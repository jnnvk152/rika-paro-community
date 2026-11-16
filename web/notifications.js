import {ref,get,set,onValue,serverTimestamp} from 'firebase/database';
import {getFunctions,httpsCallable} from 'firebase/functions';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
export class PhoneNotifications{
 enabled=false;busy=false;message='';id=null;generation=0;
 async accountChanged(user){
  ++this.generation;this.enabled=false;this.id=null;
  try{const bound=localStorage.getItem('paro-push-uid');if(bound&&bound!==user?.uid){const registration=await navigator.serviceWorker?.getRegistration('/');await (await registration?.pushManager.getSubscription())?.unsubscribe();for(const notification of await registration?.getNotifications()||[])notification.close();localStorage.removeItem('paro-push-uid');}}catch{}
  this.change();
 }
 constructor(cloud,change){this.cloud=cloud;this.change=change;}
 get support(){
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)return "On iPhone, first add the app to your home screen in Safari: Share → Add to Home Screen. Then open it from the icon.";
  if(!isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))return "This browser does not support web push notifications.";
  if(Notification.permission==='denied')return "Notifications are blocked. Allow them in your phone or browser settings.";
  return '';
 }
 get path(){if(!this.cloud.user?.uid||!this.id)throw Error("Sign in first.");return `pushSubscriptions/${this.cloud.user.uid}/${this.id}`;}
 async inspect(){
  if(this.busy)return;
  const generation=++this.generation;this.enabled=false;this.id=null;
  if(this.support||!this.cloud.allowed)return this.change();
  try{
   const registration=await navigator.serviceWorker.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();
   if(!subscription||generation!==this.generation)return;
   const id=await hash(subscription.endpoint);const saved=await get(ref(this.cloud.db,`pushSubscriptions/${this.cloud.user.uid}/${id}`));
   if(generation!==this.generation)return;
   this.id=id;this.enabled=saved.val()?.enabled===true;
  }catch{this.message="Notification status could not be checked.";}finally{this.change();}
 }
 async enable(){
  if(this.busy)return;if(this.support)throw Error(this.support);
  if(!this.cloud.allowed)throw Error("First sign in and get access to the stove.");
  const config=this.cloud.notificationConfig,uid=this.cloud.user.uid;
  if(config?.ready!==true||!config.publicKey)throw Error("Notification delivery is not enabled yet.");
  this.busy=true;this.message='';this.change();
  try{
   // Permission request must originate directly from the phone user's click.
   const permission=await Notification.requestPermission();if(permission!=='granted')throw Error("Notifications are not allowed.");
   const registration=await navigator.serviceWorker.register('/push-worker.js',{scope:'/',updateViaCache:'none'});
   await navigator.serviceWorker.ready;
   let subscription=await registration.pushManager.getSubscription();
   if(subscription&&subscription.options.applicationServerKey){const existing=Array.from(new Uint8Array(subscription.options.applicationServerKey)).join(',');if(existing!==Array.from(decode(config.publicKey)).join(',')){const oldId=await hash(subscription.endpoint);await subscription.unsubscribe();await set(ref(this.cloud.db,`pushSubscriptions/${this.cloud.user.uid}/${oldId}`),null);subscription=null;}}
   subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(config.publicKey)});
   if(this.cloud.user?.uid!==uid||!this.cloud.allowed){await subscription.unsubscribe();throw Error("Your sign-in changed. Try again.");}
   this.id=await hash(subscription.endpoint);const value=subscription.toJSON();
   await set(ref(this.cloud.db,this.path),{endpoint:value.endpoint,keys:value.keys,deviceId:'paro',enabled:true,owner:this.cloud.owner===true,createdAt:serverTimestamp()});
   localStorage.setItem('paro-push-uid',uid);this.enabled=true;this.message="Notifications are enabled on this device. Send a test notification.";
  }finally{this.busy=false;this.change();}
 }
 async disable(){
  if(this.busy)return;this.busy=true;this.change();
  try{
   if(this.id&&this.cloud.user)await set(ref(this.cloud.db,this.path),null);
   const registration=await navigator.serviceWorker.getRegistration('/');await (await registration?.pushManager.getSubscription())?.unsubscribe();
   for(const notification of await registration?.getNotifications()||[])notification.close();
   localStorage.removeItem('paro-push-uid');this.enabled=false;this.id=null;this.message="Notifications are disabled on this device.";
  }finally{this.busy=false;this.change();}
 }
 async test(){
  if(!this.enabled||!this.id||this.busy)return;this.busy=true;this.change();
  try{
   if(this.cloud.notificationConfig?.mode==='device'){
    if(!this.cloud.connected)throw Error("The service connection is interrupted.");
    const uid=this.cloud.user.uid,nonce=crypto.randomUUID();let stop=()=>{},timer,writeTimer;
    const response=new Promise((resolve,reject)=>{
     timer=setTimeout(()=>{stop();reject(Error("The module has not confirmed delivery. Check its connection and try again."));},60000);
     stop=onValue(ref(this.cloud.db,`devicePushReceipts/paro/${uid}`),snapshot=>{const value=snapshot.val();if(value?.nonce!==nonce)return;clearTimeout(timer);stop();value.status==='accepted'?resolve(value):reject(Error("The delivery service refused the notification"+(value.http?' (HTTP '+value.http+')':'')+'.'));},()=>{clearTimeout(timer);stop();reject(Error("The delivery receipt could not be read."));});
    });
    // Attach the rejection handler before the write, so disconnects cannot leave an unhandled rejection.
    response.catch(()=>{});
    try{
     await Promise.race([set(ref(this.cloud.db,`devicePushTests/paro/${uid}`),{nonce,subscription:this.id,createdAt:serverTimestamp(),expiresAt:this.cloud.now()+60000}),new Promise((_,reject)=>{writeTimer=setTimeout(()=>reject(Error("The request could not be confirmed. Check the connection and try again.")),10000);})]);
     clearTimeout(writeTimer);
     this.message="The module is preparing a test notification. Allow up to one minute.";this.change();
     await response;this.message="The module handed the notification to the delivery service. Check whether it reached your phone.";
    }finally{clearTimeout(timer);clearTimeout(writeTimer);stop();}
   }else{await httpsCallable(getFunctions(this.cloud.app,'europe-west1'),'testPhoneNotification')({id:this.id});this.message="The service accepted the test notification. Check your phone’s notifications.";}
  }
  finally{this.busy=false;this.change();}
 }
}
