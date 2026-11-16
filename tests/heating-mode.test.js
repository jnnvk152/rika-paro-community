import {test} from 'node:test';import assert from 'node:assert/strict';
import {heatingDraft,manualSettings,resumeHeatingCommands,applyHeatingCommands} from '../web/heating-mode.js';
import {DEFAULT_COMFORT_PLAN} from '../web/comfort-plan.js';
import {assertAllowed,controlsMatch} from '../web/domain.js';
const plan={...DEFAULT_COMFORT_PLAN,enabled:true,day_temperature:21};
const state=()=>({device:{capabilities:{comfort_cycle:true}},home:{cycle:{...plan,manual_paused:true,clock_ready:true}},controls:{mode:'manual',power_percent:65,on:false,target_temperature:21},stove:{has_error:false,state:'off'},sensors:{room_sensor_connected:true}});
test('managed daily plan reflects confirmed manual mode and power after subsequent telemetry',()=>{
 const s=state();assert.deepEqual(heatingDraft(s,plan,'day',true),{mode:'manual',power_percent:65,target_temperature:21});
 assert.equal(heatingDraft(s,plan,'night',true).mode,'manual');s.controls.mode='comfort';assert.equal(heatingDraft(s,plan,'day',true).mode,'comfort');
 s.controls.target_temperature=23;s.controls.mode='auto';s.home.cycle.night_mode='temperature';s.home.cycle.night_temperature=16;assert.deepEqual(heatingDraft(s),{mode:'auto',target_temperature:23,power_percent:65});
});
test('saving manual mode only changes mode/power; it never resumes or starts a paused stove',()=>{
 const s=state(),p=manualSettings(60);assert.deepEqual(p,{mode:'manual',power_percent:60});assertAllowed(p,s);
 assert.equal('on'in p,false);assert.equal('cycle_action'in p,false);assert.equal('schedule'in p,false);
 Object.assign(s.controls,p);assert.equal(s.controls.on,false);assert.equal(s.home.cycle.manual_paused,true);assert.equal(controlsMatch(s,p),true);
 for(const power of [29,101,NaN,65.5,'60'])assert.throws(()=>manualSettings(power));
});
test('explicit resume uses the persisted cycle action first, then restores manual settings without another ON frame',async()=>{
 const s=state(),commands=resumeHeatingCommands(s,plan,'day');assert.deepEqual(commands,[{cycle_action:'resume'},{mode:'manual',power_percent:65}]);
 for(const command of commands){assertAllowed(command,s);assert.equal('on'in command,false);}
 const sent=[];assert.equal(await applyHeatingCommands(commands,async p=>{sent.push(p);return true;}),true);assert.deepEqual(sent,commands);
 const stopped=[];assert.equal(await applyHeatingCommands(commands,async p=>{stopped.push(p);return false;}),false);assert.equal(stopped.length,1);
});
test('frost-only night resume never restores manual power; unknown time also only uses guarded resume',()=>{
 const s=state();assert.deepEqual(resumeHeatingCommands(s,plan,'night'),[{cycle_action:'resume'}]);
 assert.deepEqual(resumeHeatingCommands(s,plan,'unknown'),[{cycle_action:'resume'}]);
 assert.deepEqual(resumeHeatingCommands(s,{...plan,night_mode:'temperature'},'night'),[{cycle_action:'resume'},{mode:'manual',power_percent:65}]);
 s.controls.mode='comfort';assert.deepEqual(resumeHeatingCommands(s,plan,'day'),[{cycle_action:'resume'}]);
});
test('manual resume retains native-cycle fault/log safeguards and never fakes physical confirmation',()=>{
 for(const stove of [{has_error:true,state:'off'},{has_error:false,state:'splitlog'}]){
  const s=state();s.stove=stove;assert.throws(()=>assertAllowed(resumeHeatingCommands(s,plan,'day')[0],s));assert.doesNotThrow(()=>assertAllowed(manualSettings(60),s));
 }
 const s=state();assert.equal(controlsMatch(s,{mode:'manual',power_percent:60}),false);Object.assign(s.controls,manualSettings(60));assert.equal(controlsMatch(s,manualSettings(60)),true);assert.equal(s.controls.on,false);assert.equal(s.home.cycle.manual_paused,true);
});
