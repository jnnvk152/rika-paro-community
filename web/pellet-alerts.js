import {CAPACITY_KG,stockEstimate,pendingRefills,journalGap} from './pellet-stock.js';
export const PELLET_THRESHOLDS=[50,20,10];
export function pelletReading(sample,entries,now){
 const at=sample?.updatedAt;
 if(sample?.ready!==true||!Number.isFinite(at)||now-at< -2000||now-at>=30000)return {known:false,reason:'offline'};
 const state=sample.state||{};
 if(typeof state.hopper?.open!=='boolean'||state.hopper?.durable!==true)return {known:false,reason:'journal'};
 const estimate=stockEstimate(entries,state.sensors?.pellets_total_kg,pendingRefills(state,entries));
 if(state.hopper?.open===true)return {known:false,reason:'pending'};
 if(journalGap(state,entries))return {known:false,reason:'gap'};
 if(!['estimate','overflow'].includes(estimate.reason)||!Number.isFinite(estimate.kg))return {known:false,reason:estimate.reason};
 return {known:true,reason:'ready',kg:estimate.kg,percent:100*estimate.kg/CAPACITY_KG,at};
}
export function pelletThreshold(percent){return [10,20,50].find(level=>percent<level)||0;}
export function pelletMessage(reading,level,now){
 const kg=new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(reading.kg);
 return {title:`PARO · Pellet stock below ${level} %`,body:`Estimated stock: about ${new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(reading.percent)} % (${kg} kg). Check the hopper and add pellets if needed.`,tag:'paro-pellet-stock',at:now,data:{view:'control'}};
}
export function pelletAlert(sample,entries,now){
 const reading=pelletReading(sample,entries,now);if(!reading.known)return null;
 const level=pelletThreshold(reading.percent);if(!level)return null;
 const value=pelletMessage(reading,level,now);
 return {id:'pellets:'+level,kind:'warning',pelletLevel:level,title:value.title.slice(7),code:`Estimate: ${new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(reading.percent)} % · ${new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(reading.kg)} kg`,message:"Check the hopper and add pellets if needed."};
}
// A mask records the thresholds already announced in the current depletion.
// Unknown readings hold delivery; only a confirmed level above a threshold rearms it.
export function observePellets(previous,reading,now){
 const old=previous||{},state={version:1,fired:old.fired||0,sequence:old.sequence||0,eventLevel:old.eventLevel||0,eventAt:old.eventAt||0,pending:old.pending===true,delivered:old.delivered||{},lastTest:old.lastTest||'',lease:'',leaseUntil:0,checkedAt:{'.sv':'timestamp'}};
 if(!reading.known)return state;
 for(const [i,level] of PELLET_THRESHOLDS.entries())if(reading.percent>=level)state.fired&=~(1<<i);
 if(state.pending&&reading.percent>=state.eventLevel)state.pending=false;
 const candidate=[10,20,50].find(level=>reading.percent<level&&!(state.fired&(1<<PELLET_THRESHOLDS.indexOf(level))));
 if(candidate&&(!state.pending||candidate<state.eventLevel)){
  state.sequence++;state.eventLevel=candidate;state.eventAt=now;state.pending=true;state.delivered={};
  for(const [i,level] of PELLET_THRESHOLDS.entries())if(level>=candidate)state.fired|=1<<i;
 }
 return state;
}
