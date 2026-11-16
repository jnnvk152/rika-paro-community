export const CAPACITY_KG=30;
const counter=value=>Number.isFinite(value)&&value>=0&&value<=1e9;
export function hopperEvents(state){
 return Object.entries(state?.hopper?.events||{}).filter(([id,e])=>/^[a-f0-9]{16}-[0-9]+$/.test(id)&&counter(e?.counter)&&Number.isFinite(e?.at)&&e.at>=0&&Number.isInteger(e.seq)&&e.seq>0).map(([id,e])=>({id,...e})).sort((a,b)=>a.seq-b.seq);
}
export function pendingRefills(state,entries){return hopperEvents(state).filter(e=>!entries?.[e.id]);}
export function journalGap(state,entries){
 const first=hopperEvents(state)[0];if(!first||first.seq===1)return false;
 const calibration=Object.values(entries||{}).filter(e=>e.kind==='full'||e.kind==='remaining').sort((a,b)=>b.at-a.at)[0];
 if(calibration&&calibration.at>=first.at&&first.at>0)return false;
 const prefix=first.id.slice(0,17),answeredBefore=Object.keys(entries||{}).filter(id=>id.startsWith(prefix)&&Number(id.slice(17))<first.seq).length;
 return answeredBefore<first.seq-1;
}
export function stockEstimate(entries,total,pending=[]){
 let kg=null,previous=null,reset=false,overflow=false;
 const ordered=Object.values(entries||{}).filter(e=>counter(e.counter)&&Number.isFinite(e.at)).sort((a,b)=>a.at-b.at||a.recordedAt-b.recordedAt);
 for(const e of ordered){
  if(previous!==null&&e.counter<previous){kg=null;reset=true;}
  if(kg!==null&&previous!==null)kg=Math.max(0,kg-Math.max(0,e.counter-previous));
  if(e.kind==='full'||e.kind==='remaining'){kg=e.kind==='full'?CAPACITY_KG:e.kg;reset=false;overflow=false;}
  else if(e.kind==='add'&&kg!==null){overflow=kg+e.kg>CAPACITY_KG;kg=Math.min(CAPACITY_KG,kg+e.kg);}
  else if(e.kind==='unknown')kg=null;
  previous=e.counter;
 }
 if(!counter(total))return {kg:null,percent:null,reason:'counter',pending:pending.length};
 if(previous!==null&&total<previous){kg=null;reset=true;}
 if(kg!==null)kg=Math.max(0,kg-Math.max(0,total-previous));
 // An unconfirmed refill after the last calibration makes the actual level unknown.
 const last=ordered.findLast(e=>e.kind==='full'||e.kind==='remaining'),unconfirmed=pending.some(e=>!last||e.at===0||e.at>last.at||(e.at===last.at&&e.counter>=last.counter));
 return {kg,percent:kg===null?null:Math.round(100*kg/CAPACITY_KG),reason:reset?'reset':unconfirmed?'pending':kg===null?'initial':overflow?'overflow':'estimate',pending:pending.length};
}
export function refillEntry(kind,kg,point,uid,now){
 if(!['full','add','none','unknown','remaining'].includes(kind)||!counter(point?.counter)||!Number.isFinite(point?.at)||point.at<=0||!uid)throw Error("Saving requires a fresh consumption counter.");
 const amount=kind==='full'?CAPACITY_KG:['none','unknown'].includes(kind)?0:Number(kg);
 if(!Number.isFinite(amount)||amount<0||amount>CAPACITY_KG||(kind==='add'&&amount<=0))throw Error("Enter an amount from 0 to 30 kg.");
 return {kind,kg:Math.round(amount*10)/10,counter:point.counter,at:point.at,recordedAt:now,uid};
}
