import {alertFingerprint} from './alerts.js';
import {freshTelemetry,validSubscription} from './push-policy.js';
export function createAlertHandler(io){
 return async function handle(stove,eventId,eventAt=io.now(),beforeStove){
  if(!await io.enabled())return;
  let telemetry=await io.telemetry();
  if(!freshTelemetry(telemetry,io.now())||alertFingerprint(telemetry.state.stove)!==alertFingerprint(stove))return;
  const runtime=await io.claim(stove,telemetry.updatedAt,eventId,eventAt,beforeStove);
  if(!runtime?.pending)return;
  const users=await io.subscriptions();let transientFailure=false;
  for(const [uid,devices] of Object.entries(users||{})){
   if(!await io.allowed(uid))continue;
   for(const [id,subscription] of Object.entries(devices||{}).slice(0,10)){
    const key=`${uid}:${id}`;if(runtime.delivered?.[key]||!validSubscription(subscription))continue;
    telemetry=await io.telemetry();
    if(!freshTelemetry(telemetry,io.now())||alertFingerprint(telemetry.state.stove)!==runtime.fingerprint)return;
    // Membership is checked again immediately before delivery, including retries.
    if(!await io.enabled())return;
    if(!await io.allowed(uid))break;
    try{await io.send(subscription,runtime.pending);await io.delivered(eventId,key);}
    catch(error){
     if([404,410].includes(error.statusCode)){await io.remove(uid,id);await io.delivered(eventId,key);}
     else if([400,401,403,413].includes(error.statusCode)){await io.delivered(eventId,key);io.failure?.(error.statusCode);}
     else transientFailure=true;
    }
   }
  }
  if(transientFailure)throw Error('Notification transport temporarily unavailable');
  await io.finish(eventId);
 };
}
