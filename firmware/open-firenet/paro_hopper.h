#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <time.h>
#include "cJSON.h"
#include "esp_random.h"
#include "paro_hopper_policy.h"
namespace paro {
// Small, persistent journal. No stove commands and no per-sample flash writes.
class Hopper {
 HopperJournal journal_; String identity_; bool durable_=false;
 String eventsJson()const{
  String result="{";
  for(size_t i=0;i<journal_.events.size();i++){
   const auto& e=journal_.events[i];if(i)result+=",";
   char item[180];snprintf(item,sizeof item,"\"%s-%lu\":{\"seq\":%lu,\"at\":%lld,\"counter\":%lld}",identity_.c_str(),(unsigned long)e.seq,(unsigned long)e.seq,(long long)e.at,(long long)e.counter);result+=item;
  }
  return result+"}";
 }
 void save(){
  String value="{\"identity\":\""+identity_+"\",\"seq\":"+String(journal_.seq)+",\"known\":"+(journal_.known?"true":"false")+",\"open\":"+(journal_.open?"true":"false")+",\"events\":"+eventsJson()+"}";
  Preferences p;if(!p.begin("paro_hopper",false)){durable_=false;return;}durable_=p.putString("journal",value)==value.length();p.end();
 }
 public:
 void begin(){
  Preferences p;String value;if(p.begin("paro_hopper",true)){value=p.getString("journal","");p.end();}
  cJSON* root=cJSON_Parse(value.c_str());
  auto field=[&](const char* k){return cJSON_GetObjectItemCaseSensitive(root,k);};
  auto* identity=field("identity");auto* seq=field("seq");auto* events=field("events");
  if(cJSON_IsString(identity)&&strlen(identity->valuestring)==16&&cJSON_IsNumber(seq)&&seq->valuedouble>=0&&seq->valuedouble<4294967295.0&&cJSON_IsObject(events)&&cJSON_GetArraySize(events)<=32){
   identity_=identity->valuestring;journal_.seq=(uint32_t)seq->valuedouble;journal_.known=cJSON_IsTrue(field("known"));journal_.open=cJSON_IsTrue(field("open"));
   cJSON* item=nullptr;cJSON_ArrayForEach(item,events){
    auto* n=cJSON_GetObjectItemCaseSensitive(item,"seq");auto* at=cJSON_GetObjectItemCaseSensitive(item,"at");auto* counter=cJSON_GetObjectItemCaseSensitive(item,"counter");
    if(cJSON_IsNumber(n)&&n->valuedouble>0&&n->valuedouble<=journal_.seq&&cJSON_IsNumber(at)&&at->valuedouble>=0&&cJSON_IsNumber(counter)&&counter->valuedouble>=0&&counter->valuedouble<=1e9)journal_.events.push_back({(uint32_t)n->valuedouble,(int64_t)at->valuedouble,(int64_t)counter->valuedouble});
   }
   durable_=true;
  }
  cJSON_Delete(root);
  if(identity_.length()!=16){uint8_t bytes[8];esp_fill_random(bytes,sizeof bytes);char id[17];for(int i=0;i<8;i++)snprintf(id+i*2,3,"%02x",bytes[i]);identity_=id;save();}
 }
 void observe(bool open,int64_t counter){int64_t now=time(nullptr);if(journal_.observe(open,counter,now>1700000000?now*1000:0))save();}
 String json()const{return String("{\"open\":")+(journal_.known?(journal_.open?"true":"false"):"null")+",\"durable\":"+(durable_?"true":"false")+",\"sequence\":"+String(journal_.seq)+",\"events\":"+eventsJson()+"}";}
};
}
