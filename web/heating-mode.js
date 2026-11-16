import {validatePatch} from './domain.js';
// Basic controls always reflect the real stove, independently of the home plan.
export function heatingDraft(state){
 const c=state?.controls||{};
 return {mode:c.mode,target_temperature:c.target_temperature,power_percent:c.power_percent};
}
// Saving a mode/power is deliberately separate from an explicit heat request.
export const manualSettings=power=>validatePatch({mode:'manual',power_percent:power});
export function resumeHeatingCommands(state,plan,phase){
 const p=plan||state?.home?.cycle,commands=[{cycle_action:'resume'}];
 // Let the existing controller persist/claim the resume first. Then restore
 // manual power without another ON frame. Stop if either confirmation is absent.
 if(state?.controls?.mode==='manual'&&(phase==='day'||phase==='night'&&p?.night_mode==='temperature'))commands.push(manualSettings(state.controls.power_percent));
 return commands;
}
export async function applyHeatingCommands(commands,send){
 for(const command of commands)if(!await send(command))return false;
 return true;
}
