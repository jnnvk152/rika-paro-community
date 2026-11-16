#pragma once
#include <cstdint>
#include "paro_home_policy.h"
namespace paro {
struct ComfortPlan {
 bool configured=false,enabled=false;int start=360,end=1260,dayTemp=20,nightTemp=16,frostTemp=5;bool nightHeating=false;uint32_t revision=0;
 bool valid()const{return start>=0&&start<end&&end<1440&&dayTemp>=14&&dayTemp<=28&&nightTemp>=14&&nightTemp<=28&&frostTemp>=4&&frostTemp<=10;}
};
struct ComfortPeriod {bool day=false;int64_t boundary=0;};
inline ComfortPeriod comfortPeriod(const ComfortPlan& p,int64_t now){
 if(now<1700000000||!p.valid())return {};
 const int64_t wall=localWall(now),midnight=wall/86400*86400;const int minute=(wall%86400)/60;
 if(minute>=p.start&&minute<p.end)return {true,midnight+p.start*60};
 return {false,(minute>=p.end?midnight:midnight-86400)+p.end*60};
}
enum class DayAction {None,Configure,StartDay,StartNight,StopNight};
struct DaySnapshot {bool on=false,comfort=false,times=false,room=false,errorFree=false,wood=false,frostRunning=false;int target=0,frostTemp=0;bool frostOn=false;};
struct DayDecision {DayAction action=DayAction::None;int target=0;int64_t boundary=0;};
// Persisted pause is separate from the scheduled OFF state. No camera/presence
// decision is derived from the burner or from this manual pause.
struct ComfortPolicy {
 bool initialized=false,paused=true,ownedNightOff=false;int64_t claimed=0;uint32_t pauseRevision=0;
 bool primed=false,previousOn=false;int64_t previousAt=0,observedBoundary=0;
 bool reconfigure=false;uint32_t appliedRevision=0;
 void initialize(bool on){if(!initialized){initialized=true;paused=!on;ownedNightOff=false;}}
 void manualOff(){initialized=true;paused=true;ownedNightOff=false;pauseRevision++;}
 void resume(bool scheduledReturn=false){initialized=true;paused=false;if(!scheduledReturn)pauseRevision++;}
 void reboot(){primed=false;previousAt=0;observedBoundary=0;reconfigure=false;}
 bool observeManualOff(const ComfortPlan& plan,const DaySnapshot& s){
  if(initialized&&!s.on&&!ownedNightOff&&!s.frostRunning&&!paused&&plan.enabled){manualOff();previousOn=s.on;return true;}previousOn=s.on;return false;
 }
 DayDecision decide(const ComfortPlan& p,const DaySnapshot& s,int64_t now){
  if(!p.valid()||now<1700000000)return {};
  const auto period=comfortPeriod(p,now);bool boundary=false;
  if(!primed){primed=true;observedBoundary=period.boundary;previousAt=now;previousOn=s.on;}
  else{
   const int64_t elapsed=now-previousAt;
   boundary=period.boundary!=observedBoundary&&period.boundary>claimed&&elapsed>=0&&elapsed<=120;
   observedBoundary=period.boundary;previousAt=now;
  }
  if(!p.enabled)return {};
  if(!s.room||!s.errorFree||s.wood||s.frostRunning)return {};
  if(paused){
   // Only native frost settings may be restored while manually paused.
   if(reconfigure&&(!s.frostOn||s.frostTemp!=p.frostTemp))return {DayAction::Configure,0,0};
   return {};
  }
  if(boundary&&period.boundary>claimed){
   if(period.day)return {DayAction::StartDay,p.dayTemp,period.boundary};
   return {p.nightHeating?DayAction::StartNight:DayAction::StopNight,p.nightTemp,period.boundary};
  }
  if(!period.day&&!p.nightHeating&&s.on&&period.boundary>claimed)return {DayAction::StopNight,0,period.boundary};
  if(reconfigure){
   if(!period.day&&!p.nightHeating)return {s.on?DayAction::StopNight:DayAction::Configure,0,s.on?period.boundary:0};
   // Editing settings never starts an OFF stove. Morning or explicit resume is
   // required. Room target is independent from the retained native time slots.
   return {DayAction::Configure,period.day?p.dayTemp:p.nightTemp,0};
  }
  return {};
 }
 void claimedAction(const DayDecision& d){if(d.boundary)claimed=d.boundary;if(d.action==DayAction::StopNight)ownedNightOff=true;if(d.action==DayAction::StartDay||d.action==DayAction::StartNight)ownedNightOff=false;}
};
}
