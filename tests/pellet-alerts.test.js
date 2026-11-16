import {test} from 'node:test';import assert from 'node:assert/strict';
import {pelletReading,pelletThreshold,observePellets} from '../web/pellet-alerts.js';
import {runPelletMonitor} from '../monitor/pellets.js';
const now=1793000000000;
const input=(kg=30)=>({sample:{updatedAt:now,ready:true,state:{sensors:{pellets_total_kg:100},hopper:{open:false,durable:true,events:{}}}},entries:{base:{kind:'remaining',kg,counter:100,at:now-1000,recordedAt:now-1000}}});
const reading=kg=>({known:true,reason:'ready',kg,percent:kg*100/30,at:now});
test('strict 50/20/10 thresholds use the unrounded estimate and rearm only after a confirmed rise',()=>{
 let s=observePellets(null,reading(30),now);assert.equal(s.pending,false);
 for(const [kg,level] of [[15,0],[14,50],[6,0],[5,20],[3,0],[2,10]]){
  s={...s,pending:false};const before=s.sequence;s=observePellets(s,reading(kg),now+1000);
  assert.equal(s.sequence-before,level?1:0);if(level)assert.equal(s.eventLevel,level);
 }
 s.pending=false;s=observePellets(s,reading(1),now+2000);assert.equal(s.pending,false);
 s=observePellets(s,reading(10),now+3000);assert.equal(s.fired,1);assert.equal(s.pending,false);
 s=observePellets(s,reading(5),now+4000);assert.equal(s.eventLevel,20);assert.equal(s.pending,true);
 s=observePellets(s,reading(30),now+5000);assert.equal(s.fired,0);assert.equal(s.pending,false);
 s=observePellets(s,reading(14.99),now+6000);assert.equal(s.eventLevel,50);assert.equal(pelletThreshold(49.966),50);
});
test('large drops announce only the most urgent level; unknown readings hold pending delivery',()=>{
 let s=observePellets(null,reading(1),now);assert.equal(s.eventLevel,10);assert.equal(s.sequence,1);assert.equal(s.fired,7);
 s=observePellets(s,{known:false,reason:'pending'},now+1000);assert.equal(s.pending,true);
 s=observePellets(s,reading(30),now+2000);assert.equal(s.pending,false);assert.equal(s.fired,0);
});
test('stale samples, unknown refills, missing journal, gaps and counter resets suppress pellet warnings',()=>{
 let x=input(14);assert.equal(pelletReading(x.sample,x.entries,now).known,true);
 x.sample.updatedAt=now-30000;assert.equal(pelletReading(x.sample,x.entries,now).known,false);
 x=input(14);x.sample.state.hopper.open=true;assert.equal(pelletReading(x.sample,x.entries,now).reason,'pending');
 x=input(14);x.sample.state.hopper.events={'aaaaaaaaaaaaaaaa-1':{seq:1,counter:100,at:now}};assert.equal(pelletReading(x.sample,x.entries,now).reason,'pending');
 x=input(14);x.sample.state.hopper.durable=false;assert.equal(pelletReading(x.sample,x.entries,now).reason,'journal');
 x=input(14);x.sample.state.sensors.pellets_total_kg=99;assert.equal(pelletReading(x.sample,x.entries,now).reason,'reset');
 x=input(14);x.sample.state.hopper.events={'aaaaaaaaaaaaaaaa-5':{seq:5,counter:100,at:now}};assert.equal(pelletReading(x.sample,x.entries,now).reason,'gap');
});
function fake(kg=14){
 let state=null,level=kg,clock=now;const sent=[],id='a'.repeat(64),sub={deviceId:'paro',owner:true,enabled:true,endpoint:'https://web.push.apple.com/'+'x'.repeat(40),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 const io={now:()=>clock,publicKey:'key',config:async()=>({ready:true,publicKey:'key'}),pelletInput:async()=>{const x=input(level);x.sample.updatedAt=clock;return x;},pelletRuntime:async()=>({value:state,etag:'a'}),pelletClaim:async value=>{state=structuredClone(value);return true;},pelletSave:async value=>{state=structuredClone(value);},pelletStatus:async()=>{},pelletTest:async()=>null,pelletTestReceipt:async()=>{},subscriptions:async()=>({owner:{[id]:sub}}),subscription:async()=>sub,allowed:async()=>true,send:async(sub,payload)=>{sent.push(payload);return 201;}};
 return {io,sent,id,sub,get state(){return state;},setKg:n=>{level=n;clock+=120000;}};
}
test('the background sender persists deduplication, rearms after refilling and sends each phone once',async()=>{
 const f=fake();await runPelletMonitor(f.io);await runPelletMonitor(f.io);assert.equal(f.sent.length,1);assert.match(f.sent[0].title,/50 %/);
 f.setKg(5);await runPelletMonitor(f.io);assert.equal(f.sent.length,2);assert.match(f.sent[1].title,/20 %/);
 f.setKg(2);await runPelletMonitor(f.io);assert.equal(f.sent.length,3);assert.match(f.sent[2].title,/10 %/);
 f.setKg(30);await runPelletMonitor(f.io);f.setKg(14);await runPelletMonitor(f.io);assert.equal(f.sent.length,4);
 const g=fake();g.io.subscriptions=async()=>({owner:{[g.id]:g.sub,['b'.repeat(64)]:g.sub}});await runPelletMonitor(g.io);assert.equal(g.sent.length,1);await runPelletMonitor(g.io);assert.equal(g.sent.length,2);await runPelletMonitor(g.io);assert.equal(g.sent.length,2);
});
test('revoked recipients, refills immediately before sending and concurrent runs fail closed',async()=>{
 const f=fake();f.io.allowed=async()=>false;await runPelletMonitor(f.io);assert.equal(f.sent.length,0);
 const g=fake();let reads=0;g.io.pelletInput=async()=>input(++reads===1?14:30);await runPelletMonitor(g.io);assert.equal(g.sent.length,0);assert.equal(g.state.pending,false);
 const h=fake();h.io.pelletClaim=async()=>false;assert.equal((await runPelletMonitor(h.io)).status,'busy');assert.equal(h.sent.length,0);
 const retry=fake();let attempts=0;retry.io.send=async()=>++attempts===1?503:201;await runPelletMonitor(retry.io);assert.equal(retry.state.pending,true);await runPelletMonitor(retry.io);assert.equal(attempts,2);assert.equal(retry.state.pending,false);
});
test('explicit pellet tests are labelled and never change the real estimate or fake an operational alarm',async()=>{
 const f=fake(24),nonce=crypto.randomUUID();let receipt;
 f.io.pelletTest=async()=>({nonce,uid:'owner',subscription:f.id,at:now,expiresAt:now+600000});f.io.pelletTestReceipt=async v=>{receipt=v;};
 await runPelletMonitor(f.io);await runPelletMonitor(f.io);assert.equal(f.sent.length,1);assert.equal(receipt.http,201);assert.match(f.sent[0].title,/test/);assert.equal(f.state.fired,0);
});
