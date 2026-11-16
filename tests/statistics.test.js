import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayBounds,dayKey,rangeDates,statisticsCsv,RETENTION_DAYS} from '../web/statistics.js';
import {observeStatistics,sampleKind} from '../statistics/policy.js';
import {runStatistics} from '../statistics/run.js';
import {createStatisticsIo} from '../statistics/worker.js';
import {demoStatistics} from '../web/statistics-view.js';
const at=s=>Date.parse(s),base=at('2026-11-10T10:00:00Z');
const sample=(now,kg=2621,hours=2272,phase='heating',burning=true)=>({updatedAt:now-2000,ready:true,state:{version_ack:true,sensors:{pellets_total_kg:kg,pellet_hours:hours},stove:{state:phase,is_burning:burning,has_error:false}}});
test('Ljubljana day boundaries include the 23-hour and 25-hour DST days',()=>{
 const spring=dayBounds(at('2026-03-29T12:00:00Z')),autumn=dayBounds(at('2026-10-25T12:00:00Z'));
 assert.equal(spring.endAt-spring.startAt,23*3600000);assert.equal(autumn.endAt-autumn.startAt,25*3600000);
 assert.equal(dayKey(at('2026-11-09T23:00:00Z')),'2026-11-10');assert.equal(dayKey(at('2026-11-09T22:59:59Z')),'2026-11-09');
 for(const [instant,date] of [['2026-03-29T21:59:59Z','2026-03-29'],['2026-03-29T22:00:00Z','2026-03-30'],['2026-10-25T22:59:59Z','2026-10-25'],['2026-10-25T23:00:00Z','2026-10-26']])assert.equal(dayKey(at(instant)),date);
 assert.deepEqual(rangeDates('2026-03-01',3),['2026-02-27','2026-02-28','2026-03-01']);
});
test('the first sample seeds counters and never invents historical daily consumption',()=>{
 const r=observeStatistics(null,sample(base),base);assert.equal(r.day.kg,0);assert.equal(r.day.counterHours,0);assert.equal(r.day.pelletMs,0);assert.equal(r.day.partial,true);assert.equal(r.lastCounter.kg,2621);
 assert.equal(observeStatistics(r,sample(base),base),null);assert.equal(observeStatistics(r,sample(base-60000),base-60000),null);
});
test('counter increments and confirmed pellet runtime are collected once',()=>{
 let r=observeStatistics(null,sample(base),base);r=observeStatistics(r,sample(base+60000,2622,2273),base+60000);
 assert.equal(r.day.kg,1);assert.equal(r.day.counterHours,1);assert.equal(r.day.pelletMs,60000);
 const next=observeStatistics(r,sample(base+120000,2622,2273),base+120000);assert.equal(next.day.kg,1);assert.equal(next.day.pelletMs,120000);
});
test('wood, pellet, transition and idle time remain distinct; legacy burning flags do not count ignition',()=>{
 for(const phase of ['splitlog','splitlog_refuel','splitlog_no_refuel'])assert.equal(sampleKind(sample(base,1,1,phase).state),'wood');
 for(const phase of ['burn_off','burnoff','ignition','cleaning','splitlog_check'])assert.equal(sampleKind(sample(base,1,1,phase).state),'transition');
 assert.equal(sampleKind(sample(base,1,1,'standby',true).state),'idle');assert.equal(sampleKind(sample(base,1,1,'heating',false).state),'missing');
 let r=observeStatistics(null,sample(base,1,1,'splitlog'),base);r=observeStatistics(r,sample(base+60000,1,1,'splitlog'),base+60000);r=observeStatistics(r,sample(base+120000,1,1,'burn_off'),base+120000);r=observeStatistics(r,sample(base+180000,1,1,'off',false),base+180000);
 assert.equal(r.day.woodMs,120000);assert.equal(r.day.transitionMs,60000);assert.equal(r.day.pelletMs,0);
});
test('a short midnight interval is split by local day, with the kg increment explicitly assigned to the readout day',()=>{
 const before=at('2026-11-09T22:59:30Z'),after=before+60000;
 let r=observeStatistics(null,sample(before,10,1),before);r=observeStatistics(r,sample(after,11,1),after);
 assert.equal(r.day.date,'2026-11-10');assert.equal(r.day.pelletMs,30000);assert.equal(r.pending['2026-11-09'].pelletMs,30000);assert.equal(r.day.kg,1);assert.equal(r.day.boundaryKg,1);assert.equal(r.pending['2026-11-09'].kg,0);
});
test('outages preserve unassigned counter differences and never fake hours of burning',()=>{
 let r=observeStatistics(null,sample(base,10,1),base);
 const stale=sample(base,10,1);r=observeStatistics(r,stale,base+60000);assert.equal(r.day.missingMs,60000);
 r=observeStatistics(r,sample(base+7200000,15,3),base+7200000);
 assert.equal(r.day.kg,0);assert.equal(r.unassignedKg,5);assert.equal(r.unassignedHours,2);assert.equal(r.day.pelletMs,0);assert.equal(r.day.missingMs,7200000);
});
test('counter resets, initial zero groups and implausible jumps do not become consumption',()=>{
 let r=observeStatistics(null,sample(base),base);r=observeStatistics(r,sample(base+60000,0,0),base+60000);r=observeStatistics(r,sample(base+120000),base+120000);
 assert.equal(r.day.kg,0);assert.equal(r.resets,2);assert.equal(r.day.partial,true);
 r=observeStatistics(r,sample(base+180000,2622,2272),base+180000);assert.equal(r.day.kg,1);
});
test('a collector outage spanning several days retains bounded records and marks missing coverage',()=>{
 let r=observeStatistics(null,sample(base,10,1),base);const later=base+86400000*4;
 r=observeStatistics(r,sample(later,20,5),later);assert.equal(Object.keys(r.pending).length,1);assert.equal(r.day.kg,0);assert.equal(r.unassignedKg,10);assert.equal(r.day.partial,true);assert.equal(r.day.missingMs,later-r.day.startAt);
});
test('an out-of-order counter snapshot never rewinds the consumption cursor',()=>{
 let r=observeStatistics(null,sample(base,10,1),base);r=observeStatistics(r,sample(base+60000,11,1),base+60000);
 const old=sample(base+120000,10,1);old.updatedAt=base-5000;r=observeStatistics(r,old,base+120000);assert.equal(r.lastCounter.kg,11);assert.equal(r.day.kg,1);
});
function fixture(){let runtime=null,revision=0,now=base,current=sample(base);const days={},statuses=[];let fail=false;return {days,statuses,set:(n,s)=>{now=n;current=s;},get:()=>runtime,fail:()=>{fail=true;},io:{now:()=>now,runtime:async()=>({value:structuredClone(runtime),etag:String(revision)}),sample:async()=>current,claim:async(value,etag)=>{if(etag!==String(revision))return false;runtime=structuredClone(value);revision++;return true;},publishDay:async d=>{if(fail){fail=false;throw Error('network');}if(!days[d.date]||days[d.date].observedAt<d.observedAt)days[d.date]=structuredClone(d);return true;},publishStatus:async v=>statuses.push(v),prune:async()=>{}}};}
test('publication failure after the cursor commit is repaired without double-counting',async()=>{
 const f=fixture();await runStatistics(f.io);f.set(base+60000,sample(base+60000,2622));f.fail();await assert.rejects(runStatistics(f.io));assert.equal(f.get().day.kg,1);
 f.set(base+120000,sample(base+120000,2622));await runStatistics(f.io);assert.equal(f.days['2026-11-10'].kg,1);assert.equal(f.get().day.kg,1);
});
test('parallel collectors cannot both apply a counter interval',async()=>{
 const f=fixture();await runStatistics(f.io);f.set(base+60000,sample(base+60000,2622));const results=await Promise.all([runStatistics(f.io),runStatistics(f.io)]);assert.equal(results.filter(x=>x.status==='busy').length,1);assert.equal(f.get().day.kg,1);
});
test('CSV exports only actual records, with units and incomplete-day flags',()=>{
 const r=observeStatistics(null,sample(base),base),csv=statisticsCsv({[r.day.date]:r.day});assert.ok(csv.startsWith('\uFEFFDate;'));assert.match(csv,/2026-11-10;0;0;0;0;0;0;yes/);assert.equal(csv.split('\r\n').length,2);
});
test('statistics transport reads only the approved leaves, uses conditional writes and blocks redirects',async()=>{
 const env={PARO_DATABASE_URL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',PARO_STATISTICS_FIREBASE:JSON.stringify({apiKey:'AIza-test',databaseURL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',refreshToken:'test'})},calls=[];
 const io=createStatisticsIo(env,async(url,init)=>{const path=new URL(url).pathname;calls.push({path,...init});if(path.includes('/v1/token'))return Response.json({id_token:'test',expires_in:3600});return Response.json(null,{headers:{ETag:'"null_etag"'}});});
 await io.sample();assert.equal(calls.filter(x=>x.path.startsWith('/devices/')).length,8);assert.equal(calls.some(x=>x.path.includes('command')||x.path.includes('controls')||x.path.includes('pushSubscriptions')),false);
 await io.claim({version:1},'"old"');assert.equal(calls.at(-1).headers['if-match'],'"old"');for(const c of calls)assert.equal(c.redirect,'manual');
 await assert.rejects(io.claim({},null));
 const redirected=createStatisticsIo(env,async()=>new Response(null,{status:302,headers:{Location:'https://example.invalid'}}));await assert.rejects(redirected.runtime());
});
test('retention deletes only old records, in a bounded key query',async()=>{
 const old=dayBounds(base-(RETENTION_DAYS+2)*86400000),fresh=dayBounds(base),deleted=[];let queried='';
 const env={PARO_DATABASE_URL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',PARO_STATISTICS_FIREBASE:JSON.stringify({apiKey:'AIza-test',databaseURL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',refreshToken:'test'})};
 const io=createStatisticsIo(env,async(url,init)=>{if(url.includes('securetoken'))return Response.json({id_token:'test',expires_in:3600});if(init.method==='DELETE'){deleted.push(new URL(url).pathname);return Response.json(null);}queried=url;return Response.json({[old.date]:old,[fresh.date]:fresh});});
 await io.prune(base);assert.equal(new URL(queried).searchParams.get('limitToFirst'),'8');assert.deepEqual(deleted,['/statistics/paro/days/'+old.date+'.json']);
});
test('demo daily values are consistent when the user changes the selected period',()=>{
 const week=demoStatistics('2026-11-04','2026-11-10',base),month=demoStatistics('2026-10-12','2026-11-10',base);
 for(const [date,row] of Object.entries(week))assert.deepEqual(month[date],row);
});
test('a failed rollover publication is repaired on the next tick without losing either day',async()=>{
 const f=fixture(),before=at('2026-11-10T22:59:30Z');f.set(before,sample(before,100,50));await runStatistics(f.io);
 f.set(before+60000,sample(before+60000,101,50));f.fail();await assert.rejects(runStatistics(f.io));assert.equal(f.get().pending['2026-11-10'].pelletMs,30000);
 f.set(before+120000,sample(before+120000,101,50));await runStatistics(f.io);assert.equal(f.days['2026-11-10'].pelletMs,30000);assert.equal(f.days['2026-11-11'].kg,1);assert.equal(Object.keys(f.get().pending).length,0);
});
test('failed retention is retried without blocking current-day collection',async()=>{
 const f=fixture();let calls=0;f.io.prune=async()=>{calls++;if(calls===1)throw Error('temporary retention failure');};
 assert.equal((await runStatistics(f.io)).status,'recorded');assert.equal(f.get().cleanupDate,undefined);
 f.set(base+60000,sample(base+60000,2622));await runStatistics(f.io);assert.equal(calls,2);assert.equal(f.get().day.kg,1);assert.equal(f.get().cleanupDate,'2026-11-10');
});
