// Verified warning numbers: RIKA Touch Display V2.28, p. 13.
// Do not reuse the unverified error bit table in upstream PROTOCOL.md.
export const MANUAL_URL='https://rika.ams3.cdn.digitaloceanspaces.com/rika-web/download/archives/Z36223_TouchDisplay_V2.28_EN.pdf';
export const WARNINGS=[
 [1,"Room sensor connection lost","Check the sensor connection, or the receiver and batteries of the wireless sensor."],
 [2,"Pellet hopper lid is open","Close the hopper lid."],
 [4,"Firebox door open","Close the firebox door."],
 [16,"Insufficient negative pressure","Check that doors and cleaning covers are closed and that the air supply is clear. Contact a service technician if the warning recurs."],
 [32,"Pressure sensor deviation too high","Check seals, the air supply and any effect from an extractor hood. Contact a service technician if the warning recurs."],
 [64,"Calibrating air flaps","Wait for calibration to finish; after a power interruption, it can take up to 5 minutes."],
 [128,"Flue gas or burn-back flap is not in the heating position","Check the flap positions as described in the PARO manual."],
 [256,"Stove is not in its operating position","Check the stove’s position as described in your model’s manual."]
];
export const FAULT_GUIDE=[
 ["Empty hopper","Add pellets and acknowledge the message on the stove. The next ignition may take longer."],
 ["Door or hopper lid open","Close the door or lid, then acknowledge the message on the stove’s display."],
 ["Ignition failed","Wait for shutdown and cooling to finish. Follow the manual to check pellets, the burn pot, ignition tube and air supply."],
 ["Grate movement incomplete","Once cool, check for a blockage at the burn pot as described in the manual; contact a service technician if the fault recurs."],
 ["Insufficient negative pressure or pressure deviation","Check that doors and cleaning covers are closed and that the air supply is clear. Contact a service technician if the fault cannot be acknowledged."],
 ["External request blocked operation","Resolve the external block according to the connected device’s instructions."],
 ["Flue gas or burn-back flap is open","Return the flaps to their operating position as described in the manual, then acknowledge the message on the stove."],
 ["Display locked","Do not press or work on the display; contact a service technician."],
 ["Air flap motor","The flaps did not reach the required position. Check and acknowledge the message on the stove; contact a service technician if it recurs."],
 ["Room overheated","Allow the room to cool. The fault can only be acknowledged below 30 °C."],
 ["Flue gas fan or fan speed measurement","Check the message on the stove; contact a service technician to inspect the fan if it recurs."],
 ["Auger or motor blocked","Operation cannot continue. Contact a service technician; do not clear the blockage while the stove is running."],
 ["Auger motor fault","Check the message on the stove; contact a service technician if it recurs."],
 ["Flame sensor: disconnected or short circuit","Operation cannot continue; contact a service technician."],
 ["Oven sensor: disconnected or short circuit","Contact a service technician; this sensor is used on models with a baking oven."],
 ["Communication interrupted","Check which component the display names: mainboard, sensor, flap motor or another part. Contact a service technician if the fault recurs."],
 ["Pressure sensor fault","Check the display message; a disconnected sensor or recurring fault requires servicing."],
 ["Safety temperature limiter","Do not restart the stove until the cause has been resolved and the manual’s procedure or a service inspection has been completed."]
];
function mask(value){return Number.isInteger(value)&&value>=-2147483648&&value<=4294967295?(value<0?value+4294967296:value):null;}
export function stoveAlerts(stove){
 if(!stove||typeof stove!=='object')return [];
 const result=[],error=mask(stove.error_code),warning=mask(stove.warning_code),sub=Number.isInteger(stove.error_sub)?stove.error_sub:null;
 if(error>0||stove.has_error===true){
  const code=error===null?"unknown":String(error),suffix=sub===null?'':` · subcode ${sub}`;
  result.push({id:`error:${code}:${sub??'unknown'}`,kind:'error',title:"The stove reports a fault",code:`Code ${code}${suffix}`,message:"Check the text on the stove’s display. The meaning of this numeric code is not verified yet.",confirmed:false});
 }
 if(warning===null){if(stove.warning_code!=null&&stove.warning_code!==0)result.push({id:'warning:invalid',kind:'warning',title:"Unknown stove warning",code:String(stove.warning_code).slice(0,40),message:"Check the stove’s display.",confirmed:false});return result;}
 let known=0;
 for(const [bit,title,message] of WARNINGS){known+=bit;if(Math.floor(warning/bit)%2===1)result.push({id:`warning:${bit}`,kind:'warning',title,code:`W${bit.toString(16).toUpperCase().padStart(4,'0')} · ${bit}`,message,confirmed:true});}
 // W0006 is the combined door / hopper indication; unknown bits stay visible.
 let unknown=0;for(let bit=1;bit<=2147483648;bit*=2)if(Math.floor(warning/bit)%2===1&&Math.floor(known/bit)%2===0)unknown+=bit;
 if(unknown)result.push({id:`warning:unknown:${unknown}`,kind:'warning',title:"Unrecognised stove warning",code:`Code ${unknown}`,message:"This code’s meaning is not verified yet. Check the stove’s display.",confirmed:false});
 return result;
}
export function alertFingerprint(stove){return stoveAlerts(stove).map(a=>a.id).join('|');}
export function notificationPayload(stove,updatedAt){
 const alerts=stoveAlerts(stove);if(!alerts.length)return null;
 const first=alerts[0];const time=new Intl.DateTimeFormat("en-GB",{timeZone:'Europe/Ljubljana',hour:'2-digit',minute:'2-digit'}).format(updatedAt);
 return {title:alerts.some(a=>a.kind==='error')?"PARO · Stove fault":"PARO · Stove warning",body:`${first.title}. ${first.code}${alerts.length>1?` · another ${alerts.length-1} alerts`:''}. Reading ${time}.`,tag:'paro-stove-alert',at:updatedAt};
}
