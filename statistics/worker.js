import {runStatistics} from './run.js';
import {dayKey,RETENTION_DAYS} from '../web/statistics.js';
let cachedToken='',expires=0;
export function createStatisticsIo(env,network=(url,init)=>globalThis.fetch(url,init)){
 const DATABASE=env.PARO_DATABASE_URL;
 if(!/^https:\/\/[-a-z0-9]+\.(?:[-a-z0-9]+\.firebasedatabase\.app|firebaseio\.com)$/.test(DATABASE||''))throw Error('Invalid statistics database URL');
 let config;try{config=JSON.parse(env.PARO_STATISTICS_FIREBASE);}catch{throw Error('Invalid statistics binding');}
 if(config.databaseURL!==DATABASE||!config.apiKey?.startsWith('AIza')||!config.refreshToken)throw Error('Invalid statistics configuration');
 let pending;
 async function json(r){
  if(!r.body)throw Error('Empty statistics response');
  const reader=r.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Statistics response too large');}text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }
 async function token(){
  if(cachedToken&&Date.now()<expires)return cachedToken;
  if(!pending)pending=(async()=>{const r=await network('https://securetoken.googleapis.com/v1/token?key='+config.apiKey,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:config.refreshToken}),headers:{'Content-Type':'application/x-www-form-urlencoded'},redirect:'manual',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Statistics authentication failed');const value=await json(r);if(!value.id_token)throw Error('Missing statistics token');cachedToken=value.id_token;expires=Date.now()+Math.max(60,Number(value.expires_in)-120)*1000;return cachedToken;})().finally(()=>{pending=null;});
  return pending;
 }
 async function db(path,method='GET',value,etag,query={}){
  const params=new URLSearchParams({auth:await token(),...query}),headers={'Content-Type':'application/json'};
  if(etag===true)headers['X-Firebase-ETag']='true';else if(typeof etag==='string'){headers['if-match']=etag;headers['X-Firebase-ETag']='true';}
  const r=await network(DATABASE+'/'+path+'.json?'+params,{method,headers,body:value===undefined?undefined:JSON.stringify(value),redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(r.status===401){cachedToken='';expires=0;}
  if(r.status===412)return {conflict:true};
  if(!r.ok)throw Error('Statistics database refused '+r.status);
  return {value:await json(r),etag:r.headers.get('etag')};
 }
 async function publish(path,value){
  const previous=await db(path,'GET',undefined,true);
  if(previous.value?.observedAt>=value.observedAt)return true;
  if(!previous.etag)throw Error('Missing publication ETag');
  return !(await db(path,'PUT',{...value,updatedAt:{'.sv':'timestamp'}},previous.etag)).conflict;
 }
 return {
  now:()=>Date.now(),
  runtime:()=>db('statisticsRuntime/paro','GET',undefined,true),
  claim:async(value,etag)=>{if(!etag)throw Error('Missing cursor ETag');return !(await db('statisticsRuntime/paro','PUT',value,etag)).conflict;},
  sample:async()=>{
   const paths=['updatedAt','ready','state/version_ack','state/sensors/pellets_total_kg','state/sensors/pellet_hours','state/stove/state','state/stove/is_burning','state/stove/has_error'];
   const [at,ready,ack,kg,hours,phase,burning,error]=await Promise.all(paths.map(async p=>(await db('devices/paro/telemetry/'+p)).value));
   return {updatedAt:at,ready,state:{version_ack:ack,sensors:{pellets_total_kg:kg,pellet_hours:hours},stove:{state:phase,is_burning:burning,has_error:error}}};
  },
  publishDay:value=>publish('statistics/paro/days/'+value.date,value),
  publishStatus:value=>publish('statistics/paro/status',value),
  prune:async now=>{
   const cutoff=now-RETENTION_DAYS*86400000;
   const result=await db('statistics/paro/days','GET',undefined,undefined,{orderBy:'"$key"',endAt:JSON.stringify(dayKey(cutoff-86400000)),limitToFirst:'8'});
   for(const [date,row] of Object.entries(result.value||{}))if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&row.endAt<cutoff)await db('statistics/paro/days/'+date,'DELETE');
   return Object.keys(result.value||{}).length<8;
  }
 };
}
export default {async scheduled(controller,env){try{const r=await runStatistics(createStatisticsIo(env));console.log(JSON.stringify({statistics:r.status,date:r.date||null}));}catch{console.error('Statistics collection failed');throw Error('Statistics collection failed');}}};
