import {timeLabel} from './comfort-plan.js';
import {validatePatch} from './domain.js';
import {isWoodState} from './stove-status.js';

export function homeResumeAvailability({ready,busy=false,dirty=false,state,plan,managed=true}){
 const blocked=(code,reason)=>({disabled:true,code,reason});
 if(!ready)return blocked('offline',"Waiting for a fresh module and stove connection before resuming.");
 if(busy)return blocked('busy',"Waiting for confirmation of the previous change.");
 if(state?.stove?.has_error!==false)return blocked('fault',"The stove reports a fault or its state is unconfirmed. Check the Status tab and the stove’s display.");
 if(isWoodState(state?.stove?.state))return blocked('wood',"The stove is burning wood. Resuming could trigger a pellet start, so this button is disabled until wood burning ends.");
 if(managed){
  const c=state?.home?.cycle;
  if(!plan||plan.enabled!==true||c?.revision!==plan.revision||c.enabled!==true)return blocked('plan',"The module is still receiving Home Routine settings.");
  if(c.durable!==true)return blocked('storage',"The module has not confirmed its persisted settings yet.");
  if(c.clock_ready!==true)return blocked('clock',"Waiting for the module clock.");
  if(state?.sensors?.room_sensor_connected!==true)return blocked('sensor',"The RIKA room sensor is not connected. Home Routine needs its reading.");
 }
 if(dirty)return blocked('draft',"You have unsaved basic stove controls. Save or discard them first.");
 return {disabled:false,code:'ready',reason:''};
}

// Presence and heat permission are separate. Never call a paused/offline plan
// active just because its owner is at home or its settings have been saved.
export function homeModeStatus({plan,state,fresh,away=false,returnInfo}){
 const c=state?.home?.cycle;
 const result=(kind,label,detail)=>({kind,label,detail});
 if(!fresh)return result('unknown',"State unconfirmed","Waiting for fresh module readings to confirm the routine status.");
 if(state?.device?.capabilities?.comfort_cycle!==true)return result('unknown',"Unavailable","Update the module to run this routine.");
 if(!plan)return result('off',"Not configured","Set daytime hours and the night routine.");
 if(c?.revision!==plan.revision||c?.enabled!==plan.enabled)return result('waiting',"Receiving settings","Waiting for the module to confirm the saved settings.");
 if(!plan.enabled)return result('off',"Disabled","The stove uses its basic controls and built-in schedule.");
 if(away)return result('paused',"Away",returnInfo?.message||"Automatic heating is paused until your return.");
 if(c.manual_paused)return result('paused',"Manually paused","Evening transitions and morning starts are paused. Selecting “Home” does not clear this pause.");
 if(c.manual_paused!==false||!c.durable||!c.clock_ready||!['day','night'].includes(c.phase))return result('waiting',"Waiting for module","The routine needs saved settings and a correct module clock.");
 if(state?.stove?.has_error!==false||state?.sensors?.room_sensor_connected!==true||isWoodState(state?.stove?.state))return result('waiting',"Check stove","Automatic transitions are waiting for valid stove and room sensor readings.");
 if(['awaiting_confirmation','unconfirmed'].includes(c.status))return result('waiting',"Awaiting confirmation","The stove has not confirmed the scheduled transition yet.");
 const hours=timeLabel(plan.day_start_minute)+'–'+timeLabel(plan.night_start_minute);
 return result('active',"Active",c.phase==='night'?(plan.night_mode==='frost'?"Night break · Comfort at "+timeLabel(plan.day_start_minute)+'.':"Night temperature "+plan.night_temperature+" °C · Comfort at "+timeLabel(plan.day_start_minute)+'.'):'Comfort '+hours+' · '+plan.day_temperature+" °C. The saved routine applies at the next scheduled transition.");
}

// Native and module schedules must not both own the next time boundary.
// Disable only the module plan, confirm it on-device, then send the native
// settings. Never turn the stove on, resume a pause, retry or roll back ON.
export async function handoffToNativeSchedule(patch,plan,managed,io){
 patch=validatePatch(patch);
 if(patch.mode!=='auto'||!patch.schedule||'on'in patch)throw Error("Check the stove’s built-in schedule.");
 if(managed){
  if(!plan||!Number.isInteger(plan.revision))throw Error("Waiting for Home Routine settings.");
  const revision=plan.revision+(plan.enabled?1:0);
  if(plan.enabled)await io.disable({...plan,enabled:false},plan.revision);
  if(!await io.confirmDisabled(revision))throw Error("Home Routine has not been confirmed off. The built-in schedule was not sent. Check the routine status.");
 }
 return io.send(patch);
}
