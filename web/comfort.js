import {controlsMatch,validatePatch} from './domain.js';
import {readSchedule,validateSchedule} from './schedule.js';
function disabledSchedule(state){
 const schedule=readSchedule(state);
 if(!schedule)throw Error("Waiting for a complete schedule reading before using Comfort without time restrictions.");
 return {...validateSchedule(schedule),active:false};
}
// The installed bridge accepts a standalone schedule flag update. Confirm the
// Comfort settings first, then disable only the flag, preserving every slot,
// setback value and power switch. Never queue/retry a stove command.
export async function applyComfort(patch,io){
 patch=validatePatch(patch);
 if(patch.mode!=='comfort'||'on'in patch||'schedule'in patch)throw Error("Invalid switch to Comfort mode.");
 const initial=io.state();
 if(initial?.controls?.heating_times_active===true)disabledSchedule(initial);
 if(!controlsMatch(initial,patch)){
  const result=await io.apply(patch);
  if(!result.confirmed)return result;
 }
 if(!controlsMatch(io.state(),patch))return {status:'unknown',confirmed:false,reason:"Settings changed during the transition. Check the stove."};
 if(io.state()?.controls?.heating_times_active===true){
  const result=await io.apply({schedule:disabledSchedule(io.state())});
  if(!result.confirmed)return {...result,reason:"Comfort is set, but removal of its schedule restriction is unconfirmed. Check the stove before trying again."};
 }
 const confirmed=controlsMatch(io.state(),patch)&&io.state()?.controls?.heating_times_active===false;
 return {status:confirmed?'sent':'unknown',confirmed,reason:confirmed?'':"Removal of the schedule restriction is not confirmed. Check the stove."};
}
export async function applyHome(turnOn,io){
 const initial=io.state(),schedule=readSchedule(initial);
 if(!schedule)throw Error("Waiting to read the morning schedule from the stove.");
 const stored=validateSchedule(schedule);
 if(!Object.values(stored.slots).some(Boolean))throw Error("First choose “Schedule” and set your morning heating hours.");
 const mode=initial?.sensors?.room_sensor_connected===true?'comfort':'auto';
 const apply=async patch=>{const result=await io.apply(patch);return result.confirmed?null:result;};
 if(mode==='auto'){
  if(initial.controls.mode!=='auto'||!stored.active){
   const result=await apply({mode:'auto',schedule:{...stored,active:true}});if(result)return result;
  }
 }else{
  if(initial.controls.mode!=='comfort'){const result=await apply({mode:'comfort'});if(result)return result;}
  if(io.state()?.controls?.mode!=='comfort')return {status:'unknown',confirmed:false,reason:"The mode changed during the transition. Check the stove."};
  if(io.state()?.controls?.heating_times_active!==true){
   const current=readSchedule(io.state());if(!current)throw Error("Waiting for a schedule reading.");
   const result=await apply({schedule:{...validateSchedule(current),active:true}});if(result)return result;
  }
 }
 if(turnOn&&(io.state()?.controls?.on!==true||io.state()?.home?.status==='awaiting_off')){const result=await apply({on:true});if(result)return result;}
 const c=io.state()?.controls,confirmed=c?.mode===mode&&c.heating_times_active===true&&(!turnOn||c.on===true);
 return {status:confirmed?'sent':'unknown',confirmed,reason:confirmed?'':"The morning schedule is not confirmed yet. Check the stove."};
}
