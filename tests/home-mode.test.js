import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeModeStatus,homeResumeAvailability,handoffToNativeSchedule} from '../web/home-mode.js';
import {assertAllowed} from '../web/domain.js';
import {DEFAULT_COMFORT_PLAN} from '../web/comfort-plan.js';
import {demoSchedule} from '../web/schedule.js';

const plan={...DEFAULT_COMFORT_PLAN,enabled:true,revision:18,day_temperature:21};
function input(){return {fresh:true,plan:{...plan},state:{device:{capabilities:{comfort_cycle:true}},home:{cycle:{enabled:true,revision:18,durable:true,clock_ready:true,manual_paused:false,phase:'day',status:'confirmed'}},stove:{has_error:false,state:'heating'},sensors:{room_sensor_connected:true},controls:{on:true,mode:'manual',target_temperature:23}}};}
test('Home and a lit stove cannot mask the persisted manual pause',()=>{
 const i=input();i.state.home.cycle.manual_paused=true;
 assert.equal(homeModeStatus(i).kind,'paused');assert.match(homeModeStatus(i).detail,/morning starts are paused/);
 i.state.controls.on=false;assert.equal(homeModeStatus(i).kind,'paused');
 i.away=true;assert.equal(homeModeStatus(i).label,"Away");
});
test('active home routine is independent of the stove native mode and actual flame',()=>{
 const i=input();assert.equal(homeModeStatus(i).label,"Active");
 i.state.controls.mode='comfort';i.state.controls.on=false;i.state.stove.state='standby';assert.equal(homeModeStatus(i).kind,'active');
 i.state.home.cycle.phase='night';assert.match(homeModeStatus(i).detail,/Night break/);
 i.plan.night_mode='temperature';assert.match(homeModeStatus(i).detail,/Night temperature/);
});
test('stale, unacknowledged and blocked plans never appear active',()=>{
 const variants=[i=>i.fresh=false,i=>i.state.home.cycle.revision=17,i=>i.state.home.cycle.enabled=false,i=>i.state.home.cycle.durable=false,i=>i.state.home.cycle.clock_ready=false,i=>delete i.state.home.cycle.manual_paused,i=>i.state.home.cycle.phase='unknown',i=>i.state.home.cycle.status='unconfirmed',i=>i.state.stove.has_error=true,i=>i.state.stove.state='splitlog',i=>i.state.sensors.room_sensor_connected=false];
 for(const mutate of variants){const i=input();mutate(i);assert.notEqual(homeModeStatus(i).kind,'active');}
 const i=input();i.plan.enabled=false;assert.equal(homeModeStatus(i).kind,'waiting');i.state.home.cycle.enabled=false;assert.equal(homeModeStatus(i).kind,'off');
});
test('switch to native schedule waits for confirmed durable module-plan disable, with no ON/resume command',async()=>{
 const calls=[],patch={mode:'auto',power_percent:60,schedule:demoSchedule()};
 const io={disable:async(p,r)=>calls.push(['disable',p.enabled,r]),confirmDisabled:async r=>{calls.push(['confirm',r]);return true;},send:async p=>{calls.push(['send',p]);return true;}};
 assert.equal(await handoffToNativeSchedule(patch,plan,true,io),true);
 assert.deepEqual(calls,[['disable',false,18],['confirm',19],['send',patch]]);assert.equal('on'in calls[2][1],false);
 calls.length=0;await handoffToNativeSchedule(patch,{...plan,enabled:false},true,io);assert.deepEqual(calls.map(x=>x[0]),['confirm','send']);assert.equal(calls[0][1],18);
 calls.length=0;await handoffToNativeSchedule(patch,plan,false,io);assert.deepEqual(calls,[['send',patch]]);
});
test('failed disable, missing acknowledgment and malformed requests halt before the native command',async()=>{
 const patch={mode:'auto',schedule:demoSchedule()};let sent=0,disabled=0;
 const io={disable:async()=>{disabled++;},confirmDisabled:async()=>false,send:async()=>{sent++;}};
 await assert.rejects(handoffToNativeSchedule(patch,plan,true,io),/not been confirmed/);assert.equal(sent,0);
 io.disable=async()=>{throw Error('write refused');};await assert.rejects(handoffToNativeSchedule(patch,plan,true,io),/write refused/);assert.equal(sent,0);
 await assert.rejects(handoffToNativeSchedule({...patch,on:true},plan,true,io));assert.equal(disabled,1);assert.equal(sent,0);
});

test('resume explains wood burning without weakening the command guards or blocking normal OFF',()=>{
 for(const phase of ['splitlog','splitlog_refuel','splitlog_no_refuel']){
  const i=input();i.state.stove.state=phase;i.state.home.cycle.manual_paused=true;
  const before=structuredClone(i),availability=homeResumeAvailability({...i,ready:true,managed:true});
  assert.equal(availability.disabled,true);assert.equal(availability.code,'wood');assert.match(availability.reason,/burning wood/);
  assert.throws(()=>assertAllowed({cycle_action:'resume'},i.state));assert.throws(()=>assertAllowed({on:true},i.state));
  assert.doesNotThrow(()=>assertAllowed({cycle_action:'pause'},i.state));assert.doesNotThrow(()=>assertAllowed({on:false},i.state));
  assert.deepEqual(i,before);
 }
});
test('disabled resume always explains the actual blocker, including a native draft',()=>{
 const cases=[['offline',i=>i.ready=false],['busy',i=>i.busy=true],['fault',i=>i.state.stove.has_error=true],['plan',i=>i.plan.revision++],['plan',i=>i.plan.enabled=false],['storage',i=>i.state.home.cycle.durable=false],['clock',i=>i.state.home.cycle.clock_ready=false],['sensor',i=>i.state.sensors.room_sensor_connected=false],['draft',i=>i.dirty=true]];
 for(const [code,mutate] of cases){const i={...input(),ready:true,managed:true};mutate(i);const a=homeResumeAvailability(i);assert.equal(a.disabled,true);assert.equal(a.code,code);assert.ok(a.reason.length>20);}
 const i={...input(),ready:true,managed:true};i.state.home.cycle.manual_paused=true;i.state.home.cycle.applied_revision=15;
 assert.deepEqual(homeResumeAvailability(i),{disabled:false,code:'ready',reason:''});
 i.dirty=true;assert.equal(homeResumeAvailability(i).code,'draft');i.dirty=false;assert.equal(homeResumeAvailability(i).disabled,false);
 i.state.sensors.room_sensor_connected=false;i.managed=false;assert.equal(homeResumeAvailability(i).disabled,false);
});
