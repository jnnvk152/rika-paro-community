import {validateSchedule,readSchedule,SLOT_KEYS} from './schedule.js';
import {isWoodState} from './stove-status.js';
export const CONTROL_KEYS = ['on','mode','power_percent','target_temperature','schedule','cycle_action'];
export function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k=>!CONTROL_KEYS.includes(k))) throw Error("Invalid command.");
  if('cycle_action'in patch){if(Object.keys(patch).length!==1||!['pause','resume'].includes(patch.cycle_action))throw Error("Invalid daily Comfort control.");return {...patch};}
  if ('on' in patch && typeof patch.on !== 'boolean') throw Error("Invalid power command.");
  if ('mode' in patch && !['manual','auto','comfort'].includes(patch.mode)) throw Error("Invalid mode.");
  for (const [key,min,max] of [['power_percent',30,100],['target_temperature',14,28]]) if (key in patch && (!Number.isInteger(patch[key]) || patch[key]<min || patch[key]>max)) throw Error("The setting is outside the allowed range.");
  if('schedule'in patch){
    if('on'in patch||'target_temperature'in patch||('mode'in patch&&patch.mode!=='auto'))throw Error("Save the schedule separately from power and temperature mode changes.");
    return {...patch,schedule:validateSchedule(patch.schedule)};
  }
  return {...patch};
}
export function assertAllowed(patch,state) {
  validatePatch(patch);
  if('cycle_action'in patch){if(state?.device?.capabilities?.comfort_cycle!==true||state?.home?.cycle?.enabled!==true)throw Error("The daily routine is not ready on the module yet.");if(patch.cycle_action==='resume'&&(state?.stove?.has_error!==false||isWoodState(state.stove.state)||state?.sensors?.room_sensor_connected!==true))throw Error(isWoodState(state?.stove?.state)?"The stove is burning wood. Home Routine cannot be resumed during wood burning.":"Check the stove and room sensor.");}
  if('schedule'in patch&&!readSchedule(state))throw Error("Waiting to read the schedule from the stove.");
  if (patch.on===true && (state?.stove?.has_error!==false || isWoodState(state.stove.state))) throw Error("Starting is not allowed now. Check the stove’s display.");
  if ((patch.mode==='comfort'||'target_temperature' in patch) && state?.sensors?.room_sensor_connected!==true) throw Error("The RIKA room sensor is not connected.");
}
export function controlsMatch(state,patch) {
  if('cycle_action'in patch){
    const cycle=state?.home?.cycle,c=state?.controls;
    if(cycle?.manual_paused!==(patch.cycle_action==='pause'))return false;
    if(patch.cycle_action==='pause')return c?.on===false||cycle.frost_running===true;
    if(cycle.frost_running===true)return true;
    if(cycle.phase==='night'&&cycle.night_mode==='frost')return c?.on===false||cycle.frost_running===true;
    return c?.on===true&&c.mode==='comfort'&&c.heating_times_active===false&&c.target_temperature===(cycle.phase==='day'?cycle.day_temperature:cycle.night_temperature);
  }
  return Object.entries(patch).every(([key,value])=>key==='schedule'?state?.controls?.heating_times_active===value.active&&state?.controls?.setback_temperature===value.setback_temperature&&SLOT_KEYS.every(k=>state?.schedule?.[k]===value.slots[k]):state?.controls?.[key]===value);
}
export function ready(sample, connected, now) {
  return connected && sample?.ready === true && /^[a-f0-9]{32}$/.test(sample.session || '') && Number.isFinite(sample.updatedAt) && now-sample.updatedAt>=-2000 && now-sample.updatedAt<30000 && sample.state?.version_ack === true && !!sample.state?.controls && !!sample.state?.stove && !!sample.state?.sensors;
}
export function buildCommand(patch, sample, connected, now, id) {
  if (!ready(sample,connected,now)) throw Error("The stove is offline or its readings are stale.");
  patch=validatePatch(patch);
  assertAllowed(patch,sample.state);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw Error("Invalid command ID.");
  return {...patch,id,session:sample.session,expiresAt:Math.floor(now+12000)};
}
