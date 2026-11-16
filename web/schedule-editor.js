import {DAYS,readSchedule,decodeSlot,encodeSlot,validateSchedule} from './schedule.js';

export class ScheduleEditor {
 dirty=false;available=false;baseline='';
 constructor(root,onChange){
  this.root=root;this.onChange=onChange;
  root.innerHTML=`<div class="schedule-heading"><div><p class="eyebrow">WEEKLY HEATING</p><h3>Edit schedule</h3></div><button id="reloadSchedule" class="secondary" type="button">Read from stove</button></div>
   <p class="muted">Set up to two intervals per day. The schedule follows the stove’s clock; each interval must end on the same day.</p>
   <p id="scheduleUnavailable" class="muted" role="status"></p>
   <fieldset id="scheduleFields"><legend class="sr-only">Weekly schedule settings</legend>
   <label class="schedule-switch"><input id="scheduleActive" type="checkbox"> Schedule active</label>
   <label class="setback-label" for="scheduleSetback">Temperature outside intervals <span><input id="scheduleSetback" type="number" min="12" max="22" step="1" value="16"> °C</span></label>
   <div class="schedule-copy"><button type="button" id="copyWeekdays" class="secondary">Monday → weekdays</button><button type="button" id="copyAllDays" class="secondary">Monday → all days</button></div>
   <div class="schedule-days">${DAYS.map(([day,label],index)=>`<details class="schedule-day" ${index===0?'open':''}><summary>${label}<span id="summary${day}">No intervals</span></summary><div class="schedule-periods">${[1,2].map(n=>`<div class="schedule-period"><label class="period-toggle"><input id="enabled${day}${n}" type="checkbox" aria-label="${label}, ${n}. interval">${n}. interval</label><label>From<input id="start${day}${n}" type="time" step="60" aria-label="${label}, ${n}. interval, start"></label><label>To<input id="end${day}${n}" type="time" step="60" aria-label="${label}, ${n}. interval, end"></label></div>`).join('')}</div></details>`).join('')}</div>
   </fieldset><p id="scheduleValidation" class="schedule-validation" role="status" aria-live="polite"></p><p class="muted schedule-save-note">Changes are sent to the stove only when you press “Save schedule and settings”.</p>`;
  root.addEventListener('input',e=>{if(e.target.matches('input')){this.dirty=true;this.onChange();}});
  root.querySelector('#copyWeekdays').onclick=()=>this.copy(false);
  root.querySelector('#copyAllDays').onclick=()=>this.copy(true);
 }
 $(id){return this.root.querySelector(`#${id}`);}
 reset(state){this.dirty=false;this.baseline='';this.adopt(state);}
 adopt(state){
  const schedule=readSchedule(state);this.available=!!schedule;
  if(!schedule||this.dirty)return;
  const fingerprint=JSON.stringify(schedule);if(this.baseline===fingerprint)return;this.baseline=fingerprint;
  this.$('scheduleActive').checked=schedule.active;this.$('scheduleSetback').value=schedule.setback_temperature;
  for(const [day] of DAYS)for(const n of [1,2]){
   const slot=decodeSlot(schedule.slots[`heatTime${day}${n}`],n);
   this.$(`enabled${day}${n}`).checked=slot.enabled;this.$(`start${day}${n}`).value=slot.start;this.$(`end${day}${n}`).value=slot.end;
  }
 }
 activate(){if(this.available){this.$('scheduleActive').checked=true;this.dirty=true;}}
 value(){
  const slots={};for(const [day] of DAYS)for(const n of [1,2])slots[`heatTime${day}${n}`]=encodeSlot(this.$(`enabled${day}${n}`).checked,this.$(`start${day}${n}`).value,this.$(`end${day}${n}`).value);
  return validateSchedule({active:this.$('scheduleActive').checked,setback_temperature:Number(this.$('scheduleSetback').value),slots});
 }
 copy(all){
  try{
   const mon={};for(const n of [1,2])mon[n]={enabled:this.$(`enabledMon${n}`).checked,start:this.$(`startMon${n}`).value,end:this.$(`endMon${n}`).value};
   for(const n of [1,2])encodeSlot(mon[n].enabled,mon[n].start,mon[n].end);
   // Validate overlap before copying the source day.
   const draft={active:true,setback_temperature:16,slots:{}};
   for(const [day] of DAYS)for(const n of [1,2])draft.slots[`heatTime${day}${n}`]=day==='Mon'?encodeSlot(mon[n].enabled,mon[n].start,mon[n].end):0;
   validateSchedule(draft);
   for(const [day] of DAYS.slice(1,all?7:5))for(const n of [1,2]){this.$(`enabled${day}${n}`).checked=mon[n].enabled;this.$(`start${day}${n}`).value=mon[n].start;this.$(`end${day}${n}`).value=mon[n].end;}
   this.dirty=true;this.onChange();
  }catch(e){this.$('scheduleValidation').textContent=e.message;}
 }
 render({visible,enabled,busy}){
  this.root.hidden=!visible;
  const editing=enabled&&this.available&&!busy;
  this.$('scheduleFields').disabled=!editing;this.$('reloadSchedule').disabled=!enabled||busy||!this.available;
  this.$('scheduleUnavailable').hidden=this.available;
  this.$('scheduleUnavailable').textContent=!enabled?"Editing is available while the stove is connected.":"Waiting for the module’s schedule before editing. If it does not appear, update the module.";
  for(const [day] of DAYS){const summary=[];for(const n of [1,2]){const checked=this.$(`enabled${day}${n}`).checked;this.$(`start${day}${n}`).disabled=!editing||!checked;this.$(`end${day}${n}`).disabled=!editing||!checked;if(checked)summary.push(`${this.$(`start${day}${n}`).value||'—'}–${this.$(`end${day}${n}`).value||'—'}`);}this.$(`summary${day}`).textContent=summary.join(' · ')||"No intervals";}
  let error='';if(this.available)try{this.value();}catch(e){error=e.message;}
  this.$('scheduleValidation').textContent=error;this.$('scheduleValidation').hidden=!error;
  return this.available&&!error;
 }
}
