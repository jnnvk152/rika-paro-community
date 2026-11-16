import {defineConfig} from 'vite';
import {randomBytes} from 'node:crypto';
const release={version:randomBytes(12).toString('hex'),builtAt:new Date().toISOString()};
export default defineConfig({
 root:'web',
 define:{__PARO_RELEASE__:JSON.stringify(release)},
 plugins:[{
  name:'paro-app-release',
  generateBundle(){this.emitFile({type:'asset',fileName:'app-version.json',source:JSON.stringify(release)});},
  configureServer(server){server.middlewares.use('/app-version.json',(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(release));});}
 }],
 build:{outDir:'../dist',emptyOutDir:true},server:{host:'127.0.0.1'}
});
