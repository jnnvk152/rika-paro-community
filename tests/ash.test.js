import {test} from 'node:test';import assert from 'node:assert/strict';
import {ashReading,ashMessage} from '../web/ash.js';import {runAshMonitor} from '../monitor/ash.js';
const now=1793000000000,a='a'.repeat(36),b='b'.repeat(36),c='c'.repeat(36);
const input=(kg=180,hours=80)=>({sample:{updatedAt:now,ready:true,state:{sensors:{pellets_total_kg:kg,pellet_hours:hours}}},entries:{[a]:{at:now-200000,kg:100,hours:20},[b]:{at:now-100000,kg:140,hours:50}}});
test('ash reminders require two emptyings; elapsed calendar time and the service counter are not thresholds',()=>{
 let i=input();delete i.entries[a];i.sample.state.sensors.service_countdown_kg=0;let r=ashReading(i.sample,i.entries,now);assert.equal(r.reason,'learning');assert.equal(r.due,false);assert.equal(r.usedKg,40);
 assert.equal(ashReading(i.sample,{},now).reason,'initial');
});
test('latest observed kg interval is primary; hours are fallback only when kg did not change',()=>{
 let i=input(179,100),r=ashReading(i.sample,i.entries,now);assert.equal(r.interval,40);assert.equal(r.due,false);assert.equal(r.basis,'kg');
 i=input(180,80);r=ashReading(i.sample,i.entries,now);assert.equal(r.due,true);assert.match(ashMessage(r,now).body,/40 kg/);
 i.entries[b].kg=100;i.sample.state.sensors.pellets_total_kg=100;r=ashReading(i.sample,i.entries,now);assert.equal(r.basis,'hours');assert.equal(r.interval,30);assert.equal(r.due,true);
});
test('stale, missing, future, reset counters and a new emptying suppress stale ash reminders',()=>{
 const i=input();for(const patch of [{ready:false},{updatedAt:now-30000},{updatedAt:now+3000}])assert.equal(ashReading({...i.sample,...patch},i.entries,now).due,false);
 assert.equal(ashReading({...i.sample,state:{}},i.entries,now).reason,'counter');
 for(const [kg,hours] of [[139,80],[180,49]]){const j=input(kg,hours);assert.equal(ashReading(j.sample,j.entries,now).reason,'reset');}
 i.entries[c]={at:now-1000,kg:180,hours:80};assert.equal(ashReading(i.sample,i.entries,now).due,false);
 i.entries[c]={at:now-1000,kg:10,hours:1};assert.equal(ashReading(input(10,1).sample,i.entries,now).reason,'reset');
});
const phoneId='a'.repeat(64),sub={deviceId:'paro',enabled:true,owner:true,endpoint:'https://web.push.apple.com/'+'x'.repeat(40),keys:{p256dh:'B'+'A'.repeat(86),auth:'A'.repeat(22)}};
function harness(i=input()){
 let runtime=null;const sent=[],statuses=[];
 const io={now:()=>now,publicKey:'key',config:async()=>({ready:true,publicKey:'key'}),ashInput:async()=>structuredClone(i),ashRuntime:async()=>({value:runtime,etag:'one'}),ashClaim:async s=>{runtime=s;return true;},ashSave:async s=>{runtime=structuredClone(s);},ashStatus:async s=>statuses.push(s),subscriptions:async()=>({owner:{[phoneId]:sub}}),subscription:async()=>sub,allowed:async()=>true,send:async(s,p)=>{sent.push(p);return 201;}};
 return {io,sent,statuses,get runtime(){return runtime;},input:i};
}
test('ash delivery is one per phone per emptying cycle and starts again after another learned interval',async()=>{
 const h=harness();await runAshMonitor(h.io);assert.equal(h.sent.length,1);await runAshMonitor(h.io);assert.equal(h.sent.length,1);
 h.input.entries[c]={at:now-1000,kg:180,hours:80};await runAshMonitor(h.io);assert.equal(h.sent.length,1);
 h.input.sample.state.sensors.pellets_total_kg=220;h.input.sample.state.sensors.pellet_hours=110;await runAshMonitor(h.io);assert.equal(h.sent.length,2);
});
test('ash monitor waits for reference, retries transient failures, and honours revocation',async()=>{
 const h=harness();delete h.input.entries[a];await runAshMonitor(h.io);assert.equal(h.sent.length,0);assert.equal(h.statuses.at(-1).reason,'learning');
 const t=harness();let attempts=0;t.io.send=async()=>{attempts++;return attempts===1?503:201;};await runAshMonitor(t.io);await runAshMonitor(t.io);await runAshMonitor(t.io);assert.equal(attempts,2);
 const r=harness();r.io.allowed=async()=>false;await runAshMonitor(r.io);assert.equal(r.sent.length,0);
});
test('a new emptying before delivery or a concurrent lease prevents an outdated ash push',async()=>{
 const h=harness();let reads=0;h.io.ashInput=async()=>{const i=input();if(++reads>1)i.entries[c]={at:now-1000,kg:180,hours:80};return i;};assert.equal((await runAshMonitor(h.io)).status,'ash-superseded');assert.equal(h.sent.length,0);
 const b=harness();b.io.ashClaim=async()=>false;assert.equal((await runAshMonitor(b.io)).status,'busy');assert.equal(b.sent.length,0);
});
