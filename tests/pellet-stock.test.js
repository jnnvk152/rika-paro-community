import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stockEstimate,refillEntry,pendingRefills,journalGap} from '../web/pellet-stock.js';
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
