import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {observe,health,eventCurrent} from '../monitor/policy.js';
import {runMonitor} from '../monitor/run.js';
import {createIo} from '../monitor/worker.js';
import {homeDate} from '../web/absence.js';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const webpush=require('web-push'),ece=createRequire(require.resolve('web-push'))('http_ece');
const time=2000000000000,sample=(at=time,ready=true)=>({updatedAt:at,ready});
test('external monitoring waits three minutes, distinguishes USB and internet loss and sends one recovery',()=>{
 let state=observe(null,sample(),time);
 assert.equal(state.pending,false);assert.equal(state.phase,'online');
 state=observe(state,sample(time+60000,false),time+60000);assert.equal(state.phase,'pending');
 state=observe(state,sample(time+180000,false),time+180000);assert.equal(state.pending,false);
 state=observe(state,sample(time+240000,false),time+240000);assert.equal(state.phase,'offline');assert.equal(state.pending,true);assert.equal(state.sequence,1);
 state=observe({...state,pending:false},sample(time+240000,false),time+300000);assert.equal(state.sequence,1);assert.equal(state.pending,false);assert.equal(state.reason,'module');
 state=observe(state,sample(time+310000),time+310000);assert.equal(state.eventKind,'recovered');assert.equal(state.sequence,2);
 state=observe({...state,pending:false},sample(time+320000),time+320000);assert.equal(state.sequence,2);assert.equal(state.pending,false);
 const absent=observe(null,sample(time-180000),time);assert.equal(absent.phase,'offline');
 assert.equal(health({updatedAt:time+3000,ready:true},time),'unknown');
 assert.equal(observe(state,null,time),null);
 assert.equal(eventCurrent(absent,sample(),time),false);
 assert.equal(observe(null,sample(time-60000),time).pending,false);
});
function fake(){
 let clock=time,state=null,etag='a',sent=[],reads=0;
 const sub={deviceId:'paro',owner:true,enabled:true,endpoint:'https://web.push.apple.com/'+'x'.repeat(40),keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}};
 const id='a'.repeat(64);
 const io={publicKey:'key',now:()=>clock,config:async()=>({ready:true,publicKey:'key'}),sample:async()=>sample(clock-240000),runtime:async()=>({value:state,etag}),claim:async value=>{state=structuredClone(value);return true;},save:async value=>{state=structuredClone(value);},status:async()=>{},test:async()=>null,testReceipt:async()=>{},subscriptions:async()=>({owner:{[id]:sub}}),subscription:async()=>{reads++;return sub;},allowed:async()=>true,send:async(value,payload)=>{sent.push(payload);return 201;}};
 return {io,id,sub,sent,get state(){return state;},get reads(){return reads;},advance:ms=>clock+=ms};
}
test('the cloud sender rechecks permission and freshness, suppresses repeats and fails closed',async()=>{
 const f=fake();await runMonitor(f.io);assert.equal(f.sent.length,1);assert.equal(f.reads,1);
 f.advance(60000);await runMonitor(f.io);assert.equal(f.sent.length,1);
 const revoked=fake();revoked.io.allowed=async()=>false;await runMonitor(revoked.io);assert.equal(revoked.sent.length,0);
 const disabled=fake();disabled.io.config=async()=>({ready:false,publicKey:'key'});await runMonitor(disabled.io);assert.equal(disabled.reads,0);
 const restored=fake();let reads=0;restored.io.sample=async()=>++reads===1?sample(time-240000):sample(time);await runMonitor(restored.io);assert.equal(restored.sent.length,0);
 const raced=fake();raced.io.claim=async()=>false;assert.equal((await runMonitor(raced.io)).status,'busy');assert.equal(raced.sent.length,0);
});
test('transient failures retry while the outage persists; test delivery cannot write stove data',async()=>{
 const f=fake();let attempt=0;f.io.send=async()=>++attempt===1?503:201;
 await runMonitor(f.io);assert.equal(f.state.pending,true);f.advance(360000);await runMonitor(f.io);assert.equal(attempt,2);assert.equal(f.state.pending,false);
 const t=fake(),nonce=crypto.randomUUID();let receipt;
 t.io.sample=async()=>sample();
 t.io.test=async()=>({nonce,uid:'owner',subscription:t.id,at:time,expiresAt:time+600000});
 t.io.testReceipt=async value=>{receipt=value;};await runMonitor(t.io);await runMonitor(t.io);
 assert.equal(t.sent.length,1);assert.equal(receipt.status,'accepted');assert.equal(t.sent[0].title,"PARO · External monitor test");
});
test('Cloudflare encryption interoperates with an independent RFC8291 implementation and carries the existing phone payload',async()=>{
 const receiver=createECDH('prime256v1');receiver.generateKeys();const auth=randomBytes(16);
 const sub={endpoint:'https://web.push.apple.com/'+'x'.repeat(40),expirationTime:null,keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
 const value={title:"PARO · Connection lost",body:'Preveri povezavo.',tag:'paro-connection',data:{view:'control'}};
 const out=await buildPushPayload({data:JSON.stringify(value),options:{ttl:300}},sub,{...webpush.generateVAPIDKeys(),subject:'https://example-rika-project.web.app'});
 const plain=ece.decrypt(Buffer.from(out.body),{version:'aes128gcm',privateKey:receiver,authSecret:auth});
 assert.deepEqual(JSON.parse(plain.toString()),value);assert.equal(out.headers['content-encoding'],'aes128gcm');assert.match(out.headers.authorization,/^vapid /);
});
test('a due return reminder sends once per plan and stops immediately after confirmation or a change',async()=>{
 const f=fake();f.io.sample=async()=>sample();
 let plan={id:crypto.randomUUID(),active:true,returnDate:homeDate(time+86400000),confirmation:'pending',remindAt:time-1000};
 f.io.absence=async()=>plan;
 await runMonitor(f.io);await runMonitor(f.io);assert.equal(f.sent.length,1);assert.equal(f.sent[0].tag,'paro-return-date');
 plan={...plan,confirmation:'confirmed'};await runMonitor(f.io);assert.equal(f.sent.length,1);
 plan={...plan,id:crypto.randomUUID(),confirmation:'pending'};await runMonitor(f.io);assert.equal(f.sent.length,2);
 plan={...plan,returnDate:'',confirmation:'unknown'};await runMonitor(f.io);assert.equal(f.sent.length,2);
});

test('worker transport keeps the runtime fetch receiver, rejects redirects and requests only the configured metadata',async()=>{
 const prior=globalThis.fetch,urls=[];
 globalThis.fetch=async function(url,options){assert.equal(this,globalThis);assert.equal(options.redirect,'manual');urls.push(new URL(url));return Response.json(url.startsWith('https://securetoken.googleapis.com')?{id_token:'test-token',expires_in:3600}:{ready:false});};
 try{const io=createIo({PARO_DATABASE_URL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',PARO_APP_ORIGIN:'https://example-rika-project.firebaseapp.com',PARO_WATCH_FIREBASE:JSON.stringify({apiKey:'AIza-test',databaseURL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',refreshToken:'test-refresh'}),PARO_WATCH_VAPID:JSON.stringify({publicKey:'test-public',privateKey:'test-private'})});assert.deepEqual(await io.config(),{ready:false});assert.equal(urls.length,2);assert.equal(urls[1].pathname,'/watchdogConfig/paro.json');globalThis.fetch=async function(url,options){assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://example.invalid'}});};await assert.rejects(()=>io.config(),e=>e.monitorCode==='database_http_302');}finally{globalThis.fetch=prior;}
});

test('multiple phones are delivered across ticks without repeating the first phone',async()=>{
 const f=fake(),second='b'.repeat(64);f.io.subscriptions=async()=>({owner:{[f.id]:f.sub,[second]:f.sub}});
 await runMonitor(f.io);assert.equal(f.sent.length,1);assert.equal(f.state.pending,true);
 f.advance(60000);await runMonitor(f.io);assert.equal(f.sent.length,2);assert.equal(f.state.pending,false);
 f.advance(60000);await runMonitor(f.io);assert.equal(f.sent.length,2);
});

test('conditional runtime writes use the returned ETag instead of a racy follow-up GET',async()=>{
 const calls=[],env={PARO_DATABASE_URL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',PARO_APP_ORIGIN:'https://example-rika-project.firebaseapp.com',PARO_WATCH_FIREBASE:JSON.stringify({apiKey:'AIza-test',databaseURL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',refreshToken:'test-refresh'}),PARO_WATCH_VAPID:JSON.stringify({publicKey:'test-public',privateKey:'test-private'})};
 const io=createIo(env,async(url,init)=>{calls.push({path:new URL(url).pathname,...init});if(url.includes('securetoken.googleapis.com'))return Response.json({id_token:'test-token',expires_in:3600});return Response.json({}, {headers:{ETag:'"etag-'+calls.length+'"'}});});
 assert.equal(await io.pelletClaim({version:1},'"initial"'),true);await io.pelletSave({version:1});
 const writes=calls.filter(c=>c.path==='/pelletAlertRuntime/paro.json');assert.equal(writes.length,2);assert.ok(writes.every(c=>c.method==='PUT'&&c.headers['X-Firebase-ETag']==='true'));assert.equal(writes[0].headers['if-match'],'"initial"');assert.match(writes[1].headers['if-match'],/^"etag-/);
});

test('parallel scheduled invocations never share an in-flight authentication request',async()=>{
 const {createIo:createIsolated}=await import('../monitor/worker.js?isolated-promise-test');
 const env={PARO_DATABASE_URL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',PARO_APP_ORIGIN:'https://example-rika-project.firebaseapp.com',PARO_WATCH_FIREBASE:JSON.stringify({apiKey:'AIza-test',databaseURL:'https://example-rika-project-default-rtdb.europe-west1.firebasedatabase.app',refreshToken:'test-refresh'}),PARO_WATCH_VAPID:JSON.stringify({publicKey:'test-public',privateKey:'test-private'})},releases=[];
 const transport=async url=>url.includes('securetoken.googleapis.com')?new Promise(resolve=>releases.push(()=>resolve(Response.json({id_token:'test-token',expires_in:3600})))):Response.json({ready:true});
 const a=createIsolated(env,transport).config(),b=createIsolated(env,transport).config(),requests=releases.length;
 releases.forEach(release=>release());await Promise.all([a,b]);assert.equal(requests,2);
});
