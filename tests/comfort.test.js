import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyComfort,applyHome} from '../web/comfort.js';
import {demoSchedule} from '../web/schedule.js';
import {validatePatch} from '../web/domain.js';
const state=()=>({controls:{on:true,mode:'auto',target_temperature:20,power_percent:60,heating_times_active:true,setback_temperature:12},schedule:{...demoSchedule().slots,heatTimeSat1:7000800}});
function fake(){
 const current=state(),sent=[];
 return {current,sent,state:()=>current,apply:async patch=>{validatePatch(patch);sent.push(structuredClone(patch));const {schedule,...controls}=patch;Object.assign(current.controls,controls);if(schedule){current.schedule={...schedule.slots};current.controls.heating_times_active=schedule.active;current.controls.setback_temperature=schedule.setback_temperature;}return {status:'sent',confirmed:true};}};
}
test('Comfort overrides the schedule flag and preserves all times, setback and power',async()=>{
 const f=fake(),slots={...f.current.schedule};const result=await applyComfort({mode:'comfort',target_temperature:22},f);
 assert.equal(result.confirmed,true);assert.equal(f.sent.length,2);assert.equal(f.current.controls.mode,'comfort');assert.equal(f.current.controls.target_temperature,22);assert.equal(f.current.controls.heating_times_active,false);
 assert.deepEqual(f.current.schedule,slots);assert.equal(f.current.controls.setback_temperature,12);assert.equal(f.current.controls.on,true);
 assert.ok(f.sent.every(p=>!Object.hasOwn(p,'on')));assert.deepEqual(Object.keys(f.sent[1]),['schedule']);
});
test('an already saved Comfort target needs only the standalone schedule deactivation',async()=>{
 const f=fake();f.current.controls.mode='comfort';f.current.controls.target_temperature=22;
 await applyComfort({mode:'comfort',target_temperature:22},f);assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]),['schedule']);
 const g=fake();g.current.controls.heating_times_active=false;await applyComfort({mode:'comfort',target_temperature:22},g);assert.equal(g.sent.length,1);assert.equal(g.sent[0].mode,'comfort');
});
test('unknown results stop the sequence without retrying; concurrent mode changes cannot silently disable the schedule',async()=>{
 const f=fake();f.apply=async p=>{f.sent.push(p);return {status:'unknown',confirmed:false};};assert.equal((await applyComfort({mode:'comfort',target_temperature:22},f)).confirmed,false);assert.equal(f.sent.length,1);
 const g=fake();const send=g.apply;g.apply=async p=>{await send(p);g.current.controls.mode='manual';return {status:'sent',confirmed:true};};
 assert.equal((await applyComfort({mode:'comfort',target_temperature:22},g)).confirmed,false);assert.equal(g.sent.length,1);
 const h=fake();const apply=h.apply;h.apply=async p=>p.schedule?{status:'unknown',confirmed:false}:apply(p);const result=await applyComfort({mode:'comfort',target_temperature:22},h);assert.match(result.reason,/removal of its schedule restriction/);assert.equal(h.current.controls.heating_times_active,true);
});
test('missing or malformed schedule fails before changing any stove settings',async()=>{
 const f=fake();delete f.current.schedule;await assert.rejects(()=>applyComfort({mode:'comfort',target_temperature:22},f),/schedule reading/);assert.equal(f.sent.length,0);
 const g=fake();g.current.schedule.heatTimeSat1=9000700;await assert.rejects(()=>applyComfort({mode:'comfort',target_temperature:22},g));assert.equal(g.sent.length,0);
});
test('ending manual heat restores native morning Comfort without switching the stove off or losing the target',async()=>{
 const f=fake();f.current.sensors={room_sensor_connected:true};Object.assign(f.current.controls,{mode:'comfort',heating_times_active:false,target_temperature:22});const slots={...f.current.schedule};
 assert.equal((await applyHome(false,f)).confirmed,true);assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]),['schedule']);assert.equal(f.current.controls.on,true);assert.equal(f.current.controls.target_temperature,22);assert.deepEqual(f.current.schedule,slots);assert.equal(f.current.controls.heating_times_active,true);
});
test('returning Home prepares the morning program before the explicit power request; uncertain setup never starts the stove',async()=>{
 const f=fake();f.current.sensors={room_sensor_connected:true};Object.assign(f.current.controls,{on:false,mode:'manual',heating_times_active:false});
 assert.equal((await applyHome(true,f)).confirmed,true);assert.equal(f.sent.length,3);assert.deepEqual(f.sent.at(-1),{on:true});
 const g=fake();g.current.sensors={room_sensor_connected:true};g.current.controls.on=false;g.current.controls.mode='manual';g.current.controls.heating_times_active=false;g.apply=async p=>{g.sent.push(p);return {status:'unknown',confirmed:false};};await applyHome(true,g);assert.equal(g.sent.length,1);assert.ok(!g.sent.some(p=>p.on===true));
});

test('explicit Home clears a pending OFF intent even when the last controls still say ON',async()=>{
 const f=fake();f.current.sensors={room_sensor_connected:true};f.current.controls.mode='comfort';f.current.home={status:'awaiting_off'};
 assert.equal((await applyHome(true,f)).confirmed,true);assert.deepEqual(f.sent,[{on:true}]);
});
