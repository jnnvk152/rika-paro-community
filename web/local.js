import {assertAllowed,validatePatch} from './domain.js';

// Same-origin bridge only: the hosted HTTPS app never calls a private HTTP IP.
export class Local {
  available=false; connected=false; sample=null; token=''; address='open-firenet.local'; epoch=0; polling=false;
  now=()=>Date.now();
  async request(path,options={}) {
    const r=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json','X-Paro-Token':this.token,...options.headers},signal:AbortSignal.timeout(8000)});
    let body;try{body=await r.json();}catch{throw Error("The local launcher is unavailable.");}
    if(!r.ok)throw Error(body.error||"The module did not respond.");
    return body;
  }
  async init(callbacks) {
    this.callbacks=callbacks;
    try{const info=await this.request('/local/info');if(typeof info.token!=='string'||typeof info.address!=='string')return false;this.token=info.token;this.address=info.address;this.available=true;return true;}catch{return false;}
  }
  async connect(address) {
    ++this.epoch;this.connected=false;this.sample=null;this.callbacks.state(null,false);
    const info=await this.request('/local/connection',{method:'POST',body:JSON.stringify({address})});this.address=info.address;
    await this.refresh();
  }
  async refresh() {
    if(!this.available||this.polling)return;
    this.polling=true;const epoch=this.epoch;
    try{
      const state=await this.request('/api/state');
      const schedule=await this.request('/api/schedule');
      if(schedule.synced===true)state.schedule=schedule.slots;
      if(epoch!==this.epoch)return;
      if(!state?.controls||!state?.stove||!state?.sensors)throw Error("Unexpected module response.");
      this.connected=true;
      this.sample={ready:state.version_ack===true,session:'0'.repeat(32),updatedAt:Date.now(),state};
      this.callbacks.state(this.sample,true);
      return this.sample;
    }catch(e){if(epoch===this.epoch){this.connected=false;this.callbacks.state(this.sample,false);}throw e;}
    finally{this.polling=false;}
  }
  async command(patch) {
    validatePatch(patch);assertAllowed(patch,this.sample?.state);
    const result=await this.request('/api/controls',{method:'POST',body:JSON.stringify(patch)});
    if(result?.applied?.sent===false||result?.sent===false)return {status:'rejected',reason:"The stove is not ready for controls yet."};
    return {status:'sent'};
  }
}
