// Creates only the statistics collector identity in the user's configured project.
// No administrator token leaves the local Firebase CLI session.
const fs=require('node:fs/promises'),path=require('node:path');
const auth=require('firebase-tools/lib/auth.js');
const {loadProjectConfig}=require('./project-config.cjs');
(async()=>{
 const config=await loadProjectConfig(),account=auth.getGlobalDefaultAccount();if(!account)throw Error('Run firebase login first.');
 const access=await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes),folder=path.resolve(__dirname,'../.secrets');await fs.mkdir(folder,{recursive:true,mode:0o700});
 const file=path.join(folder,'statistics-firebase.json');let identity;
 try{identity=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!identity){const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});if(!r.ok)throw Error('Collector identity creation refused.');const value=await r.json();identity={apiKey:config.apiKey,databaseURL:config.databaseURL,refreshToken:value.refreshToken,uid:value.localId};if(!identity.refreshToken||!identity.uid)throw Error('Incomplete collector identity.');await fs.writeFile(file,JSON.stringify(identity)+'\n',{mode:0o600});}
 if(identity.databaseURL!==config.databaseURL||!identity.refreshToken||!identity.uid)throw Error('Collector identity belongs to another project.');
 const target=config.databaseURL+'/statisticsAccess/paro.json',headers={Authorization:'Bearer '+access.access_token,'Content-Type':'application/json'};
 const prior=await fetch(target,{headers});if(!prior.ok)throw Error('Cannot read collector registration.');const old=await prior.json();if(old?.uid&&old.uid!==identity.uid)throw Error('A different collector is already registered.');
 const saved=await fetch(target,{method:'PUT',headers,body:JSON.stringify({uid:identity.uid})});if(!saved.ok)throw Error('Collector registration refused.');
 const refreshed=await fetch('https://securetoken.googleapis.com/v1/token?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:identity.refreshToken})});if(!refreshed.ok)throw Error('Collector token refresh failed.');const token=await refreshed.json();
 for(const [leaf,allowed]of [['devices/paro/telemetry/updatedAt',true],['devices/paro/telemetry/ready',true],['devices/paro/telemetry/state/sensors/pellets_total_kg',true],['statisticsRuntime/paro',true],['devices/paro/telemetry',false],['devices/paro/command',false],['pushSubscriptions',false],['members',false]]){const r=await fetch(config.databaseURL+'/'+leaf+'.json?auth='+encodeURIComponent(token.id_token));if(r.ok!==allowed)throw Error('Unexpected collector permission.');}
 await fs.writeFile(path.join(folder,'statistics-worker-secrets.json'),JSON.stringify({PARO_STATISTICS_FIREBASE:JSON.stringify(identity)})+'\n',{mode:0o600});
 console.log('Collector registered. Its limited credentials are saved only in .secrets/. No stove commands were sent.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
