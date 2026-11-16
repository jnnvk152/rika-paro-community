export const RETENTION_DAYS=1827;
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Ljubljana',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(at){return Object.fromEntries(calendar.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function offset(at){const p=parts(at);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(at/1000)*1000;}
function midnight(year,month,day){const wall=Date.UTC(year,month-1,day);let at=wall-offset(wall);for(let i=0;i<2;i++)at=wall-offset(at);return at;}
export function dayBounds(at){const p=parts(at),next=new Date(Date.UTC(p.year,p.month-1,p.day+1));return {date:`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`,startAt:midnight(p.year,p.month,p.day),endAt:midnight(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate())};}
export function dayKey(at){const p=parts(at);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
export function shiftDay(date,amount){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
export function rangeDates(end,count){return Array.from({length:count},(_,i)=>shiftDay(end,i-count+1));}
export function duration(ms){const minutes=Math.round(ms/60000);return minutes>=60?`${Math.floor(minutes/60)} h`+(minutes%60?` ${minutes%60} min`:''):`${minutes} min`;}
export function summarizeDays(records){return Object.values(records||{}).reduce((a,d)=>{for(const key of ['kg','pelletMs','woodMs','transitionMs','missingMs','counterHours'])a[key]+=Number(d[key])||0;return a;},{kg:0,pelletMs:0,woodMs:0,transitionMs:0,missingMs:0,counterHours:0});}
export function statisticsCsv(records){
 const header="Date;Pellets used (kg);Pellet burning (min, estimated);Wood burning (min, estimated);Ignition and cooling (min, estimated);Missing readings (min);Pellet-hour counter change (h);Partial day";
 return '\uFEFF'+[header,...Object.entries(records||{}).sort(([a],[b])=>a.localeCompare(b)).map(([date,d])=>[date,d.kg,Math.round(d.pelletMs/60000),Math.round(d.woodMs/60000),Math.round(d.transitionMs/60000),Math.round(d.missingMs/60000),d.counterHours,d.partial?"yes":"no"].join(';'))].join('\r\n');
}
