import {test} from 'node:test';
import assert from 'node:assert/strict';
import {credentialReceiver,mountGoogleSignIn,loadGoogleIdentity} from '../web/google-signin.js';
const config={projectId:'example-rika-project',googleClientId:'000000000000-example.apps.googleusercontent.com'};
test('direct Google sign-in exchanges credentials once, recovers from Firebase failure and rejects empty tokens',async()=>{
 let finish;const received=[],failures=[],states=[];
 const receive=credentialReceiver(token=>{received.push(token);return new Promise(resolve=>{finish=resolve;});},{busy:value=>states.push(value),error:value=>failures.push(value.code)});
 const first=receive({credential:'test-only-token'});await receive({credential:'duplicate-token'});
 assert.deepEqual(received,['test-only-token']);finish();await first;assert.deepEqual(states,[true,false]);
 await receive({});await receive({credential:'x'.repeat(20001)});assert.deepEqual(failures,['app/google-credential-missing','app/google-credential-missing']);
 const firebaseFailure=credentialReceiver(async()=>{throw {code:'auth/invalid-credential'};},{error:error=>failures.push(error.code),busy:value=>states.push(value)});
 await firebaseFailure({credential:'invalid-test-token'});assert.equal(failures.at(-1),'auth/invalid-credential');assert.equal(states.at(-1),false);
});
test('direct login uses the existing Google client and explicit consent button without One Tap or a Firebase auth iframe',async()=>{
 const calls=[],element={clientWidth:280};let handler;
 const identity={initialize(options){calls.push(options);handler=options.callback;},renderButton(target,options){assert.equal(target,element);calls.push(options);}};
 const received=[];await mountGoogleSignIn(element,config,async token=>received.push(token),{},async()=>identity);
 assert.equal(calls[0].client_id,config.googleClientId);assert.equal(calls[0].auto_select,false);assert.equal(calls[0].ux_mode,'popup');assert.equal(calls[1].width,280);
 assert.equal(calls[1].locale,'en');
 await handler({credential:'test-only-token'});assert.deepEqual(received,['test-only-token']);
 await assert.rejects(mountGoogleSignIn(element,{...config,googleClientId:'another-client'},()=>{}, {},()=>{throw Error('Must not load Google');}),{code:'app/google-client-missing'});
});
test('the English edition accepts another installation’s configured web client',async()=>{
 const other={projectId:'another-rika-project',googleClientId:'123456789-anotherclient.apps.googleusercontent.com'};let used;
 await mountGoogleSignIn({clientWidth:300},other,()=>{}, {},async()=>({initialize(value){used=value.client_id;},renderButton(){}}));assert.equal(used,other.googleClientId);
});
test('Google Identity loader uses accounts.google.com and reports a blocked script without leaking URLs',async()=>{
 let inserted;
 const document={head:{appendChild(script){inserted=script;queueMicrotask(()=>script.onerror());}},createElement(){return {remove(){}};}};
 await assert.rejects(loadGoogleIdentity({document,getGoogle:()=>null,timeoutMs:100}),{code:'app/google-script-unavailable'});
 assert.equal(inserted.src,"https://accounts.google.com/gsi/client?hl=en");assert.doesNotMatch(inserted.src,/apis\.google\.com|token|credential/);
 const identity={};assert.equal(await loadGoogleIdentity({document,getGoogle:()=>({accounts:{id:identity}})}),identity);
});
