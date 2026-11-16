import {dayBounds,dayKey,RETENTION_DAYS} from '../web/statistics.js';
import {isWoodState} from '../web/stove-status.js';
export const MAX_GAP=180000;
const validCounter=n=>Number.isInteger(n)&&n>=0&&n<=1e9;
export function sampleKind(state){
 const s=state?.stove;
 if(s?.has_error!==false)return 'missing';
 if(isWoodState(s.state))return s.is_burning===true?'wood':'missing';
 if(['heating','regulation','start','flame_start'].includes(s.state))return s.is_burning===true?'pellet':'missing';
 if(['ignition','burnoff','burn_off','cleaning','splitlog_check'].includes(s.state))return 'transition';
 return ['off','standby'].includes(s.state)?'idle':'missing';
}
function fresh(sample,now){return sample?.ready===true&&sample.state?.version_ack===true&&Number.isFinite(sample.updatedAt)&&now-sample.updatedAt>=-2000&&now-sample.updatedAt<30000&&validCounter(sample.state?.sensors?.pellets_total_kg)&&validCounter(sample.state?.sensors?.pellet_hours);}
function newDay(now,partial){return {...dayBounds(now),firstAt:now,observedAt:now,kg:0,counterHours:0,boundaryKg:0,pelletMs:0,woodMs:0,transitionMs:0,idleMs:0,missingMs:0,resets:0,partial};}
function interval(day,from,to,kind){const elapsed=Math.max(0,Math.min(to,day.endAt)-Math.max(from,day.startAt));day[kind+'Ms']+=elapsed;if(kind==='missing'&&elapsed>0)day.partial=true;day.observedAt=to;}
// One minute is one observation, not a retained raw sample. Counter differences
// across outages remain unassigned rather than inventing their day of use.
export function observeStatistics(previous,sample,now){
 if(!Number.isFinite(now)||now<1700000000000)return null;
 const tick=Math.floor(now/60000),valid=fresh(sample,now),kind=valid?sampleKind(sample.state):'missing';
 if(previous&&(previous.version!==1||tick<=previous.tick||now<=previous.at))return null;
 let r=previous?structuredClone(previous):{version:1,startedAt:now,tick,at:now,lastKind:kind,lastReady:valid,lastCounter:null,gap:!valid,unassignedKg:0,unassignedHours:0,resets:0,pending:{},day:newDay(now,now-dayBounds(now).startAt>90000)};
 r.pending??={};
 if(previous){
  const continuous=now-r.at<=MAX_GAP&&r.lastReady&&valid&&r.lastKind!=='missing'&&kind!=='missing';
  const intervalKind=continuous?r.lastKind:'missing';
  if(dayKey(now)!==r.day.date){
   if(Object.keys(r.pending).length>=7)return null;
   interval(r.day,r.at,now,intervalKind);r.pending[r.day.date]=r.day;
   r.day=newDay(now,!continuous||now-dayBounds(now).startAt>MAX_GAP);
  }
  interval(r.day,r.at,now,intervalKind);
  if(!continuous)r.gap=true;
 }
 if(valid){
  const counter={at:sample.updatedAt,kg:sample.state.sensors.pellets_total_kg,hours:sample.state.sensors.pellet_hours};
  if(r.lastCounter&&counter.at>r.lastCounter.at){
   const elapsed=counter.at-r.lastCounter.at,kg=counter.kg-r.lastCounter.kg,hours=counter.hours-r.lastCounter.hours;
   if(kg<0||hours<0||kg>elapsed/3600000*4+1.5||hours>Math.ceil(elapsed/3600000)+1){r.resets++;r.day.resets++;r.day.partial=true;}
   else if(r.gap||elapsed>MAX_GAP){r.unassignedKg+=kg;r.unassignedHours+=hours;r.day.partial=true;}
   else{
    const target=dayKey(counter.at)===r.day.date?r.day:r.pending[dayKey(counter.at)];
    if(target){target.kg+=kg;target.counterHours+=hours;if(dayKey(counter.at)!==dayKey(r.lastCounter.at))target.boundaryKg+=kg;target.observedAt=now;}
    else{r.unassignedKg+=kg;r.unassignedHours+=hours;}
   }
  }
  // Never move the counter cursor backwards after an out-of-order response.
  if(!r.lastCounter||counter.at>r.lastCounter.at){r.lastCounter=counter;r.gap=false;}
 }
 r.tick=tick;r.at=now;r.lastKind=kind;r.lastReady=valid;
 return r;
}
export function statisticsStatus(r){return {version:1,startedAt:r.startedAt,observedAt:r.at,lastValidAt:r.lastCounter?.at||0,online:r.lastReady,unassignedKg:r.unassignedKg,unassignedHours:r.unassignedHours,resets:r.resets,retentionDays:RETENTION_DAYS,pollSeconds:60};}
