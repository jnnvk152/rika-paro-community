import {test} from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_COMFORT_PLAN,validateComfortPlan,comfortPeriod} from '../web/comfort-plan.js';
import {validatePatch,assertAllowed,controlsMatch} from '../web/domain.js';
test('Comfort plan separates daytime, temperature setback and native frost; invalid times and temperatures are rejected',()=>{
 const p={...DEFAULT_COMFORT_PLAN,enabled:true};assert.deepEqual(validateComfortPlan({...p,revision:1,uid:'ignored'}),p);
 for(const patch of [{day_start_minute:1260},{night_start_minute:300},{enabled:1},{day_temperature:13},{night_temperature:29},{frost_temperature:3},{frost_temperature:11},{night_mode:'off'},{version:2},{day_start_minute:360.5}])assert.throws(()=>validateComfortPlan({...p,...patch}));
});
test('Comfort windows use Ljubljana wall time and exact inclusive/exclusive boundaries on both sides of DST',()=>{
 const p=DEFAULT_COMFORT_PLAN;
 for(const [utc,want] of [['2026-10-24T03:59:59Z','night'],['2026-10-24T04:00:00Z','day'],['2026-10-24T19:00:00Z','night'],['2026-10-27T04:59:59Z','night'],['2026-10-27T05:00:00Z','day'],['2026-10-27T19:59:59Z','day'],['2026-10-27T20:00:00Z','night']])assert.equal(comfortPeriod(p,Date.parse(utc)),want,utc);
});
test('resume/pause actions cannot be mixed with stove commands and require a capable controller',()=>{
 assert.deepEqual(validatePatch({cycle_action:'pause'}),{cycle_action:'pause'});
 for(const patch of [{cycle_action:'start'},{cycle_action:'pause',on:true},{cycle_action:'resume',mode:'comfort'}])assert.throws(()=>validatePatch(patch));
 const s={device:{capabilities:{comfort_cycle:true}},home:{cycle:{enabled:true}},stove:{has_error:false,state:'standby'},sensors:{room_sensor_connected:true}};
 assert.doesNotThrow(()=>assertAllowed({cycle_action:'resume'},s));assert.throws(()=>assertAllowed({cycle_action:'resume'},{...s,device:{}}));
 for(const patch of [{stove:{has_error:true}},{stove:{has_error:false,state:'splitlog'}},{sensors:{room_sensor_connected:false}}]){assert.throws(()=>assertAllowed({cycle_action:'resume'},{...s,...patch}));assert.doesNotThrow(()=>assertAllowed({cycle_action:'pause'},{...s,...patch}));}
});
test('a persisted intent alone never claims successful ignition/shutdown; real control echo is required',()=>{
 const s={controls:{on:true,mode:'comfort',target_temperature:20,heating_times_active:false},home:{cycle:{manual_paused:false,phase:'day',day_temperature:20,night_temperature:16,night_mode:'frost'}}};
 assert.equal(controlsMatch(s,{cycle_action:'resume'}),true);s.controls.on=false;assert.equal(controlsMatch(s,{cycle_action:'resume'}),false);
 s.home.cycle.manual_paused=true;s.controls.on=true;assert.equal(controlsMatch(s,{cycle_action:'pause'}),false);s.controls.on=false;assert.equal(controlsMatch(s,{cycle_action:'pause'}),true);
 s.home.cycle.manual_paused=false;s.home.cycle.phase='night';assert.equal(controlsMatch(s,{cycle_action:'resume'}),true);s.home.cycle.night_mode='temperature';assert.equal(controlsMatch(s,{cycle_action:'resume'}),false);s.controls.on=true;s.controls.target_temperature=16;assert.equal(controlsMatch(s,{cycle_action:'resume'}),true);
});

test('native frost heating is preserved while normal heating intent is paused or resumed',()=>{
 const s={controls:{on:true,mode:'auto'},home:{cycle:{frost_running:true,manual_paused:true,phase:'day'}}};
 assert.equal(controlsMatch(s,{cycle_action:'pause'}),true);assert.equal(controlsMatch(s,{cycle_action:'resume'}),false);s.home.cycle.manual_paused=false;assert.equal(controlsMatch(s,{cycle_action:'resume'}),true);
});
