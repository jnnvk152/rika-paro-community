import {observe,eventCurrent,payload,validTest} from './policy.js';
import {validSubscription} from '../functions/push-policy.js';
import {reminderDue} from '../web/absence.js';
const safe=value=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
export async function targetId(uid,id){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(uid+'/'+id))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function runMonitor(io){
 const now=io.now(),[config,sample,stored]=await Promise.all([io.config(),io.sample(),io.runtime()]);
 if(config?.ready!==true||config.publicKey!==io.publicKey)return {status:'disabled'};
 if(stored.value?.leaseUntil>now)return {status:'busy'};
 const state=observe(stored.value,sample,now);if(!state)return {status:'unknown'};
 state.lease=crypto.randomUUID();state.leaseUntil=now+45000;state.checkedAt={'.sv':'timestamp'};
 if(!await io.claim(state,stored.etag))return {status:'busy'};
 let http=0;
 try{
  // Test delivery is isolated: never forge real telemetry or stove controls.
  const test=await io.test();
  if(validTest(test,now)&&test.nonce!==state.lastTest){
   const sub=await io.subscription(test.uid,test.subscription);
   let accepted=false;
   if(validSubscription(sub)&&typeof sub.owner==='boolean'&&await io.allowed(test.uid,sub)){
    try{http=await io.send(sub,{title:"PARO · External monitor test",body:"Cloudflare sent this notification. The monitor can alert you even if the ESP32 loses power or internet access. No command was sent to the stove.",tag:'paro-cloud-monitor-test',at:now,data:{view:'control'}});accepted=http>=200&&http<300;}catch{http=0;}
   }
   if(accepted||(http>=400&&http<500&&http!==408&&http!==429))state.lastTest=test.nonce;
   await io.testReceipt({nonce:test.nonce,status:accepted?'accepted':'failed',http,updatedAt:{'.sv':'timestamp'}});
   return {status:accepted?'test-accepted':'test-failed',http};
  }
  const plan=!state.pending&&io.absence?await io.absence():null,reminder=reminderDue(plan,io.now());
  if(!state.pending&&!reminder)return {status:state.phase};
  if(reminder&&state.absenceId!==plan.id){state.absenceId=plan.id;state.absenceDelivered={};}
  const delivered=reminder?state.absenceDelivered:state.delivered;
  // One encrypted delivery per tick keeps CPU bounded on Workers Free.
  const users=await io.subscriptions();let attempted=0,remaining=false;
  for(const [uid,phones] of Object.entries(users||{}).slice(0,8)){
   if(!safe(uid))continue;
   for(const [id] of Object.entries(phones||{}).slice(0,10)){
    if(!/^[a-f0-9]{64}$/.test(id))continue;
    const key=await targetId(uid,id);if(delivered[key])continue;
    if(attempted>=1){remaining=true;continue;}attempted++;
    // Re-check deletion, revocation and current readings before each attempt.
    const sub=await io.subscription(uid,id);
    if(!validSubscription(sub)||typeof sub.owner!=='boolean'||!await io.allowed(uid,sub)){delivered[key]=true;continue;}
    if(reminder){const latest=await io.absence();if(latest?.id!==plan.id||!reminderDue(latest,io.now()))return {status:'reminder-superseded'};}
    else if(!eventCurrent(state,await io.sample(),io.now())){state.pending=false;return {status:'superseded'};}
    const message=reminder?{title:"PARO · Check your return date",body:"Planned return: "+plan.returnDate.split('-').reverse().join('. ')+". If you are staying away longer, change the date in the app. Otherwise, Home Routine resumes automatically at the morning start time.",tag:'paro-return-date',at:io.now(),data:{view:'control'}}:payload(state,io.now());
    try{http=await io.send(sub,message);}catch{http=0;}
    if(http>=200&&http<300||(http>=400&&http<500&&http!==408&&http!==429)){
     delivered[key]=true;
     // Persist after each accepted recipient; a crash can still duplicate an
     // in-flight delivery, so the browser uses a stable notification tag.
     await io.save(state);
    }else remaining=true;
   }
  }
  if(!reminder)state.pending=remaining;
  return {status:reminder?'return-reminder':state.phase,http};
 }finally{
  state.lease='';state.leaseUntil=0;await io.save(state);
  await io.status({checkedAt:{'.sv':'timestamp'},lastSeen:state.lastSeen,phase:state.phase,lastEventAt:state.eventAt,http});
 }
}
