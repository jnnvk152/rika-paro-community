import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{assertProjectConfig}=require('./project-config.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
 const c=assertProjectConfig(JSON.parse(await readFile(path.join(root,'community.config.json'),'utf8')));
 if(!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(c.ownerEmail||'')||c.ownerEmail.endsWith('.invalid'))throw Error('Set your verified Google account email as ownerEmail.');
 if(!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.googleClientId||''))throw Error('Set your Google OAuth web client ID.');
 const origin=new URL(c.appOrigin);if(origin.protocol!=='https:'||origin.origin!==c.appOrigin||origin.username||origin.password)throw Error('Set appOrigin to your app’s HTTPS origin, without a trailing slash.');
 if(c.authDomain!==origin.hostname)throw Error('Use the same Firebase Hosting domain for authDomain and appOrigin.');
 if(c.cloudflareAccountId&&!/^[a-f0-9]{32}$/.test(c.cloudflareAccountId))throw Error('Invalid Cloudflare account ID.');
 const publicConfig=Object.fromEntries(['projectId','apiKey','appId','messagingSenderId','databaseURL','storageBucket','authDomain','googleClientId'].map(k=>[k,c[k]||'']));publicConfig.deviceId='paro';
 const rules=(await readFile(path.join(root,'database.rules.template.json'),'utf8')).replaceAll('owner@example.invalid',c.ownerEmail);
 await mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
 await writeFile(path.join(root,'.local/database.rules.json'),rules,{mode:0o600});
 await writeFile(path.join(root,'web/public/firebase-config.json'),JSON.stringify(publicConfig,null,2)+'\n');
 await writeFile(path.join(root,'.firebaserc'),JSON.stringify({projects:{default:c.projectId}},null,2)+'\n');
 const header='#pragma once\n// Generated locally by pnpm configure. Never commit installation settings.\n#define PARO_FIREBASE_URL '+JSON.stringify(c.databaseURL)+'\n#define PARO_APP_ORIGIN '+JSON.stringify(c.appOrigin)+'\n';
 await writeFile(path.join(root,'firmware/open-firenet/community_config.h'),header);
 for(const name of ['monitor','statistics']){const file=path.join(root,name,'wrangler.jsonc'),w=JSON.parse(await readFile(file,'utf8'));if(c.cloudflareAccountId)w.account_id=c.cloudflareAccountId;w.vars={PARO_DATABASE_URL:c.databaseURL,PARO_APP_ORIGIN:c.appOrigin};await writeFile(path.join(root,name,'wrangler.local.jsonc'),JSON.stringify(w,null,2)+'\n');}
 await writeFile(path.join(root,'functions/project-config.json'),JSON.stringify({databaseURL:c.databaseURL,ownerEmail:c.ownerEmail,appOrigin:c.appOrigin,instance:new URL(c.databaseURL).hostname.split('.')[0]},null,2)+'\n',{mode:0o600});
 console.log('Local installation files prepared. No cloud resources were created, no deployment was made, and no stove commands were sent.');
}catch(error){console.error(error.code==='ENOENT'?'Copy community.config.example.json to community.config.json and enter your own project details first.':error.message);process.exitCode=1;}
