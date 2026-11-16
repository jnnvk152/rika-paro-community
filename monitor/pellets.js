import {pelletReading,observePellets,pelletMessage} from '../web/pellet-alerts.js';
import {validSubscription} from '../functions/push-policy.js';
import {targetId} from './run.js';
import {validTest} from './policy.js';
export async function runPelletMonitor(io){
 const now=io.now(),[config,input,stored]=await Promise.all([io.config(),io.pelletInput(),io.pelletRuntime()]);
 if(config?.ready!==true||config.publicKey!==io.publicKey)return {status:'disabled'};
 if(stored.value?.leaseUntil>now)return {status:'busy'};
 let reading=pelletReading(input.sample,input.entries,now);
 const state=observePellets(stored.value,reading,now);state.lease=crypto.randomUUID();state.leaseUntil=now+45000;
 if(!await io.pelletClaim(state,stored.etag))return {status:'busy'};
 let http=0;
 try{
  const test=await io.pelletTest();
  if(validTest(test,now)&&test.nonce!==state.lastTest){
   const sub=await io.subscription(test.uid,test.subscription);let accepted=false;
   if(validSubscription(sub)&&typeof sub.owner==='boolean'&&await io.allowed(test.uid,sub)){
    try{http=await io.send(sub,{title:"PARO · Pellet alert test",body:"The test succeeded. Estimated stock alerts below 50%, 20% and 10% are ready. This is not an alert about actual stock.",tag:'paro-pellet-test',at:now,data:{view:'control'}});accepted=http>=200&&http<300;}catch{http=0;}
   }
   if(accepted||(http>=400&&http<500&&http!==408&&http!==429))state.lastTest=test.nonce;
   await io.pelletTestReceipt({nonce:test.nonce,status:accepted?'accepted':'failed',http,updatedAt:{'.sv':'timestamp'}});
   return {status:accepted?'pellet-test-accepted':'pellet-test-failed',http};
  }
  if(!reading.known||!state.pending)return {status:reading.known?'pellets-ready':reading.reason};
  const users=await io.subscriptions();let attempted=0,remaining=false;
  for(const [uid,phones] of Object.entries(users||{}).slice(0,8)){
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))continue;
   for(const [id] of Object.entries(phones||{}).slice(0,10)){
    if(!/^[a-f0-9]{64}$/.test(id))continue;
    const key=await targetId(uid,id);if(state.delivered[key])continue;
    if(attempted>=1){remaining=true;continue;}attempted++;
    const sub=await io.subscription(uid,id);
    if(!validSubscription(sub)||typeof sub.owner!=='boolean'||!await io.allowed(uid,sub)){state.delivered[key]=true;continue;}
    // Re-read the real estimate immediately before delivery. A refill, an open
    // lid or a newer, more urgent level supersedes the queued message.
    const latest=await io.pelletInput();reading=pelletReading(latest.sample,latest.entries,io.now());
    if(!reading.known)return {status:reading.reason};
    const current=observePellets(state,reading,io.now());
    if(current.sequence!==state.sequence||!current.pending){Object.assign(state,current);return {status:'pellet-superseded'};}
    try{http=await io.send(sub,pelletMessage(reading,state.eventLevel,io.now()));}catch{http=0;}
    if(http>=200&&http<300||(http>=400&&http<500&&http!==408&&http!==429)){state.delivered[key]=true;await io.pelletSave(state);}else remaining=true;
   }
  }
  state.pending=remaining;return {status:'pellet-alert',http};
 }finally{
  state.lease='';state.leaseUntil=0;await io.pelletSave(state);
  await io.pelletStatus({checkedAt:{'.sv':'timestamp'},lastValidAt:reading.known?reading.at:0,level:reading.known?([10,20,50].find(level=>reading.percent<level)||0):0,reason:reading.reason,http,lastEventAt:state.eventAt});
 }
}
