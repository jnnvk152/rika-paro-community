export const SILENCE_MS=180000,FRESH_MS=30000;
export function health(sample,now){
 if(!Number.isFinite(sample?.updatedAt)||sample.updatedAt<=0||sample.updatedAt>now+2000||typeof sample.ready!=='boolean')return 'unknown';
 return now-sample.updatedAt>=FRESH_MS?'module':sample.ready?'online':'stove';
}
// One outage spans changes of cause (USB loss followed by router loss).
// A warning needs three minutes; recovery is sent only after a reported outage.
export function observe(previous,sample,now){
 const reason=health(sample,now);if(reason==='unknown')return null;
 const old=previous||{},next={version:1,phase:'online',reason,lastSeen:sample.updatedAt,since:0,sequence:old.sequence||0,eventKind:old.eventKind||'none',eventAt:old.eventAt||0,pending:old.pending===true,delivered:old.delivered||{},lastTest:old.lastTest||'',absenceId:old.absenceId||'',absenceDelivered:old.absenceDelivered||{},lease:'',leaseUntil:0};
 const event=kind=>Object.assign(next,{sequence:next.sequence+1,eventKind:kind,eventAt:now,pending:true,delivered:{}});
 if(reason==='online'){
  if(old.phase==='offline')event('recovered');
  else if(old.phase==='pending')next.pending=false;
 }else{
  next.since=old.phase&&old.phase!=='online'&&old.since>0?old.since:reason==='module'?sample.updatedAt:now;
  if(now-next.since>=SILENCE_MS){next.phase='offline';if(old.phase!=='offline')event('offline');}
  else{next.phase='pending';next.pending=false;}
 }
 return next;
}
export function payload(runtime,now){
 return {title:runtime.eventKind==='recovered'?"PARO · Connection restored":"PARO · Connection lost",body:runtime.eventKind==='recovered'?"The module and stove are responding again. Check fresh readings in the app.":runtime.reason==='stove'?"The module is reachable, but the stove has not responded for several minutes. Check the USB connection and the stove’s display.":"The module has not checked in for several minutes. Check your home internet, module power and connection. The stove’s state cannot currently be confirmed.",tag:'paro-connection',at:now,data:{view:'control'}};
}
export function eventCurrent(runtime,sample,now){
 const value=health(sample,now);
 return value!=='unknown'&&(runtime.eventKind==='recovered'?value==='online':value!=='online');
}
export function validTest(value,now){
 return /^[a-f0-9-]{36}$/.test(value?.nonce||'')&&/^[A-Za-z0-9_-]{1,128}$/.test(value?.uid||'')&&/^[a-f0-9]{64}$/.test(value?.subscription||'')&&Number.isFinite(value.at)&&value.at<=now+2000&&now-value.at<=600000&&value.expiresAt>now&&value.expiresAt<=value.at+600000;
}
