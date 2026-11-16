import {initializeApp} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {getAuth} from 'firebase-admin/auth';
import {onValueWritten} from 'firebase-functions/v2/database';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {defineJsonSecret} from 'firebase-functions/params';
import webpush from 'web-push';
import {createHash} from 'node:crypto';
import {planTransition,validSubscription} from './push-policy.js';
import {createAlertHandler} from './delivery.js';
import {readFileSync} from 'node:fs';

const installation=JSON.parse(readFileSync(new URL('./project-config.json',import.meta.url),'utf8'));
initializeApp({databaseURL:installation.databaseURL});
const keys=defineJsonSecret('PARO_WEB_PUSH');
const runtimeRef=()=>getDatabase().ref('notificationRuntime/paro');
const options={region:'europe-west1',memory:'256MiB',cpu:'gcf_gen1',maxInstances:1,concurrency:1,timeoutSeconds:120,secrets:[keys]};
const ownerEmail=installation.ownerEmail;
async function allowed(uid){
 try{const user=await getAuth().getUser(uid);
 if(user.disabled||!user.emailVerified||!user.providerData.some(p=>p.providerId==='google.com'))return false;
 return user.email===ownerEmail||(await getDatabase().ref(`members/${uid}/enabled`).get()).val()===true;
 }catch{return false;}
}
function send(subscription,payload){
 const credentials=keys.value();
 return webpush.sendNotification({endpoint:subscription.endpoint,keys:subscription.keys},JSON.stringify(payload),{vapidDetails:{subject:installation.appOrigin,publicKey:credentials.publicKey,privateKey:credentials.privateKey},TTL:300,urgency:'high',timeout:10000});
}
const io={
 now:()=>Date.now(),
 enabled:async()=>{const config=(await getDatabase().ref('notificationConfig/paro').get()).val();return config?.ready===true&&config.mode!=='device'&&config.publicKey===keys.value().publicKey;},
 telemetry:async()=>(await getDatabase().ref('devices/paro/telemetry').get()).val(),
 claim:async(stove,updatedAt,eventId,eventAt,beforeStove)=>{
  const transaction=await runtimeRef().transaction(previous=>planTransition(previous,stove,updatedAt,eventId,Date.now(),eventAt,beforeStove)||undefined);
  return transaction.committed?transaction.snapshot.val():null;
 },
 subscriptions:async()=>(await getDatabase().ref('pushSubscriptions').get()).val(),allowed,send,
 delivered:async(eventId,key)=>runtimeRef().transaction(value=>value?.eventId===eventId?{...value,delivered:{...value.delivered,[key]:true}}:undefined),
 remove:(uid,id)=>getDatabase().ref(`pushSubscriptions/${uid}/${id}`).remove(),
 finish:async(eventId)=>runtimeRef().transaction(value=>value?.eventId===eventId?{...value,pending:false}:undefined),
 failure:status=>console.error('Push delivery refused',{status}) // Never log endpoints, keys or user IDs.
};
export const stoveAlerts=onValueWritten({...options,instance:installation.instance,ref:'/devices/paro/telemetry/state/stove',retry:true},async event=>{
 if(!event.data.after.exists())return;
 await createAlertHandler(io)(event.data.after.val(),createHash('sha256').update(event.id).digest('hex'),Date.parse(event.time),event.data.before.val());
});
export const testPhoneNotification=onCall({...options,cors:[installation.appOrigin]},async request=>{
 const uid=request.auth?.uid;
 if(!uid||!await allowed(uid))throw new HttpsError('permission-denied',"Stove access is required for notifications.");
 if(!/^[a-f0-9]{64}$/.test(request.data?.id||''))throw new HttpsError('invalid-argument',"Enable notifications again.");
 if(!await io.enabled())throw new HttpsError('failed-precondition',"Notification delivery is disabled.");
 const clock=Date.now();
 const rate=await getDatabase().ref(`notificationTests/${uid}`).transaction(old=>!old||clock-old>15000?clock:undefined);
 if(!rate.committed)throw new HttpsError('resource-exhausted',"Wait 15 seconds before the next test.");
 const subscription=(await getDatabase().ref(`pushSubscriptions/${uid}/${request.data.id}`).get()).val();
 if(!validSubscription(subscription)||createHash('sha256').update(subscription.endpoint).digest('hex')!==request.data.id)throw new HttpsError('failed-precondition',"Enable notifications again on this phone.");
 try{await send(subscription,{title:"PARO · Notification test",body:"This phone can receive stove alerts. The test did not change stove settings.",tag:'paro-notification-test',at:clock});}
 catch{throw new HttpsError('unavailable',"Delivery failed. Enable notifications again or try later.");}
 return {accepted:true};
});
