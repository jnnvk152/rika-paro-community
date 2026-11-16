import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stoveStatus} from '../web/stove-status.js';
const state=(phase,on=true,is_burning=false)=>({stove:{state:phase,is_burning,has_error:false},controls:{on},sensors:{combustion_temperature:480}});
test('enabled standby is waiting for heat, never burning or described as switched off',()=>{
 const status=stoveStatus(state('standby'),true);
 assert.equal(status.title,"Standby");assert.equal(status.badge,"No active fire");assert.equal(status.animate,false);
 assert.equal(stoveStatus(state('off',true),true).title,"Waiting to start");
 assert.equal(stoveStatus(state('off',false),true).title,"Stove is off");
});
test('a flame requires a current confirmed burning phase, not the power switch or residual heat',()=>{
 for(const phase of ['heating','regulation','flame_start','start','splitlog','splitlog_refuel','splitlog_no_refuel']){
  assert.equal(stoveStatus(state(phase,false,true),true).animate,true);
  for(const is_burning of [false,undefined]){const input=state(phase);if(is_burning===undefined)delete input.stove.is_burning;else input.stove.is_burning=is_burning;assert.equal(stoveStatus(input,true).animate,false);}
 }
 for(const phase of ['standby','off','ignition','cleaning','burn_off','unknown','future-phase'])assert.equal(stoveStatus(state(phase,true,true),true).animate,false);
});
test('the switch being off while the stove burns off does not hide the shutdown phase',()=>{
 const status=stoveStatus(state('burn_off',false,true),true);
 assert.equal(status.title,"Stove is shutting down");assert.equal(status.phase,'cooling');assert.equal(status.animate,false);
 assert.equal(stoveStatus(state('ignition',true,true),true).phase,'ignition');
 assert.equal(stoveStatus(state('cleaning',true,true),true).phase,'cleaning');
});
test('stale readings, missing state and a fault suppress active fire even after heating',()=>{
 const burning=state('heating',true,true);
 assert.equal(stoveStatus(burning,false).phase,'offline');assert.equal(stoveStatus(burning,false).animate,false);
 burning.stove.has_error=true;assert.equal(stoveStatus(burning,true).phase,'fault');assert.equal(stoveStatus(burning,true).animate,false);
 for(const missing of [null,{},state('unknown',true,true)])assert.equal(stoveStatus(missing,true).animate,false);
});
