import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCommand,ready,validatePatch,controlsMatch} from '../web/domain.js';
const now=1700000000000;
const sample=()=>({session:'a'.repeat(32),updatedAt:now,ready:true,state:{version_ack:true,stove:{has_error:false,state:'standby'},sensors:{room_sensor_connected:true},controls:{on:false,mode:'manual',power_percent:70,target_temperature:21}}});
test('temperature, power and all three heating modes remain supported',()=>{
 for(const mode of ['comfort','manual','auto'])assert.equal(buildCommand({mode},sample(),true,now,'command-123456789').mode,mode);
 for(const target_temperature of [14,21,28])assert.equal(buildCommand({target_temperature},sample(),true,now,'command-123456789').target_temperature,target_temperature);
 for(const power_percent of [30,70,100])assert.equal(buildCommand({power_percent},sample(),true,now,'command-123456789').power_percent,power_percent);
});
test('commands require recent synchronized readings and an online connection',()=>{
 for(const s of [{...sample(),updatedAt:now-30000},{...sample(),updatedAt:now+5000},{...sample(),ready:false},{...sample(),session:'invalid'},{...sample(),state:{...sample().state,version_ack:false}}])assert.throws(()=>buildCommand({on:true},s,true,now,'command-123456789'));
 assert.throws(()=>buildCommand({on:true},sample(),false,now,'command-123456789'));
 assert.equal(ready(sample(),true,now),true);
});
test('a failed stove or wood burning cannot be ignited remotely; normal shutdown is allowed',()=>{
 for(const stove of [{has_error:true,state:'standby'},{has_error:false,state:'splitlog'},{}]){
  const s=sample();s.state.stove=stove;
  assert.throws(()=>buildCommand({on:true},s,true,now,'command-123456789'));
  assert.equal(buildCommand({on:false},s,true,now,'command-123456789').on,false);
 }
});
test('missing room sensor blocks temperature control while retaining manual and schedule',()=>{
 const s=sample();s.state.sensors.room_sensor_connected=false;
 assert.throws(()=>buildCommand({mode:'comfort'},s,true,now,'command-123456789'));
 assert.throws(()=>buildCommand({target_temperature:21},s,true,now,'command-123456789'));
 for(const mode of ['manual','auto'])assert.equal(buildCommand({mode,power_percent:70},s,true,now,'command-123456789').mode,mode);
});
test('invalid types, hidden controls and out of range values cannot be sent',()=>{
 for(const p of [null,[],{}, {on:'true'},{on:1},{mode:'unsupported'},{power_percent:29},{power_percent:100.1},{target_temperature:29},{target_temperature:20.5},{revision:1},{on:true,arbitrary:1}])assert.throws(()=>validatePatch(p));
});
test('receipt matching checks all requested values, including false and zero-like values',()=>{
 assert.equal(controlsMatch(sample().state,{on:false,mode:'manual',power_percent:70}),true);
 assert.equal(controlsMatch(sample().state,{on:true}),false);
 assert.equal(controlsMatch(sample().state,{power_percent:65}),false);
 const c=buildCommand({on:false},sample(),true,now,'command-123456789');
 assert.equal(c.expiresAt,now+12000);assert.equal(c.session,sample().session);
});
