#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <time.h>
#include "paro_home_policy.h"
namespace paro {
class HomeNight {
 HomeNightPolicy state_;bool durable_=true;
 bool save(){
  Preferences p;if(!p.begin("paro_home",false)){durable_=false;return false;}
  const bool ok=p.putBool("blockedOff",state_.blockedOff)>0&&p.putLong64("manualSince",state_.manualSince)>0&&p.putLong64("nightApplied",state_.appliedBoundary)>0&&p.putUInt("nightGuard",1)>0;p.end();durable_=ok;return ok;
 }
 public:
 void begin(){Preferences p;if(p.begin("paro_home",true)){state_.blockedOff=p.getBool("blockedOff",false);state_.manualSince=p.getLong64("manualSince",0);state_.appliedBoundary=p.getLong64("nightApplied",0);const bool legacy=p.getUInt("nightGuard",0)<1;p.end();if(legacy){state_.upgradeGuard();save();}}}
 void requestOff(){state_.requestOff();save();}
 void requestOn(){state_.requestOn();save();}
 void observe(bool manual,bool actualOn){if(state_.observe(manual,time(nullptr),actualOn))save();}
 int64_t due(int minute)const{return durable_?state_.due(time(nullptr),minute):0;}
 bool claim(int64_t boundary){const auto old=state_.appliedBoundary;state_.appliedBoundary=boundary;if(save())return true;state_.appliedBoundary=old;return false;}
 void notSent(int64_t prior){state_.appliedBoundary=prior;save();}
 int64_t applied()const{return state_.appliedBoundary;}
 String json(int minute)const{
  const bool clock=time(nullptr)>=1700000000;
  const char* status=!durable_?"storage_unavailable":!clock?"clock_not_ready":state_.blockedOff?"awaiting_off":!state_.manualSince?"ready":state_.appliedBoundary>localWall(state_.manualSince)?"awaiting_confirmation":"manual";
  char cutoff[24]="";if(state_.appliedBoundary){time_t wall=(time_t)state_.appliedBoundary;tm local={};gmtime_r(&wall,&local);strftime(cutoff,sizeof(cutoff),"%Y-%m-%dT%H:%M:%S",&local);}
  return String("{\"manual_started_at\":")+String((long long)state_.manualSince*1000LL)+",\"last_cutoff_local\":\""+cutoff+"\",\"night_end_minute\":"+minute+",\"clock_ready\":"+(clock?"true":"false")+",\"durable\":"+(durable_?"true":"false")+",\"status\":\""+status+"\"}";
 }
};
}
