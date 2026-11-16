import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {AppUpdates,releaseUrl,watchAppUpdates} from '../web/app-updates.js';

const current='a'.repeat(24),next='b'.repeat(24);
const release=version=>Response.json({version,builtAt:'2026-11-12T08:00:00.000Z'});
function setup(options={}){
 let now=20000,visible=true,reason='',calls=0,workers=0;const reloads=[],values=new Map();
 const updates=new AppUpdates({version:current,now:()=>now,visible:()=>visible,block:()=>reason,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},reload:v=>reloads.push(v),workerUpdate:async()=>{workers++;},fetch:async()=>{calls++;return release(next);},...options});
 return {updates,reloads,values,setTime:n=>now=n,setVisible:v=>visible=v,setReason:v=>reason=v,get calls(){return calls;},get workers(){return workers;}};
}

test('a resumed old document detects the public release and reloads once, without a Firebase request',async()=>{
 const f=setup();await f.updates.check({automatic:true});
 assert.deepEqual(f.reloads,[next]);assert.equal(f.workers,1);
 f.setTime(40000);await f.updates.check({automatic:true});assert.deepEqual(f.reloads,[next]);
 assert.match(f.updates.message,/Update app/);
});
test('a current app and overlapping resume events do not reload or duplicate checks',async()=>{
 let finish,calls=0;const f=setup({fetch:()=>{calls++;return new Promise(r=>finish=r);}});
 const pending=f.updates.check({automatic:true});await f.updates.check({automatic:true});
 assert.equal(calls,1);finish(release(current));await pending;
 assert.equal(f.updates.available,null);assert.deepEqual(f.reloads,[]);
 await f.updates.check();assert.equal(calls,1);assert.match(f.updates.message,/latest app version/);
});
test('pending commands and unsaved settings defer both automatic and explicit reload until safe',async()=>{
 for(const reason of ["Wait for the current operation to finish.","First save or discard your changes."]){
  const f=setup();f.setReason(reason);await f.updates.check({automatic:true});
  assert.equal(f.updates.available,next);assert.deepEqual(f.reloads,[]);assert.equal(f.updates.apply(),false);assert.ok(f.updates.message.includes(reason));
  f.setReason('');assert.equal(f.updates.apply(),true);assert.deepEqual(f.reloads,[next]);
 }
});
test('offline, invalid metadata, an HTML fallback and rejected redirects never trigger a reload',async()=>{
 const responses=[()=>{throw Error('offline');},()=>new Response('fallback'),()=>new Response('bad',{headers:{'content-type':'application/json'}}),()=>release('https://outside.invalid'),()=>Response.json({version:next,builtAt:'invalid'}),()=>new Response('x'.repeat(1025),{headers:{'content-type':'application/json'}}),()=>new Response('',{status:503})];
 for(const network of responses){const f=setup({fetch:network});await f.updates.check({automatic:true});assert.deepEqual(f.reloads,[]);assert.equal(f.updates.available,null);assert.match(f.updates.message,/cannot be checked/);}
 const f=setup();await f.updates.check();f.setTime(40000);f.updates.network=()=>{throw Error();};await f.updates.check({automatic:true});assert.deepEqual(f.reloads,[]);
});
test('version checks bypass caches, omit credentials and refuse redirects; background documents wait',async()=>{
 let request;const f=setup({fetch:async(url,init)=>{request={url,init};return release(next);}});
 f.setVisible(false);await f.updates.check({automatic:true});assert.equal(request,undefined);
 f.setVisible(true);await f.updates.check();assert.match(request.url,/^\/app-version\.json\?check=\d+$/);
 assert.equal(request.init.cache,'no-store');assert.equal(request.init.credentials,'omit');assert.equal(request.init.redirect,'error');assert.ok(request.init.signal);
 f.setVisible(false);assert.equal(f.updates.apply(),false);assert.deepEqual(f.reloads,[]);
});
test('the release URL preserves the same origin, login intent, demo flag, hash and active view',()=>{
 const url=new URL(releaseUrl('https://example-rika-project.firebaseapp.com/?login=direct&demo=1#details',next,'statistics'));
 assert.equal(url.origin,'https://example-rika-project.firebaseapp.com');assert.equal(url.searchParams.get('login'),'direct');assert.equal(url.searchParams.get('demo'),'1');assert.equal(url.hash,'#details');assert.equal(url.searchParams.get('view'),'statistics');assert.equal(url.searchParams.get('_paro_release'),next);
 assert.throws(()=>releaseUrl(url.href,'https://outside.invalid','control'));
});
test('a requested release prevents automatic reload loops even when Safari storage is unavailable',async()=>{
 const f=setup({requestedVersion:next,storage:{getItem(){throw Error();},setItem(){throw Error();}}});
 await f.updates.check({automatic:true});assert.deepEqual(f.reloads,[]);assert.match(f.updates.message,/Update app/);
 assert.equal(f.updates.apply(),true);assert.deepEqual(f.reloads,[next]);
 const older=setup({requestedVersion:next,storage:{getItem:()=>current}});await older.updates.check({automatic:true});assert.deepEqual(older.reloads,[]);
});
test('page restoration, foregrounding and network recovery check again; hidden pages and cleanup do not',()=>{
 const page=new EventTarget(),doc=new EventTarget(),checks=[];doc.hidden=false;let tick,cancelled=false;
 const stop=watchAppUpdates({check:options=>checks.push(options)},{page,doc,schedule:fn=>{tick=fn;return 7;},cancel:id=>{assert.equal(id,7);cancelled=true;}});
 assert.equal(checks.length,1);page.dispatchEvent(new Event('pageshow'));assert.equal(checks.length,2);
 doc.hidden=true;page.dispatchEvent(new Event('pageshow'));tick();assert.equal(checks.length,2);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));page.dispatchEvent(new Event('online'));tick();assert.equal(checks.length,5);assert.equal(checks.at(-1),undefined);
 stop();page.dispatchEvent(new Event('pageshow'));assert.equal(checks.length,5);assert.equal(cancelled,true);
});
test('push worker fetches app navigations without caching and leaves Google/Firebase auth and subscriptions alone',async()=>{
 const listeners={},requests=[];let skipped=0,claimed=0,notifications=0;
 const self={location:{origin:'https://example-rika-project.firebaseapp.com'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}},registration:{showNotification:async()=>{notifications++;}}};
 runInNewContext(await readFile(new URL('../web/public/push-worker.js',import.meta.url),'utf8'),{self,URL,Request,Date,Number,fetch:async r=>{requests.push(r);return new Response('fresh');}});
 const promises=[];listeners.install({waitUntil:p=>promises.push(p)});listeners.activate({waitUntil:p=>promises.push(p)});await Promise.all(promises);assert.equal(skipped,1);assert.equal(claimed,1);
 let response;const appRequest=new Request('https://example-rika-project.firebaseapp.com/?login=direct');
 Object.defineProperty(appRequest,'mode',{value:'navigate'});
 listeners.fetch({request:appRequest,respondWith:p=>response=p});assert.equal(await (await response).text(),'fresh');assert.equal(requests[0].cache,'no-store');
 for(const path of ['https://example-rika-project.firebaseapp.com/__/auth/handler','https://accounts.google.com/','https://example-rika-project.firebaseapp.com/app-version.json']){
  const request=new Request(path);Object.defineProperty(request,'mode',{value:'navigate'});let intercepted=false;listeners.fetch({request,respondWith:()=>intercepted=true});assert.equal(intercepted,false);
 }
 listeners.push({data:{json:()=>({title:'PARO',body:'existing push'})},waitUntil:p=>promises.push(p)});await Promise.all(promises);assert.equal(notifications,1);
});
