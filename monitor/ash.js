import {ashReading,ashMessage} from '../web/ash.js';
import {validSubscription} from '../functions/push-policy.js';
import {targetId} from './run.js';
export async function runAshMonitor(io){
 const now=io.now(),[config,input,stored]=await Promise.all([io.config(),io.ashInput(),io.ashRuntime()]);
 if(config?.ready!==true||config.publicKey!==io.publicKey)return {status:'disabled'};
 if(stored.value?.leaseUntil>now)return {status:'busy'};
 let reading=ashReading(input.sample,input.entries,now);
 const old=stored.value,state={version:1,cycle:reading.cycle,eventAt:old?.cycle===reading.cycle?old.eventAt:0,delivered:old?.cycle===reading.cycle?old.delivered||{}:{},lease:crypto.randomUUID(),leaseUntil:now+45000,checkedAt:{'.sv':'timestamp'}};
 if(!await io.ashClaim(state,stored.etag))return {status:'busy'};
 let http=0;
 try{
  if(!reading.known||!reading.due)return {status:'ash-'+reading.reason};
  if(!state.eventAt)state.eventAt=now;
  const users=await io.subscriptions();let attempted=0;
  for(const [uid,phones] of Object.entries(users||{}).slice(0,8)){
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))continue;
   for(const id of Object.keys(phones||{}).slice(0,10)){
    if(!/^[a-f0-9]{64}$/.test(id))continue;
    const key=await targetId(uid,id);if(state.delivered[key])continue;
    if(attempted>=1)continue;attempted++;
    const sub=await io.subscription(uid,id);
    if(!validSubscription(sub)||typeof sub.owner!=='boolean'||!await io.allowed(uid,sub)){state.delivered[key]=true;continue;}
    // A newly recorded emptying supersedes the old reminder before delivery.
    const latest=await io.ashInput();reading=ashReading(latest.sample,latest.entries,io.now());
    if(!reading.known||!reading.due||reading.cycle!==state.cycle)return {status:'ash-superseded'};
    try{http=await io.send(sub,ashMessage(reading,io.now()));}catch{http=0;}
    if(http>=200&&http<300||(http>=400&&http<500&&http!==408&&http!==429)){state.delivered[key]=true;await io.ashSave(state);}
   }
  }
  return {status:'ash-reminder',http};
 }finally{
  state.lease='';state.leaseUntil=0;await io.ashSave(state);
  await io.ashStatus({checkedAt:{'.sv':'timestamp'},reason:reading.reason,due:reading.due,http,lastEventAt:state.eventAt});
 }
}
