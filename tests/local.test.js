import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalServer,resolveModule,privateIPv4} from '../scripts/local-server.js';
test('local connection refuses public, loopback, credential, path and port targets',async()=>{
 for(const s of ['127.0.0.1','169.254.169.254','example.org','https://10.0.0.1','http://user:pass@10.0.0.1','http://10.0.0.1:3000','10.0.0.1/admin','10.0.0.1/?key=x'])await assert.rejects(resolveModule(s));
 assert.equal(privateIPv4('192.168.999.1'),false);
 await assert.rejects(resolveModule('open-firenet.local',async()=>[{address:'8.8.8.8'}]));
 assert.deepEqual(await resolveModule('192.168.1.33'),{address:'192.168.1.33',ip:'192.168.1.33'});
});
test('local API reads, applies partial settings once and enforces origin and readiness',async(t)=>{
 let state={version_ack:true,stove:{has_error:false,state:'standby'},controls:{on:false,mode:'manual',power_percent:70},sensors:{room_sensor_connected:false}};
 const writes=[];
 const {server,hosts}=createLocalServer({port:0,resolve:async()=>({address:'open-firenet.local',ip:'192.168.1.33'}),upstream:async(_m,endpoint,patch)=>{if(endpoint==='/api/state')return structuredClone(state);writes.push(patch);Object.assign(state.controls,patch);return {ok:true};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const port=server.address().port,base=`http://127.0.0.1:${port}`;hosts.add(`127.0.0.1:${port}`);
 const info=await (await fetch(`${base}/local/info`)).json();
 const send=async(patch,extra={})=>fetch(`${base}/api/controls`,{method:'POST',headers:{'Content-Type':'application/json','X-Paro-Token':info.token,...extra},body:JSON.stringify(patch)});
 assert.equal((await send({on:true},{Origin:'https://evil.example'})).status,403);
 assert.equal((await send({on:true},{'X-Paro-Token':'bad'})).status,403);
 assert.equal((await send({mode:'manual',power_percent:65})).status,200);
 assert.deepEqual(writes,[{mode:'manual',power_percent:65}]);
 assert.equal((await send({target_temperature:21})).status,400);
 state.stove.has_error=true;assert.equal((await send({on:true})).status,400);
 assert.equal((await send({on:false})).status,200);
 state.version_ack=false;assert.equal((await send({mode:'auto'})).status,400);
 assert.equal(writes.length,2);
 const response=await fetch(`${base}/api/state`,{headers:{'X-Paro-Token':info.token}});assert.equal(response.status,200);
 assert.equal((await response.json()).version_ack,false);
});

test('local schedule is read before writing all slots once, without changing the power switch',async(t)=>{
 const {demoSchedule}=await import('../web/schedule.js');const schedule=demoSchedule();schedule.active=true;schedule.slots.heatTimeMon1=6000900;
 let synced=false;
 const state={version_ack:true,stove:{has_error:false,state:'heating'},controls:{on:true,mode:'auto',power_percent:70,heating_times_active:false,setback_temperature:16},sensors:{room_sensor_connected:true}};
 const writes=[];
 const {server,hosts}=createLocalServer({port:0,resolve:async()=>({address:'open-firenet.local',ip:'192.168.1.33'}),upstream:async(_m,endpoint,patch)=>{
  if(endpoint==='/api/state')return structuredClone(state);
  if(endpoint==='/api/schedule'&&!patch)return {synced,slots:demoSchedule().slots};
  writes.push({endpoint,patch});return {ok:true};
 }});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;hosts.add(`127.0.0.1:${server.address().port}`);
 const {token}=await (await fetch(`${base}/local/info`)).json();
 const send=()=>fetch(`${base}/api/controls`,{method:'POST',headers:{'Content-Type':'application/json','X-Paro-Token':token},body:JSON.stringify({mode:'auto',power_percent:70,schedule})});
 assert.equal((await send()).status,400);assert.equal(writes.length,0);
 synced=true;assert.equal((await send()).status,200);assert.equal(writes.length,1);
 assert.equal(writes[0].endpoint,'/api/schedule');assert.equal(writes[0].patch.heatTimeMon1,6000900);assert.equal(writes[0].patch.heatTimeSun2,0);assert.equal(writes[0].patch.heating_times_active,true);assert.equal('on'in writes[0].patch,false);
 assert.equal(state.controls.on,true);
});
