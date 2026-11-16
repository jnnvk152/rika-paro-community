import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {ref,set,get,update,serverTimestamp,runTransaction,onValue} from 'firebase/database';
import {absenceEntry,completedAbsenceEntry} from '../web/absence.js';
import {observeStatistics,statisticsStatus} from '../statistics/policy.js';
let env,owner,device,stranger,anonymous;
const session='a'.repeat(32);
const sample=()=>({updatedAt:serverTimestamp(),session,ready:true,state:{version_ack:true,device:{version:'test'},stove:{has_error:false,state:'standby'},sensors:{room_sensor_connected:true},controls:{on:false,mode:'manual',power_percent:70,target_temperature:21}}});
const command=(patch={on:true},id='command-123456789')=>({...patch,id,session,issuedAt:serverTimestamp(),expiresAt:Date.now()+12000});
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-paro',database:{host:'127.0.0.1',port:9000,rules:await readFile('database.rules.template.json','utf8')}});
 const google={email:'owner@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 owner=env.authenticatedContext('owner',google).database();
 device=env.authenticatedContext('module',{firebase:{sign_in_provider:'anonymous'}}).database();
 stranger=env.authenticatedContext('stranger',{...google,email:'other@example.com'}).database();
 anonymous=env.unauthenticatedContext().database();
});
beforeEach(async()=>{
 await env.clearDatabase();
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'deviceAccess/paro'),{uid:'module'}));
 await set(ref(device,'devices/paro/telemetry'),sample());
});
after(async()=>{await env?.cleanup();});
test('statistics collector has only narrow counter/state reads and cannot touch heating or other private data',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'statisticsAccess/paro'),{uid:'statistics'}));
 const statistics=env.authenticatedContext('statistics',{firebase:{sign_in_provider:'anonymous'}}).database();
 for(const leaf of ['updatedAt','ready','state/version_ack','state/sensors/pellets_total_kg','state/sensors/pellet_hours','state/stove/state','state/stove/is_burning','state/stove/has_error'])await assertSucceeds(get(ref(statistics,'devices/paro/telemetry/'+leaf)));
 for(const path of ['devices/paro/telemetry','devices/paro/telemetry/state/controls','devices/paro/command','comfortPlan/paro','pushSubscriptions','members','deviceAccess','statisticsAccess','devices/other/telemetry/updatedAt'])await assertFails(get(ref(statistics,path)));
 for(const path of ['devices/paro/command','devices/paro/telemetry','devices/paro/receipt','members/statistics','deviceAccess/paro','statisticsAccess/paro','comfortPlan/paro'])await assertFails(set(ref(statistics,path),{on:true}));
});
test('statistics is shared only with approved people; cursor writes are collector-only, monotonic and schema-checked',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'statisticsAccess/paro'),{uid:'statistics'}));
 const statistics=env.authenticatedContext('statistics',{firebase:{sign_in_provider:'anonymous'}}).database(),now=Date.now();
 const s={...sample(),updatedAt:now,state:{...sample().state,stove:{has_error:false,state:'heating',is_burning:true},sensors:{pellets_total_kg:100,pellet_hours:50}}};
 const r=observeStatistics(null,s,now),row={...r.day,updatedAt:serverTimestamp()},status={...statisticsStatus(r),updatedAt:serverTimestamp()};
 for(const db of [owner,device,stranger,anonymous])await assertFails(set(ref(db,'statisticsRuntime/paro'),r));
 await assertSucceeds(set(ref(statistics,'statisticsRuntime/paro'),r));await assertFails(set(ref(statistics,'statisticsRuntime/paro'),r));
 for(const patch of [{version:2},{lastKind:'fake'},{extra:true},{unassignedKg:-1}])await assertFails(set(ref(statistics,'statisticsRuntime/paro'),{...r,tick:r.tick+1,...patch}));
 await assertSucceeds(set(ref(statistics,'statistics/paro/days/'+row.date),row));await assertSucceeds(set(ref(statistics,'statistics/paro/status'),status));await assertSucceeds(get(ref(statistics,'statistics/paro/status')));
 for(const db of [anonymous,stranger,device]){await assertFails(get(ref(db,'statistics/paro')));await assertFails(set(ref(db,'statistics/paro/days/'+row.date),row));}
 await assertSucceeds(get(ref(owner,'statistics/paro')));await assertFails(get(ref(owner,'statisticsRuntime/paro')));
 const member=env.authenticatedContext('approved-statistics',{email:'approved@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).database();
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'members/approved-statistics'),{enabled:true}));await assertSucceeds(get(ref(member,'statistics/paro')));await assertFails(set(ref(member,'statistics/paro/status'),status));
 for(const patch of [{extra:true},{woodMs:90000001},{kg:-1},{partial:'yes'}])await assertFails(set(ref(statistics,'statistics/paro/days/'+row.date),{...row,...patch}));
 await assertFails(set(ref(statistics,'statistics/paro/days/'+row.date),null));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'statisticsAccess/paro'),null));await assertFails(get(ref(statistics,'statisticsRuntime/paro')));await assertFails(set(ref(statistics,'statistics/paro/status'),status));
});
test('automatic statistics retention can delete expired days but never recent history',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'statisticsAccess/paro'),{uid:'statistics'}));
 const statistics=env.authenticatedContext('statistics',{firebase:{sign_in_provider:'anonymous'}}).database();
 await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'statistics/paro/days/old'),{endAt:Date.now()-157852800001});await set(ref(c.database(),'statistics/paro/days/recent'),{endAt:Date.now()-86400000});});
 await assertSucceeds(set(ref(statistics,'statistics/paro/days/old'),null));await assertFails(set(ref(statistics,'statistics/paro/days/recent'),null));await assertFails(set(ref(owner,'statistics/paro/days/old'),null));
});
test('return plans are private, shared only with approved users and the reminder, and stale edits cannot overwrite newer plans',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database();
 const first={id:'00000000-0000-0000-0000-000000000000',revision:1,active:true,returnDate:'2026-10-26',remindAt:Date.now()+86400000,confirmation:'pending',updatedAt:serverTimestamp(),uid:'owner'};
 for(const db of [anonymous,stranger,device,watcher])await assertFails(set(ref(db,'absencePlans/paro'),first));
 await assertSucceeds(set(ref(owner,'absencePlans/paro'),first));
 await assertSucceeds(get(ref(watcher,'absencePlans/paro')));await assertSucceeds(get(ref(device,'absencePlans/paro')));await assertFails(get(ref(device,'absencePlans/other')));
 await assertFails(set(ref(owner,'absencePlans/paro'),{...first,confirmation:'confirmed'}));
 const yes={...first,revision:2,confirmation:'confirmed'};await assertSucceeds(set(ref(owner,'absencePlans/paro'),yes));
 await assertFails(set(ref(owner,'absencePlans/paro'),{...yes,revision:3,returnDate:'2026-10-27'}));
 await assertSucceeds(set(ref(owner,'absencePlans/paro'),{...yes,id:'10000000-0000-0000-0000-000000000000',revision:3,returnDate:'2026-10-27',confirmation:'pending'}));
});
test('a confirmed return closes absence atomically, without heater commands or overwriting an extended date',async t=>{
 const path=ref(owner,'absencePlans/paro'),now=Date.parse('2026-11-16T07:00Z'),first=absenceEntry(null,{returnDate:'2026-11-17'},'owner',now);
 await set(path,{...first,updatedAt:serverTimestamp()});
 // Cloud keeps an active absence listener; transactions use that synchronized cache.
 let stop;await new Promise((resolve,reject)=>{stop=onValue(path,resolve,reject);});t.after(()=>stop());
 const state={device:{capabilities:{return_schedule:true}},home:{return:{id:first.id,return_date:first.returnDate,status:'completed',durable:true}}};
 const close=()=>runTransaction(path,current=>{const entry=completedAbsenceEntry(current,state,'owner',now);return entry?{...entry,updatedAt:serverTimestamp()}:undefined;},{applyLocally:false});
 const result=await close();assert.equal(result.committed,true);const closed=result.snapshot.val();assert.equal(closed.active,false);assert.equal(closed.revision,2);
 await env.withSecurityRulesDisabled(async c=>assert.equal((await get(ref(c.database(),'devices/paro/command'))).exists(),false));
 const next=absenceEntry(closed,{returnDate:first.returnDate},'owner',now);await set(path,{...next,updatedAt:serverTimestamp()});assert.equal((await close()).committed,false);assert.equal((await get(path)).val().id,next.id);
 const extended=absenceEntry(next,{returnDate:'2026-11-18'},'owner',now);await set(path,{...extended,updatedAt:serverTimestamp()});assert.equal((await close()).committed,false);assert.equal((await get(path)).val().returnDate,'2026-11-18');
});
test('night configuration is bounded, readable by the module, and cannot be changed by the external monitor',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database(),value={night_end_minute:1380,updatedAt:serverTimestamp(),uid:'owner'};
 for(const db of [anonymous,stranger,device,watcher])await assertFails(set(ref(db,'homeConfig/paro'),value));
 await assertSucceeds(set(ref(owner,'homeConfig/paro'),value));await assertSucceeds(get(ref(device,'homeConfig/paro')));await assertFails(get(ref(watcher,'homeConfig/paro')));
 for(const patch of [{night_end_minute:-1},{night_end_minute:1440},{night_end_minute:12.5},{on:true},{uid:'stranger'}])await assertFails(set(ref(owner,'homeConfig/paro'),{...value,...patch}));
});
test('external monitor can read only approved metadata and pellet inputs, never stove controls or private profiles',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database();
 for(const path of ['devices/paro/telemetry/updatedAt','devices/paro/telemetry/ready','pushSubscriptions','members/stranger/enabled','watchdogConfig/paro','watchdogRuntime/paro','watchdogTests/paro','pelletStock/paro','devices/paro/telemetry/state/sensors/pellets_total_kg','devices/paro/telemetry/state/hopper'])await assertSucceeds(get(ref(watcher,path)));
 for(const path of ['devices/paro/telemetry','devices/paro/telemetry/state','devices/paro/command','members','members/owner/email','deviceAccess','watchdogAccess','devices/paro/telemetry/state/sensors','devices/paro/telemetry/state/sensors/room_temperature','devices/paro/telemetry/state/controls'])await assertFails(get(ref(watcher,path)));
 await assertFails(set(ref(watcher,'devices/paro/telemetry'),sample()));
 await assertFails(set(ref(watcher,'devices/paro/command'),command()));
 for(const path of ['members/stranger','deviceAccess/paro','watchdogAccess/paro','watchdogConfig/paro','watchdogTests/paro','pushSubscriptions/owner/'+'a'.repeat(64)])await assertFails(set(ref(watcher,path),{enabled:true}));
 for(const db of [anonymous,stranger,device,owner])await assertFails(get(ref(db,'watchdogRuntime/paro')));
});
test('monitor lease, status and test receipts are bounded and writable only by the registered monitor',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database(),now=Date.now();
 const value={version:1,phase:'online',reason:'online',lastSeen:now,since:0,sequence:0,eventKind:'none',eventAt:0,pending:false,lastTest:'',lease:'',leaseUntil:0,checkedAt:serverTimestamp()};
 await assertSucceeds(set(ref(watcher,'watchdogRuntime/paro'),value));
 for(const patch of [{extra:true},{leaseUntil:now+60000},{phase:'fake'},{lastSeen:now+10000},{delivered:{'invalid-id':true}},{pending:'true'}])await assertFails(set(ref(watcher,'watchdogRuntime/paro'),{...value,...patch}));
 const status={checkedAt:serverTimestamp(),lastSeen:now,phase:'online',lastEventAt:0,http:201};
 for(const db of [owner,device,stranger,anonymous])await assertFails(set(ref(db,'watchdogStatus/paro'),status));
 await assertSucceeds(set(ref(watcher,'watchdogStatus/paro'),status));await assertSucceeds(get(ref(owner,'watchdogStatus/paro')));
 const nonce='00000000-0000-0000-0000-000000000000';
 await assertFails(set(ref(watcher,'watchdogTestReceipt/paro'),{nonce,status:'accepted',http:201,updatedAt:serverTimestamp()}));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogTests/paro'),{nonce}));
 await assertSucceeds(set(ref(watcher,'watchdogTestReceipt/paro'),{nonce,status:'accepted',http:201,updatedAt:serverTimestamp()}));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),null));
 await assertFails(get(ref(watcher,'devices/paro/telemetry/updatedAt')));
 await assertFails(set(ref(watcher,'watchdogRuntime/paro'),value));
});
test('only verified owner Google login can read telemetry; the URL grants no access',async()=>{
 await assertSucceeds(get(ref(owner,'devices/paro/telemetry')));
 for(const db of [anonymous,stranger,device])await assertFails(get(ref(db,'devices/paro/telemetry')));
 const unverified=env.authenticatedContext('unverified',{email:'owner@example.invalid',email_verified:false,firebase:{sign_in_provider:'google.com'}}).database();
 const wrongProvider=env.authenticatedContext('emailPassword',{email:'owner@example.invalid',email_verified:true,firebase:{sign_in_provider:'password'}}).database();
 for(const db of [unverified,wrongProvider])await assertFails(set(ref(db,'devices/paro/command'),command()));
});
test('device has access only to its command and can never grant itself access to another stove',async()=>{
 await assertFails(set(ref(device,'deviceAccess/other'),{uid:'module'}));
 await assertFails(set(ref(device,'devices/other/telemetry'),sample()));
 await assertFails(get(ref(device,'deviceAccess')));
 await assertSucceeds(get(ref(device,'devices/paro/command')));
 await assertFails(set(ref(device,'devices/paro/command'),command()));
});
test('every original control is writable by owner within the new validation rules',async()=>{
 for(const [index,patch] of [{on:true},{on:false},{mode:'manual'},{mode:'auto'},{mode:'comfort'},{power_percent:30},{power_percent:100},{target_temperature:14},{target_temperature:28}].entries()){
  const id=`command-123456789-${index}`;
  await assertSucceeds(set(ref(owner,'devices/paro/command'),command(patch,id)));
  await assertSucceeds(set(ref(device,'devices/paro/receipt'),{id,status:'sent',updatedAt:serverTimestamp(),reason:''}));
 }
});
test('invalid, stale or foreign-session commands and unsigned writes are denied',async()=>{
 const bad=[command({}),command({unknown:true}),command({on:'true'}),command({power_percent:29}),command({power_percent:65.5}),command({target_temperature:29}),command({mode:'x'}),{...command(),expiresAt:Date.now()-1000},{...command(),expiresAt:Date.now()+60000},{...command(),session:'b'.repeat(32)},{...command(),issuedAt:1}];
 for(const c of bad)await assertFails(set(ref(owner,'devices/paro/command'),c));
 for(const db of [anonymous,stranger])await assertFails(set(ref(db,'devices/paro/command'),command()));
 await set(ref(device,'devices/paro/telemetry'),{...sample(),ready:false});
 await assertFails(set(ref(owner,'devices/paro/command'),command()));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'devices/paro/telemetry'),{...sample(),updatedAt:Date.now()-31000}));
 await assertFails(set(ref(owner,'devices/paro/command'),command()));
});
test('an unacknowledged command cannot be overwritten or repeated',async()=>{
 const first=command();await set(ref(owner,'devices/paro/command'),first);
 await assertFails(set(ref(owner,'devices/paro/command'),command({on:false},'other-command-123456789')));
 await set(ref(device,'devices/paro/receipt'),{id:first.id,status:'sent',updatedAt:serverTimestamp(),reason:''});
 await assertFails(set(ref(owner,'devices/paro/command'),first));
 await assertSucceeds(set(ref(owner,'devices/paro/command'),command({on:false},'other-command-123456789')));
 assert.equal((await get(ref(device,'devices/paro/command'))).val().on,false);
});
test('a signed-in guest requests access; only owner may approve, remove or list users',async()=>{
 await assertFails(get(ref(stranger,'members')));
 await assertFails(get(ref(stranger,'accessRequests')));
 await assertFails(get(ref(stranger,'ownerCheck')));
 await assertSucceeds(get(ref(owner,'ownerCheck')));
 await assertFails(set(ref(stranger,'accessRequests/stranger'),{email:'owner@example.invalid',createdAt:serverTimestamp()}));
 await assertFails(set(ref(stranger,'accessRequests/someoneElse'),{email:'other@example.com',createdAt:serverTimestamp()}));
 await assertSucceeds(set(ref(stranger,'accessRequests/stranger'),{email:'other@example.com',createdAt:serverTimestamp()}));
 const membership={email:'other@example.com',enabled:true,createdAt:serverTimestamp()};
 await assertFails(set(ref(stranger,'members/stranger'),membership));
 await assertSucceeds(update(ref(owner),{'members/stranger':membership,'accessRequests/stranger':null}));
 await assertSucceeds(get(ref(stranger,'devices/paro/telemetry')));
 await assertSucceeds(set(ref(stranger,'devices/paro/command'),command()));
 await assertFails(set(ref(stranger,'members/another'),membership));
 await assertFails(set(ref(stranger,'members/stranger'),null));
 await assertSucceeds(set(ref(owner,'members/stranger'),null));
 await set(ref(device,'devices/paro/receipt'),{id:'command-123456789',status:'sent',updatedAt:serverTimestamp(),reason:''});
 await assertFails(set(ref(stranger,'devices/paro/command'),command({on:false},'another-command-123456789')));
});

test('complete schedules require capable firmware and retain strict field validation',async()=>{
 const {demoSchedule,SLOT_KEYS}=await import('../web/schedule.js');
 const schedule=demoSchedule();schedule.active=true;schedule.slots.heatTimeMon1=6000900;
 const patch={mode:'auto',power_percent:70,schedule};
 await assertFails(set(ref(owner,'devices/paro/command'),command(patch)));
 const telemetry=sample();telemetry.state.device.capabilities={schedule:true};
 await set(ref(device,'devices/paro/telemetry'),telemetry);
 await assertFails(set(ref(owner,'devices/paro/command'),command(patch)));
 telemetry.state.schedule={...schedule.slots};telemetry.state.controls.heating_times_active=false;telemetry.state.controls.setback_temperature=16;
 await set(ref(device,'devices/paro/telemetry'),telemetry);
 for(const db of [anonymous,stranger,device])await assertFails(set(ref(db,'devices/paro/command'),command(patch)));
 for(const key of SLOT_KEYS){
  for(const value of [-1,6000960,23600000,9000600,6000600,1.5,'6000900']){
   const invalid=structuredClone(patch);invalid.schedule.slots[key]=value;
   await assertFails(set(ref(owner,'devices/paro/command'),command(invalid)));
  }
  const missing=structuredClone(patch);delete missing.schedule.slots[key];await assertFails(set(ref(owner,'devices/paro/command'),command(missing)));
 }
 for(const modify of [p=>p.on=false,p=>p.target_temperature=20,p=>p.mode='manual',p=>p.schedule.active='true',p=>p.schedule.setback_temperature=23,p=>p.schedule.slots.extra=0,p=>p.schedule.extra=0,p=>p.schedule.slots.heatTimeMon2=8591200]){
  const invalid=structuredClone(patch);modify(invalid);await assertFails(set(ref(owner,'devices/paro/command'),command(invalid)));
 }
 await assertSucceeds(set(ref(owner,'devices/paro/command'),command(patch)));
 assert.deepEqual((await get(ref(device,'devices/paro/command'))).val().schedule,schedule);
});

test('push subscriptions are private, tied to the approved user, and cannot target other servers',async()=>{
 const id='a'.repeat(64),path=`pushSubscriptions/owner/${id}`;
 const value={enabled:true,owner:true,deviceId:'paro',createdAt:serverTimestamp(),endpoint:'https://fcm.googleapis.com/fcm/send/'+'a'.repeat(100),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 await assertSucceeds(set(ref(owner,path),value));
 for(const db of [anonymous,stranger])await assertFails(get(ref(db,path)));
 for(const db of [anonymous,stranger,device])await assertFails(set(ref(db,path),value));
 await assertSucceeds(get(ref(device,path)));
 await assertFails(get(ref(device,'members')));
 await assertFails(get(ref(device,'members/owner/email')));
 await assertFails(get(ref(owner,'pushSubscriptions')));
 await assertFails(set(ref(owner,`pushSubscriptions/stranger/${id}`),value));
 for(const endpoint of ['http://127.0.0.1/admin','https://example.com/'+'a'.repeat(30),'https://fcm.googleapis.com.evil.test/fcm/send/'+'a'.repeat(30),'https://user:pass@fcm.googleapis.com/fcm/send/'+'a'.repeat(30)])await assertFails(set(ref(owner,path),{...value,endpoint}));
 await assertFails(set(ref(owner,path),{...value,keys:{...value.keys,extra:'unknown'}}));
 await assertFails(set(ref(owner,path),{...value,enabled:'true'}));
 await assertFails(set(ref(owner,'notificationConfig/paro'),{ready:true,publicKey:'fake'}));
 await assertFails(get(ref(stranger,'notificationConfig/paro')));
 await assertSucceeds(get(ref(owner,'notificationConfig/paro')));
 await assertFails(set(ref(owner,'notificationRuntime/paro'),{fingerprint:'override'}));
 await assertFails(get(ref(owner,'notificationRuntime/paro')));
 await assertSucceeds(set(ref(owner,path),null));
});

test('pellet confirmations are private, immutable, shared with approved members and cannot forge stove counters',async()=>{
 const telemetry=sample();telemetry.state.sensors.pellets_total_kg=2600;
 const id='a'.repeat(16)+'-1',at=Date.now()-1000;
 telemetry.state.hopper={events:{[id]:{seq:1,at,counter:2599}}};
 await set(ref(device,'devices/paro/telemetry'),telemetry);
 const path=`pelletStock/paro/${id}`,answer={kind:'add',kg:15,counter:2599,at,recordedAt:serverTimestamp(),uid:'owner'};
 for(const db of [anonymous,stranger,device]){await assertFails(get(ref(db,'pelletStock/paro')));await assertFails(set(ref(db,path),answer));}
 for(const patch of [{kg:31},{kg:-1},{counter:2598},{at:at-1},{uid:'stranger'},{kind:'remaining'},{extra:true},{kind:'full',kg:15}])await assertFails(set(ref(owner,path),{...answer,...patch}));
 await assertSucceeds(set(ref(owner,path),answer));
 await assertFails(set(ref(owner,path),{...answer,kg:10}));
 await assertFails(set(ref(owner,path),null));
 await assertSucceeds(get(ref(owner,'pelletStock/paro')));
 const manual='manual-00000000-0000-0000-0000-000000000000';
 const baseline={kind:'remaining',kg:8,counter:2600,at:serverTimestamp(),recordedAt:serverTimestamp(),uid:'owner'};
 await assertFails(set(ref(owner,`pelletStock/paro/${manual}`),{...baseline,counter:2601}));
 await assertFails(set(ref(owner,`pelletStock/paro/${manual}`),{...baseline,kind:'add'}));
 await assertSucceeds(set(ref(owner,`pelletStock/paro/${manual}`),baseline));
 await assertFails(set(ref(owner,'pelletStock/other/'+manual),baseline));
});

test('only one phone can answer an opening; old or nonexistent events cannot be invented',async()=>{
 const telemetry=sample(),id='b'.repeat(16)+'-2',at=Date.now()-1000;
 telemetry.state.sensors.pellets_total_kg=2700;telemetry.state.hopper={events:{[id]:{seq:2,at,counter:2699}}};
 await set(ref(device,'devices/paro/telemetry'),telemetry);
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'members/stranger'),{email:'other@example.com',enabled:true,createdAt:Date.now()}));
 const answer={kind:'none',kg:0,counter:2699,at,recordedAt:serverTimestamp(),uid:'stranger'};
 await assertFails(set(ref(stranger,'pelletStock/paro/'+'b'.repeat(16)+'-3'),answer));
 await assertSucceeds(set(ref(stranger,'pelletStock/paro/'+id),answer));
 await assertSucceeds(get(ref(stranger,'pelletStock/paro')));
 await assertFails(set(ref(owner,'pelletStock/paro/'+id),{...answer,kind:'full',kg:30,uid:'owner'}));
 await set(ref(owner,'members/stranger'),null);
 await assertFails(get(ref(stranger,'pelletStock/paro')));
});

test('direct ESP32 push reads only subscriptions, public config and membership flags, never control or profile privileges',async()=>{
 const id='c'.repeat(64),subscription={deviceId:'paro',enabled:true,owner:true,createdAt:serverTimestamp(),endpoint:'https://web.push.apple.com/'+'a'.repeat(60),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 await set(ref(owner,'pushSubscriptions/owner/'+id),subscription);
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'notificationConfig/paro'),{ready:false,mode:'device',publicKey:'B'.repeat(87)}));
 await assertSucceeds(get(ref(device,'pushSubscriptions')));
 await assertSucceeds(get(ref(device,'notificationConfig/paro')));
 await assertSucceeds(get(ref(device,'members/stranger/enabled')));
 for(const path of ['members','members/owner/email','ownerCheck','accessRequests'])await assertFails(get(ref(device,path)));
 await assertFails(set(ref(device,'notificationConfig/paro'),{ready:true}));
 await assertFails(set(ref(device,'members/stranger/enabled'),true));
 await assertFails(set(ref(device,'pushSubscriptions/owner/'+id),subscription));
});

test('a phone test is limited to its own subscription, expires in one minute and only the module can acknowledge it',async()=>{
 const id='d'.repeat(64),nonce='00000000-0000-4000-8000-000000000001';
 const subscription={deviceId:'paro',enabled:true,owner:true,createdAt:serverTimestamp(),endpoint:'https://web.push.apple.com/'+'a'.repeat(60),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 await set(ref(owner,'pushSubscriptions/owner/'+id),subscription);
 const request={nonce,subscription:id,createdAt:serverTimestamp(),expiresAt:Date.now()+59000},path='devicePushTests/paro/owner';
 for(const db of [anonymous,stranger,device])await assertFails(set(ref(db,path),request));
 for(const patch of [{subscription:'a'.repeat(64)},{expiresAt:Date.now()-1},{expiresAt:Date.now()+120000},{extra:true}])await assertFails(set(ref(owner,path),{...request,...patch}));
 await assertFails(set(ref(owner,'devicePushTests/paro/stranger'),request));
 await assertSucceeds(set(ref(owner,path),request));
 await assertFails(set(ref(owner,path),{...request,nonce:'00000000-0000-4000-8000-000000000002'}));
 await assertSucceeds(get(ref(device,'devicePushTests/paro')));
 const receipt={nonce,status:'accepted',http:201,updatedAt:serverTimestamp()},receiptPath='devicePushReceipts/paro/owner';
 for(const db of [owner,stranger,anonymous])await assertFails(set(ref(db,receiptPath),receipt));
 await assertFails(set(ref(device,receiptPath),{...receipt,nonce:'wrong'}));
 await assertSucceeds(set(ref(device,receiptPath),receipt));
 await assertSucceeds(get(ref(owner,receiptPath)));
 await assertFails(get(ref(stranger,receiptPath)));
 assert.equal((await get(ref(device,'devices/paro/command'))).exists(),false);
});

test('approved guests cannot claim owner status and a revoked member loses test access',async()=>{
 const id='e'.repeat(64),path='pushSubscriptions/stranger/'+id;
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'members/stranger'),{enabled:true,email:'other@example.com',createdAt:Date.now()}));
 const subscription={deviceId:'paro',enabled:true,owner:true,createdAt:serverTimestamp(),endpoint:'https://web.push.apple.com/'+'a'.repeat(60),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 await assertFails(set(ref(stranger,path),subscription));
 await assertSucceeds(set(ref(stranger,path),{...subscription,owner:false}));
 assert.equal((await get(ref(device,path))).val().owner,false);
 await set(ref(owner,'members/stranger'),null);
 assert.equal((await get(ref(device,'members/stranger/enabled'))).val(),null);
 await assertFails(set(ref(stranger,'devicePushTests/paro/stranger'),{nonce:'00000000-0000-4000-8000-000000000001',subscription:id,createdAt:serverTimestamp(),expiresAt:Date.now()+50000}));
});

test('pellet alert monitoring has narrowly scoped reads and cannot edit stock or control the stove',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database();
 for(const path of ['pelletStock/paro','devices/paro/telemetry/state/hopper','devices/paro/telemetry/state/sensors/pellets_total_kg','pelletAlertRuntime/paro','pelletAlertTests/paro'])await assertSucceeds(get(ref(watcher,path)));
 for(const path of ['devices/paro/telemetry','devices/paro/telemetry/state/controls','devices/paro/telemetry/state/sensors/room_temperature','pelletStock/other','homeConfig/paro'])await assertFails(get(ref(watcher,path)));
 await assertFails(set(ref(watcher,'pelletStock/paro/manual-test'),{kind:'full',kg:30,counter:10,at:Date.now(),recordedAt:serverTimestamp(),uid:'watcher'}));
 await assertFails(set(ref(watcher,'devices/paro/command'),command()));
 const runtime={version:1,fired:0,sequence:0,eventLevel:0,eventAt:0,pending:false,lastTest:'',lease:'',leaseUntil:0,checkedAt:serverTimestamp()};
 await assertSucceeds(set(ref(watcher,'pelletAlertRuntime/paro'),runtime));
 for(const db of [owner,device,stranger,anonymous]){await assertFails(get(ref(db,'pelletAlertRuntime/paro')));await assertFails(set(ref(db,'pelletAlertRuntime/paro'),runtime));}
 for(const patch of [{fired:8},{eventLevel:30},{pending:1},{delivered:{bad:true}},{leaseUntil:Date.now()+60000},{extra:true}])await assertFails(set(ref(watcher,'pelletAlertRuntime/paro'),{...runtime,...patch}));
 const status={checkedAt:serverTimestamp(),lastValidAt:Date.now(),level:50,reason:'ready',http:201,lastEventAt:Date.now()};
 await assertSucceeds(set(ref(watcher,'pelletAlertStatus/paro'),status));await assertSucceeds(get(ref(owner,'pelletAlertStatus/paro')));await assertFails(get(ref(stranger,'pelletAlertStatus/paro')));await assertFails(set(ref(owner,'pelletAlertStatus/paro'),status));
 const nonce='00000000-0000-0000-0000-000000000000',receipt={nonce,status:'accepted',http:201,updatedAt:serverTimestamp()};
 await assertFails(set(ref(watcher,'pelletAlertTestReceipt/paro'),receipt));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'pelletAlertTests/paro'),{nonce}));
 await assertSucceeds(set(ref(watcher,'pelletAlertTestReceipt/paro'),receipt));
 await assertFails(set(ref(watcher,'pelletAlertTests/paro'),{nonce}));
});
test('ash records are private, immutable and tied to fresh real counters; only the monitor can write its runtime',async()=>{
 await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'});await update(ref(c.database(),'devices/paro/telemetry/state/sensors'),{pellets_total_kg:2609,pellet_hours:2258});});
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database(),path='ashEmptyings/paro/'+'a'.repeat(36),at=(await get(ref(owner,'devices/paro/telemetry/updatedAt'))).val();
 const entry={at:serverTimestamp(),recordedAt:serverTimestamp(),sampleAt:at,kg:2609,hours:2258,source:'app',uid:'owner'};
 for(const db of [anonymous,stranger,device,watcher])await assertFails(set(ref(db,path),entry));
 for(const patch of [{kg:2608},{hours:2257},{source:'reported'},{uid:'stranger'},{extra:true},{sampleAt:1}])await assertFails(set(ref(owner,path),{...entry,...patch}));
 await assertSucceeds(set(ref(owner,path),entry));await assertFails(set(ref(owner,path),entry));await assertFails(set(ref(owner,path),null));
 await assertSucceeds(get(ref(watcher,'ashEmptyings/paro')));await assertSucceeds(get(ref(watcher,'devices/paro/telemetry/state/sensors/pellet_hours')));
 for(const db of [anonymous,stranger,device])await assertFails(get(ref(db,'ashEmptyings/paro')));
 await assertFails(get(ref(watcher,'ashEmptyings/other')));
 const runtime={version:1,cycle:'a'.repeat(36),eventAt:0,lease:'',leaseUntil:0,checkedAt:serverTimestamp()};
 await assertSucceeds(set(ref(watcher,'ashAlertRuntime/paro'),runtime));
 for(const db of [owner,stranger,device,anonymous]){await assertFails(set(ref(db,'ashAlertRuntime/paro'),runtime));await assertFails(get(ref(db,'ashAlertRuntime/paro')));}
 for(const patch of [{cycle:'bad'},{on:true},{leaseUntil:Date.now()+60000},{delivered:{bad:true}}])await assertFails(set(ref(watcher,'ashAlertRuntime/paro'),{...runtime,...patch}));
 const status={checkedAt:serverTimestamp(),reason:'learning',due:false,http:0,lastEventAt:0};await assertSucceeds(set(ref(watcher,'ashAlertStatus/paro'),status));await assertSucceeds(get(ref(owner,'ashAlertStatus/paro')));
 await assertFails(set(ref(owner,'ashAlertStatus/paro'),status));await assertFails(set(ref(watcher,'ashAlertStatus/paro'),{...status,reason:'full'}));
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),null));await assertFails(get(ref(watcher,'ashEmptyings/paro')));
});
test('daily Comfort settings are private, bounded and revision checked; neither device nor watchdog can change them',async()=>{
 await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),'watchdogAccess/paro'),{uid:'watcher'}));
 const watcher=env.authenticatedContext('watcher',{firebase:{sign_in_provider:'anonymous'}}).database();
 const value={version:1,enabled:true,day_start_minute:360,night_start_minute:1260,day_temperature:20,night_mode:'frost',night_temperature:16,frost_temperature:5,revision:1,updatedAt:serverTimestamp(),uid:'owner'};
 for(const db of [anonymous,stranger,device,watcher])await assertFails(set(ref(db,'comfortPlan/paro'),value));
 for(const patch of [{day_start_minute:1260},{night_start_minute:200},{day_temperature:13},{night_temperature:29},{frost_temperature:11},{frost_temperature:3},{enabled:'true'},{night_mode:'off'},{uid:'stranger'},{revision:2},{on:true}])await assertFails(set(ref(owner,'comfortPlan/paro'),{...value,...patch}));
 await assertSucceeds(set(ref(owner,'comfortPlan/paro'),value));await assertSucceeds(get(ref(device,'comfortPlan/paro')));
 for(const db of [anonymous,stranger,watcher])await assertFails(get(ref(db,'comfortPlan/paro')));
 await assertFails(set(ref(owner,'comfortPlan/paro'),value));await assertSucceeds(set(ref(owner,'comfortPlan/paro'),{...value,night_mode:'temperature',revision:2}));await assertFails(set(ref(owner,'comfortPlan/paro'),null));
});
test('cycle resume/pause use the ordinary session and permission boundaries and cannot bypass faults or mix commands',async()=>{
 await env.withSecurityRulesDisabled(async c=>update(ref(c.database(),'devices/paro/telemetry/state'),{device:{version:'test',capabilities:{comfort_cycle:true}},home:{cycle:{enabled:true,manual_paused:false}},sensors:{room_sensor_connected:true}}));
 const pause=command({cycle_action:'pause'});
 await assertSucceeds(set(ref(owner,'devices/paro/command'),pause));
 await assertSucceeds(set(ref(device,'devices/paro/receipt'),{id:pause.id,status:'sent',reason:'',updatedAt:serverTimestamp()}));
 for(const [n,patch] of [{cycle_action:'invalid'},{cycle_action:'resume',on:true},{cycle_action:'pause',target_temperature:21}].entries())await assertFails(set(ref(owner,'devices/paro/command'),command(patch,'cycle-bad-command-'+n)));
 await env.withSecurityRulesDisabled(async c=>update(ref(c.database(),'devices/paro/telemetry/state/stove'),{has_error:true}));
 await assertFails(set(ref(owner,'devices/paro/command'),command({cycle_action:'resume'},'cycle-resume-fault')));
 await assertSucceeds(set(ref(owner,'devices/paro/command'),command({cycle_action:'pause'},'cycle-pause-fault')));
});
