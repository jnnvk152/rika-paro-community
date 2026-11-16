import {initializeApp} from 'firebase/app';
import {initializeAuth, indexedDBLocalPersistence, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence} from 'firebase/auth';
import {getDatabase, ref, onValue, get, set, update, serverTimestamp, query, orderByKey, startAt, endAt,runTransaction} from 'firebase/database';
import {buildCommand} from './domain.js';
import {consumeSignInIntent,choosePersistence,authStep} from './auth-flow.js';
import {refillEntry,hopperEvents} from './pellet-stock.js';
import {absenceEntry,completedAbsenceEntry,effectiveAbsence} from './absence.js';
import {validateComfortPlan} from './comfort-plan.js';

export class Cloud {
  connected=false; sample=null; offset=0; user=null; stops=[]; dataStops=[]; configured=false;
  notificationConfig=null;watchConfig=null;watchStatus=null;absencePlan=null;homeConfig=null;comfortPlan=null;
  stockEntries={};ashEntries={};statisticsDays={};statisticsStatus=null;statisticsLoading=false;statisticsError='';statisticsStops=[];statisticsRange=null;
  owner=false; allowed=false; members={}; requests={}; requested=false; generation=0;
  returnClosing=null;returnCloseAttemptAt=-Infinity;
  access(){this.callbacks.access?.({owner:this.owner,allowed:this.allowed,members:this.members,requests:this.requests,requested:this.requested});}
  allow(value){
    this.stopStatistics(true);
    for(const stop of this.dataStops)stop();this.dataStops=[];
    this.allowed=value;this.sample=null;this.stockEntries={};this.ashEntries={};this.callbacks.stock?.();this.notificationConfig=null;this.watchConfig=null;this.watchStatus=null;this.absencePlan=null;this.homeConfig=null;this.comfortPlan=null;this.callbacks.state(null,false);this.access();
    if(!value){this.callbacks.notifications?.();return;}
    if(this.statisticsRange)this.watchStatistics(...this.statisticsRange);
    this.dataStops.push(onValue(ref(this.db,'absencePlans/'+this.deviceId),s=>{this.absencePlan=s.val();this.callbacks.home?.();void this.finishScheduledReturn().catch(()=>{});},()=>{this.absencePlan=null;this.callbacks.home?.();}));
    this.dataStops.push(onValue(ref(this.db,'comfortPlan/'+this.deviceId),s=>{this.comfortPlan=s.val();this.callbacks.home?.();},()=>{this.comfortPlan=null;this.callbacks.home?.();}));
    this.dataStops.push(onValue(ref(this.db,'homeConfig/'+this.deviceId),s=>{this.homeConfig=s.val();this.callbacks.home?.();},()=>{this.homeConfig=null;this.callbacks.home?.();}));
    this.dataStops.push(onValue(ref(this.db,'watchdogConfig/'+this.deviceId),s=>{this.watchConfig=s.val();this.callbacks.monitor?.();},()=>{this.watchConfig=null;this.callbacks.monitor?.();}));
    this.dataStops.push(onValue(ref(this.db,'watchdogStatus/'+this.deviceId),s=>{this.watchStatus=s.val();this.callbacks.monitor?.();},()=>{this.watchStatus=null;this.callbacks.monitor?.();}));
    this.dataStops.push(onValue(ref(this.db,`notificationConfig/${this.deviceId}`),s=>{this.notificationConfig=s.val();this.callbacks.notifications?.();},()=>{this.notificationConfig=null;this.callbacks.notifications?.();}));
    this.dataStops.push(onValue(ref(this.db,`devices/${this.deviceId}/telemetry`),s=>{this.sample=s.val();this.callbacks.state(this.sample,this.connected);void this.finishScheduledReturn().catch(()=>{});},()=>{this.sample=null;this.callbacks.error("Stove access has been interrupted.");this.callbacks.state(null,false);}));
    this.dataStops.push(onValue(ref(this.db,`ashEmptyings/${this.deviceId}`),s=>{this.ashEntries=s.val()||{};this.callbacks.ash?.();},()=>{this.ashEntries={};this.callbacks.ash?.();}));
    this.dataStops.push(onValue(ref(this.db,`pelletStock/${this.deviceId}`),s=>{this.stockEntries=s.val()||{};this.callbacks.stock?.();},()=>{this.stockEntries={};this.ashEntries={};this.callbacks.stock?.("The pellet log could not be read.");}));
  }
  now=()=>Date.now()+this.offset;
  async init(callbacks) {
    this.callbacks=callbacks;
    let config;
    for (const path of ['/firebase-config.json','/__/firebase/init.json']) {
      try {const r=await fetch(path,{cache:'no-store'});if(r.ok){const data=await r.json();if(data.apiKey&&data.projectId&&data.databaseURL){config=data;break;}}} catch {}
    }
    if(!config) throw Error("Firebase is not configured yet. Try the demo in Settings.");
    this.app=initializeApp(config);this.auth=initializeAuth(this.app,{persistence:[browserLocalPersistence,browserSessionPersistence,indexedDBLocalPersistence]});this.db=getDatabase(this.app);this.config=config;
    this.deviceId=config.deviceId||'paro';
    const intent=consumeSignInIntent(location.href);
    if(intent.requested)history.replaceState(history.state,'',intent.cleanUrl);
    this.persistence=await authStep('storage',()=>choosePersistence(value=>setPersistence(this.auth,value),[['local',browserLocalPersistence],['session',browserSessionPersistence],['memory',inMemoryPersistence]]));
    onValue(ref(this.db,'.info/serverTimeOffset'),s=>{this.offset=Number(s.val())||0;});
    onAuthStateChanged(this.auth,async user=>{
      const generation=++this.generation;this.stopStatistics(true);
      for(const stop of [...this.stops,...this.dataStops])stop();this.stops=[];this.dataStops=[];
      this.user=user;this.sample=null;this.stockEntries={};this.ashEntries={};this.notificationConfig=null;this.watchConfig=null;this.watchStatus=null;this.absencePlan=null;this.homeConfig=null;this.comfortPlan=null;this.connected=false;this.owner=false;this.allowed=false;this.members={};this.requests={};this.requested=false;
      callbacks.account(user);callbacks.state(null,false);this.access();
      if(!user)return;
      this.stops.push(onValue(ref(this.db,'.info/connected'),s=>{this.connected=s.val()===true;callbacks.state(this.sample,this.connected);}));
      // The server grants this read only to the owner. No owner email is exposed
      // in the public web configuration, and the rules remain authoritative.
      let owner=false;try{await get(ref(this.db,'ownerCheck'));owner=true;}catch{}
      if(generation!==this.generation)return;
      this.owner=owner;
      if(owner){
        this.allow(true);
        this.stops.push(onValue(ref(this.db,'members'),s=>{this.members=s.val()||{};this.access();}));
        this.stops.push(onValue(ref(this.db,'accessRequests'),s=>{this.requests=s.val()||{};this.access();}));
      }else{
        this.stops.push(onValue(ref(this.db,`members/${user.uid}`),s=>this.allow(s.val()?.enabled===true)));
        this.stops.push(onValue(ref(this.db,`accessRequests/${user.uid}`),s=>{this.requested=s.exists();this.access();}));
      }
    });
    this.configured=true;
  }
  stopStatistics(clear=false){
    for(const stop of this.statisticsStops)stop();this.statisticsStops=[];
    if(clear){this.statisticsDays={};this.statisticsStatus=null;this.statisticsLoading=false;this.statisticsError='';this.callbacks?.statistics?.();}
  }
  watchStatistics(from,to){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw Error("Check the statistics period.");
    this.statisticsRange=[from,to];this.stopStatistics();this.statisticsDays={};this.statisticsError='';
    if(!this.configured||!this.allowed){this.statisticsLoading=false;this.callbacks?.statistics?.();return;}
    this.statisticsLoading=true;this.callbacks.statistics?.();
    const fail=()=>{this.statisticsLoading=false;this.statisticsError="Statistics could not be read at the moment.";this.callbacks.statistics?.();};
    this.statisticsStops.push(onValue(query(ref(this.db,'statistics/'+this.deviceId+'/days'),orderByKey(),startAt(from),endAt(to)),s=>{this.statisticsDays=s.val()||{};this.statisticsLoading=false;this.callbacks.statistics?.();},fail));
    this.statisticsStops.push(onValue(ref(this.db,'statistics/'+this.deviceId+'/status'),s=>{this.statisticsStatus=s.val();this.callbacks.statistics?.();},fail));
  }
  async loginWithGoogleToken(token){
    if(!this.configured)throw Error("Firebase is not configured yet.");
    return authStep('credential',()=>signInWithCredential(this.auth,GoogleAuthProvider.credential(token)));
  }
  async logout(){await signOut(this.auth);}
  async requestAccess(){
    if(!this.user?.emailVerified)throw Error("Sign in with a verified Google account.");
    await set(ref(this.db,`accessRequests/${this.user.uid}`),{email:this.user.email,createdAt:serverTimestamp()});
  }
  async approve(uid){
    if(!this.owner||!this.requests[uid]?.email)throw Error("This request is unavailable.");
    await update(ref(this.db),{[`members/${uid}`]:{email:this.requests[uid].email,enabled:true,createdAt:serverTimestamp()},[`accessRequests/${uid}`]:null});
  }
  async remove(uid){if(!this.owner)throw Error("Only the owner can change access.");await set(ref(this.db,`members/${uid}`),null);}
  async reject(uid){if(!this.owner)throw Error("Only the owner can change access.");await set(ref(this.db,`accessRequests/${uid}`),null);}
  async refresh(){
    if(!this.configured||!this.user)throw Error("Sign in first.");
    if(!this.allowed)throw Error("The owner has not approved your access yet.");
    if(!this.connected)throw Error("The Firebase connection is interrupted.");
    const snapshot=await get(ref(this.db,`devices/${this.deviceId}/telemetry`));
    this.sample=snapshot.val();this.callbacks.state(this.sample,this.connected);return this.sample;
  }
  async saveAbsence(value,expectedRevision){
    if(!this.user||!this.allowed||!this.connected)throw Error("Sign-in and internet access are required for an absence plan.");
    if(expectedRevision!==undefined&&(this.absencePlan?.revision||0)!==expectedRevision)throw Error("The plan changed on another device. Check the new date.");
    const before=this.absencePlan?.revision||0,closed=await this.finishScheduledReturn(true);
    if(closed&&expectedRevision===before)expectedRevision=closed.revision;
    if(expectedRevision!==undefined&&(this.absencePlan?.revision||0)!==expectedRevision)throw Error("The plan changed on another device. Check the new date.");
    const entry=absenceEntry(this.absencePlan,value,this.user.uid,this.now());entry.updatedAt=serverTimestamp();
    await set(ref(this.db,'absencePlans/'+this.deviceId),entry);
  }
  async finishScheduledReturn(force=false){
    if(this.returnClosing)return this.returnClosing;
    const at=this.sample?.updatedAt,now=this.now(),state=this.sample?.state,uid=this.user?.uid,generation=this.generation;
    if(!uid||!this.allowed||!this.connected||this.sample?.ready!==true||!Number.isFinite(at)||now-at< -2000||now-at>=30000||this.absencePlan?.active!==true||effectiveAbsence(this.absencePlan,state)?.active!==false||!force&&now-this.returnCloseAttemptAt<30000)return null;
    this.returnCloseAttemptAt=now;
    // Only reconcile the presence record after a matching physical control echo.
    // The transaction never sends heater commands and cannot overwrite a new date.
    const operation=runTransaction(ref(this.db,'absencePlans/'+this.deviceId),current=>{
      if(this.generation!==generation||this.user?.uid!==uid||!this.allowed)return;
      const entry=completedAbsenceEntry(current,state,uid,this.now());
      return entry?{...entry,updatedAt:serverTimestamp()}:undefined;
    },{applyLocally:false}).then(result=>{
      if(!result.committed)return null;const closed=result.snapshot.val();
      if(this.generation===generation&&(this.absencePlan?.revision||0)<=closed.revision){this.absencePlan=closed;this.callbacks.home?.();}
      return closed;
    }).finally(()=>{if(this.returnClosing===operation)this.returnClosing=null;});
    this.returnClosing=operation;return operation;
  }
  async saveComfortPlan(value,expectedRevision){
    if(!this.user||!this.allowed||!this.connected)throw Error("Sign in and connect to the internet to save.");
    if(expectedRevision!==undefined&&(this.comfortPlan?.revision||0)!==expectedRevision)throw Error("Settings changed on another device. Check the new values.");
    const plan=validateComfortPlan(value);
    if(plan.enabled&&this.sample?.state?.sensors?.room_sensor_connected===false)throw Error("Comfort requires a connected RIKA room sensor.");
    await set(ref(this.db,'comfortPlan/'+this.deviceId),{...plan,revision:(this.comfortPlan?.revision||0)+1,updatedAt:serverTimestamp(),uid:this.user.uid});
  }
  async saveNightEnd(minute){
    if(!this.user||!this.allowed||!this.connected||!Number.isInteger(minute)||minute<0||minute>1439)throw Error("Check the clock and internet connection.");
    await set(ref(this.db,'homeConfig/'+this.deviceId),{night_end_minute:minute,updatedAt:serverTimestamp(),uid:this.user.uid});
  }
  async recordAsh(){
    await this.refresh();
    const s=this.sample?.state?.sensors,age=this.now()-this.sample?.updatedAt;
    if(!this.sample?.ready||age< -2000||age>=30000||!Number.isFinite(s?.pellets_total_kg)||!Number.isFinite(s?.pellet_hours))throw Error("Wait for fresh stove counters before logging this.");
    await set(ref(this.db,`ashEmptyings/${this.deviceId}/${crypto.randomUUID()}`),{at:serverTimestamp(),recordedAt:serverTimestamp(),sampleAt:this.sample.updatedAt,kg:s.pellets_total_kg,hours:s.pellet_hours,source:'app',uid:this.user.uid});
  }
  async recordRefill(kind,kg,eventId){
    await this.refresh();
    if(!this.sample?.ready||this.now()-this.sample.updatedAt>=30000)throw Error("Wait for fresh stove readings before confirming.");
    const event=eventId?hopperEvents(this.sample.state).find(e=>e.id===eventId):null;
    if(eventId&&!event)throw Error("This lid event is no longer in the module’s journal. Correct the current amount instead.");
    if(event&&!event.at&&kind!=='unknown')throw Error("The event time is unknown. Mark it as unknown, then set the current amount.");
    const point=event||{counter:this.sample.state?.sensors?.pellets_total_kg,at:this.now()};
    const entry=refillEntry(kind,kg,{...point,at:point.at||this.now()},this.user.uid,serverTimestamp());
    if(!event||!event.at)entry.at=serverTimestamp();
    const id=eventId||'manual-'+crypto.randomUUID();
    try{await set(ref(this.db,`pelletStock/${this.deviceId}/${id}`),entry);}
    catch(error){if(eventId&&(await get(ref(this.db,`pelletStock/${this.deviceId}/${id}`))).exists())throw Error("This lid event was already confirmed on another device.");throw error;}
  }
  async command(patch) {
    const command=buildCommand(patch,this.sample,this.connected,this.now(),crypto.randomUUID());
    if(!this.user||!this.allowed)throw Error("You do not have access to the stove.");
    command.issuedAt=serverTimestamp();
    // No command queue or retry: one short-lived, session-bound request.
    let finishResponse;
    const response=new Promise(resolve=>{
      let timer,stop=()=>{};const finish=value=>{clearTimeout(timer);stop();resolve(value);};
      finishResponse=finish;
      timer=setTimeout(()=>finish({status:'unknown',reason:"No receipt arrived. Check the stove before trying again."}),16000);
      stop=onValue(ref(this.db,`devices/${this.deviceId}/receipt`),s=>{const r=s.val();if(r?.id===command.id)finish(r);},()=>finish({status:'unknown',reason:"The command receipt could not be read."}));
    });
    let sendTimer;
    try{
      await Promise.race([set(ref(this.db,`devices/${this.deviceId}/command`),command),new Promise((_,reject)=>{sendTimer=setTimeout(()=>reject(Error('offline')),8000);})]);
    }catch{finishResponse({status:'unknown'});throw Error("Command unconfirmed. Check the stove before trying again.");}
    finally{clearTimeout(sendTimer);}
    return response;
  }
}
