import {buildPushPayload} from '@block65/webcrypto-web-push';
import {runMonitor} from './run.js';
import {runAshMonitor} from './ash.js';
import {runPelletMonitor} from './pellets.js';
let cachedToken,expires=0;
const failure=code=>Object.assign(Error('Monitor operation failed'),{monitorCode:code});
async function bounded(response,max=65536){
 if(!response.body)return '';
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Response too large');}text+=decoder.decode(value,{stream:true});}
 return text+decoder.decode();
}
export function createIo(env,network=(input,init)=>globalThis.fetch(input,init)){
 const DATABASE=env.PARO_DATABASE_URL,appOrigin=env.PARO_APP_ORIGIN;
 if(!/^https:\/\/[-a-z0-9]+\.(?:[-a-z0-9]+\.firebasedatabase\.app|firebaseio\.com)$/.test(DATABASE||'')||!/^https:\/\/[-a-z0-9.]+$/.test(appOrigin||''))throw failure('invalid_configuration');
 let credentials,keys,pendingToken;
 if(typeof env.PARO_WATCH_FIREBASE!=='string'||typeof env.PARO_WATCH_VAPID!=='string')throw failure('missing_bindings');
 try{credentials=JSON.parse(env.PARO_WATCH_FIREBASE);keys=JSON.parse(env.PARO_WATCH_VAPID);}catch{throw failure('invalid_bindings');}
 if(credentials.databaseURL!==DATABASE||!credentials.apiKey?.startsWith('AIza')||!credentials.refreshToken||!keys.publicKey||!keys.privateKey)throw failure('invalid_configuration');
 async function token(){
  if(cachedToken&&Date.now()<expires)return cachedToken;
  if(!pendingToken)pendingToken=(async()=>{
   if(typeof AbortSignal.timeout!=='function')throw failure('unsupported_timeout');
   const r=await network('https://securetoken.googleapis.com/v1/token?key='+credentials.apiKey,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:credentials.refreshToken}),redirect:'manual',signal:AbortSignal.timeout(8000)});
   if(!r.ok)throw failure('auth_http_'+r.status);
   const value=JSON.parse(await bounded(r,8192));if(!value.id_token)throw failure('auth_no_token');
   cachedToken=value.id_token;expires=Date.now()+Math.max(60,Number(value.expires_in)-120)*1000;return cachedToken;
  })().finally(()=>{pendingToken=null;});
  return pendingToken;
 }
 async function db(path,method='GET',value,etag){
  // This identity is restricted by database rules, not an administrator.
  const headers={'Content-Type':'application/json'};
  if(etag===true)headers['X-Firebase-ETag']='true';else if(typeof etag==='string'){headers['if-match']=etag;headers['X-Firebase-ETag']='true';}
  const r=await network(DATABASE+'/'+path+'.json?auth='+encodeURIComponent(await token()),{method,headers,body:value===undefined?undefined:JSON.stringify(value),redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(r.status===401){cachedToken=null;expires=0;}
  if(r.status===412)return {conflict:true};
  if(!r.ok)throw failure('database_http_'+r.status);
  return {value:JSON.parse(await bounded(r)),etag:r.headers.get('etag')};
 }
 const write=(path,value)=>db(path,'PUT',value);
 let currentEtag,pelletEtag,ashEtag;
 return {
  publicKey:keys.publicKey,now:()=>Date.now(),
  ashInput:async()=>{const [at,ready,kg,hours,entries]=await Promise.all(['devices/paro/telemetry/updatedAt','devices/paro/telemetry/ready','devices/paro/telemetry/state/sensors/pellets_total_kg','devices/paro/telemetry/state/sensors/pellet_hours','ashEmptyings/paro'].map(path=>db(path)));return {sample:{updatedAt:at.value,ready:ready.value,state:{sensors:{pellets_total_kg:kg.value,pellet_hours:hours.value}}},entries:entries.value};},
  ashRuntime:()=>db('ashAlertRuntime/paro','GET',undefined,true),
  ashClaim:async(value,etag)=>{if(!etag)throw Error('Missing transaction ETag');const r=await db('ashAlertRuntime/paro','PUT',value,etag);if(r.conflict)return false;ashEtag=r.etag;if(!ashEtag)throw Error('Missing ash ETag');return true;},
  ashSave:async value=>{const r=await db('ashAlertRuntime/paro','PUT',value,ashEtag);if(r.conflict)throw Error('Ash lease changed');ashEtag=r.etag;if(!ashEtag)throw Error('Missing ash ETag');},
  ashStatus:value=>write('ashAlertStatus/paro',value),
  pelletInput:async()=>{const [at,ready,counter,hopper,entries]=await Promise.all(['devices/paro/telemetry/updatedAt','devices/paro/telemetry/ready','devices/paro/telemetry/state/sensors/pellets_total_kg','devices/paro/telemetry/state/hopper','pelletStock/paro'].map(path=>db(path)));return {sample:{updatedAt:at.value,ready:ready.value,state:{sensors:{pellets_total_kg:counter.value},hopper:hopper.value}},entries:entries.value};},
  pelletRuntime:()=>db('pelletAlertRuntime/paro','GET',undefined,true),
  pelletClaim:async(value,etag)=>{if(!etag)throw Error('Missing transaction ETag');const r=await db('pelletAlertRuntime/paro','PUT',value,etag);if(r.conflict)return false;pelletEtag=r.etag;if(!pelletEtag)throw Error('Missing pellet ETag');return true;},
  pelletSave:async value=>{const r=await db('pelletAlertRuntime/paro','PUT',value,pelletEtag);if(r.conflict)throw Error('Pellet lease changed');pelletEtag=r.etag;if(!pelletEtag)throw Error('Missing pellet ETag');},
  pelletStatus:value=>write('pelletAlertStatus/paro',value),
  pelletTest:async()=>(await db('pelletAlertTests/paro')).value,
  pelletTestReceipt:value=>write('pelletAlertTestReceipt/paro',value),
  config:async()=>(await db('watchdogConfig/paro')).value,
  sample:async()=>{const [at,ready]=await Promise.all([db('devices/paro/telemetry/updatedAt'),db('devices/paro/telemetry/ready')]);return {updatedAt:at.value,ready:ready.value};},
  runtime:async()=>db('watchdogRuntime/paro','GET',undefined,true),
  claim:async(value,etag)=>{if(!etag)throw Error('Missing transaction ETag');const r=await db('watchdogRuntime/paro','PUT',value,etag);if(r.conflict)return false;currentEtag=r.etag;if(!currentEtag)throw Error('Missing monitor ETag');return true;},
  save:async value=>{const r=await db('watchdogRuntime/paro','PUT',value,currentEtag);if(r.conflict)throw Error('Monitor lease changed');currentEtag=r.etag;if(!currentEtag)throw Error('Missing monitor ETag');},
  status:value=>write('watchdogStatus/paro',value),
  test:async()=>(await db('watchdogTests/paro')).value,
  absence:async()=>(await db('absencePlans/paro')).value,
  testReceipt:value=>write('watchdogTestReceipt/paro',value),
  subscriptions:async()=>(await db('pushSubscriptions')).value,
  subscription:async(uid,id)=>(await db('pushSubscriptions/'+uid+'/'+id)).value,
  allowed:async(uid,sub)=>sub.owner===true||(await db('members/'+uid+'/enabled')).value===true,
  send:async(sub,value)=>{
   const options=await buildPushPayload({data:JSON.stringify(value),options:{ttl:300,urgency:'high'}},{endpoint:sub.endpoint,expirationTime:null,keys:sub.keys},{...keys,subject:appOrigin});
   const r=await network(sub.endpoint,{...options,redirect:'manual',signal:AbortSignal.timeout(8000)});await r.body?.cancel();return r.status;
  }
 };
}
export default {
 async scheduled(controller,env){
  let stage='configuration';
  try{const io=createIo(env);stage='execution';const result=await (controller.cron==='1-59/2 * * * *'?runAshMonitor(io):controller.cron==='*/2 * * * *'?runPelletMonitor(io):runMonitor(io));console.log(JSON.stringify({monitor:result.status,http:result.http||0}));}
  catch(error){const code=/^[a-z0-9_]{1,64}$/.test(error?.monitorCode||'')?error.monitorCode:error instanceof TypeError?(String(error.message).includes('redirect')?'redirect_type_error':String(error.message).includes('Illegal invocation')?'receiver_type_error':String(error.message).includes('fetch')?'fetch_type_error':String(error.message).includes('URL')?'url_type_error':'type_error'):'operation_failed';const frames=String(error?.stack||'').split('\n').slice(1,5).map(line=>line.match(/at ([A-Za-z_$][\w.$]*) \(([^()\s]+\.js):([0-9]+):([0-9]+)\)/)?.slice(1)).filter(Boolean);console.error(JSON.stringify({monitor:'failed',stage,code,frames}));throw Error('Connection monitor failed');}
 }
};
