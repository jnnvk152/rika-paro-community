import {CAPACITY_KG,stockEstimate,pendingRefills,journalGap} from './pellet-stock.js';
const fmt=n=>new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(n);
export class PelletStockView {
 constructor(root,save){
  this.root=root;this.save=save;this.busy=false;
  root.innerHTML=`<button class="stock-toggle" aria-haspopup="dialog" aria-controls="stockDialog" aria-label="Open hopper details"><span class="stock-mini-copy"><span class="stock-label">Hopper · estimate</span><span class="stock-values"><span class="stock-percent">— %</span><span class="stock-kg">— kg</span><span class="stock-pending" hidden>Confirm</span></span></span></button>
  <dialog id="stockDialog" class="stock-dialog" aria-labelledby="stockDialogTitle"><div class="stock-heading"><div><p class="eyebrow">PELLETS · ESTIMATE</p><h3 id="stockDialogTitle">Hopper</h3></div><button class="stock-close" aria-label="Close hopper details">×</button></div>
  <p class="stock-note muted" role="status"></p><p class="stock-support muted"></p>
  <section class="stock-question" hidden aria-label="Confirm pellet refill"><p class="eyebrow">ADDING PELLETS</p><h4>Did you refill the hopper?</h4><p class="stock-event-time muted"></p><div class="stock-choices"><button class="primary" data-stock="full">Full hopper</button><button class="secondary" data-stock="bag">I added 15 kg</button><button class="stock-other-button secondary" aria-expanded="false">None of these</button></div><button class="stock-time-unknown secondary wide" data-stock="unknown" hidden>Mark event as unknown</button><div class="stock-other" hidden><button class="secondary wide" data-stock="none">I did not add pellets</button><label>Amount added (kg)<input class="stock-added" type="number" min="0.1" max="30" step="0.1" inputmode="decimal" placeholder="e.g. 5"></label><button class="secondary wide" data-stock="add">Save another amount</button><button class="stock-unknown secondary wide" data-stock="unknown">I do not know how much is in the hopper</button></div></section>
  <details class="stock-calibrate"><summary>Set current amount</summary><p class="muted">Initial setup or correction of the estimate. This does not change stove settings.</p><button class="secondary wide" data-stock="calibrate-full">It is full now</button><label>Current hopper amount (kg)<input class="stock-remaining" type="number" min="0" max="30" step="0.1" inputmode="decimal" placeholder="0–30"></label><button class="secondary wide" data-stock="remaining">Save current amount</button></details>
  <p class="stock-footnote">About 30 kg / 47 l. The estimate uses your refill confirmations and the stove’s consumption counter; it is not a level-sensor measurement. <a href="https://rika.ams3.cdn.digitaloceanspaces.com/rika-web/ovens/paro/pdf/EN/Datenblatt_PARO_EN.pdf" target="_blank" rel="noopener noreferrer">RIKA</a></p></dialog>`;
  this.$=selector=>root.querySelector(selector);
  this.dialog=this.$('.stock-dialog');
  this.hopperButton=document.getElementById('stoveHopper');
  if(this.hopperButton)this.hopperButton.onclick=()=>this.$('.stock-toggle').click();
  this.$('.stock-toggle').onclick=()=>{if(!this.dialog.open)this.dialog.showModal();};
  this.$('.stock-close').onclick=()=>{this.lastPromptId=this.event?.id;this.dialog.close();};
  this.dialog.addEventListener('cancel',()=>{this.lastPromptId=this.event?.id;});
  this.$('.stock-other-button').onclick=()=>{const open=this.$('.stock-other').hidden;this.$('.stock-other').hidden=!open;this.$('.stock-other-button').setAttribute('aria-expanded',String(open));};
  for(const button of root.querySelectorAll('[data-stock]'))button.onclick=async()=>{
   if(this.busy||!this.enabled)return;
   const action=button.dataset.stock,manual=['calibrate-full','remaining'].includes(action),kind=action==='calibrate-full'?'full':action==='bag'?'add':action;
   let kg=action==='bag'?15:kind==='add'?Number(this.$('.stock-added').value):kind==='remaining'?Number(this.$('.stock-remaining').value):CAPACITY_KG;
   if((kind==='add'&&!this.$('.stock-added').value&&action!=='bag')||(kind==='remaining'&&!this.$('.stock-remaining').value)){this.message("Enter the pellet amount.");return;}
   this.busy=true;this.disable();
   try{await save(kind,kg,manual?null:this.event?.id);this.$('.stock-calibrate').open=false;this.message("Amount saved.");}catch(e){this.message(e.message);}finally{this.busy=false;this.disable();}
  };
 }
 message(text){this.$('.stock-note').textContent=text;}
 disable(){for(const e of this.root.querySelectorAll('[data-stock],.stock-other-button,input'))e.disabled=this.busy||!this.enabled;}
 update({state,entries,enabled,fresh,visible=true}){
  this.root.hidden=!visible;if(this.hopperButton)this.hopperButton.hidden=!visible;if(!visible){if(this.dialog.open)this.dialog.close();const fuel=document.getElementById('hopperPellets'),unknown=document.getElementById('hopperUnknown');if(fuel)fuel.style.display='none';if(unknown)unknown.style.display='';return;}
  this.enabled=enabled;
  const pending=pendingRefills(state,entries),estimate=stockEstimate(entries,state?.sensors?.pellets_total_kg,pending),journal=state?.device?.capabilities?.hopper_journal===true;
  if(journalGap(state,entries)){estimate.kg=null;estimate.percent=null;estimate.reason='gap';}
  const ambiguous=estimate.reason==='pending';
  this.$('.stock-percent').textContent=estimate.percent===null?'— %':`~${estimate.percent} %`;
  this.$('.stock-kg').textContent=estimate.kg===null?'— kg':`~${fmt(estimate.kg)} kg`;
  this.$('.stock-label').textContent=ambiguous?"Hopper · confirm refill":!fresh?"Hopper · last estimate":"Hopper · estimate";
  // A cutaway in the PARO's right stone panel shares the same estimate as the text.
  const known=estimate.percent!==null,percent=known?Math.max(0,Math.min(100,estimate.percent)):0,y=226-181*percent/100;
  const fuel=document.getElementById('hopperPellets'),unknown=document.getElementById('hopperUnknown');
  if(fuel){fuel.style.display=known?'':'none';fuel.classList.toggle('hopper-uncertain',ambiguous||!fresh);for(const level of fuel.querySelectorAll('rect')){level.setAttribute('y',y);level.setAttribute('height',181*percent/100);}const surface=fuel.querySelector('path');surface.setAttribute('d',`M139 ${y}h35`);surface.style.display=percent>0?'':'none';}
  if(unknown)unknown.style.display=known?'none':'';
  this.$('.stock-toggle').setAttribute('aria-label',(estimate.percent===null?"Hopper: amount unknown":`Hopper: about ${estimate.percent} percent, ${fmt(estimate.kg)} kg`)+(ambiguous?", confirm refill":'')+". Open hopper details.");
  if(this.hopperButton)this.hopperButton.setAttribute('aria-label',this.$('.stock-toggle').getAttribute('aria-label'));
  this.root.classList.toggle('stock-low',estimate.kg!==null&&estimate.kg<=5);
  this.message(!fresh?"No fresh readings. Showing the last available estimate.":estimate.reason==='gap'?"Some earlier lid events are missing. Set the current amount again.":estimate.reason==='reset'?"The consumption counter reset. Set the current amount again.":ambiguous?"A lid event was detected. Confirm the amount added to update the estimate.":estimate.kg===null?"Start by confirming a full hopper or entering the current amount.":estimate.reason==='overflow'?"The total exceeds 30 kg; the estimate is capped at a full hopper. Correct it if needed.":estimate.kg<=5?"The pellet estimate is low. Check the hopper.":"Consumption is subtracted automatically using the stove’s counter.");
  this.$('.stock-support').textContent=!journal?"Automatic lid detection requires a module update. You can already set the amount manually.":state?.hopper?.durable===false?"The module cannot persist lid events. Check the current pellet amount.":state?.hopper?.open===true?"The lid is open. The refill question appears after you close it.":"The module records lid openings and closures even while the app is closed. It stores the last 32 closures.";
  const event=pending[0];
  if(event?.id!==this.event?.id){this.$('.stock-other').hidden=true;this.$('.stock-other-button').setAttribute('aria-expanded','false');this.$('.stock-added').value='';}
  const previousEvent=this.event;this.event=event;this.$('.stock-pending').hidden=!event;if(previousEvent&&!event&&this.dialog.open)this.dialog.close();
  if(event&&fresh&&!document.hidden){if(this.dialog.open)this.lastPromptId=event.id;else if(this.lastPromptId!==event.id&&!document.querySelector('dialog[open]')){this.lastPromptId=event.id;this.dialog.showModal();}}
  this.$('.stock-question').hidden=!event;this.$('.stock-choices').hidden=!!event&&!event.at;this.$('.stock-time-unknown').hidden=!event||!!event.at;if(event&&!event.at)this.$('.stock-other').hidden=true;
  if(event){this.$('.stock-event-time').textContent=(event.at?new Intl.DateTimeFormat("en-GB",{timeZone:'Europe/Ljubljana',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}).format(event.at):"The lid closure time is unknown. Mark the event as unknown, then set the current amount.")+(pending.length>1?` · another ${pending.length-1} unconfirmed lid events`:'');}
  this.$('.stock-calibrate summary').textContent=estimate.kg===null?"Set initial amount":"Correct current amount";
  this.disable();
 }
}
