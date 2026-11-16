// Existing Firebase CLI authorisation is used only locally. No administrator
// token or service account is exported to Cloudflare, GitHub or the ESP32.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const auth=require('firebase-tools/lib/auth.js');
(async()=>{
 const mode=process.argv[2]||'--status';
 if(!['--prepare','--activate','--disable','--status','--test','--test-pellets'].includes(mode))throw Error('Unknown mode');
 const root=path.resolve(__dirname,'..'),config=JSON.parse(await fs.readFile(path.join(root,'web/public/firebase-config.json'),'utf8'));
 require("./project-config.cjs").assertProjectConfig(config);
 const account=auth.getGlobalDefaultAccount();if(!account)throw Error('Firebase CLI login required');
 const token=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 async function admin(target,method='GET',value){
  const r=await fetch(config.databaseURL+'/'+target+'.json',{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});
  if(!r.ok)throw Error('Firebase request refused: '+r.status);return r.json();
 }
 if(mode==='--status'){
  const [value,status,receipt,pellets,pelletReceipt,ash]=await Promise.all(['watchdogConfig/paro','watchdogStatus/paro','watchdogTestReceipt/paro','pelletAlertStatus/paro','pelletAlertTestReceipt/paro','ashAlertStatus/paro'].map(p=>admin(p)));
  console.log(JSON.stringify({enabled:value?.ready===true,status,receipt,pellets,pelletReceipt,ash},null,2));return;
 }
 const folder=path.join(root,'.secrets');await fs.mkdir(folder,{recursive:true,mode:0o700});
 const vapid=JSON.parse(await fs.readFile(path.join(folder,'web-push.json'),'utf8'));
 const file=path.join(folder,'watchdog-firebase.json');let identity;
 try{identity=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'||mode!=='--prepare')throw e;}
 if(mode==='--prepare'){
  if(!identity){
   const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
   if(!r.ok)throw Error('Monitor identity creation refused: '+r.status);const body=await r.json();
   identity={apiKey:config.apiKey,databaseURL:config.databaseURL,refreshToken:body.refreshToken,uid:body.localId};
   await fs.writeFile(file,JSON.stringify(identity)+'\n',{mode:0o600});
  }
  if(!identity.refreshToken||!identity.uid||identity.databaseURL!==config.databaseURL)throw Error('Invalid monitor identity');
  const prior=await admin('watchdogAccess/paro');if(prior?.uid&&prior.uid!==identity.uid)throw Error('Existing monitor identity differs');
  await admin('watchdogAccess/paro','PUT',{uid:identity.uid});
  const previous=await admin('watchdogConfig/paro');
  if(previous?.publicKey&&previous.publicKey!==vapid.publicKey)throw Error('Existing push public key differs');
  await admin('watchdogConfig/paro','PUT',{ready:previous?.ready===true,publicKey:vapid.publicKey,silenceSeconds:180,intervalSeconds:60});
  const refreshed=await fetch('https://securetoken.googleapis.com/v1/token?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:identity.refreshToken})});
  if(!refreshed.ok)throw Error('Monitor identity refresh refused');const id=await refreshed.json();
  // Verify real read permissions without attempting any real stove write.
  for(const [target,allowed] of [['devices/paro/telemetry/updatedAt',true],['devices/paro/telemetry/ready',true],['devices/paro/telemetry/state/sensors/pellets_total_kg',true],['devices/paro/telemetry/state/hopper',true],['pelletStock/paro',true],['ashEmptyings/paro',true],['devices/paro/telemetry/state/sensors/pellet_hours',true],['devices/paro/telemetry',false],['devices/paro/command',false],['members',false]]){
   const r=await fetch(config.databaseURL+'/'+target+'.json?auth='+encodeURIComponent(id.id_token));
   if(r.ok!==allowed)throw Error('Unexpected monitor permission: '+target);
  }
  const secrets={PARO_WATCH_FIREBASE:JSON.stringify(identity),PARO_WATCH_VAPID:JSON.stringify(vapid)};
  await fs.writeFile(path.join(folder,'watchdog-worker-secrets.json'),JSON.stringify(secrets)+'\n',{mode:0o600});
  console.log('Monitor identity prepared; metadata reads allowed, full telemetry, commands and profiles denied. Worker secrets saved only locally. No stove controls sent.');return;
 }
 if(mode==='--test'||mode==='--test-pellets'){
  const current=await admin('watchdogConfig/paro');if(current?.ready!==true)throw Error('Monitor is not active');
  const users=await admin('pushSubscriptions');let selected;
  for(const [uid,phones] of Object.entries(users||{}))for(const [subscription,p] of Object.entries(phones||{}))if(p.enabled===true&&p.owner===true&&/^[a-f0-9]{64}$/.test(subscription)){selected={uid,subscription};break;}
  if(!selected)throw Error('No owner phone is subscribed');
  const at=Date.now();await admin(mode==='--test-pellets'?'pelletAlertTests/paro':'watchdogTests/paro','PUT',{...selected,nonce:crypto.randomUUID(),at,expiresAt:at+600000});
  console.log(mode==='--test-pellets'?'Explicit pellet-notification test queued for one existing owner phone. Actual stock and stove controls unchanged.':'Explicit cloud-monitor test queued for one existing owner phone. No telemetry changed.');return;
 }
 const current=await admin('watchdogConfig/paro');if(!identity?.uid||current?.publicKey!==vapid.publicKey)throw Error('Prepare monitor first');
 if((await admin('watchdogAccess/paro'))?.uid!==identity.uid)throw Error('Monitor identity differs');
 await admin('watchdogConfig/paro','PUT',{...current,ready:mode==='--activate'});
 console.log(mode==='--activate'?'External connection monitor enabled. Billing plan unchanged.':'External connection monitor disabled.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
