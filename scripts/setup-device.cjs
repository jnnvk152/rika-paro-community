// Uses the user's existing Firebase CLI session. Never exports admin credentials.
const fs=require('node:fs/promises');
const path=require('node:path');
const auth=require('firebase-tools/lib/auth.js');
async function json(url,options={}){
 const response=await fetch(url,options);const body=await response.json();
 if(!response.ok)throw Error(`Firebase request failed (${response.status}): ${body.error?.message||'request refused'}`);
 return body;
}
(async()=>{
 const root=path.resolve(__dirname,'..');
 const config=JSON.parse(await fs.readFile(path.join(root,'web/public/firebase-config.json'),'utf8'));
 require("./project-config.cjs").assertProjectConfig(config);
 const account=auth.getGlobalDefaultAccount();if(!account)throw Error('Run firebase login first.');
 const access=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes);
 const secrets=path.join(root,'.secrets');await fs.mkdir(secrets,{recursive:true,mode:0o700});
 const file=path.join(secrets,'device-credentials.json');let device;
 try{device=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!device){
  const created=await json(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
  device={apiKey:config.apiKey,databaseURL:config.databaseURL,refreshToken:created.refreshToken,uid:created.localId};
  await fs.writeFile(file,JSON.stringify(device,null,2)+'\n',{mode:0o600});
 }
 if(device.databaseURL!==config.databaseURL||!device.refreshToken||!device.uid)throw Error('Invalid device credentials.');
 await json(`${config.databaseURL}/deviceAccess/paro.json`,{method:'PUT',headers:{Authorization:`Bearer ${access.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({uid:device.uid})});
 // Verify this device identity can refresh and publish but cannot send controls.
 const token=await json(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:device.refreshToken})});
 const sample={updatedAt:{'.sv':'timestamp'},session:'0'.repeat(32),ready:false,state:{version_ack:false,device:{version:"Waiting for installation"},stove:{state:'unknown',has_error:false},sensors:{room_sensor_connected:false},controls:{on:false,mode:'manual',power_percent:70,target_temperature:21}}};
 await json(`${config.databaseURL}/devices/paro/telemetry.json?auth=${token.id_token}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(sample)});
 const denied=await fetch(`${config.databaseURL}/devices/paro/command.json?auth=${token.id_token}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'self-control-test',on:true})});
 if(denied.ok)throw Error('Device unexpectedly has command write access.');
 console.log('Device identity registered and permissions verified. Credentials saved locally in .secrets/. No stove controls were sent.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
