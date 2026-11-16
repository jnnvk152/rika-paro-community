export const DEFAULT_COMFORT_PLAN=Object.freeze({version:1,enabled:false,day_start_minute:360,night_start_minute:1260,day_temperature:20,night_mode:'frost',night_temperature:16,frost_temperature:5});
export function validateComfortPlan(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error("Check Comfort settings.");
 const p=Object.fromEntries(Object.keys(DEFAULT_COMFORT_PLAN).map(k=>[k,value[k]]));
 if(p.version!==1||typeof p.enabled!=='boolean'||!['frost','temperature'].includes(p.night_mode))throw Error("Choose a valid night routine.");
 for(const [key,min,max] of [['day_start_minute',0,1439],['night_start_minute',0,1439],['day_temperature',14,28],['night_temperature',14,28],['frost_temperature',4,10]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw Error("Check times and temperatures.");
 if(p.day_start_minute>=p.night_start_minute)throw Error("Daytime Comfort must start before the night routine.");
 return p;
}
export function comfortPeriod(plan,now=Date.now()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Ljubljana',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const n=kind=>Number(parts.find(p=>p.type===kind).value),minute=n('hour')*60+n('minute');
 return minute>=plan.day_start_minute&&minute<plan.night_start_minute?'day':'night';
}
export function cycleEnabled(state,plan){return state?.device?.capabilities?.comfort_cycle===true&&state?.home?.cycle?.enabled===true&&plan?.enabled===true&&state.home.cycle.revision===plan.revision;}
export const timeLabel=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
