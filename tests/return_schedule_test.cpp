#include <cassert>
#include <iostream>
#include "../firmware/open-firenet/paro_return_policy.h"
using namespace paro;
static int64_t wall(const char* date,int hour,int minute=0){return returnDateDay(date)*86400+hour*3600+minute*60;}
// November local time is UTC+1; the production conversion is also tested at DST.
static int64_t utc(const char* date,int hour,int minute=0){return wall(date,hour,minute)-3600;}
static ComfortPlan comfort(){ComfortPlan p;p.configured=p.enabled=true;p.revision=19;p.dayTemp=21;return p;}
static ReturnPlan plan(const char* date="2026-11-16",uint32_t revision=1,char id='a'){ReturnPlan p;p.id=std::string(36,id);p.date=date;p.day=p.date.empty()?-1:returnDateDay(date);p.revision=revision;p.active=true;return p;}
static DaySnapshot stove(){DaySnapshot s;s.room=s.errorFree=true;s.comfort=true;s.target=21;return s;}
int main(){
 const auto c=comfort();auto s=stove();
 assert(returnDateDay("2026-11-16")==20773);assert(returnDateDay("2028-02-29")>=0);assert(returnDateDay("2026-02-29")==-1);assert(returnDateDay("2026-13-01")==-1);assert(returnDateDay("2026-11-31")==-1);assert(returnDateDay("2026-1-16")==-1);
 ReturnPolicy r;assert(r.install(plan(),c,3,utc("2026-11-15",12)));assert(r.phase==ReturnPhase::Armed);
 assert(!r.due(c,s,3,utc("2026-11-15",21),utc("2026-11-15",21)));assert(!r.due(c,s,3,utc("2026-11-16",5,59),utc("2026-11-16",5,59)));
 assert(!r.due(c,s,3,utc("2026-11-16",6),utc("2026-11-16",5,59)));
 assert(r.due(c,s,3,utc("2026-11-16",6),utc("2026-11-16",6)));
 assert(!r.due(c,s,3,utc("2026-11-16",6,2),utc("2026-11-16",6)));
 for(int k=0;k<4;k++){auto blocked=s;if(k==0)blocked.room=false;if(k==1)blocked.errorFree=false;if(k==2)blocked.wood=true;if(k==3)blocked.frostRunning=true;assert(!r.due(c,blocked,3,utc("2026-11-16",6),utc("2026-11-16",6)));}
 auto disabled=c;disabled.enabled=false;assert(!r.due(disabled,s,3,utc("2026-11-16",6),utc("2026-11-16",6)));assert(!r.due(c,s,4,utc("2026-11-16",6),utc("2026-11-16",6)));
 auto stopped=r;assert(stopped.observe(c,s,4,utc("2026-11-16",6)));assert(stopped.phase==ReturnPhase::Cancelled);
 auto confirmation=plan("2026-11-16",2);assert(stopped.install(confirmation,c,4,utc("2026-11-15",19)));assert(stopped.phase==ReturnPhase::Cancelled);
 auto postponed=plan("2026-11-17",3,'b');assert(stopped.install(postponed,c,4,utc("2026-11-15",19)));assert(stopped.phase==ReturnPhase::Armed);assert(!stopped.due(c,s,4,utc("2026-11-16",6),utc("2026-11-16",6)));assert(stopped.due(c,s,4,utc("2026-11-17",6),utc("2026-11-17",6)));
 auto unknown=plan("",4,'c');assert(stopped.install(unknown,c,4,utc("2026-11-15",19)));assert(stopped.phase==ReturnPhase::WaitingDate);assert(!stopped.due(c,s,4,utc("2026-11-17",6),utc("2026-11-17",6)));
 r.claim(utc("2026-11-16",6));assert(!r.due(c,s,3,utc("2026-11-16",6),utc("2026-11-16",6)));
 auto rebooted=r;assert(!rebooted.due(c,s,3,utc("2026-11-16",6),utc("2026-11-16",6)));s.on=true;assert(rebooted.observe(c,s,3,utc("2026-11-16",6)));assert(rebooted.phase==ReturnPhase::Completed);assert(rebooted.completedAt==utc("2026-11-16",6));
 s.on=false;assert(r.observe(c,s,3,utc("2026-11-16",6,1)));assert(r.phase==ReturnPhase::Unconfirmed);assert(!r.due(c,s,3,utc("2026-11-16",6,2),utc("2026-11-16",6,2)));
 ReturnPolicy missed;assert(missed.install(plan(),c,0,utc("2026-11-16",8)));assert(missed.phase==ReturnPhase::Missed);
 ReturnPolicy late;assert(late.install(plan(),c,0,utc("2026-11-15",19)));assert(late.observe(c,s,0,utc("2026-11-16",21)));assert(late.phase==ReturnPhase::Missed);assert(!late.due(c,s,0,utc("2026-11-17",6),utc("2026-11-17",6)));
 ReturnPolicy night;assert(night.install(plan(),c,0,utc("2026-11-15",19)));ComfortPolicy day;day.initialize(true);day.claimedAction({DayAction::StopNight,0,utc("2026-11-15",21)});assert(day.pauseRevision==0);assert(!day.observeManualOff(c,s));assert(day.pauseRevision==0);day.manualOff();assert(day.pauseRevision==1);assert(night.observe(c,s,day.pauseRevision,utc("2026-11-15",22)));assert(night.phase==ReturnPhase::Cancelled);
 day.resume(true);assert(day.pauseRevision==1);day.resume();assert(day.pauseRevision==2);
 for(const char* date:{"2026-03-29","2026-10-25"}){
  ReturnPolicy dst;assert(dst.install(plan(date),c,0,wall(date,0)-86400));
  const int offset=std::string(date)=="2026-03-29"?7200:3600;const auto at=wall(date,6)-offset;
  assert(dst.due(c,s,0,at,at));assert(!dst.due(c,s,0,at-1,at-1));
 }
 std::cout<<"Scheduled return policy: all checks passed\n";
}
