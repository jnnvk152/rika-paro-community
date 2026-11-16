#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "paro_day_policy.h"
namespace paro {
class DayComfort {
 ComfortPlan config_;ComfortPolicy state_;bool durable_=true,known_=false,frostRunning_=false;uint32_t seenConfig_=0;bool pending_=false;DayDecision pendingDecision_;uint32_t sentAt_=0;const char* result_="idle";
 bool save(){
  JsonDocument doc;doc["initialized"]=state_.initialized;doc["paused"]=state_.paused;doc["ownedOff"]=state_.ownedNightOff;doc["claimed"]=state_.claimed;doc["pauseRevision"]=state_.pauseRevision;
  String raw;serializeJson(doc,raw);Preferences p;if(!p.begin("paro_day",false)){durable_=false;return false;}bool ok=p.putString("state",raw)>0;p.end();durable_=ok;return ok;
 }
 bool parsePlan(const String& raw,ComfortPlan& p){
  JsonDocument doc;if(raw.length()>2048||deserializeJson(doc,raw)||!doc.is<JsonObject>()||doc["version"]!=1||!doc["enabled"].is<bool>()||!doc["revision"].is<uint32_t>()||doc["revision"].as<uint32_t>()==0)return false;
  for(const char* key:{"day_start_minute","night_start_minute","day_temperature","night_temperature","frost_temperature"})if(!doc[key].is<int>())return false;
  String mode=doc["night_mode"]|"";if(mode!="frost"&&mode!="temperature")return false;
  p.configured=true;p.enabled=doc["enabled"].as<bool>();p.revision=doc["revision"];p.start=doc["day_start_minute"];p.end=doc["night_start_minute"];p.dayTemp=doc["day_temperature"];p.nightTemp=doc["night_temperature"];p.frostTemp=doc["frost_temperature"];p.nightHeating=mode=="temperature";return p.valid();
 }
 public:
 void begin(){
  Preferences p;if(!p.begin("paro_day",true))return;String raw=p.getString("state","");String plan=p.getString("plan","");p.end();
  JsonDocument doc;if(raw.length()&&!deserializeJson(doc,raw)&&doc["initialized"].is<bool>()&&doc["paused"].is<bool>()&&doc["ownedOff"].is<bool>()&&doc["claimed"].is<int64_t>()){
   state_.initialized=doc["initialized"];state_.paused=doc["paused"];state_.ownedNightOff=doc["ownedOff"];state_.claimed=doc["claimed"];state_.pauseRevision=doc["pauseRevision"]|0U;
  }
  ComfortPlan stored;if(parsePlan(plan,stored)){config_=stored;seenConfig_=stored.revision;}
 }
 bool configure(const String& raw){
  ComfortPlan next;if(!parsePlan(raw,next)||next.revision<=seenConfig_)return false;
  Preferences p;if(!p.begin("paro_day",false)){durable_=false;return false;}bool ok=p.putString("plan",raw)>0;p.end();if(!ok){durable_=false;return false;}
  config_=next;seenConfig_=next.revision;state_.primed=false;state_.reconfigure=true;durable_=true;result_="configuration_pending";return true;
 }
 const ComfortPlan& config()const{return config_;}
 bool enabled()const{return config_.configured&&config_.enabled;}
 bool durable()const{return durable_;}
 bool paused()const{return state_.paused;}
 uint32_t pauseRevision()const{return state_.pauseRevision;}
 bool nightOnlyFrost()const{return enabled()&&(time(nullptr)<1700000000||(!comfortPeriod(config_,time(nullptr)).day&&!config_.nightHeating));}
 bool manualOff(){auto old=state_;state_.manualOff();pending_=false;result_="paused";if(save())return true;state_=old;return false;}
 bool resume(bool scheduledReturn=false){if(enabled()&&time(nullptr)<1700000000)return false;auto old=state_;state_.resume(scheduledReturn);pending_=false;result_="resuming";if(save())return true;state_=old;return false;}
 void observe(const DaySnapshot& s){
  frostRunning_=s.frostRunning;known_=true;if(!state_.initialized){state_.initialize(s.on);save();}
  const bool waking=pending_&&(pendingDecision_.action==DayAction::StartDay||pendingDecision_.action==DayAction::StartNight);
  if(!waking&&state_.observeManualOff(config_,s))save();
  if(pending_){
   const bool frost=s.frostOn&&s.frostTemp==config_.frostTemp;
   bool match=pendingDecision_.action==DayAction::StopNight?frost&&!s.on:frost&&((state_.paused||pendingDecision_.target==0)?true:s.comfort&&!s.times&&s.target==pendingDecision_.target);
   if(pendingDecision_.action==DayAction::StartDay||pendingDecision_.action==DayAction::StartNight)match=match&&s.on;
   if(match){pending_=false;result_="confirmed";state_.appliedRevision=config_.revision;}
   else if((uint32_t)(millis()-sentAt_)>=20000){pending_=false;result_="unconfirmed";}
  }
 }
 DayDecision next(const DaySnapshot& s){if(!durable_||!known_||pending_)return {};return state_.decide(config_,s,time(nullptr));}
 DayDecision resumeDecision()const{
  auto period=comfortPeriod(config_,time(nullptr));if(!enabled())return {};
  return {period.day?DayAction::StartDay:config_.nightHeating?DayAction::StartNight:DayAction::StopNight,period.day?config_.dayTemp:config_.nightTemp,period.boundary};
 }
 bool claim(const DayDecision& d){
  if(!durable_)return false;auto old=state_;state_.claimedAction(d);if(!save()){state_=old;return false;}return true;
 }
 void sent(const DayDecision& d,bool ok){state_.reconfigure=false;if(ok){pendingDecision_=d;pending_=true;sentAt_=millis();result_="awaiting_confirmation";}else result_="not_sent";}
 String json()const{
  JsonDocument doc;const bool clock=time(nullptr)>=1700000000;const auto period=comfortPeriod(config_,time(nullptr));
  doc["frost_running"]=frostRunning_;doc["enabled"]=enabled();doc["configured"]=config_.configured;doc["revision"]=config_.revision;doc["applied_revision"]=state_.appliedRevision;doc["manual_paused"]=state_.paused;doc["day_start_minute"]=config_.start;doc["night_start_minute"]=config_.end;doc["day_temperature"]=config_.dayTemp;doc["night_mode"]=config_.nightHeating?"temperature":"frost";doc["night_temperature"]=config_.nightTemp;doc["frost_temperature"]=config_.frostTemp;
  doc["pause_revision"]=state_.pauseRevision;doc["durable"]=durable_;doc["clock_ready"]=clock;doc["phase"]=!clock?"unknown":period.day?"day":"night";doc["status"]=!durable_?"storage_unavailable":!clock?"clock_not_ready":!enabled()?"disabled":state_.paused?"paused":pending_?"awaiting_confirmation":result_;
  String raw;serializeJson(doc,raw);return raw;
 }
};
}
