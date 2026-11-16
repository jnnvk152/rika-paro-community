import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {createIo} from '../monitor/worker.js';
import {createStatisticsIo} from '../statistics/worker.js';
const require=createRequire(import.meta.url),{assertProjectConfig}=require('../scripts/project-config.cjs'),run=promisify(execFile);
const fixture={projectId:'community-test-project',apiKey:'AIza'+'x'.repeat(35),appId:'test-app',messagingSenderId:'123',databaseURL:'https://community-test-project-default-rtdb.europe-west1.firebasedatabase.app',authDomain:'community-test-project.firebaseapp.com',googleClientId:'123-test.apps.googleusercontent.com',appOrigin:'https://community-test-project.firebaseapp.com',ownerEmail:'fixture-owner@example.com',cloudflareAccountId:'a'.repeat(32)};
test('community configuration rejects placeholders and non-Firebase credential targets',()=>{
 assert.equal(assertProjectConfig(fixture),fixture);
 for(const patch of [{projectId:'your-firebase-project'},{apiKey:'YOUR_KEY'},{databaseURL:'http://localhost'},{databaseURL:'https://example.com'},{databaseURL:fixture.databaseURL+'/secret'},{databaseURL:fixture.databaseURL+'?token=secret'}])assert.throws(()=>assertProjectConfig({...fixture,...patch}));
});
test('configuration generates only this installation and no owner email in browser config',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'paro-community-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['scripts','web/public','firmware/open-firenet','monitor','statistics','functions'])await mkdir(path.join(root,dir),{recursive:true});
 for(const file of ['scripts/configure.mjs','scripts/project-config.cjs','database.rules.template.json','monitor/wrangler.jsonc','statistics/wrangler.jsonc'])await copyFile(new URL('../'+file,import.meta.url),path.join(root,file));
 await writeFile(path.join(root,'community.config.json'),JSON.stringify(fixture));
 const result=await run(process.execPath,[path.join(root,'scripts/configure.mjs')]);assert.match(result.stdout,/No cloud resources were created/);
 const config=JSON.parse(await readFile(path.join(root,'web/public/firebase-config.json'),'utf8'));assert.equal(config.projectId,fixture.projectId);assert.equal(config.ownerEmail,undefined);
 const rules=await readFile(path.join(root,'.local/database.rules.json'),'utf8');assert.ok(rules.includes(fixture.ownerEmail));assert.ok(!rules.includes('owner@example.invalid'));assert.doesNotMatch(rules,/"\.read":\s*true|"\.write":\s*true/);
 const header=await readFile(path.join(root,'firmware/open-firenet/community_config.h'),'utf8');assert.ok(header.includes(fixture.databaseURL));assert.ok(header.includes(fixture.appOrigin));assert.ok(!header.includes(fixture.ownerEmail));
 const worker=JSON.parse(await readFile(path.join(root,'monitor/wrangler.local.jsonc'),'utf8'));assert.equal(worker.vars.PARO_DATABASE_URL,fixture.databaseURL);assert.equal(worker.account_id,fixture.cloudflareAccountId);
 assert.match(await readFile(path.join(root,'.firebaserc'),'utf8'),/community-test-project/);
 await writeFile(path.join(root,'community.config.json'),JSON.stringify({...fixture,ownerEmail:"x' || true || '@example.com"}));await assert.rejects(run(process.execPath,[path.join(root,'scripts/configure.mjs')]));
});
test('workers reject mismatched database credentials before making any network request',()=>{
 const env={PARO_DATABASE_URL:fixture.databaseURL,PARO_APP_ORIGIN:fixture.appOrigin},credentials={apiKey:fixture.apiKey,databaseURL:'https://another-project.firebaseio.com',refreshToken:'test-token'};
 const network=()=>{throw Error('Network must not run');};
 assert.throws(()=>createIo({...env,PARO_WATCH_FIREBASE:JSON.stringify(credentials),PARO_WATCH_VAPID:JSON.stringify({publicKey:'public',privateKey:'private'})},network));
 assert.throws(()=>createStatisticsIo({...env,PARO_STATISTICS_FIREBASE:JSON.stringify(credentials)},network));
});
