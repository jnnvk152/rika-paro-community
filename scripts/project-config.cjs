const fs=require('node:fs/promises'),path=require('node:path');
function assertProjectConfig(c){
 if(!c||!/^[a-z][a-z0-9-]{4,29}$/.test(c.projectId||'')||c.projectId.includes('example')||c.projectId.startsWith('your-')||!/^AIza[\w-]{35}$/.test(c.apiKey||''))throw Error('Run pnpm configure with your own Firebase project first.');
 const url=new URL(c.databaseURL);if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!/^[-a-z0-9]+\.(?:[-a-z0-9]+\.firebasedatabase\.app|firebaseio\.com)$/.test(url.hostname))throw Error('Use your Firebase Realtime Database HTTPS URL.');
 return c;
}
async function loadProjectConfig(){return assertProjectConfig(JSON.parse(await fs.readFile(path.resolve(__dirname,'../web/public/firebase-config.json'),'utf8')));}
module.exports={assertProjectConfig,loadProjectConfig};
