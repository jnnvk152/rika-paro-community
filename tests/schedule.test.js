import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DAYS,SLOT_KEYS,validSlot,validateSchedule,encodeSlot,decodeSlot,demoSchedule,nativePatch} from '../web/schedule.js';
import {buildCommand,controlsMatch} from '../web/domain.js';
test('slot encoding round trips every valid minute, including midnight and 23:59',()=>{
 for(let minute=0;minute<1439;minute++){
  const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const slot=encodeSlot(true,time(minute),time(minute+1));
  assert.deepEqual(decodeSlot(slot),{enabled:true,start:time(minute),end:time(minute+1)});
 }
 assert.equal(encodeSlot(false,'',''),0);assert.equal(decodeSlot(0).enabled,false);
 for(const value of [-1,0.1,23600000,6000960,6002400,9000600,6000600,'6000900',NaN,Infinity])assert.equal(validSlot(value),false);
 for(const times of [['23:00','01:00'],['06:00','06:00'],['24:00','24:01'],['06:60','09:00'],['','09:00']])assert.throws(()=>encodeSlot(true,...times));
});
test('full schedule rejects malformed fields and overlaps on every day',()=>{
 assert.deepEqual(validateSchedule(demoSchedule()),demoSchedule());
 for(const [day] of DAYS){
  const s=demoSchedule();s.slots[`heatTime${day}1`]=6000900;s.slots[`heatTime${day}2`]=8591200;assert.throws(()=>validateSchedule(s));
  s.slots[`heatTime${day}2`]=9001200;assert.doesNotThrow(()=>validateSchedule(s));
  s.slots[`heatTime${day}1`]=15001700;assert.doesNotThrow(()=>validateSchedule(s));
 }
 for(const modify of [s=>delete s.slots.heatTimeSun2,s=>s.slots.unknown=0,s=>s.slots.heatTimeTue1=true,s=>s.active='true',s=>s.setback_temperature=11,s=>s.setback_temperature=22.5,s=>s.unknown=true]){const s=demoSchedule();modify(s);assert.throws(()=>validateSchedule(s));}
});
test('schedule command preserves all fourteen slots and never adds a power toggle',()=>{
 const schedule=demoSchedule();schedule.active=true;schedule.slots.heatTimeMon1=6000900;
 const now=1700000000000;
 const state={version_ack:true,device:{capabilities:{schedule:true}},stove:{has_error:false,state:'heating'},sensors:{room_sensor_connected:true},controls:{on:true,mode:'auto',power_percent:70,heating_times_active:true,setback_temperature:16},schedule:{...schedule.slots}};
 const sample={state,ready:true,session:'a'.repeat(32),updatedAt:now};
 const patch={mode:'auto',power_percent:70,schedule};
 assert.equal(buildCommand(patch,sample,true,now,'command-123456789').schedule.slots.heatTimeMon1,6000900);
 assert.equal(controlsMatch(state,patch),true);state.schedule.heatTimeSun2=6000900;assert.equal(controlsMatch(state,patch),false);
 const flat=nativePatch(patch);assert.equal(flat.heating_times_active,true);assert.equal(flat.setback_temperature,16);assert.equal(flat.heatTimeMon1,6000900);assert.equal('on'in flat,false);assert.equal('schedule'in flat,false);assert.equal(SLOT_KEYS.filter(k=>k in flat).length,14);
 for(const extra of [{on:false},{on:true},{target_temperature:20},{mode:'comfort'},{mode:'manual'}])assert.throws(()=>buildCommand({...patch,...extra},sample,true,now,'command-123456789'));
 delete state.schedule;assert.throws(()=>buildCommand(patch,sample,true,now,'command-123456789'));
});
