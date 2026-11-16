import {alertFingerprint,notificationPayload} from './alerts.js';
export function validSubscription(value){
 if(!value||value.enabled!==true||value.deviceId!=='paro'||typeof value.endpoint!=='string'||value.endpoint.length>2048)return false;
 try{const u=new URL(value.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search)return false;
 const prefix={'fcm.googleapis.com':'/fcm/send/','web.push.apple.com':'/','updates.push.services.mozilla.com':'/wpush/v2/'}[u.hostname];
 if(!prefix||!u.pathname.startsWith(prefix)||u.pathname.length<prefix.length+20)return false;
 }catch{return false;}
 return typeof value.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]{87}=?$/.test(value.keys.p256dh)&&typeof value.keys?.auth==='string'&&/^[A-Za-z0-9_-]{22}(==)?$/.test(value.keys.auth);
}
export function freshTelemetry(telemetry,now=Date.now()){
 return telemetry?.ready===true&&telemetry.state?.version_ack===true&&Number.isFinite(telemetry.updatedAt)&&telemetry.updatedAt<=now+2000&&telemetry.updatedAt>now-30000;
}
export function planTransition(previous,stove,updatedAt,eventId,now=Date.now(),eventAt=updatedAt,beforeStove){
 if(!Number.isFinite(updatedAt)||updatedAt>now+2000||updatedAt<now-30000||!eventId)return null;
 if(previous?.observedAt>updatedAt||previous?.observedEventAt>eventAt)return null;
 const fingerprint=alertFingerprint(stove);
 if(previous?.fingerprint===fingerprint){
  if(previous.eventId===eventId)return previous.pending?previous:null;
  if(beforeStove===undefined||alertFingerprint(beforeStove)===fingerprint||eventAt<=(previous.observedEventAt??0))return null;
 }
 const payload=notificationPayload(stove,updatedAt);
 return {fingerprint,observedAt:updatedAt,observedEventAt:eventAt,eventId,pending:payload||false,delivered:{}};
}
