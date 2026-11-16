// Uses the existing official Firebase CLI session; never prints OAuth or push keys.
const fs=require('node:fs/promises');
const path=require('node:path');
const auth=require('firebase-tools/lib/auth.js');
const webpush=require('../functions/node_modules/web-push');
(async()=>{
 const mode=process.argv[2]||'--status';if(!['--status','--prepare','--activate','--disable','--prepare-device','--activate-device'].includes(mode))throw Error('Use --status, --prepare-device, --activate-device, --prepare, --activate or --disable.');
 const root=path.resolve(__dirname,'..'),config=JSON.parse(await fs.readFile(path.join(root,'web/public/firebase-config.json'),'utf8'));
 require("./project-config.cjs").assertProjectConfig(config);
 const account=auth.getGlobalDefaultAccount();if(!account)throw Error('Run firebase login first.');
 const access=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 async function request(url,options={}){const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${access.access_token}`,'Content-Type':'application/json',...options.headers}});if(!response.ok)throw Error(`Service request failed (${response.status}).`);return response.json();}
 if(mode==='--status'){
  const billing=await request(`https://cloudbilling.googleapis.com/v1/projects/${config.projectId}/billingInfo`);
  const current=await request(`${config.databaseURL}/notificationConfig/paro.json`);
  console.log(JSON.stringify({billingEnabled:billing.billingEnabled===true,notificationsReady:current?.ready===true,transport:current?.mode||'off'}));return;
 }
 const folder=path.join(root,'.secrets');await fs.mkdir(folder,{recursive:true,mode:0o700});
 const file=path.join(folder,'web-push.json');let key;
 try{key=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'||!['--prepare','--prepare-device'].includes(mode))throw e;key=webpush.generateVAPIDKeys();await fs.writeFile(file,JSON.stringify(key)+'\n',{mode:0o600});}
 if(!/^[A-Za-z0-9_-]{87}$/.test(key.publicKey)||!/^[A-Za-z0-9_-]{43}$/.test(key.privateKey))throw Error('Invalid push keys.');
 const current=await request(`${config.databaseURL}/notificationConfig/paro.json`);
 if(current?.publicKey&&current.publicKey!==key.publicKey)throw Error('Existing public key differs; not changing it.');
 if(mode==='--activate')for(const name of ['stoveAlerts','testPhoneNotification']){
  const deployed=await request(`https://cloudfunctions.googleapis.com/v2/projects/${config.projectId}/locations/europe-west1/functions/${name}`);
  if(deployed.state!=='ACTIVE'||!deployed.serviceConfig?.secretEnvironmentVariables?.some(v=>v.key==='PARO_WEB_PUSH'))throw Error('Notification functions must be deployed with the push secret first.');
 }
 if(mode==='--activate-device'){
  const telemetry=await request(`${config.databaseURL}/devices/paro/telemetry.json`);
  if(!telemetry?.state?.device?.capabilities?.web_push||telemetry.state.push?.enabled!==true||telemetry.state.push?.publicKey!==key.publicKey||Date.now()-telemetry.updatedAt>30000)throw Error("First install and configure the module for direct notifications.");
 }
 const deviceMode=mode.endsWith('-device');
 const ready=mode==='--activate'||mode==='--activate-device'||mode==='--prepare'&&current?.ready===true&&current?.mode!=='device'||mode==='--prepare-device'&&current?.ready===true&&current?.mode==='device';
 await request(`${config.databaseURL}/notificationConfig/paro.json`,{method:'PUT',body:JSON.stringify({ready,mode:deviceMode?'device':mode==='--disable'?(current?.mode||'cloud'):'cloud',publicKey:key.publicKey})});
 console.log(['--prepare','--prepare-device'].includes(mode)?'Push keys prepared locally. Existing delivery state preserved. No billing or services enabled.':ready?'Notification delivery enabled.':'Notification delivery disabled in the app.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
