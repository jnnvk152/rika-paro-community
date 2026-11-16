import './style.css';
import './app-updates.css';
import {AppUpdates,releaseUrl,watchAppUpdates} from './app-updates.js';
import {StatisticsView,demoStatistics} from './statistics-view.js';
import {Cloud} from './cloud.js';
import {ComfortPlanView} from './comfort-plan-view.js';
import {DEFAULT_COMFORT_PLAN,comfortPeriod} from './comfort-plan.js';
import {authErrorMessage} from './auth-flow.js';
import {mountGoogleSignIn} from './google-signin.js';
import {ashReading,ashAlert} from './ash.js';
import {AshView} from './ash-view.js';
import {pelletAlert} from './pellet-alerts.js';
import {PelletStockView} from './pellet-stock-view.js';
import {refillEntry,hopperEvents} from './pellet-stock.js';
import {stoveStatus} from './stove-status.js';
import {ready,validatePatch,controlsMatch} from './domain.js';
import {Local} from './local.js';
import {PhoneNotifications} from './notifications.js';
import {stoveAlerts,FAULT_GUIDE,WARNINGS} from '../functions/alerts.js';
import {ScheduleEditor} from './schedule-editor.js';
import {applyComfort,applyHome} from './comfort.js';
import {heatingDraft,resumeHeatingCommands,applyHeatingCommands} from './heating-mode.js';
import {homeModeStatus,homeResumeAvailability,handoffToNativeSchedule} from './home-mode.js';
import {AbsenceView} from './absence-view.js';
import {absenceEntry,effectiveAbsence,absenceScheduleStatus,homeDate} from './absence.js';
import {demoSchedule,decodeSlot,validSlot} from './schedule.js';
const $=id=>document.getElementById(id),cloud=new Cloud(),local=new Local();
let demo=false,busy=false,authBusy=false,dirty=false,sample=null,connected=false,state=null,user=null,toastTimer,route='cloud';
let draft={mode:'comfort',target_temperature:21,power_percent:70};
let demoState,demoStockEntries={},demoAshEntries={},demoAbsencePlan=null,nightDirty=false,nightSaving=false,demoComfortPlan=null,demoCyclePhase=null;
let activeTab='control',statisticsDemoCache=null;
let appUpdates=null,lastInteraction=-Infinity;
const statisticsView=new StatisticsView($('statistics'),(from,to)=>{statisticsDemoCache=null;if(!demo&&route==='cloud')cloud.watchStatistics(from,to);render();});
const stockView=new PelletStockView($('pelletStock'),async(kind,kg,eventId)=>{
 if(demo){const event=eventId?hopperEvents(demoState).find(e=>e.id===eventId):null;const point=event||{at:Date.now(),counter:demoState.sensors.pellets_total_kg};demoStockEntries[eventId||'manual-'+crypto.randomUUID()]=refillEntry(kind,kg,point,'demo',Date.now());render();return;}
 if(route!=='cloud')throw Error("Sign in online to use the pellet log.");
 await cloud.recordRefill(kind,kg,eventId);
});
const absenceView=new AbsenceView($('absenceView'),async(value,switchOff,expectedRevision)=>{
 if(switchOff&&state?.device?.capabilities?.comfort_cycle===true&&state?.home?.cycle?.enabled===true){const confirmed=await command({cycle_action:'pause'});if(!confirmed)throw Error("Shutdown is not confirmed. Check the stove.");}
 else if(switchOff&&state?.controls?.on!==false){const confirmed=await command({on:false});if(!confirmed)throw Error("Stove shutdown is not confirmed. Check its state before trying again.");}
 if(demo){demoAbsencePlan=absenceEntry(demoAbsencePlan,value,'demo',Date.now());render();return;}
 if(route!=='cloud')throw Error("Sign in online to manage your return plan.");
 await cloud.saveAbsence(value,expectedRevision);
},()=>tab('absence'));
const ashView=new AshView($('ashCard'),async()=>{
 if(demo){demoAshEntries[crypto.randomUUID()]={at:Date.now(),kg:demoState.sensors.pellets_total_kg,hours:demoState.sensors.pellet_hours};render();return;}
 if(route!=='cloud')throw Error("Sign in online to use the pellet log.");
 await cloud.recordAsh();
});
const currentPlan=()=>demo?demoComfortPlan:cloud.comfortPlan;
const currentAbsence=()=>effectiveAbsence(demo?demoAbsencePlan:cloud.absencePlan,state);
const cycleCap=()=>state?.device?.capabilities?.comfort_cycle===true;
const managedCycle=()=>cycleCap()&&(currentPlan()?.enabled===true||state?.home?.cycle?.enabled===true);
const cyclePhase=()=>demo&&demoCyclePhase?demoCyclePhase:currentPlan()?comfortPeriod(currentPlan(),demo?Date.now():cloud.now()):state?.home?.cycle?.phase;
function syncDemoCycle(){
 if(!demo||!demoComfortPlan)return;
 const paused=demoState.home.cycle?.manual_paused??false,phase=cyclePhase();demoState.home.cycle={...demoComfortPlan,configured:true,durable:true,clock_ready:true,manual_paused:paused,phase,status:paused?'paused':'confirmed',applied_revision:demoComfortPlan.revision};
 if(!demoComfortPlan.enabled)return;
 demoState.controls.frost_protection_active=true;demoState.controls.frost_protection_temperature=demoComfortPlan.frost_temperature;
 if(paused||phase==='night'&&demoComfortPlan.night_mode==='frost')demoState.controls.on=false;
 else if(demoState.controls.on){demoState.controls.mode='comfort';demoState.controls.heating_times_active=false;demoState.controls.target_temperature=phase==='day'?demoComfortPlan.day_temperature:demoComfortPlan.night_temperature;}
}
const comfortView=new ComfortPlanView($('comfortPlanCard'),async(value,revision)=>{
 if(demo){demoComfortPlan={...value,revision:(demoComfortPlan?.revision||0)+1};syncDemoCycle();adopt(null,false);return;}
 if(route!=='cloud')throw Error("Sign in online to save the routine.");
 await cloud.saveComfortPlan(value,revision);
});
const nightReturnReady=()=>!cycleCap()&&state?.device?.capabilities?.home_night===true;
const manualNightNote=()=>managedCycle()?"Home Routine remains saved for the next scheduled transition.":cycleCap()?"The automatic daily routine is disabled.":nightReturnReady()?"The stove automatically returns to its schedule at night.":"Update the module for night transitions.";
function manualHeat(c){return c?.on===true&&(c.mode==='manual'||c.heating_times_active===false);}
const phone=new PhoneNotifications(cloud,()=>renderNotificationSettings());
function renderNotificationSettings(){
 const config=cloud.notificationConfig,usable=!demo&&route==='cloud'&&cloud.allowed,problem=phone.support;
 $('notificationStatus').textContent=demo?"Demo · notifications are not sent":!usable?"Sign in and get access to enable notifications.":config?.ready!==true?"Notification delivery is not enabled yet.":phone.enabled?(config.mode==='device'?"Your ESP32 module sends notifications · no paid server required.":"Notifications are enabled on this device."):"Notifications are not enabled on this device.";
 $('notificationHelp').textContent=problem||"On iPhone, open the app from your home screen. On Android, allow notifications in the browser. Delivery requires internet access and notification permission.";
 $('enableNotifications').hidden=phone.enabled;$('enableNotifications').disabled=!usable||config?.ready!==true||!!problem||phone.busy;
 $('testNotification').hidden=!phone.enabled;$('testNotification').disabled=!usable||config?.ready!==true||phone.busy;
 $('disableNotifications').hidden=!phone.enabled;$('disableNotifications').disabled=!usable||phone.busy;
 $('notificationMessage').textContent=phone.message;
 const checked=cloud.watchStatus?.checkedAt,monitorFresh=Number.isFinite(checked)&&cloud.now()-checked>=-2000&&cloud.now()-checked<180000;
 $('watchdogStatus').hidden=!usable;
 $('watchdogStatus').textContent=cloud.watchConfig?.ready!==true?"External connection monitoring is not enabled yet.":!checked?"External connection monitoring is being prepared.":!monitorFresh?"The external monitor has not checked in for several minutes. Its operation cannot currently be confirmed.":"External connection monitoring is active. It reports disconnection after about 3–4 minutes without a response, and also reports recovery.";
}
let lastAlerts='';
function renderAlerts(linked){
 const stock=linked?pelletAlert(demo?{updatedAt:Date.now(),ready:true,state}:sample,demo?demoStockEntries:cloud.stockEntries,demo?Date.now():transport().now()):null;
 const ash=linked?ashAlert(ashReading(demo?{updatedAt:Date.now(),ready:true,state}:sample,demo?demoAshEntries:cloud.ashEntries,demo?Date.now():transport().now())):null;
 const alerts=linked?[...stoveAlerts(state?.stove),...(stock?[stock]:[]),...(ash?[ash]:[])]:[],fingerprint=JSON.stringify(alerts);
 $('activeAlerts').hidden=!alerts.length;if(fingerprint===lastAlerts)return;lastAlerts=fingerprint;$('activeAlerts').replaceChildren();
 for(const alert of alerts){const card=document.createElement('article');card.className='stove-alert '+alert.kind;if(alert.pelletLevel)card.dataset.pelletLevel=String(alert.pelletLevel);const title=document.createElement('h3');title.textContent=alert.title;const code=document.createElement('p');code.className='alert-code';code.textContent=alert.code;const message=document.createElement('p');message.textContent=alert.message;card.append(title,code,message);$('activeAlerts').append(card);}
}
for(const [title,message] of [...WARNINGS.map(([,title,message])=>[title,message]),...FAULT_GUIDE]){const item=document.createElement('details'),summary=document.createElement('summary'),p=document.createElement('p');summary.textContent=title;p.textContent=message;item.append(summary,p);$('faultGuide').append(item);}
const scheduleEditor=new ScheduleEditor($('schedulePanel'),()=>{dirty=true;render();});
scheduleEditor.$('reloadSchedule').onclick=async()=>{await refresh(true);scheduleEditor.reset(state);dirty=Object.entries(draft).some(([k,v])=>state?.controls?.[k]!==v);render();};
const transport=()=>route==='local'?local:cloud;
const isReady=()=>demo||ready(sample,connected,transport().now());
const resumeAvailability=()=>homeResumeAvailability({ready:isReady(),busy,dirty,state,plan:currentPlan(),managed:managedCycle()});
const fmt=(v,s='')=>Number.isFinite(v)?new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(v)+s:'—';
function notify(t){clearTimeout(toastTimer);$('toast').textContent=t;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,7000);}
function tab(name){if(!['control','status','statistics','settings','absence'].includes(name))throw Error("Unknown view");for(const e of document.querySelectorAll('.view'))e.hidden=e.id!==name;for(const e of document.querySelectorAll('[data-tab]')){e.classList.toggle('selected',e.dataset.tab===name);if(e.dataset.tab===name)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');}activeTab=name;if(name==='statistics'&&!demo&&route==='cloud')cloud.watchStatistics(statisticsView.from,statisticsView.to);else{cloud.statisticsRange=null;cloud.stopStatistics();}renderStatistics();}
function adopt(s,up){sample=s;connected=up;if(!demo){state=s?.state||null;scheduleEditor.adopt(state);}if(!busy&&!dirty&&state?.controls)draft=heatingDraft(state);render();}
function renderStatistics(){
 if(activeTab!=='statistics')return;
 if(demo&&!statisticsDemoCache)statisticsDemoCache=demoStatistics(statisticsView.from,statisticsView.to,Date.now());
 statisticsView.update({days:demo?statisticsDemoCache:cloud.statisticsDays,status:demo?{startedAt:Date.now()-86400000*30,observedAt:Date.now(),online:true,unassignedKg:0}:cloud.statisticsStatus,loading:!demo&&cloud.statisticsLoading,error:!demo&&route==='local'?"Sign in online to view history.":cloud.statisticsError,allowed:demo||route==='cloud'&&cloud.allowed,demo,now:demo?Date.now():cloud.now()});
}
function render(){
 renderAppUpdate();
 if(demo){
  const p=demoAbsencePlan,parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Ljubljana',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(Date.now()),minute=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
  const future=p?.returnDate&&(p.returnDate>homeDate()||p.returnDate===homeDate()&&minute<demoComfortPlan.day_start_minute);
  demoState.device.capabilities.return_schedule=true;demoState.home.return={id:p?.id||'',revision:p?.revision||0,return_date:p?.returnDate||'',durable:true,status:!p?.active?'disabled':!p.returnDate?'waiting_date':future?'armed':'missed',reason:'scheduled'};
 }
 const linked=isReady(),moduleFresh=demo||(connected&&Number.isFinite(sample?.updatedAt)&&transport().now()-sample.updatedAt>=-2000&&transport().now()-sample.updatedAt<30000),s=state?.sensors||{},c=state?.controls||{},st=state?.stove||{};
 renderNotificationSettings();renderAlerts(linked);renderStatistics();
 comfortView.update({plan:currentPlan(),state,enabled:!busy&&(demo||route==='cloud'&&cloud.allowed&&cloud.connected),fresh:moduleFresh,demo});
 $('legacyNightCard').hidden=cycleCap()||!!currentPlan();
 ashView.update({sample:demo?{updatedAt:Date.now(),ready:true,state}:sample,entries:demo?demoAshEntries:cloud.ashEntries,now:demo?Date.now():cloud.now(),enabled:linked&&(demo||route==='cloud'&&cloud.allowed&&cloud.connected),visible:demo||route==='cloud'&&!!user&&cloud.allowed});
 const away=cycleCap()?currentAbsence()?.active===true:c.on===false;
 const returnInfo=absenceScheduleStatus(demo?demoAbsencePlan:cloud.absencePlan,state,currentPlan(),linked);
 const homeStatus=homeModeStatus({plan:currentPlan(),state,fresh:linked,away,returnInfo});
 for(const id of ['homeModeSummary','homeModeState'])$(id).dataset.status=homeStatus.kind;
 $('homeModeBadge').textContent=homeStatus.label;$('homeModeDetail').textContent=homeStatus.detail;
 $('homeModeStateLabel').textContent=homeStatus.label;$('homeModeStateDetail').textContent=homeStatus.detail;
 const resume=resumeAvailability();
 $('resumeHomeMode').hidden=!away&&!(managedCycle()&&state?.home?.cycle?.manual_paused===true);$('resumeHomeMode').textContent=away?"Home · enable heating":"Enable Home Routine";$('resumeHomeMode').disabled=resume.disabled;
 $('homeResumeReason').hidden=$('resumeHomeMode').hidden||!resume.reason;$('homeResumeReason').textContent=resume.reason;
 $('discardHomeDraft').hidden=$('resumeHomeMode').hidden||resume.code!=='draft';

 absenceView.update({plan:currentAbsence(),away,enabled:!busy&&(demo||route==='cloud'&&cloud.allowed&&cloud.connected),visible:demo||!!user,now:demo?Date.now():cloud.now(),homeStatus,returnInfo});
 const night=cloud.homeConfig?.night_end_minute??state?.home?.night_end_minute??1380;
 if(!nightDirty)$('nightEnd').value=String(Math.floor(night/60)).padStart(2,'0')+':'+String(night%60).padStart(2,'0');
 $('saveNightEnd').hidden=!nightDirty;
 $('saveNightEnd').disabled=busy||nightSaving||!(demo||route==='cloud'&&cloud.allowed&&cloud.connected);
 $('saveNightEnd').textContent=nightSaving?"Saving …":"Save new time";
 const selectedTime=$('nightEnd').value||'23:00';$('nightFlowTime').textContent=selectedTime.replace(':','.');
 const slots=Object.values(state?.schedule||{}),morning=slots.filter(Boolean),sameMorning=slots.length===14&&morning.length===7&&morning.every(v=>v===morning[0])&&validSlot(morning[0]);
 const interval=sameMorning?decodeSlot(morning[0]):null;
 $('morningFlowTime').textContent=interval?interval.start.replace(':','.')+'–'+interval.end.replace(':','.'):"By schedule";
 const nightReady=demo||moduleFresh&&nightReturnReady()&&state?.home?.clock_ready===true&&state?.home?.durable===true&&state?.home?.night_end_minute===night&&['ready','manual'].includes(state?.home?.status);
 $('nightEndStatus').dataset.status=nightDirty?'draft':nightReady?'ready':'waiting';
 $('nightEndStatus').textContent=nightDirty?"The new time is not saved yet.":demo?"Demo · this time does not change the real stove.":!state?.device?"Sign in and connect to the stove to change this setting.":!nightReturnReady()?"Update the module to use night transitions.":!moduleFresh?"Time saved. Waiting for the module connection.":state?.home?.status==='clock_not_ready'?"Waiting for the module clock.":state?.home?.status==='storage_unavailable'?"The module cannot persist this time.":state?.home?.status==='awaiting_off'?"Waiting for shutdown confirmation. The night transition is on hold.":state?.home?.status==='awaiting_confirmation'?"The change was sent. Waiting for confirmation from the stove.":state?.home?.night_end_minute!==night?"Time saved. The module is still receiving it.":"Ready · every day at "+selectedTime.replace(':','.');
 stockView.update({state,entries:demo?demoStockEntries:cloud.stockEntries,enabled:linked&&(demo||(route==='cloud'&&cloud.allowed)),fresh:linked,visible:demo||!!user||route==='local'});
 $('demoStockControls').hidden=!demo;$('demoHopper').textContent=demoState?.hopper?.open?"Close lid (demo)":"Open lid (demo)";
 $('demoAlertLabel').hidden=!demo;
 $('demoPhaseLabel').hidden=!demo;$('demoCycleLabel').hidden=!demo;
 $('googleSignInButton').style.pointerEvents=authBusy?'none':'';$('googleSignInButton').setAttribute('aria-busy',String(authBusy));
 $('demoNotice').hidden=!demo;$('loginCard').hidden=!!user||demo||route==='local';$('accountBar').hidden=!user||demo||route==='local';$('accountEmail').textContent=user?.email||'';$('signOut').disabled=busy||phone.busy;$('access').hidden=demo||!user||route!=='cloud';$('ownerAccess').hidden=!cloud.owner;$('personalAccessStatus').textContent=cloud.owner?"You own this stove connection.":cloud.allowed?"The owner has approved your access to stove controls.":"Wait for the owner to approve stove controls.";$('accessPending').hidden=demo||route!=='cloud'||!user||cloud.allowed;$('requestAccess').disabled=cloud.requested||busy;$('accessMessage').textContent=cloud.requested?"Request sent. Wait for the owner to approve access.":"Stove controls require the owner’s approval.";
 $('linkLabel').textContent=demo?'Demo':linked?"Connected":moduleFresh?"Waiting for stove":"Offline";$('linkDot').className='dot '+(demo?'demo':linked?'online':user||route==='local'?'offline':'');
 const status=stoveStatus(state,linked);$('stoveOverview').dataset.phase=status.phase;$('stoveOverview').classList.toggle('has-flame',status.animate);
 for(const [id,value] of [['stoveState',status.title],['stoveStateDetail',status.detail],['stateBadge',status.badge]])if($(id).textContent!==value)$(id).textContent=value;
 $('thermostatPanel').hidden=draft.mode!=='comfort';$('powerPanel').hidden=draft.mode!=='manual';
 $('targetValue').textContent=linked?fmt(draft.target_temperature):'—';$('dial').style.setProperty('--angle',linked?`${Math.max(0,Math.min(280,((draft.target_temperature-14)/14)*280))}deg`:'0deg');$('targetCaption').textContent=!linked?"Offline":busy?"Saving …":dirty?"Unsaved":"Saved";$('targetLabel').textContent="Target temperature";
 $('roomValue').textContent=linked?fmt(s.room_temperature,' °C'):'—';$('sensorNote').textContent=!linked?"Readings will be available once connected.":s.room_sensor_connected!==true?"The RIKA room sensor is not connected.":demo?"Sample data":"Reading from the RIKA room sensor";
 for(const e of document.querySelectorAll('[data-mode]')){const selected=linked&&e.dataset.mode===draft.mode;e.classList.toggle('chosen',selected);e.setAttribute('aria-pressed',String(selected));}
 for(const e of document.querySelectorAll('[data-write]'))e.disabled=!linked||busy;
 $('tempDown').disabled=!linked||busy||draft.mode!=='comfort'||draft.target_temperature<=14||s.room_sensor_connected!==true;$('tempUp').disabled=!linked||busy||draft.mode!=='comfort'||draft.target_temperature>=28||s.room_sensor_connected!==true;
 document.querySelector('[data-mode="comfort"]').disabled=!linked||busy||s.room_sensor_connected!==true;
 $('modeDescription').textContent={comfort:c.heating_times_active===true?"Comfort is currently restricted by the schedule. Saving removes the time restriction; the saved intervals remain unchanged.":"In Comfort mode, the stove maintains the target temperature regardless of the schedule.",manual:"The stove runs at your selected heating power.",auto:"Edit heating days and times. Save to confirm changes."}[draft.mode]||"Settings will be available once connected.";
 $('powerRange').disabled=!linked||busy||draft.mode==='comfort';$('powerRange').value=draft.power_percent||70;$('powerValue').textContent=linked?fmt(draft.power_percent):'—';
 const scheduleValid=scheduleEditor.render({visible:draft.mode==='auto',enabled:linked,busy});
 $('apply').disabled=!linked||busy||(!dirty&&!(draft.mode==='comfort'&&c.heating_times_active===true))||(draft.mode==='auto'&&!scheduleValid);$('apply').textContent=busy?"Waiting for the module …":draft.mode==='auto'?"Save schedule and settings":"Save settings";$('togglePower').disabled=!linked||busy||(!c.on&&(st.has_error!==false||st.state==='splitlog'));
 const offPending=state?.home?.status==='awaiting_off',returnPending=currentAbsence()?.active===true,manual=manualHeat(c),title=!linked?"Waiting for connection":!c.on||offPending||returnPending?"Home · prepare morning heating":manual?"End manual heating":"Heat now";
 $('togglePower').classList.toggle('is-on',linked&&!!c.on);$('togglePower').setAttribute('aria-label',title);$('powerTitle').textContent=title;
 $('powerHint').textContent=!linked?"Controls require fresh readings.":!c.on?"Enable “Home” mode and the morning schedule.":manual?"The stove returns to its morning schedule. Manage time away in the “Home Routine” tab.":"Comfort temporarily bypasses the schedule.";
 $('presenceHint').textContent=!linked?"Waiting for fresh stove readings.":!c.on?"Away · heating is off until your return.":manual?"Manual heating · "+manualNightNote():"Home · the morning schedule remains ready each day.";
 if(cycleCap()&&!managedCycle()){const title=c.on?"Switch off stove":"Switch on stove";$('powerTitle').textContent=linked?title:"Waiting for connection";$('togglePower').setAttribute('aria-label',title);$('presenceHint').textContent="Basic stove controls · Home Routine is disabled.";$('powerHint').textContent="Switching on or off uses the stove’s currently selected mode.";}
 const managed=managedCycle();$('modeOptions').hidden=false;document.querySelector('[data-mode="auto"]').hidden=false;$('modeDescription').hidden=false;
 $('apply').hidden=!dirty&&!(draft.mode==='comfort'&&!managed&&c.heating_times_active===true);
 if(managed){
  const paused=state?.home?.cycle?.manual_paused===true,away=currentAbsence()?.active===true,p=currentPlan(),night=cyclePhase()==='night';
  const stopped=paused||(!c.on&&(!night||p?.night_mode==='temperature'));
  const title=away?"Home · enable heating":stopped?(c.on?"Enable Home Routine":"Enable heating"):night?"Pause automatic heating":"Switch off heating";
  $('powerTitle').textContent=linked?title:"Waiting for connection";$('togglePower').setAttribute('aria-label',title);
  $('powerHint').textContent=paused?"A manual shutdown also pauses future automatic starts.":night?"The night routine applies until daytime Comfort starts.":c.mode==='manual'?"Manual power is selected. The night break remains in place.":"The stove maintains the selected temperature using the daily routine.";
  $('presenceHint').textContent=away?"Away · daytime heating is paused.":paused?"Home · the automatic routine is manually paused.":night?p?.night_mode==='frost'?"Home · night break, frost protection only.":"Home · maintaining the night temperature.":c.mode==='manual'?"Home · manual power "+fmt(c.power_percent,' %')+'.':"Home · daytime Comfort.";
  $('modeDescription').textContent=draft.mode==='auto'?"This is the stove’s built-in schedule. Saving asks you to disable Home Routine.":draft.mode==='manual'?"Manual power applies until the next transition of the active Home Routine. Saving does not cancel a manual shutdown.":"Comfort maintains your selected temperature. Set daytime hours and the night break in Home Routine.";
  $('togglePower').disabled=!linked||busy||state?.home?.cycle?.revision!==p?.revision||((paused||away)&&resume.disabled);
  if((paused||away)&&resume.reason)$('powerHint').textContent=resume.reason;
  if(state?.home?.cycle?.frost_running===true)$('presenceHint').textContent="Frost protection is active.";

 }


 $('lastUpdated').textContent=demo?"Demo data · "+new Date().toLocaleTimeString("en-GB"):sample?.updatedAt?"Last reading · "+new Date(sample.updatedAt).toLocaleTimeString("en-GB")+(linked?'':" · readings are stale"):"No readings";
 for(const [id,k,suffix] of [['metricRoom','room_temperature',' °C'],['metricFlame','combustion_temperature',' °C'],['metricPellets','pellets_total_kg',' kg'],['metricHours','pellet_hours',' h']])$(id).textContent=linked?fmt(s[k],suffix):'—';
 $('model').textContent=linked?(st.model_name||'—'):'—';$('firmware').textContent=linked?(st.mainboard_version||'—'):'—';$('bridgeVersion').textContent=moduleFresh?(state?.device?.version||'—'):'—';$('wifi').textContent=moduleFresh?fmt(state?.device?.wifi_rssi,' dBm'):'—';$('warning').textContent=linked?(stoveAlerts(st).filter(a=>a.kind==='warning').map(a=>a.title+' ('+a.code+')').join(' · ')||"No warning"):'—';
 $('connectionMessage').textContent=demo?"Demo is enabled. No commands are sent to the stove.":route==='local'?"You are using a local connection on your home network.":!user?"Sign in to view stove status.":linked?"The stove connection is ready.":moduleFresh?"The module is online. Waiting for its USB connection to the stove.":sample?"The module is unreachable, readings are stale, or the USB connection to the stove is not ready.":"Waiting for the first module readings.";$('demoButton').disabled=busy;$('exitDemo').hidden=!demo;$('connectButton').disabled=!local.available||busy;$('bridgeAddress').disabled=!local.available||busy;$('cloudButton').disabled=busy;$('demoButton').textContent=demo?"Reset demo":"Enable demo";
}
function edit(p){if(!isReady()||busy)return;draft={...draft,...p};dirty=true;render();}
async function command(patch,purpose='normal'){
 if(!isReady()||busy)return false;try{patch=validatePatch(patch);}catch(e){notify(e.message);return;}busy=true;render();
 try{
  const active=transport();
  const apply=async value=>{
   if(demo){
    if(value.cycle_action){demoState.home.cycle.manual_paused=value.cycle_action==='pause';const p=demoComfortPlan,phase=cyclePhase();demoState.controls.on=value.cycle_action==='resume'&&(phase==='day'||p.night_mode==='temperature');syncDemoCycle();state=demoState;return {status:'sent',confirmed:true};}
    const {schedule,...controls}=value;Object.assign(demoState.controls,controls);
    if(schedule){demoState.schedule={...schedule.slots};demoState.controls.heating_times_active=schedule.active;demoState.controls.setback_temperature=schedule.setback_temperature;}
    if('on'in value&&managedCycle())demoState.home.cycle.manual_paused=!value.on;
    if('on'in value)previewDemoPhase(value.on?(demoState.controls.heating_times_active?'standby':'ignition'):'burn_off');
    state=demoState;return {status:'sent',confirmed:true};
   }
   const sentAfter=active.now(),receipt=await active.command(value);
   if(receipt.status!=='sent')return {...receipt,confirmed:false};
   const deadline=Date.now()+12000;
   while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,1500));
    if(route==='local')await active.refresh();
    const next=active.sample;
    if(next?.updatedAt>sentAfter&&ready(next,active.connected,active.now())&&controlsMatch(next.state,value))return {status:'sent',confirmed:true};
   }
   return {status:'sent',confirmed:false};
  };
  const io={state:()=>demo?demoState:active.sample?.state,apply};
  const result=purpose==='home'||purpose==='resume'?await applyHome(purpose==='home',io):patch.mode==='comfort'?await applyComfort(patch,io):await apply(patch);
  if(demo&&result.confirmed){if(purpose==='home'||purpose==='resume')previewDemoPhase('standby');else if(patch.mode==='comfort'&&demoState.controls.on&&demoState.controls.heating_times_active===false)previewDemoPhase('ignition');}
  if(result.status==='sent'){
   dirty=false;if(patch.schedule||patch.mode==='comfort'||purpose!=='normal')scheduleEditor.reset(demo?demoState:active.sample?.state);
   notify(patch.cycle_action?(patch.cycle_action==='pause'?"Heating is manually switched off. Automatic starts are paused.":"The daily routine is enabled again."):demo?"Demo: the change is shown. No command was sent to the stove.":result.confirmed?(purpose==='home'||purpose==='resume'?"The morning schedule is ready.":patch.mode==='comfort'?"Comfort mode is confirmed."+' '+manualNightNote():"The module returned the requested values. Also check the stove’s state."):(result.reason||"Command sent, but the change is unconfirmed. Check the stove before trying again."));
  }else if(result.status==='rejected')notify(result.reason?"The module rejected the command: "+result.reason:"The module rejected the command.");
  else notify(result.reason||"The response is not confirmed. Check the stove before trying again.");
  if(result.confirmed&&purpose==='home'){if(demo){if(demoAbsencePlan)demoAbsencePlan=absenceEntry(demoAbsencePlan,{active:false,returnDate:demoAbsencePlan.returnDate},'demo',Date.now());}else if(route==='cloud'&&cloud.absencePlan?.active)await cloud.saveAbsence({active:false,returnDate:cloud.absencePlan.returnDate,confirmation:cloud.absencePlan.confirmation});}
  return result.confirmed;
 }catch(e){notify(e.message);return false;}finally{busy=false;if(!demo)adopt(transport().sample,transport().connected);else adopt(null,false);}
}
function confirmPower(purpose){
 if(!isReady()||busy)return;
 if(dirty){notify("First save the selected mode and settings.");return;}
 if(managedCycle())return confirmCyclePower();
 const c=state.controls;
 if(cycleCap()){const on=!c.on;confirmChoice(on?"Switch on the stove?":"Switch off the stove?",on?"The stove uses its selected mode and saved settings. Home Routine remains disabled.":"The stove shuts down normally. Frost protection remains enabled.",on?"Switch on stove":"Switch off stove").then(ok=>{if(ok)command({on});});return;}
 purpose=purpose||(!c.on||state?.home?.status==='awaiting_off'||currentAbsence()?.active===true?'home':manualHeat(c)?'resume':'manual');
 if(dirty){notify("First save your settings or read the stove state again.");return;}
 const title=purpose==='home'?"Enable “Home” mode?":purpose==='resume'?"End manual heating?":"Heat now?";
 $('confirmTitle').textContent=title;
 $('confirmText').textContent=(demo?'Demo: ':'')+(purpose==='home'?"The morning schedule is enabled. The stove remains on standby and heats during the saved hours.":purpose==='resume'?"The stove returns to its morning schedule. Outside scheduled intervals, the lower target temperature applies. Manage time away in the “Home Routine” tab.":"Comfort uses the saved temperature and temporarily bypasses the schedule."+' '+manualNightNote());
 $('confirmAction').textContent=purpose==='home'?"Home":purpose==='resume'?"End manual heating":"Heat now";
 const dialog=$('confirmDialog');dialog.returnValue='';dialog.showModal();dialog.addEventListener('close',()=>{if(dialog.returnValue==='confirm')command(purpose==='manual'?{mode:'comfort',target_temperature:c.target_temperature}:{mode:'comfort'},purpose==='manual'?'normal':purpose);},{once:true});
}
function confirmCyclePower(){
 const away=currentAbsence()?.active===true,resume=away||state?.home?.cycle?.manual_paused===true||(!state?.controls?.on&&(cyclePhase()==='day'||currentPlan()?.night_mode==='temperature'));
 const resumeCommands=resume?resumeHeatingCommands(state,currentPlan(),cyclePhase()):[],manualResume=resumeCommands.length>1;
 $('confirmTitle').textContent=resume?(manualResume?"Start manual heating?":"Enable daytime heating?"):"Manually switch off heating?";
 $('confirmText').textContent=resume?(manualResume?"The stove starts in Manual mode at "+fmt(resumeCommands[1].power_percent,' %')+". The configured night routine remains in place.":"The daily routine will be enabled again. During the night break, only frost protection remains active."):"The stove switches off and will not restart automatically the next morning. To resume, select “Enable heating”. Frost protection remains enabled.";
 $('confirmAction').textContent=resume?"Enable heating":"Switch off heating";
 const dialog=$('confirmDialog');dialog.returnValue='';dialog.showModal();dialog.addEventListener('close',async()=>{if(dialog.returnValue!=='confirm')return;try{if(resume&&away){if(demo)demoAbsencePlan=absenceEntry(demoAbsencePlan,{active:false,returnDate:demoAbsencePlan.returnDate},'demo',Date.now());else await cloud.saveAbsence({active:false,returnDate:cloud.absencePlan.returnDate,confirmation:cloud.absencePlan.confirmation});}await applyHeatingCommands(resume?resumeCommands:[{cycle_action:'pause'}],patch=>command(patch));}catch(e){notify(e.message);}},{once:true});
}
function confirmChoice(title,text,action){
 $('confirmTitle').textContent=title;$('confirmText').textContent=text;$('confirmAction').textContent=action;
 const dialog=$('confirmDialog');dialog.returnValue='';dialog.showModal();
 return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}
async function confirmPlanDisabled(revision){
 const deadline=Date.now()+15000;
 do{
  const plan=currentPlan(),cycle=state?.home?.cycle;
  if(isReady()&&plan?.revision===revision&&plan.enabled===false&&cycle?.revision===revision&&cycle.enabled===false&&cycle.durable===true)return true;
  if(plan&&plan.revision>revision)return false;
  if(demo)return false;
  await new Promise(resolve=>setTimeout(resolve,500));
 }while(Date.now()<deadline);
 return false;
}
async function saveNativeSettings(){
 if(busy||!isReady())return;
 const patch={mode:draft.mode};
 if(draft.mode==='comfort')patch.target_temperature=draft.target_temperature;else patch.power_percent=draft.power_percent;
 try{
  if(draft.mode==='auto')patch.schedule=scheduleEditor.value();
  if(draft.mode!=='auto'||!managedCycle())return await command(patch);
  if(!demo&&(route!=='cloud'||!cloud.allowed))throw Error("Use the online connection to disable Home Routine.");
  const plan=currentPlan();
  if(!await confirmChoice("Use the stove’s built-in schedule?","Home Routine will be disabled. The stove’s built-in schedule will apply. This change does not switch on a stove that is off.","Use built-in schedule"))return;
  if(!isReady()||busy||currentPlan()?.revision!==plan?.revision)throw Error("The state changed. Check the settings and try again.");
  busy=true;render();
  await handoffToNativeSchedule(patch,plan,true,{
   disable:async(value,revision)=>{if(demo){demoComfortPlan={...value,revision:revision+1};demoState.home.cycle={...demoState.home.cycle,enabled:false,revision:revision+1};render();}else await cloud.saveComfortPlan(value,revision);},
   confirmDisabled:confirmPlanDisabled,
   send:async value=>{busy=false;return command(value);}
  });
 }catch(e){notify(e.message);}finally{busy=false;adopt(transport().sample,transport().connected);}
}

function startDemo(){if(busy)return;demo=true;dirty=false;$('demoAlert').value='none';$('demoPhase').value='standby';demoState={version_ack:true,device:{version:'Demo',wifi_rssi:-51},stove:{model_name:'PARO',mainboard_version:'2.29',state:'standby',is_burning:false,has_error:false,warning_code:0},sensors:{room_temperature:20.4,room_sensor_connected:true,combustion_temperature:24,pellets_total_kg:2025,pellet_hours:1582},controls:{on:true,mode:'comfort',target_temperature:21,power_percent:70,heating_times_active:false,setback_temperature:16},schedule:demoSchedule().slots};demoState.device.capabilities={hopper_journal:true,home_profiles:true,home_night:true,comfort_cycle:true};demoState.home={night_end_minute:1380,clock_ready:true,status:'ready'};demoState.schedule=Object.fromEntries(Object.keys(demoState.schedule).map(k=>[k,k.endsWith('1')?7000800:0]));demoState.controls.heating_times_active=true;demoAshEntries={first:{at:Date.now()-86400000,kg:2005,hours:1572}};demoAbsencePlan=null;demoState.hopper={open:false,durable:true,sequence:0,events:{}};demoStockEntries={'manual-demo':refillEntry('full',30,{counter:2005,at:Date.now()-3600000},'demo',Date.now()-3600000)};demoComfortPlan={...DEFAULT_COMFORT_PLAN,enabled:true,revision:1};demoCyclePhase='day';state=demoState;syncDemoCycle();scheduleEditor.reset(state);draft={mode:'comfort',target_temperature:demoComfortPlan.day_temperature,power_percent:70};tab('control');render();}
function previewDemoPhase(phase){
 if(!demo)return;
 const fixture={standby:[true,false,24],heating:[true,true,480],ignition:[true,true,65],burn_off:[false,true,160],cleaning:[true,true,300],splitlog:[false,true,450],off:[false,false,24]}[phase];
 if(!fixture)return;
 const [on,is_burning,combustion_temperature]=fixture;Object.assign(demoState.stove,{state:phase,is_burning});demoState.controls.on=on;demoState.sensors.combustion_temperature=combustion_temperature;$('demoPhase').value=phase;render();
}
for(const e of document.querySelectorAll('[data-tab]'))e.onclick=()=>tab(e.dataset.tab);
for(const e of document.querySelectorAll('[data-mode]'))e.onclick=()=>{if(e.dataset.mode==='auto'&&draft.mode!=='auto')scheduleEditor.activate();edit({mode:e.dataset.mode});};
$('homeModeSummary').onclick=()=>tab('absence');$('resumeHomeMode').onclick=async()=>{const availability=resumeAvailability();if(availability.disabled){notify(availability.reason);return;}if(managedCycle())return confirmPower();if(!isReady()||busy||dirty)return;if(!await confirmChoice("Back home?","Your absence ends and the stove switches on with its current settings. Home Routine remains disabled.","Home · switch on stove"))return;if(!await command({on:true}))return;try{if(demo){demoAbsencePlan=absenceEntry(demoAbsencePlan,{active:false,returnDate:demoAbsencePlan?.returnDate||''},'demo',Date.now());render();}else await cloud.saveAbsence({active:false,returnDate:cloud.absencePlan?.returnDate||'',confirmation:cloud.absencePlan?.confirmation||'unknown'});}catch(e){notify(e.message);}};
$('discardHomeDraft').onclick=()=>{if(busy||!isReady())return;dirty=false;scheduleEditor.reset(state);draft=heatingDraft(state);render();};
$('connectionShortcut').onclick=()=>tab('settings');$('tempDown').onclick=()=>edit({target_temperature:Math.max(14,draft.target_temperature-1)});$('tempUp').onclick=()=>edit({target_temperature:Math.min(28,draft.target_temperature+1)});$('powerRange').oninput=e=>edit({power_percent:Number(e.target.value)});
$('apply').onclick=saveNativeSettings;$('togglePower').onclick=()=>confirmPower();
$('nightEnd').oninput=()=>{nightDirty=true;render();};$('saveNightEnd').onclick=async()=>{if(nightSaving)return;nightSaving=true;render();try{const [h,m]=$('nightEnd').value.split(':').map(Number),minute=h*60+m;if(!Number.isInteger(minute)||minute<0||minute>1439)throw Error("Choose a valid time.");if(demo){demoState.home={...demoState.home,night_end_minute:minute};}else await cloud.saveNightEnd(minute);nightDirty=false;notify("Night cutoff time saved.");}catch(e){notify(e.message);}finally{nightSaving=false;render();}};
$('demoAlert').onchange=()=>{if(!demo)return;const value=$('demoAlert').value;Object.assign(demoState.stove,{has_error:value==='error:512',error_code:value==='error:512'?512:0,error_sub:value==='error:512'?8:0,warning_code:value.startsWith('warning:')?Number(value.split(':')[1]):0});render();};
$('demoHopper').onclick=()=>{if(!demo)return;demoState.hopper.open=!demoState.hopper.open;if(!demoState.hopper.open){const seq=++demoState.hopper.sequence;demoState.hopper.events['dddddddddddddddd-'+seq]={seq,at:Date.now(),counter:demoState.sensors.pellets_total_kg};tab('control');}render();};
$('demoConsume').onclick=()=>{if(!demo)return;demoState.sensors.pellets_total_kg+=1;render();};
$('demoCyclePeriod').onchange=()=>{if(!demo)return;demoCyclePhase=$('demoCyclePeriod').value;if(!demoState.home.cycle?.manual_paused)demoState.controls.on=demoCyclePhase==='day'||demoComfortPlan.night_mode==='temperature';syncDemoCycle();adopt(null,false);};
$('demoPhase').onchange=()=>previewDemoPhase($('demoPhase').value);
$('demoButton').onclick=startDemo;$('exitDemo').onclick=()=>{demo=false;dirty=false;state=null;scheduleEditor.reset(transport().sample?.state);adopt(transport().sample,transport().connected);tab('control');};
async function refresh(silent=false){
 if(demo){state=demoState;render();if(!silent)notify("Demo readings refreshed.");return;}
 try{await transport().refresh();if(!silent)notify(isReady()?"Readings refreshed.":"Readings are stale or the stove is offline.");}catch(e){if(!silent)notify(e.message);}
}
$('refresh').onclick=()=>refresh();
$('cloudButton').onclick=()=>{if(busy)return;route='cloud';demo=false;dirty=false;scheduleEditor.reset(cloud.sample?.state);adopt(cloud.sample,cloud.connected);tab(user?'control':'settings');};
$('connectButton').onclick=async()=>{
 if(busy||!local.available)return;
 route='local';demo=false;dirty=false;state=null;scheduleEditor.reset(null);sample=null;connected=false;busy=true;render();$('localMessage').textContent="Connecting …";
 try{await local.connect($('bridgeAddress').value);$('bridgeAddress').value=local.address;$('localMessage').textContent=isReady()?"The stove connection is ready.":"The module is reachable. Waiting for its USB connection to the stove.";if(isReady())tab('control');}
 catch(e){$('localMessage').textContent=e.message;notify(e.message);}finally{busy=false;render();}
};$('modeHelp').onclick=()=>notify("Comfort maintains a target temperature. Manual uses your selected heating power. Schedule uses the stove’s built-in timetable. Home Routine separately manages daytime Comfort and the night break; edit its hours in its own tab. Saving basic settings does not switch on a stove that is off.");
$('signOut').onclick=async()=>{try{if(phone.enabled||phone.id)await phone.disable();await cloud.logout();}catch(e){notify(e.message);}};
for(const [id,action] of [['enableNotifications',()=>phone.enable()],['testNotification',()=>phone.test()],['disableNotifications',()=>phone.disable()]])$(id).onclick=()=>action().catch(e=>{phone.message=e.message;renderNotificationSettings();});
$('requestAccess').onclick=async()=>{try{await cloud.requestAccess();notify("Your request was sent to the owner.");}catch(e){notify(e.message);}};
$('shareLink').onclick=async()=>{try{await navigator.clipboard.writeText(location.origin);notify("App link copied.");}catch{notify("App link: "+location.origin);}};
function renderAccess(){
 for(const [name,entries,isRequest] of [['accessRequests',cloud.requests,true],['accessMembers',cloud.members,false]]){
  const container=$(name);container.replaceChildren();
  if(!Object.keys(entries).length){const note=document.createElement('p');note.className='muted';note.textContent=isRequest?"No new requests.":"Only you currently have access.";container.append(note);continue;}
  for(const [uid,entry] of Object.entries(entries)){
   const row=document.createElement('article');row.className='connection-card access-row';const email=document.createElement('p');email.textContent=entry.email;row.append(email);
   for(const [label,action] of (isRequest?[["Approve access",()=>cloud.approve(uid)],["Reject",()=>cloud.reject(uid)]]:[["Revoke access",()=>cloud.remove(uid)]])){
    const button=document.createElement('button');button.className='secondary';button.textContent=label;button.onclick=()=>{
     if(busy)return;const dialog=$('confirmDialog');$('confirmTitle').textContent=label+'?';$('confirmText').textContent=entry.email+(label==="Approve access"?" will be able to control the stove.":label==="Reject"?" · This request will be rejected.":" · This account will lose access to stove controls.");$('confirmAction').textContent=label;dialog.returnValue='';dialog.showModal();
     dialog.addEventListener('close',async()=>{if(dialog.returnValue!=='confirm')return;button.disabled=true;try{await action();notify("Access updated.");}catch(e){notify(e.message);button.disabled=false;}},{once:true});
    };row.append(button);
   }container.append(row);
  }
 }render();
}
render();cloud.init({statistics:()=>renderStatistics(),ash:()=>render(),stock:message=>{if(message)notify(message);render();},access:renderAccess,home:()=>{if(!dirty&&!busy&&route==='cloud'&&!demo)adopt(cloud.sample,cloud.connected);else render();},monitor:renderNotificationSettings,notifications:()=>phone.inspect(),account:u=>{user=u;if(u)$('authMessage').textContent='';phone.accountChanged(u);dirty=false;if(!demo)scheduleEditor.reset(null);render();},state:(s,c)=>{if(route==='cloud')adopt(s,c);},error:message=>{$('authMessage').textContent=message;$('signInReload').hidden=false;notify(message);}}).then(async()=>{
 render();
 await mountGoogleSignIn($('googleSignInButton'),cloud.config,token=>cloud.loginWithGoogleToken(token),{
   busy:value=>{authBusy=value;if(value){$('authMessage').textContent='';$('signInReload').hidden=true;}$('directSignInStatus').textContent=value?"Confirming sign-in …":'';render();},
   error:error=>{$('authMessage').textContent=authErrorMessage(error);$('signInReload').hidden=false;}
  });
 $('directSignInStatus').textContent='';
}).catch(e=>{cloud.initFailed=!cloud.configured;$('authMessage').textContent=e.code?authErrorMessage(e):e.message;$('signInReload').hidden=false;$('directSignInStatus').textContent='';render();});
local.init({state:(s,c)=>{if(route==='local')adopt(s,c);}}).then(available=>{if(available){$('bridgeAddress').value=local.address;$('localMessage').textContent="Enter the module address and select “Connect locally”. Connecting does not switch on the stove.";}render();});
{const view=new URLSearchParams(location.search).get('view');if(['control','status','statistics','absence','settings'].includes(view))tab(view);else if(view==='connect'||view==='access')tab('settings');}if(new URLSearchParams(location.search).get('demo')==='1')startDemo();setInterval(render,1000);setInterval(()=>{if(!document.hidden&&!busy&&route==='local'&&!demo&&local.sample)refresh(true);},5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)refresh(true);});

function appUpdateBlock({automatic=false}={}){
 if(busy||authBusy||nightSaving||phone.busy||comfortView.busy||stockView.busy||ashView.busy||absenceView.busy)return "Wait for the current operation to finish.";
 if(dirty||nightDirty||scheduleEditor.dirty||comfortView.dirty)return "First save or discard your changes.";
 if(document.querySelector('dialog[open],.stock-calibrate[open]'))return "First finish or close the open form.";
 if(automatic&&(Date.now()-lastInteraction<5000||document.activeElement?.matches('input,select,textarea,[contenteditable="true"]')))return "When you finish editing, select “Update app”.";
 return '';
}
function renderAppUpdate(){
 if(!appUpdates)return;
 const pending=!!appUpdates.available,reason=appUpdateBlock(),blocked=!!reason;
 const message=pending?(appUpdates.message.includes('internet')?appUpdates.message:"A new app version is available.")+(reason?' '+reason:''):appUpdates.message;
 $('appUpdateBanner').hidden=!pending;for(const id of ['appUpdateNotice','appUpdateStatus'])if($(id).textContent!==message)$(id).textContent=message;
 $('applyAppUpdate').disabled=blocked||appUpdates.checking;$('settingsAppUpdate').hidden=!pending;$('settingsAppUpdate').disabled=blocked||appUpdates.checking;$('checkAppUpdate').disabled=appUpdates.checking;
}
let updateStorage;try{updateStorage=sessionStorage;}catch{}
appUpdates=new AppUpdates({
 version:__PARO_RELEASE__.version,storage:updateStorage,requestedVersion:new URLSearchParams(location.search).get('_paro_release'),
 visible:()=>!document.hidden,block:appUpdateBlock,changed:renderAppUpdate,
 reload:version=>location.replace(releaseUrl(location.href,version,activeTab)),
 workerUpdate:async()=>{const registration=await navigator.serviceWorker?.getRegistration('/');await registration?.update();}
});
$('appVersion').textContent="Published "+new Intl.DateTimeFormat("en-GB",{timeZone:'Europe/Ljubljana',dateStyle:'medium',timeStyle:'short'}).format(new Date(__PARO_RELEASE__.builtAt))+' · '+__PARO_RELEASE__.version.slice(0,8);
$('checkAppUpdate').onclick=()=>appUpdates.check({manual:true});$('applyAppUpdate').onclick=$('settingsAppUpdate').onclick=()=>appUpdates.apply();
for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>{lastInteraction=Date.now();},{capture:true,passive:true});
watchAppUpdates(appUpdates);renderAppUpdate();

// Same structured read/stage helpers as the previous app. They never apply controls.
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_paro_state',description:'Read displayed stove state, freshness and demo flag. Does not send controls.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({demo,connected:isReady(),lastRead:sample?.updatedAt?new Date(sample.updatedAt).toISOString():null,state})});
 register({name:'stage_paro_temperature',description:'Stage a target temperature in the visible draft. Does not apply or start the stove.',inputSchema:{type:'object',properties:{temperature:{type:'integer',minimum:14,maximum:28}},required:['temperature'],additionalProperties:false},execute:input=>{if(!input||Object.keys(input).some(k=>k!=='temperature')||!Number.isInteger(input.temperature)||input.temperature<14||input.temperature>28)throw Error("Temperature must be a whole number from 14 to 28.");if(!isReady()||busy||state.sensors?.room_sensor_connected!==true)throw Error("Editing is unavailable.");edit({target_temperature:input.temperature,mode:'comfort'});return {demo,applied:false,draft:{...draft}};}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
