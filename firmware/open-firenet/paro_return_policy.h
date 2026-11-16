#pragma once
#include <string>
#include "paro_day_policy.h"
namespace paro {
inline int64_t returnDateDay(const std::string& date){
 if(date.size()!=10||date[4]!='-'||date[7]!='-')return -1;
 for(size_t i=0;i<date.size();i++)if(i!=4&&i!=7&&(date[i]<'0'||date[i]>'9'))return -1;
 int y=(date[0]-'0')*1000+(date[1]-'0')*100+(date[2]-'0')*10+date[3]-'0',m=(date[5]-'0')*10+date[6]-'0',d=(date[8]-'0')*10+date[9]-'0';
 if(y<2020||y>2399||m<1||m>12)return -1;
 const int days[]={31,28+(y%4==0&&(y%100!=0||y%400==0)),31,30,31,30,31,31,30,31,30,31};
 if(d<1||d>days[m-1])return -1;
 y-=m<=2;const int era=y/400;const unsigned year=y-era*400;
 const unsigned day=(153*(m+(m>2?-3:9))+2)/5+d-1;
 return int64_t(era)*146097+year*365+year/4-year/100+day-719468;
}
struct ReturnPlan {std::string id,date;uint32_t revision=0;bool active=false;int64_t day=-1;};
inline bool validReturnPlan(const ReturnPlan& p){
 if(p.id.size()!=36||p.revision==0||p.revision>=1000000000)return false;
 for(char c:p.id)if(!((c>='a'&&c<='f')||(c>='0'&&c<='9')||c=='-'))return false;
 return p.date.empty()?p.day==-1:p.day>=0&&p.day==returnDateDay(p.date);
}
enum class ReturnPhase {Disabled,WaitingDate,Armed,Starting,Completed,Cancelled,Missed,Unconfirmed};
inline const char* returnPhaseName(ReturnPhase phase){switch(phase){
 case ReturnPhase::Disabled:return "disabled";case ReturnPhase::WaitingDate:return "waiting_date";case ReturnPhase::Armed:return "armed";case ReturnPhase::Starting:return "starting";case ReturnPhase::Completed:return "completed";case ReturnPhase::Cancelled:return "cancelled";case ReturnPhase::Missed:return "missed";default:return "unconfirmed";
}}
struct ReturnPolicy {
 ReturnPlan plan;ReturnPhase phase=ReturnPhase::Disabled;uint32_t pauseRevision=0;int64_t armedAt=0,startedAt=0,completedAt=0;
 int64_t boundary(const ComfortPlan& comfort)const{return plan.day*86400+comfort.start*60;}
 bool install(const ReturnPlan& next,const ComfortPlan& comfort,uint32_t pause,int64_t now){
  if(!validReturnPlan(next)||now<1700000000||next.revision<plan.revision)return false;
  const bool same=next.id==plan.id&&next.date==plan.date&&next.active==plan.active;
  if(next.revision==plan.revision)return false;
  plan=next;
  // A reminder answer changes revision, not the scheduled return or cancellation.
  if(same)return true;
  pauseRevision=pause;armedAt=now;startedAt=completedAt=0;
  phase=!plan.active?ReturnPhase::Disabled:plan.day<0?ReturnPhase::WaitingDate:now>=1700000000&&localWall(now)<boundary(comfort)?ReturnPhase::Armed:ReturnPhase::Missed;
  return true;
 }
 const char* blocker(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause,int64_t now,int64_t verifiedAt)const{
  if(now<1700000000)return "clock_not_ready";
  if(!comfort.configured||!comfort.enabled)return "plan_disabled";
  if(!comfort.valid())return "invalid_plan";
  if(pause!=pauseRevision)return "manual_stop";
  const int64_t wall=localWall(now);
  if(wall<boundary(comfort))return "scheduled";
  if(wall>=plan.day*86400+comfort.end*60)return "missed";
  // Revalidate in Firebase after the due boundary. A cached date from before
  // the morning cannot start a stove after its owner extended the absence.
  if(verifiedAt<1700000000||verifiedAt>now+2||now-verifiedAt>60||localWall(verifiedAt)<boundary(comfort))return "awaiting_fresh_plan";
  if(!stove.room)return "room_sensor";
  if(!stove.errorFree)return "stove_error";
  if(stove.wood)return "wood_burning";
  if(stove.frostRunning)return "native_frost";
  return "ready";
 }
 bool due(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause,int64_t now,int64_t verifiedAt)const{
  return phase==ReturnPhase::Armed&&plan.active&&plan.day>=0&&std::string(blocker(comfort,stove,pause,now,verifiedAt))=="ready";
 }
 bool observe(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause,int64_t now){
  if(phase!=ReturnPhase::Armed&&phase!=ReturnPhase::Starting)return false;
  if(pause!=pauseRevision){phase=ReturnPhase::Cancelled;return true;}
  if(now<1700000000)return false;
  if(phase==ReturnPhase::Starting){
   if(stove.on&&stove.comfort&&!stove.times&&stove.target==comfort.dayTemp&&stove.errorFree&&stove.room&&!stove.wood){phase=ReturnPhase::Completed;completedAt=now;return true;}
   if(now-startedAt>=60){phase=ReturnPhase::Unconfirmed;return true;}
  }else if(localWall(now)>=plan.day*86400+comfort.end*60){phase=ReturnPhase::Missed;return true;}
  return false;
 }
 void claim(int64_t now){phase=ReturnPhase::Starting;startedAt=now;}
 void failed(){phase=ReturnPhase::Unconfirmed;}
};
}
