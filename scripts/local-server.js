import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {networkInterfaces} from 'node:os';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertAllowed,validatePatch} from '../web/domain.js';
import {nativePatch} from '../web/schedule.js';

export function privateIPv4(value) {
 const parts=value.split('.');
 if(parts.length!==4||parts.some(v=>!/^\d{1,3}$/.test(v)||Number(v)>255))return false;
 const [a,b]=parts.map(Number);
 return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
export async function resolveModule(input,resolve=lookup) {
 const value=String(input||'open-firenet.local').trim();
 const url=new URL(value.includes('://')?value:`http://${value}`);
 if(url.protocol!=='http:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error("Enter only the module’s local address, without a path or port.");
 const host=url.hostname;
 if(!privateIPv4(host)&&(!/^[a-z0-9-]+\.local$/i.test(host)))throw Error("Use a private IPv4 address or the module’s .local name.");
 const addresses=privateIPv4(host)?[{address:host}]:await resolve(host,{family:4,all:true});
 if(!addresses.length||addresses.some(v=>!privateIPv4(v.address)))throw Error("The module must be on your private home network.");
 return {address:host,ip:addresses[0].address};
}
function sameToken(received,expected) {
 return typeof received==='string'&&received.length===expected.length&&timingSafeEqual(Buffer.from(received),Buffer.from(expected));
}
async function body(req) {
 if(!String(req.headers['content-type']).startsWith('application/json'))throw Error("A JSON request is required.");
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw Error("The request is too large.");}
 try{return JSON.parse(raw);}catch{throw Error("Invalid JSON.");}
}
export function createLocalServer({root=fileURLToPath(new URL('../dist/',import.meta.url)),port=8767,lan=false,resolve=resolveModule,upstream}={}) {
 const token=randomBytes(32).toString('hex');let module=null,address='open-firenet.local',writing=false;
 const localIPs=Object.values(networkInterfaces()).flat().filter(v=>v?.family==='IPv4'&&privateIPv4(v.address)).map(v=>v.address);
 const hosts=new Set(['127.0.0.1','localhost',...(lan?localIPs:[])].map(host=>`${host}:${port}`));
 async function call(endpoint,patch) {
  if(!module)module=await resolve(address);
  if(upstream)return upstream(module,endpoint,patch);
  const raw=await new Promise((resolve,reject)=>{
   const request=http.request({hostname:module.ip,port:80,path:endpoint,method:patch?'POST':'GET',headers:{Host:module.address,...(patch?{'Content-Type':'application/json'}:{})},timeout:6000},response=>{
    let value='';response.on('data',chunk=>{value+=chunk;if(Buffer.byteLength(value)>131072)response.destroy(Error("The module response is too large."));});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,value}));
   });request.on('timeout',()=>request.destroy(Error("The module did not respond.")));request.on('error',reject);request.end(patch?JSON.stringify(patch):undefined);
  });
  if(raw.status<200||raw.status>=300)throw Error(`The module refused the request (${raw.status}).`);
  try{return JSON.parse(raw.value);}catch{throw Error("The module did not return the expected data.");}
 }
 const server=http.createServer(async(req,res)=>{
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(!hosts.has(req.headers.host)||req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:"Access from another origin is not allowed."});
  const url=new URL(req.url,`http://${req.headers.host}`);
  try{
   if(url.pathname==='/local/info'&&req.method==='GET')return json(200,{token,address});
   if(url.pathname.startsWith('/local/')||url.pathname.startsWith('/api/')){
    if(!sameToken(req.headers['x-paro-token'],token))return json(403,{error:"Reopen the app."});
    if(url.pathname==='/local/connection'&&req.method==='POST'){
     if(writing)return json(409,{error:"Wait for the previous command’s response."});
     const next=await body(req);if(Object.keys(next).some(k=>k!=='address'))throw Error("Invalid connection setting.");
     module=await resolve(next.address);address=module.address;return json(200,{address});
    }
    if(url.pathname==='/api/state'&&req.method==='GET')return json(200,await call('/api/state'));
    if(url.pathname==='/api/schedule'&&req.method==='GET')return json(200,await call('/api/schedule'));
    if(url.pathname==='/api/controls'&&req.method==='POST'){
     if(writing)return json(409,{error:"Wait for the previous command’s response."});
     writing=true;
     try{
      const patch=validatePatch(await body(req));
      const state=await call('/api/state');
      if(patch.schedule){const schedule=await call('/api/schedule');if(schedule.synced!==true)throw Error("Waiting for the stove schedule.");state.schedule=schedule.slots;}
      if(state?.version_ack!==true||!state?.controls||!state?.sensors||!state?.stove)throw Error("The USB connection to the stove is not ready yet.");
      assertAllowed(patch,state);
      const response=await call(patch.schedule?'/api/schedule':'/api/controls',nativePatch(patch));return json(200,response);
     }finally{writing=false;}
    }
    return json(404,{error:"Unknown address."});
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:"Method not allowed."});
   const name=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
   if(name.split('/').some(p=>p.startsWith('.')||p.includes('\\')))return json(404,{error:"File not found."});
   const file=path.resolve(root,name);
   if(!file.startsWith(path.resolve(root)+path.sep))return json(404,{error:"File not found."});
   const data=await readFile(file);
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){json(400,{error:e.code==='ENOENT'?"Build the app first with pnpm build.":e.message});}
 });
 return {server,hosts,localIPs};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const lan=process.argv.includes('--lan'),port=8767;
 const {server,localIPs}=createLocalServer({port,lan});
 server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{
  console.log(`PARO: http://127.0.0.1:${port}`);
  if(lan)for(const ip of localIPs)console.log(`Phone on your home Wi-Fi: http://${ip}:${port}`);
 });
}
