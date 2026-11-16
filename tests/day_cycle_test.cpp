#include <cassert>
#include "../firmware/open-firenet/paro_day_policy.h"
int main(){
 paro::ComfortPlan p;p.configured=true;p.enabled=true;assert(p.valid());
 // 27 October 2026 05:00 UTC = 06:00 Ljubljana.
 const int64_t six=1793077200LL,ninePM=six+15*3600;paro::DaySnapshot s;s.room=true;s.errorFree=true;s.comfort=true;s.frostOn=true;s.frostTemp=5;
 paro::ComfortPolicy q;q.initialize(true);q.paused=false;q.ownedNightOff=true;s.on=false;
 assert(q.decide(p,s,six-1).action==paro::DayAction::None);auto d=q.decide(p,s,six);assert(d.action==paro::DayAction::StartDay);q.claimedAction(d);s.on=true;
 assert(q.decide(p,s,six+1).action==paro::DayAction::None);
 q.decide(p,s,ninePM-1);d=q.decide(p,s,ninePM);assert(d.action==paro::DayAction::StopNight);q.claimedAction(d);s.on=false;
 assert(!q.observeManualOff(p,s));assert(!q.paused);
 q.decide(p,s,six+86400-1);d=q.decide(p,s,six+86400);assert(d.action==paro::DayAction::StartDay);q.claimedAction(d);
 // Explicit manual OFF persists through a reboot and through multiple mornings.
 q.manualOff();q.reboot();q.decide(p,s,six+2*86400-1);assert(q.decide(p,s,six+2*86400).action==paro::DayAction::None);assert(q.paused);
 // Settings edits, including enable/disable, never clear manual pause.
 q.reconfigure=true;s.frostOn=true;assert(q.decide(p,s,six+2*86400+1).action==paro::DayAction::None);assert(q.paused);
 s.frostOn=false;d=q.decide(p,s,six+2*86400+2);assert(d.action==paro::DayAction::Configure&&d.target==0);assert(q.paused);
 // Native frost heating must never be countermanded by our night OFF.
 paro::ComfortPolicy frost;frost.initialize(true);s.on=true;s.frostOn=true;frost.decide(p,s,ninePM-1);s.frostRunning=true;assert(frost.decide(p,s,ninePM).action==paro::DayAction::None);
 s.frostRunning=false;assert(frost.decide(p,s,ninePM+1).action==paro::DayAction::StopNight);
 // Night temperature is an explicit alternative, not ordinary night heating in
 // the frost-only mode. Day and night setpoints are retained separately.
 p.nightHeating=true;paro::ComfortPolicy temp;temp.initialize(true);s.frostRunning=false;temp.decide(p,s,ninePM-1);d=temp.decide(p,s,ninePM);assert(d.action==paro::DayAction::StartNight&&d.target==16);
 // No ignition replay on boot, a long USB outage, an NTP jump or a clock reset.
 paro::ComfortPolicy boot;boot.initialize(false);boot.resume();assert(boot.decide(p,s,six+30).action==paro::DayAction::None);
 paro::ComfortPolicy lost;lost.initialize(true);lost.decide(p,s,six-60);assert(lost.decide(p,s,six+600).action==paro::DayAction::None);
 assert(lost.decide(p,s,0).action==paro::DayAction::None);
 // Faults, absent room sensors and log burning fail closed.
 for(int k=0;k<3;k++){paro::ComfortPolicy guard;guard.initialize(true);s.room=true;s.errorFree=true;s.wood=false;guard.decide(p,s,six-1);if(k==0)s.errorFree=false;if(k==1)s.room=false;if(k==2)s.wood=true;assert(guard.decide(p,s,six).action==paro::DayAction::None);}
 // A real OFF transition on the stove screen during daytime also latches pause.
 s.room=true;s.errorFree=true;s.wood=false;s.on=true;paro::ComfortPolicy physical;physical.initialize(true);physical.decide(p,s,six+60);s.on=false;assert(physical.observeManualOff(p,s)&&physical.paused);
 // Native manual mode is a temporary power override. The next frost-only
 // night still stops it, without latching a user pause; morning restores Comfort.
 p.nightHeating=false;p.dayTemp=21;s.on=true;s.comfort=false;s.room=true;s.errorFree=true;s.wood=false;s.frostRunning=false;
 paro::ComfortPolicy manual;manual.initialize(true);manual.decide(p,s,ninePM-1);
 d=manual.decide(p,s,ninePM);assert(d.action==paro::DayAction::StopNight);manual.claimedAction(d);s.on=false;
 assert(!manual.observeManualOff(p,s)&&!manual.paused);manual.decide(p,s,six+86400-1);
 d=manual.decide(p,s,six+86400);assert(d.action==paro::DayAction::StartDay&&d.target==21);
 // DST uses Ljubljana wall time; default 06–21 remains unchanged across changes.
 assert(paro::comfortPeriod(p,1792904400LL).day); // 25 Oct 2026 05:00 UTC.
 auto invalid=p;invalid.start=1260;invalid.end=360;assert(!invalid.valid());invalid=p;invalid.start=invalid.end;assert(!invalid.valid());invalid=p;invalid.frostTemp=11;assert(!invalid.valid());
}
