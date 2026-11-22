import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stockEstimate,refillEntry,pendingRefills,latestRefillPrompt,journalGap} from '../web/pellet-stock.js';
const entry=(kind,kg,counter,at)=>refillEntry(kind,kg,{counter,at},'owner',at);
test('a full hopper loses reported consumption, a bag adds 15kg and the level stays bounded',()=>{
 const entries={a:entry('full',30,2600,100),b:entry('add',15,2620,200)};
 assert.equal(stockEstimate(entries,2623).kg,22);
 assert.equal(stockEstimate(entries,2700).kg,0);
 assert.equal(stockEstimate({a:entry('full',30,2600,100),b:entry('add',15,2601,200)},2602).kg,29);
});
test('unknown starting level and reset consumption never invent stock; a new calibration recovers',()=>{
 assert.equal(stockEstimate({a:entry('add',15,2600,100)},2601).kg,null);
 assert.equal(stockEstimate({a:entry('full',30,2600,100)},10).reason,'reset');
 const entries={a:entry('full',30,2600,100),b:entry('unknown',0,2601,200),c:entry('remaining',8,2602,300)};
 assert.equal(stockEstimate(entries,2604).kg,6);
 assert.equal(stockEstimate(entries,undefined).kg,null);
});
test('delayed, out of order answers use consumption at closing and unknown refills remain pending',()=>{
 const entries={b:entry('add',15,2620,200),a:entry('full',30,2600,100)};
 assert.equal(stockEstimate(entries,2625).kg,20);
 const id='a'.repeat(16)+'-1',state={hopper:{events:{[id]:{counter:2625,at:300,seq:1}}}};
 assert.equal(pendingRefills(state,entries).length,1);
 assert.equal(stockEstimate(entries,2625,pendingRefills(state,entries)).reason,'pending');
 assert.equal(pendingRefills(state,{...entries,[id]:entry('none',0,2625,300)}).length,0);
});
test('invalid inputs and duplicate logical refills cannot silently change the estimate',()=>{
 for(const amount of [-1,31,NaN])assert.throws(()=>entry('add',amount,2600,100));
 assert.throws(()=>entry('full',30,-1,100));
 assert.equal(stockEstimate({a:entry('full',30,2600,100),b:entry('none',0,2601,200)},2602).kg,28);
});
test('a missing journal segment requires calibration, and a later none answer does not hide an older pending refill',()=>{
 const id='a'.repeat(16)+'-3',state={hopper:{events:{[id]:{counter:2625,at:300,seq:3}}}};
 const entries={a:entry('full',30,2600,100),b:entry('none',0,2626,400)};
 assert.equal(journalGap(state,entries),true);
 assert.equal(journalGap(state,{...entries,c:entry('remaining',10,2627,500)}),false);
 assert.equal(stockEstimate(entries,2626,pendingRefills(state,entries)).reason,'pending');
});
test('only the newest opening is prompted; answering it never replays the older backlog',()=>{
 const prefix='a'.repeat(16)+'-',id=n=>prefix+n;
 const state={hopper:{events:{[id(3)]:{counter:2622,at:400,seq:3},[id(1)]:{counter:2620,at:200,seq:1},[id(2)]:{counter:2621,at:300,seq:2}}}};
 const entries={initial:entry('full',30,2600,100)};
 assert.equal(latestRefillPrompt(state,entries).id,id(3));
 const answered={...entries,[id(3)]:entry('none',0,2622,400)};
 assert.equal(latestRefillPrompt(state,answered),null);
 assert.equal(pendingRefills(state,answered).length,2);
 assert.equal(stockEstimate(answered,2623,pendingRefills(state,answered)).reason,'pending');
 const full={...entries,[id(3)]:entry('full',30,2622,400)};
 assert.equal(latestRefillPrompt(state,full),null);
 assert.equal(stockEstimate(full,2623,pendingRefills(state,full)).kg,29);
 assert.equal(stockEstimate(full,2623,pendingRefills(state,full)).reason,'estimate');
 state.hopper.events[id(4)]={counter:2623,at:500,seq:4};
 assert.equal(latestRefillPrompt(state,answered).id,id(4));
});
test('newest prompt follows journal sequence even when its clock is unknown or older dates look newer',()=>{
 const prefix='b'.repeat(16)+'-',state={hopper:{events:{[prefix+'1']:{counter:10,at:1000,seq:1},[prefix+'2']:{counter:10,at:0,seq:2}}}};
 assert.equal(latestRefillPrompt(state,{}).id,prefix+'2');
 assert.equal(latestRefillPrompt(state,{[prefix+'2']:entry('unknown',0,10,1100)}),null);
 assert.equal(latestRefillPrompt({},{}),null);
});
