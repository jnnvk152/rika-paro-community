#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "paro_return_policy.h"
namespace paro {
class ScheduledReturn {
 ReturnPolicy policy_;bool durable_=true;int64_t verifiedAt_=0;
 static bool parse(JsonDocument& doc,ReturnPlan& p){
  if(!doc.is<JsonObject>()||!doc["id"].is<const char*>()||!doc["returnDate"].is<const char*>()||!doc["active"].is<bool>()||!doc["revision"].is<uint32_t>())return false;
  p.id=doc["id"].as<const char*>();p.date=doc["returnDate"].as<const char*>();p.active=doc["active"];p.revision=doc["revision"];p.day=p.date.empty()?-1:returnDateDay(p.date);return validReturnPlan(p);
 }
 bool save(){
  JsonDocument doc;const auto& p=policy_.plan;
  doc["id"]=p.id;doc["returnDate"]=p.date;doc["active"]=p.active;doc["revision"]=p.revision;doc["phase"]=(int)policy_.phase;
  doc["pauseRevision"]=policy_.pauseRevision;doc["armedAt"]=policy_.armedAt;doc["startedAt"]=policy_.startedAt;doc["completedAt"]=policy_.completedAt;
  String raw;serializeJson(doc,raw);Preferences nvs;if(!nvs.begin("paro_return",false)){durable_=false;return false;}
  durable_=nvs.putString("state",raw)>0;nvs.end();return durable_;
 }
 public:
 void begin(){
  Preferences nvs;if(!nvs.begin("paro_return",true))return;const String raw=nvs.getString("state","");nvs.end();if(!raw.length())return;
  JsonDocument doc;ReturnPlan p;
  if(raw.length()>2048||deserializeJson(doc,raw)||!parse(doc,p)||!doc["phase"].is<int>()||doc["phase"].as<int>()<0||doc["phase"].as<int>()>(int)ReturnPhase::Unconfirmed||!doc["pauseRevision"].is<uint32_t>()||!doc["armedAt"].is<int64_t>()||!doc["startedAt"].is<int64_t>()||!doc["completedAt"].is<int64_t>()){durable_=false;return;}
  policy_.plan=p;policy_.phase=(ReturnPhase)doc["phase"].as<int>();policy_.pauseRevision=doc["pauseRevision"];policy_.armedAt=doc["armedAt"];policy_.startedAt=doc["startedAt"];policy_.completedAt=doc["completedAt"];
 }
 void configure(const String& raw,int64_t fetchedAt,const ComfortPlan& comfort,uint32_t pause){
  JsonDocument doc;ReturnPlan next;
  if(raw.length()>2048||deserializeJson(doc,raw)||!parse(doc,next)||time(nullptr)<1700000000){verifiedAt_=0;return;}
  const auto& old=policy_.plan;
  if(next.revision<old.revision||(next.revision==old.revision&&(next.id!=old.id||next.date!=old.date||next.active!=old.active))){verifiedAt_=0;return;}
  verifiedAt_=fetchedAt;
  if(policy_.install(next,comfort,pause,time(nullptr)))save();
 }
 void observe(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause){if(policy_.observe(comfort,stove,pause,time(nullptr)))save();}
 bool due(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause)const{return durable_&&policy_.due(comfort,stove,pause,time(nullptr),verifiedAt_);}
 bool claim(){policy_.claim(time(nullptr));return save();}
 void failed(){policy_.failed();save();}
 String json(const ComfortPlan& comfort,const DaySnapshot& stove,uint32_t pause)const{
  JsonDocument doc;const auto& p=policy_.plan;
  doc["id"]=p.id;doc["revision"]=p.revision;doc["active"]=p.active;doc["return_date"]=p.date;doc["day_start_minute"]=comfort.start;
  doc["status"]=!durable_?"storage_unavailable":p.active&&time(nullptr)<1700000000?"clock_not_ready":returnPhaseName(policy_.phase);
  doc["reason"]=policy_.phase==ReturnPhase::Armed?policy_.blocker(comfort,stove,pause,time(nullptr),verifiedAt_):returnPhaseName(policy_.phase);
  doc["durable"]=durable_;doc["verified_at"]=verifiedAt_;doc["completed_at"]=policy_.completedAt;doc["started_at"]=policy_.startedAt;
  String raw;serializeJson(doc,raw);return raw;
 }
};
}
