import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stoveAlerts,alertFingerprint,notificationPayload,WARNINGS} from '../functions/alerts.js';
import {freshTelemetry,validSubscription,planTransition} from '../functions/push-policy.js';
import {createAlertHandler} from '../functions/delivery.js';
const now=Date.parse('2026-10-22T19:00:00Z');
const normal=()=>({has_error:false,error_code:0,error_sub:0,warning_code:0});
const subscription=()=>({enabled:true,deviceId:'paro',endpoint:'https://fcm.googleapis.com/fcm/send/'+'a'.repeat(100),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}});
const sample=stove=>({updatedAt:now,ready:true,state:{version_ack:true,stove}});
test('official warning numbers decode independently; 64 is calibration and 6 combines both open covers',()=>{
 for(const [code,title] of WARNINGS){const alerts=stoveAlerts({...normal(),warning_code:code});assert.equal(alerts.length,1);assert.equal(alerts[0].title,title);assert.equal(alerts[0].confirmed,true);}
 assert.match(stoveAlerts({...normal(),warning_code:64})[0].title,/Calibrating/);
 assert.equal(stoveAlerts({...normal(),warning_code:6}).length,2);
 assert.equal(stoveAlerts({...normal(),warning_code:8})[0].confirmed,false);
 assert.equal(stoveAlerts({...normal(),warning_code:512})[0].confirmed,false);
 assert.deepEqual(stoveAlerts(normal()),[]);
});
test('unconfirmed 512 / 8 stays unconfirmed and every unknown future error remains visible',()=>{
 for(const error_code of [1,8,512,2147483648,-2147483648,4294967295]){
  const [alert]=stoveAlerts({...normal(),has_error:true,error_code,error_sub:8});assert.equal(alert.kind,'error');assert.equal(alert.confirmed,false);assert.match(alert.code,/subcode 8/);assert.doesNotMatch(alert.title,/flap|pellet|ignition/i);
 }
 assert.equal(stoveAlerts({...normal(),has_error:true,error_code:null}).length,1);
 const payload=notificationPayload({...normal(),has_error:true,error_code:512,error_sub:8},now);
 assert.match(payload.body,/512.*subcode 8/);assert.match(payload.body,/21:00/);
 assert.equal(notificationPayload(normal(),now),null);
});
test('subscriptions cannot target arbitrary sites or local services',()=>{
 assert.equal(validSubscription(subscription()),true);
 for(const host of ['https://web.push.apple.com/','https://updates.push.services.mozilla.com/wpush/v2/'])assert.equal(validSubscription({...subscription(),endpoint:host+'a'.repeat(50)}),true);
 for(const endpoint of ['http://127.0.0.1/admin','https://127.0.0.1/','https://example.org/test','https://fcm.googleapis.com.evil.example/fcm/send/'+'a'.repeat(30),'https://user:pass@fcm.googleapis.com/fcm/send/'+'a'.repeat(30),'https://fcm.googleapis.com:3000/fcm/send/'+'a'.repeat(30),'https://fcm.googleapis.com/fcm/send/'+'a'.repeat(30)+'?target=x'])assert.equal(validSubscription({...subscription(),endpoint}),false);
 assert.equal(validSubscription({...subscription(),deviceId:'other'}),false);assert.equal(validSubscription({...subscription(),keys:{p256dh:'x',auth:'y'}}),false);
});
test('transition planner suppresses repeats, rejects stale events, and allows recurrence after clearing',()=>{
 const error={...normal(),error_code:512,error_sub:8,has_error:true};
 assert.equal(freshTelemetry(sample(error),now),true);assert.equal(freshTelemetry({...sample(error),ready:false},now),false);
 const first=planTransition(null,error,now,'event-one',now);assert.ok(first.pending);
 assert.equal(planTransition({...first,pending:false},error,now+1000,'event-two',now+1000),null);
 assert.equal(planTransition(first,error,now,'event-one',now).eventId,'event-one');
 const clean=planTransition(first,normal(),now+2000,'clear',now+2000);assert.equal(clean.pending,false);
 assert.ok(planTransition(clean,error,now+3000,'recurrence',now+3000).pending);
 assert.equal(planTransition(clean,error,now-1000,'old',now),null);assert.equal(planTransition(null,error,now-31000,'expired',now),null);
 assert.equal(alertFingerprint({...error,room_temperature:22}),alertFingerprint(error));
 const missedClear=planTransition({...first,pending:false},error,now+2000,'new-occurrence',now+2000,now+2000,normal());assert.ok(missedClear.pending);
 assert.equal(planTransition(missedClear,error,now+3000,'old-event',now+3000,now,error),null);
});
test('delivery sends once to approved devices, retries transient failures, prunes expired subscriptions and skips revoked users',async()=>{
 const error={...normal(),error_code:512,error_sub:8,has_error:true};let runtime=null,current=sample(error),tries=0;
 const deliveries=[],removed=[];const subscribers={owner:{phone:subscription(),expired:subscription()},revoked:{old:subscription()}};
 const io={enabled:async()=>true,now:()=>now,telemetry:async()=>current,claim:async(stove,at,id)=>{const next=planTransition(runtime,stove,at,id,now);if(next)runtime=next;return next;},subscriptions:async()=>subscribers,allowed:async uid=>uid==='owner',send:async(s,p)=>{if(s===subscribers.owner.expired)throw {statusCode:410};if(tries++===0)throw {statusCode:503};deliveries.push(p);},delivered:async(_,key)=>{runtime.delivered[key]=true;},remove:async(uid,id)=>removed.push([uid,id]),finish:async()=>{runtime.pending=false;}};
 const handle=createAlertHandler(io);
 await assert.rejects(handle(error,'event-one'));assert.equal(runtime.pending.title,"PARO · Stove fault");assert.deepEqual(removed,[['owner','expired']]);
 await handle(error,'event-one');assert.equal(deliveries.length,1);await handle(error,'new-telemetry');assert.equal(deliveries.length,1);
 current={...sample(error),ready:false};await handle(error,'offline');assert.equal(deliveries.length,1);
 current=sample(normal());await handle(error,'out-of-order');assert.equal(deliveries.length,1);
});

test('disabled phone delivery never reads telemetry or sends a notification',async()=>{
 const handle=createAlertHandler({enabled:async()=>false,now:()=>now,telemetry:async()=>{throw Error('Unexpected read while disabled');}});
 await assert.doesNotReject(handle({...normal(),has_error:true,error_code:512,error_sub:8},'disabled-event'));
});
