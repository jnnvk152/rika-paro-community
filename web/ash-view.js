import {ashReading} from './ash.js';
const manual='https://rika.ams3.cdn.digitaloceanspaces.com/rika-web/ovens/paro/pdf/EN/Z39887_Paro_EN.pdf';
export class AshView{
 constructor(root,record){
  this.root=root;this.record=record;this.busy=false;
  root.innerHTML=`<div class="ash-head"><span class="eyebrow">MAINTENANCE</span><span class="ash-mark" aria-hidden="true">◷</span></div><h3>Ash drawer</h3><p class="ash-status" role="status"></p><div class="ash-usage" hidden><div><strong class="ash-kg"></strong><span>of pellets since emptying</span></div><div><strong class="ash-hours"></strong><span>of operation since emptying</span></div></div><div class="ash-progress" hidden><div role="progressbar" aria-label="Consumption against the previous interval" aria-valuemin="0" aria-valuemax="100"><span></span></div><p></p></div><p class="ash-last muted"></p><button class="secondary wide ash-record">I emptied the ash drawer</button><div class="ash-confirm" hidden><p>Confirm that you have just emptied the ash drawer. The current consumption and operating-hour counters will be saved.</p><button class="primary wide ash-yes">Log emptying</button><button class="secondary wide ash-no">Cancel</button></div><p class="ash-message muted" role="status"></p><details class="setup-details"><summary>How do reminders work?</summary><p>RIKA recommends regular emptying, without a fixed number of kilograms or hours. After two logged emptyings, the app reminds you when consumption reaches the previous interval. If the kilogram counter has not moved, operating hours are used. Each emptying begins a new interval.</p><p>This is an estimate, not an ash-level sensor. Wood burning and different pellets can produce different amounts of ash. Check the drawer yourself too. Empty only when the stove is cold; ash can contain hot embers.</p><p><a href="${manual}#page=27" target="_blank" rel="noopener">Official RIKA PARO maintenance manual</a></p></details>`;
  this.$=s=>root.querySelector(s);
  this.$('.ash-record').onclick=()=>{this.$('.ash-confirm').hidden=false;this.$('.ash-record').hidden=true;};
  this.$('.ash-no').onclick=()=>this.close();
  this.$('.ash-yes').onclick=async()=>{if(this.busy)return;this.busy=true;this.update(this.input);try{await this.record();this.$('.ash-message').textContent="Emptying logged.";this.close();}catch(e){this.$('.ash-message').textContent=e.message;}finally{this.busy=false;this.update(this.input);}};
 }
 close(){this.$('.ash-confirm').hidden=true;this.$('.ash-record').hidden=false;}
 update(input){
  this.input=input;const {sample,entries,now,enabled,visible}=input,r=ashReading(sample,entries,now);this.root.hidden=!visible;
  const n=v=>new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(v);
  this.$('.ash-status').textContent={initial:"Log the first emptying to establish a reference.",offline:"Waiting for fresh stove readings to calculate the estimate.",counter:"Consumption counters are unavailable.",reset:"The counter reset. Log the next two emptyings to establish a new reference.",learning:"Log one more emptying to enable the first reminder.",ready:r.due?"It is time to check the ash drawer.":"Consumption is tracked from the last emptying."}[r.reason];
  this.$('.ash-usage').hidden=r.usedKg===undefined;this.$('.ash-kg').textContent=n(r.usedKg||0)+' kg';this.$('.ash-hours').textContent=n(r.usedHours||0)+' h';
  this.$('.ash-last').textContent=r.last?"Last emptied: "+new Intl.DateTimeFormat("en-GB",{timeZone:'Europe/Ljubljana',dateStyle:'medium',timeStyle:'short'}).format(r.last.at)+" · counters "+n(r.last.kg)+' kg / '+n(r.last.hours)+' h.':'';
  this.$('.ash-progress').hidden=!r.known;const percent=r.known?Math.min(100,Math.round(r.progress*100)):0;this.$('[role=progressbar]').setAttribute('aria-valuenow',percent);this.$('[role=progressbar] span').style.width=percent+'%';this.$('.ash-progress p').textContent=r.known?`${percent} % of the previous interval · ${n(r.interval)} ${r.basis==='kg'?'kg':'h'}`:'';
  this.root.dataset.due=r.due?'true':'false';for(const cls of ['.ash-record','.ash-yes'])this.$(cls).disabled=this.busy||!enabled;
 }
}
