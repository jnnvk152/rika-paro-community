export const DAYS=[['Mon',"Monday"],['Tue',"Tuesday"],['Wed',"Wednesday"],['Thu',"Thursday"],['Fri',"Friday"],['Sat',"Saturday"],['Sun',"Sunday"]];
export const SLOT_KEYS=DAYS.flatMap(([day])=>[1,2].map(n=>`heatTime${day}${n}`));
export function validSlot(value){
 if(!Number.isInteger(value)||value<0)return false;
 if(value===0)return true;
 const start=Math.floor(value/10000),end=value%10000;
 return start<=2359&&end<=2359&&start%100<60&&end%100<60&&start<end;
}
export function validateSchedule(schedule){
 if(!schedule||typeof schedule!=='object'||Array.isArray(schedule)||Object.keys(schedule).sort().join(',')!=='active,setback_temperature,slots')throw Error("The schedule is incomplete.");
 if(typeof schedule.active!=='boolean'||!Number.isInteger(schedule.setback_temperature)||schedule.setback_temperature<12||schedule.setback_temperature>22)throw Error("The setback temperature must be between 12 and 22 °C.");
 const slots=schedule.slots;
 if(!slots||typeof slots!=='object'||Array.isArray(slots)||Object.keys(slots).length!==14||SLOT_KEYS.some(k=>!Object.hasOwn(slots,k)||!validSlot(slots[k])))throw Error("Enter valid intervals from 00:00 to 23:59. The end must follow the start.");
 for(const [day,label] of DAYS){
  const a=slots[`heatTime${day}1`],b=slots[`heatTime${day}2`];
  if(a&&b&&a%10000>Math.floor(b/10000)&&b%10000>Math.floor(a/10000))throw Error(`${label}: the intervals overlap.`);
 }
 return {active:schedule.active,setback_temperature:schedule.setback_temperature,slots:{...slots}};
}
export function readSchedule(state){
 const slots=state?.schedule;
 if(!slots||SLOT_KEYS.some(k=>!Object.hasOwn(slots,k)))return null;
 const schedule={active:state.controls?.heating_times_active,setback_temperature:state.controls?.setback_temperature,slots:Object.fromEntries(SLOT_KEYS.map(k=>[k,slots[k]]))};
 // Preserve actual values, including a malformed legacy interval, for correction.
 return typeof schedule.active==='boolean'&&Number.isFinite(schedule.setback_temperature)?schedule:null;
}
export function decodeSlot(value,period=1){
 const format=v=>`${String(Math.floor(v/100)).padStart(2,'0')}:${String(v%100).padStart(2,'0')}`;
 return value?{enabled:true,start:format(Math.floor(value/10000)),end:format(value%10000)}:{enabled:false,start:period===1?'06:00':'17:00',end:period===1?'09:00':'22:00'};
}
export function encodeSlot(enabled,start,end){
 if(!enabled)return 0;
 if(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end))throw Error("Choose the interval start and end.");
 const value=Number(start.replace(':',''))*10000+Number(end.replace(':',''));
 if(!validSlot(value)||value===0)throw Error("The interval must end after it starts, on the same day.");
 return value;
}
export function demoSchedule(){return {active:false,setback_temperature:16,slots:Object.fromEntries(SLOT_KEYS.map(k=>[k,0]))};}
export function nativePatch(patch){
 const {schedule,...controls}=patch;if(!schedule)return controls;
 const value=validateSchedule(schedule);return {...controls,heating_times_active:value.active,setback_temperature:value.setback_temperature,...value.slots};
}
