// The power switch is a heat request, not proof of fire. The bridge also marks
// ignition, cleaning and burn-off as is_burning: use the actual phase as well.
export const isWoodState=phase=>['splitlog','splitlog_refuel','splitlog_no_refuel'].includes(phase);
export function stoveStatus(state,available){
 const stove=state?.stove||{},on=state?.controls?.on===true;
 const result=(phase,title,detail,badge,animate=false)=>({phase,title,detail,badge,animate});
 if(!available)return result('offline',"Waiting for connection","Fresh stove readings are needed to confirm its current state.","State unconfirmed");
 if(stove.has_error===true)return result('fault',"Stove fault","Check the message on the stove’s display.","Attention needed");
 const burning=(title,detail,badge)=>stove.is_burning===true
  ?result('burning',title,detail,badge,true)
  :result('pending',"Checking combustion","The stove reports heating. Waiting for confirmation of active burning.","Flame not yet confirmed");
 switch(stove.state){
  case 'off':return on
   ?result('standby',"Waiting to start","Heating is enabled; the stove is not burning now.","No active fire")
   :result('off',"Stove is off","Heating is off.","No active fire");
  case 'standby':return result('standby',"Standby",on?"Waiting for a demand for heat.":"Waiting to confirm the state after switching off.","No active fire");
  case 'ignition':return result('ignition',"Stove is igniting","Pellet ignition is in progress.","Ignition in progress");
  case 'start':case 'flame_start':return burning("Establishing flame","The stove is stabilising the flame before heating.","Starting heating");
  case 'heating':case 'regulation':return burning("Stove is heating","The flame is active. The stove is regulating heating.","Flame active");
  case 'cleaning':return result('cleaning',"Stove is cleaning","Automatic grate cleaning is in progress.","Cleaning");
  case 'burnoff':case 'burn_off':return result('cooling',"Stove is shutting down","The stove is burning off and cooling down.","Shutdown in progress");
  case 'splitlog':case 'splitlog_refuel':case 'splitlog_no_refuel':return burning("Burning wood","The stove is operating in wood-burning mode.","Flame active");
  case 'splitlog_check':return result('pending',"Checking wood mode","The stove is checking wood-burning mode.","Check in progress");
  default:return result('pending',"Unknown state","Check the current state on the stove’s display.","Flame unconfirmed");
 }
}
