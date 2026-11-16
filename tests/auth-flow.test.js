import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeSignInIntent,choosePersistence,authErrorMessage,authStep} from '../web/auth-flow.js';
test('internal errors identify the failed sign-in boundary and script without exposing private diagnostics',async()=>{
 const privateUrl='https://apis.google.com/js/api.js?token=must-not-display';
 const cause={code:'auth/internal-error',message:'private-account@example.com',customData:{target:{tagName:'SCRIPT',src:privateUrl}}};
 await assert.rejects(authStep('start',()=>Promise.reject(cause)),error=>{
  const message=authErrorMessage(error);
  assert.match(message,/apis\.google\.com/);assert.match(message,/starting sign-in/);assert.match(message,/auth\/internal-error/);assert.match(message,/Sign-in P5/);
  assert.doesNotMatch(message,/must-not-display|private-account|\?token|api\.js/);return true;
 });
 const unknown=authErrorMessage({code:'auth/internal-error',authStep:'private-stage',failedScriptHost:'private-host.example',customData:{originalError:Error('secret')}});
 assert.match(unknown,/internal error/);assert.doesNotMatch(unknown,/private-stage|private-host|secret/);
 assert.match(authErrorMessage({code:'auth/network-request-failed',authStep:'credential'}),/connection to Firebase/);
 assert.equal(await authStep('start',async()=>42),42);
});
test('old redirect intents are consumed once without changing the app origin or losing its view',()=>{
 for(const origin of ['https://example-rika-project.web.app','https://example-rika-project.firebaseapp.com']){
  for(const path of ['/', '/?login=direct', '/?login=legacy', '/?view=status'])assert.equal(consumeSignInIntent(origin+path).requested,false);
  const input=origin+'/?signin=google&view=status';
  const consumed=consumeSignInIntent(input);assert.equal(consumed.requested,true);assert.equal(consumed.cleanUrl,origin+'/?view=status');assert.equal(consumeSignInIntent(consumed.cleanUrl).requested,false);
 }
});
test('Safari storage fallback uses session persistence, without disabling privacy protection',async()=>{
 const attempted=[];const result=await choosePersistence(async value=>{attempted.push(value);if(value==='local')throw Error('Storage blocked');},[['local','local'],['session','session'],['memory','memory']]);
 assert.equal(result,'session');assert.deepEqual(attempted,['local','session']);
 assert.match(authErrorMessage({code:'auth/web-storage-unsupported'}),/regular Safari tab/);
 assert.match(authErrorMessage({code:'auth/network-request-failed'}),/internet connection/);
 assert.doesNotMatch(authErrorMessage({code:'https://private-token.example'}),/private-token/);
});
