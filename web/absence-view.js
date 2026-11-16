import {homeDate,reminderDue} from './absence.js';
const format=value=>value?value.split('-').reverse().join('. '):"Date not set";
export class AbsenceView{
 constructor(root,save,onShow=()=>{}){
  this.root=root;this.save=save;this.onShow=onShow;this.busy=false;
  root.innerHTML="<article class=\"absence-card\" hidden><p class=\"eyebrow\">HOME OR AWAY</p><h3 class=\"absence-date\"></h3><p class=\"absence-note muted\"></p><p class=\"absence-return muted\" role=\"status\"></p><button class=\"absence-edit secondary wide\">Edit return date</button><button class=\"absence-confirm secondary wide\" hidden>Confirm return date</button></article><dialog class=\"absence-dialog\" aria-labelledby=\"absenceTitle\"><form><p class=\"eyebrow\">TIME AWAY</p><h2 id=\"absenceTitle\">When will you return?</h2><p class=\"absence-intro\"></p><label>Expected return<input class=\"absence-input\" type=\"date\"></label><p class=\"muted\">At 19:00 Europe/Ljubljana time on the evening before your return, you receive a reminder to check the date and extend your absence if needed.</p><p class=\"absence-auto-note muted\"></p><p class=\"absence-error muted\" role=\"status\"></p><div class=\"absence-actions\"><button type=\"submit\" class=\"primary\">Save time away</button><button type=\"button\" class=\"absence-unknown secondary\">I do not know the date yet</button><button type=\"button\" class=\"absence-close secondary\">Cancel</button></div></form></dialog><dialog class=\"return-dialog\" aria-labelledby=\"returnTitle\"><p class=\"eyebrow\">BEFORE YOUR RETURN</p><h2 id=\"returnTitle\">Is your return date still correct?</h2><p class=\"muted\">The reminder does not hold the morning start. If you are staying away longer, change the date or choose “Not sure yet”.</p><p class=\"return-date\"></p><p class=\"return-error muted\" role=\"status\"></p><div class=\"absence-actions\"><button class=\"return-yes primary\">Yes, still correct</button><button class=\"return-edit secondary\">Change date</button><button class=\"return-unknown secondary\">Not sure yet</button><button class=\"return-close secondary\">Later</button></div></dialog>";
  this.$=selector=>root.querySelector(selector);this.edit=this.$('.absence-dialog');this.confirm=this.$('.return-dialog');
  this.$('.absence-edit').onclick=()=>this.open(!this.away);
  this.$('.absence-confirm').onclick=()=>{if(!this.confirm.open)this.confirm.showModal();};
  this.$('.absence-close').onclick=()=>this.edit.close();
  this.$('.return-close').onclick=()=>this.confirm.close();
  this.$('form').onsubmit=e=>{e.preventDefault();this.submit(this.$('.absence-input').value);};
  this.$('.absence-unknown').onclick=()=>this.submit('');
  this.$('.return-yes').onclick=()=>this.answer(this.plan?.returnDate||'','confirmed');
  this.$('.return-unknown').onclick=()=>this.answer('','unknown');
  this.$('.return-edit').onclick=()=>{this.confirm.close();this.open(false);};
 }
 open(switchOff){
  this.onShow();this.editingRevision=this.plan?.revision||0;this.switchOff=switchOff;this.$('.absence-auto-note').textContent=this.returnInfo?.supported?"On your return date, at "+this.returnInfo.time+" Home Routine resumes automatically. The reminder lets you extend time away; answering is not required for heating to resume.":"Automatic return requires a module update. Until then, select “Home · enable heating” when you return.";this.$('.absence-input').min=homeDate();this.$('.absence-input').value=this.plan?.returnDate||'';
  this.$('.absence-intro').textContent=switchOff?(this.returnInfo?.supported?"Heating pauses until the selected return date. Without a return date, you can enable it later with “Home · enable heating”.":"The stove switches off. Until the module is updated, select “Home · enable heating” when you return."): "Changing the date also reschedules your automatic return to Home Routine.";
  this.$('.absence-error').textContent='';if(!this.edit.open)this.edit.showModal();
 }
 disable(){for(const el of this.root.querySelectorAll('button:not(.absence-close):not(.return-close),input'))el.disabled=this.busy||!this.enabled;}
 async submit(returnDate){
  if(this.busy||!this.enabled)return;this.busy=true;this.disable();
  try{await this.save({active:true,returnDate,confirmation:returnDate?'pending':'unknown'},this.switchOff,this.editingRevision);this.edit.close();}
  catch(e){this.$('.absence-error').textContent=e.message;}finally{this.busy=false;this.disable();}
 }
 async answer(returnDate,confirmation){
  if(this.busy||!this.enabled||!this.plan)return;this.busy=true;this.disable();
  try{await this.save({active:true,returnDate,confirmation},false);this.confirm.close();}
  catch(e){this.$('.return-error').textContent=e.message;}finally{this.busy=false;this.disable();}
 }
 update({plan,away,enabled,visible,now,homeStatus,returnInfo}){
  this.plan=plan;this.enabled=enabled;this.away=away;this.returnInfo=returnInfo;this.$('.absence-return').textContent=returnInfo?.message||'';this.$('.absence-return').hidden=!returnInfo?.message;
  this.$('.absence-card').hidden=!visible;
  this.$('.absence-date').textContent=away?format(plan?.returnDate):"Home";
  this.$('.absence-edit').textContent=away?"Edit return date":"Plan time away";
  this.$('.absence-note').textContent=!away?(homeStatus?.kind==='active'?"Home Routine is active. When leaving, you can pause heating and set a return date.":homeStatus?.detail||"Selecting “Home” alone does not enable automatic heating."):plan?.confirmation==='confirmed'?"Return date confirmed.":plan?.returnDate?"The evening reminder lets you extend time away.":"You can set the return date now or later.";
  const due=away&&plan?.active===true&&reminderDue(plan,now);
  this.$('.absence-confirm').hidden=!due;
  this.$('.return-date').textContent="Expected return: "+format(plan?.returnDate)+'.';
  if(!visible){this.edit.close();this.confirm.close();}
  if(!due&&this.confirm.open)this.confirm.close();
  if(due&&enabled&&!document.hidden&&this.prompted!==plan.id&&!document.querySelector('dialog[open]')){this.prompted=plan.id;this.onShow();this.confirm.showModal();}
  this.disable();
 }
}
