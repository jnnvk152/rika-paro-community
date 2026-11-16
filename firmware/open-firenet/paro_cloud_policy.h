#pragma once
#include <stdint.h>
#include <string>
#include <array>
namespace paro {
inline const char* slotName(int index){static const char* names[]={"heatTimeMon1","heatTimeMon2","heatTimeTue1","heatTimeTue2","heatTimeWed1","heatTimeWed2","heatTimeThu1","heatTimeThu2","heatTimeFri1","heatTimeFri2","heatTimeSat1","heatTimeSat2","heatTimeSun1","heatTimeSun2"};return names[index];}
inline bool validSlot(int value){if(value==0)return true;if(value<0)return false;int start=value/10000,end=value%10000;return start<=2359&&end<=2359&&start%100<60&&end%100<60&&start<end;}
struct Action {
 std::string id,session,mode,cycleAction;
 bool hasCycleAction=false;
 int64_t issued=0,expires=0;
 bool hasOn=false,on=false,hasMode=false,hasPower=false,hasTemperature=false;
 int power=0,temperature=0;
 bool hasSchedule=false,scheduleActive=false;
 int setback=16;
 std::array<int,14> slots{};
};
inline bool validId(const std::string& id) {
 if(id.size()<16||id.size()>64)return false;
 for(char c:id)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;
 return true;
}
inline const char* policy(const Action& a,const std::string& session,const std::string& lastId,int64_t now,bool connected,bool stoveReady,bool hasError,bool wood,bool roomSensor,bool scheduleSynced=false) {
 if(!validId(a.id))return "invalid_id";
 if(a.id==lastId)return "duplicate";
 if(!connected||a.session!=session)return "old_session";
 if(now<1700000000000LL||a.issued>now+2000||a.issued<now-15000||a.expires<=now||a.expires>a.issued+15000||a.expires>now+15000||a.expires<=a.issued)return "expired";
 if(!stoveReady)return "stove_not_ready";
 if(a.hasCycleAction){
  if(a.cycleAction!="pause"&&a.cycleAction!="resume")return "invalid_cycle_action";
  if(a.hasOn||a.hasMode||a.hasPower||a.hasTemperature||a.hasSchedule)return "mixed_cycle_action";
  if(a.cycleAction=="resume"&&(hasError||wood||!roomSensor))return "check_stove";
  return nullptr;
 }
 if(!a.hasOn&&!a.hasMode&&!a.hasPower&&!a.hasTemperature&&!a.hasSchedule)return "empty_command";
 if(a.hasSchedule){
  if(!scheduleSynced)return "schedule_not_ready";
  if(a.hasOn||a.hasTemperature||(a.hasMode&&a.mode!="auto"))return "mixed_schedule_command";
  if(a.setback<12||a.setback>22)return "invalid_setback";
  for(int i=0;i<14;i++)if(!validSlot(a.slots[i]))return "invalid_slot";
  for(int i=0;i<14;i+=2){int x=a.slots[i],y=a.slots[i+1];if(x&&y&&x%10000>y/10000&&y%10000>x/10000)return "overlapping_slots";}
 }
 if(a.hasOn&&a.on&&(hasError||wood))return "check_stove";
 if(a.hasMode&&a.mode!="manual"&&a.mode!="auto"&&a.mode!="comfort")return "invalid_mode";
 if(a.hasPower&&(a.power<30||a.power>100))return "invalid_power";
 if(a.hasTemperature&&(a.temperature<14||a.temperature>28))return "invalid_temperature";
 if(((a.hasMode&&a.mode=="comfort")||a.hasTemperature)&&!roomSensor)return "room_sensor_missing";
 return nullptr;
}
}
