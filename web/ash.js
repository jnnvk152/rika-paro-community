// PARO's manual specifies regular ash-drawer emptying, without a kg/hour limit.
// A learned interval is a reminder to inspect, never a measurement of fullness.
export function ashReading(sample,entries,now=Date.now()){
 const events=Object.entries(entries||{}).filter(([,v])=>Number.isFinite(v?.at)&&v.at>0&&v.at<=now&&Number.isFinite(v.kg)&&v.kg>=0&&Number.isFinite(v.hours)&&v.hours>=0).sort((a,b)=>a[1].at-b[1].at||a[0].localeCompare(b[0]));
 const [id,last]=events.at(-1)||[],prior=events.at(-2)?.[1];
 const base={known:false,reason:'initial',last:last||null,count:events.length,cycle:id||'',due:false};
 if(!last)return base;
 const s=sample?.state?.sensors,age=now-sample?.updatedAt;
 if(sample?.ready!==true||!Number.isFinite(age)||age< -2000||age>=30000)return {...base,reason:'offline'};
 if(!Number.isFinite(s?.pellets_total_kg)||!Number.isFinite(s?.pellet_hours))return {...base,reason:'counter'};
 const usedKg=s.pellets_total_kg-last.kg,usedHours=s.pellet_hours-last.hours;
 if(usedKg<0||usedHours<0)return {...base,reason:'reset'};
 const intervalKg=prior?last.kg-prior.kg:0,intervalHours=prior?last.hours-prior.hours:0;
 if(intervalKg<0||intervalHours<0)return {...base,reason:'reset',usedKg,usedHours};
 const basis=intervalKg>0?'kg':intervalHours>0?'hours':null;
 if(!basis)return {...base,reason:'learning',usedKg,usedHours};
 const interval=basis==='kg'?intervalKg:intervalHours,used=basis==='kg'?usedKg:usedHours;
 return {...base,known:true,reason:'ready',usedKg,usedHours,intervalKg,intervalHours,basis,interval,used,progress:used/interval,due:used>=interval};
}
export function ashMessage(r,now=Date.now()){
 const n=v=>new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}).format(v);
 return {title:"PARO · Check the ash drawer",body:`Since the last emptying, the stove has used ${n(r.usedKg)} kg of pellets (${n(r.usedHours)} h). Consumption has reached the previous interval. Check the drawer and empty it if necessary once the stove is cold.`,tag:'paro-ash-drawer',at:now,data:{view:'status'}};
}
export function ashAlert(r){return r.known&&r.due?{kind:'warning',title:"Check ash drawer",code:"Estimate based on the previous emptying",message:ashMessage(r).body}:null;}
