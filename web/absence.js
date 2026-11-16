import {timeLabel} from './comfort-plan.js';
export const HOME_ZONE='Europe/Ljubljana';
export function homeDate(now=Date.now()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:HOME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=k=>parts.find(p=>p.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');
}
export function validDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
}
// The reminder follows the home's timezone even when the phone is abroad.
export function reminderAt(date){
 if(!validDate(date))throw Error("Choose a valid return date.");
 const prior=new Date(date+'T12:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);
 const target=prior.toISOString().slice(0,10),[y,m,d]=target.split('-').map(Number),wall=Date.UTC(y,m-1,d,19);
 let utc=wall;
 for(let n=0;n<2;n++){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:HOME_ZONE,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(utc);
  const get=k=>Number(parts.find(p=>p.type===k).value);
  utc+=wall-Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
 }
 return utc;
}
export function absenceEntry(previous,{active=true,returnDate='',confirmation='pending'},uid,now=Date.now()){
 if(typeof active!=='boolean'||!['pending','confirmed','unknown'].includes(confirmation))throw Error("Invalid absence plan.");
 if(returnDate&&(!validDate(returnDate)||active&&(returnDate<homeDate(now)||Date.parse(returnDate+'T12:00:00Z')>now+732*86400000)))throw Error("Choose today or a future return date.");
 if(!returnDate)confirmation='unknown';
 const same=previous?.id&&previous.returnDate===returnDate&&previous.active===active;
 return {id:same?previous.id:crypto.randomUUID(),revision:(previous?.revision||0)+1,active,returnDate,remindAt:returnDate?reminderAt(returnDate):0,confirmation,updatedAt:now,uid};
}
export function reminderDue(plan,now=Date.now()){
 return plan?.active===true&&plan.confirmation==='pending'&&validDate(plan.returnDate)&&plan.remindAt>0&&plan.remindAt<=now&&homeDate(now)<plan.returnDate;
}
export function effectiveAbsence(plan,state){
 const r=state?.home?.return;
 const completed=plan?.active===true&&state?.device?.capabilities?.return_schedule===true&&r?.durable===true&&r.status==='completed'&&r.id===plan.id&&r.return_date===plan.returnDate;
 return completed?{...plan,active:false}:plan;
}
export function completedAbsenceEntry(plan,state,uid,now=Date.now()){
 if(plan?.active!==true||effectiveAbsence(plan,state)?.active!==false)return undefined;
 return absenceEntry(plan,{active:false,returnDate:plan.returnDate,confirmation:plan.confirmation},uid,now);
}
export function absenceScheduleStatus(plan,state,comfort,fresh){
 const supported=state?.device?.capabilities?.return_schedule===true,time=timeLabel(comfort?.day_start_minute??360),r=state?.home?.return;
 const result=(kind,message)=>({kind,message,supported,time});
 if(plan?.active!==true)return result('none','');
 if(!plan.returnDate)return result('unknown',"No return date is set. Heating remains paused.");
 const date=plan.returnDate.split('-').reverse().join('. '),when=date+" at "+time;
 if(!fresh)return result('waiting',"Return: "+when+". Waiting for a fresh confirmation from the module.");
 if(!supported)return result('unsupported',"Automatic return at "+when+" requires a module update. The current version does not act on this date yet.");
 if(r?.id!==plan.id||r?.return_date!==plan.returnDate||r.revision<plan.revision)return result('waiting',"Return: "+when+". The module is still receiving the latest saved date.");
 if(r.status==='completed'&&r.durable===true)return result('completed',"Automatic return to Home Routine is confirmed. Check the Control tab for flame status.");
 if(r.status==='starting')return result('starting',"The module is enabling Home Routine. Waiting for confirmation from the stove.");
 if(r.status==='cancelled')return result('cancelled',"Automatic return was cancelled by a later manual command. To resume, select “Home · enable heating”.");
 if(r.status==='missed')return result('missed',"The return time has already passed. To start heating today, select “Home · enable heating”.");
 if(r.status==='unconfirmed')return result('unconfirmed',"The automatic transition is unconfirmed. Check the stove; the module will not retry the start automatically.");
 if(r.durable!==true||r.status==='storage_unavailable')return result('storage',"The module cannot persist the return date. Automatic start is not ready.");
 if(r.status==='clock_not_ready')return result('clock',"Waiting for the module clock. Automatic start is not ready yet.");
 if(comfort?.enabled!==true||r.reason==='plan_disabled')return result('disabled',"Home Routine is disabled. Enable it first for an automatic return.");
 const blockers={room_sensor:"Waiting for the room sensor.",stove_error:"The stove reports a fault.",wood_burning:"The stove is burning wood.",native_frost:"Frost protection is running.",awaiting_fresh_plan:"The module is checking the return date again."};
 if(blockers[r.reason])return result('blocked',"Return: "+when+'. '+blockers[r.reason]);
 if(r.status!=='armed')return result('waiting',"Return: "+when+". Waiting for plan confirmation.");
 return result('armed',"Automatic return to Home Routine: "+when+". You do not need to answer the evening reminder for heating to resume.");
}
