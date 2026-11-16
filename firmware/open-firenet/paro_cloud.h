#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <mutex>
#include <atomic>
#include <vector>
#include <time.h>
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_random.h"
#include "cJSON.h"
#include "paro_cloud_policy.h"
#include "paro_push.h"
#include "paro_installation.h"

namespace paro {
struct Json {
 cJSON* p;
 explicit Json(const String& text):p(cJSON_Parse(text.c_str())){}
 ~Json(){if(p)cJSON_Delete(p);}
 Json(const Json&)=delete;
};
inline String quote(const String& text){cJSON* p=cJSON_CreateString(text.c_str());char* s=cJSON_PrintUnformatted(p);String r=s?s:"\"\"";cJSON_free(s);cJSON_Delete(p);return r;}
inline String text(cJSON* p,const char* key){auto* item=cJSON_GetObjectItemCaseSensitive(p,key);return cJSON_IsString(item)?String(item->valuestring):String();}
inline bool exactKeys(cJSON* object,const std::vector<std::string>& keys){
 if(!cJSON_IsObject(object)||cJSON_GetArraySize(object)!=(int)keys.size())return false;
 for(const auto& key:keys){int count=0;for(cJSON* item=object->child;item;item=item->next)if(item->string&&key==item->string)count++;if(count!=1)return false;}
 return true;
}
inline bool parseAction(const String& raw,Action& action){
 Json json(raw);if(!cJSON_IsObject(json.p))return false;
 // Explicit whitelist also rejects duplicate properties, unlike most JSON parsers.
 uint32_t seen=0; cJSON* item=nullptr;
 cJSON_ArrayForEach(item,json.p){
  const char* keys[]={"id","session","issuedAt","expiresAt","on","mode","power_percent","target_temperature","schedule","cycle_action"};
  int index=-1;for(int i=0;i<10;i++)if(item->string&&strcmp(item->string,keys[i])==0)index=i;
  if(index<0||(seen&(1U<<index)))return false;seen|=1U<<index;
 }
 if((seen&15)!=15)return false;
 action.id=text(json.p,"id").c_str();action.session=text(json.p,"session").c_str();
 auto number=[&](const char* key,int64_t& out){auto* p=cJSON_GetObjectItemCaseSensitive(json.p,key);if(!cJSON_IsNumber(p)||!isfinite(p->valuedouble)||floor(p->valuedouble)!=p->valuedouble||fabs(p->valuedouble)>9007199254740991.0)return false;out=(int64_t)p->valuedouble;return true;};
 if(!number("issuedAt",action.issued)||!number("expiresAt",action.expires))return false;
 if(seen&16){auto* p=cJSON_GetObjectItemCaseSensitive(json.p,"on");if(!cJSON_IsBool(p))return false;action.hasOn=true;action.on=cJSON_IsTrue(p);}
 if(seen&32){action.hasMode=true;action.mode=text(json.p,"mode").c_str();}
 int64_t value=0;
 if(seen&64){if(!number("power_percent",value)||value<30||value>100)return false;action.hasPower=true;action.power=(int)value;}
 if(seen&128){if(!number("target_temperature",value)||value<14||value>28)return false;action.hasTemperature=true;action.temperature=(int)value;}
 if(seen&512){action.hasCycleAction=true;action.cycleAction=text(json.p,"cycle_action").c_str();}
 if(seen&256){
  cJSON* schedule=cJSON_GetObjectItemCaseSensitive(json.p,"schedule");
  if(!exactKeys(schedule,{"active","setback_temperature","slots"}))return false;
  auto* active=cJSON_GetObjectItemCaseSensitive(schedule,"active");auto* setback=cJSON_GetObjectItemCaseSensitive(schedule,"setback_temperature");
  if(!cJSON_IsBool(active)||!cJSON_IsNumber(setback)||!isfinite(setback->valuedouble)||floor(setback->valuedouble)!=setback->valuedouble||setback->valuedouble<12||setback->valuedouble>22)return false;
  auto* slots=cJSON_GetObjectItemCaseSensitive(schedule,"slots");std::vector<std::string> keys;for(int i=0;i<14;i++)keys.push_back(slotName(i));
  if(!exactKeys(slots,keys))return false;
  for(int i=0;i<14;i++){auto* slot=cJSON_GetObjectItemCaseSensitive(slots,slotName(i));if(!cJSON_IsNumber(slot)||!isfinite(slot->valuedouble)||floor(slot->valuedouble)!=slot->valuedouble||slot->valuedouble<0||slot->valuedouble>23592359)return false;action.slots[i]=(int)slot->valuedouble;}
  action.hasSchedule=true;action.scheduleActive=cJSON_IsTrue(active);action.setback=(int)setback->valuedouble;
 }
 return true;
}

// All HTTPS and token refresh run on the worker task. The USB loop only copies
// snapshots and exchanges bounded messages through queues; it never waits for TLS.
class Cloud {
 struct Incoming {char raw[1024];char session[33];uint32_t received;};
 struct Reply {char id[65];bool sent;char reason[121];};
 Push push_;
 std::atomic<int> nightMinute_{1380};uint32_t homeConfigAt_=0,comfortConfigAt_=0,absenceConfigAt_=0;
 String key_,url_,refresh_,idToken_,snapshot_,session_,lastSeen_,comfortPlan_,absencePlan_;int64_t absenceFetchedAt_=0;
 bool enabled_=false,active_=false,ready_=false;
 int httpStatus_=0;esp_err_t httpError_=ESP_OK;
 uint32_t snapshotAt_=0,tokenAt_=0,tokenLifetime_=0;
 std::mutex mutex_;
 QueueHandle_t inbox_=nullptr,outbox_=nullptr;
 struct Response {String body;bool overflow=false;size_t limit=8192;};
 static esp_err_t event(esp_http_client_event_t* e){
  if(e->event_id==HTTP_EVENT_ON_DATA){auto* r=(Response*)e->user_data;if(r->body.length()+e->data_len>r->limit){r->overflow=true;return ESP_FAIL;}r->body.concat((const char*)e->data,e->data_len);}
  return ESP_OK;
 }
 bool request(const String& url,esp_http_client_method_t method,const String& body,String& result,const char* contentType="application/json",size_t limit=8192){
  Response response;response.limit=limit;esp_http_client_config_t cfg={};cfg.url=url.c_str();cfg.method=method;cfg.timeout_ms=5000;cfg.crt_bundle_attach=esp_crt_bundle_attach;cfg.event_handler=event;cfg.user_data=&response;cfg.buffer_size=1024;cfg.buffer_size_tx=2048;cfg.disable_auto_redirect=true;
  auto client=esp_http_client_init(&cfg);if(!client)return false;
  esp_http_client_set_header(client,"Content-Type",contentType);
  if(body.length())esp_http_client_set_post_field(client,body.c_str(),body.length());
  esp_err_t error=esp_http_client_perform(client);int status=esp_http_client_get_status_code(client);esp_http_client_cleanup(client);
  {std::lock_guard<std::mutex> lock(mutex_);httpStatus_=status;httpError_=error;}
  if(status==401)idToken_="";
  if(error!=ESP_OK||response.overflow||status<200||status>=300)return false;
  result=response.body;return true;
 }
 bool token(){
  if(idToken_.length()&&(uint32_t)(millis()-tokenAt_)<tokenLifetime_)return true;
  String result;
  String encoded;
  for(size_t i=0;i<refresh_.length();i++){unsigned char c=refresh_[i];if(isalnum(c)||c=='-'||c=='_'||c=='.'||c=='~')encoded+=(char)c;else{char escaped[4];snprintf(escaped,sizeof(escaped),"%%%02X",c);encoded+=escaped;}}
  if(!request("https://securetoken.googleapis.com/v1/token?key="+key_,HTTP_METHOD_POST,"grant_type=refresh_token&refresh_token="+encoded,result,"application/x-www-form-urlencoded"))return false;
  Json json(result);String value=text(json.p,"id_token"),refresh=text(json.p,"refresh_token");
  int expires=text(json.p,"expires_in").toInt();
  if(value.length()<100||expires<120)return false;
  idToken_=value;tokenAt_=millis();tokenLifetime_=(uint32_t)(min(expires,3600)-60)*1000U;
  if(refresh.length()>20&&refresh!=refresh_){Preferences p;p.begin("paro_cloud",false);size_t saved=p.putString("refresh",refresh);p.end();if(!saved)return false;refresh_=refresh;}
  return true;
 }
 bool database(const char* endpoint,esp_http_client_method_t method,const String& body,String& result){return token()&&request(url_+"/devices/paro/"+endpoint+".json?auth="+idToken_,method,body,result);}
 void offline(){std::lock_guard<std::mutex> lock(mutex_);active_=false;session_="";xQueueReset(inbox_);}
 void newSession(){
  uint8_t nonce[16];esp_fill_random(nonce,sizeof(nonce));char value[33];for(int i=0;i<16;i++)snprintf(value+i*2,3,"%02x",nonce[i]);
  std::lock_guard<std::mutex> lock(mutex_);session_=value;active_=false;
 }
 bool publish(){
  String snapshot,session;bool ready;
  {std::lock_guard<std::mutex> lock(mutex_);snapshot=snapshot_;session=session_;ready=ready_&&(uint32_t)(millis()-snapshotAt_)<3000;}
  if(!snapshot.length()||session.length()!=32)return false;
  String result;String body="{\"updatedAt\":{\".sv\":\"timestamp\"},\"session\":"+quote(session)+",\"ready\":"+(ready?"true":"false")+",\"state\":"+snapshot+"}";
  return database("telemetry",HTTP_METHOD_PUT,body,result);
 }
 void run(){
  uint32_t published=0,backoff=3000;
  for(;;){
   if(WiFi.status()!=WL_CONNECTED||time(nullptr)<1700000000){offline();vTaskDelay(pdMS_TO_TICKS(1000));continue;}
   bool active;{std::lock_guard<std::mutex> lock(mutex_);active=active_;}
   if(!active){newSession();if(!publish()){offline();vTaskDelay(pdMS_TO_TICKS(backoff));backoff=std::min<uint32_t>(backoff*2,30000U);continue;}{std::lock_guard<std::mutex> lock(mutex_);active_=true;}published=millis();backoff=3000;}
   Reply reply;bool ok=true;
   while(xQueueReceive(outbox_,&reply,0)==pdTRUE){
    String result;String body="{\"id\":"+quote(reply.id)+",\"status\":\""+(reply.sent?"sent":"rejected")+"\",\"updatedAt\":{\".sv\":\"timestamp\"},\"reason\":"+quote(reply.reason)+"}";
    // Receipt can be retried; the actual stove command is never retried.
    if(!database("receipt",HTTP_METHOD_PUT,body,result)){xQueueSendToFront(outbox_,&reply,0);ok=false;break;}
   }
   if(ok&&(uint32_t)(millis()-published)>=8000){ok=publish();if(ok)published=millis();}
   if(ok){
    String raw;if(!database("command",HTTP_METHOD_GET,"",raw))ok=false;
    else if(raw!="null"&&raw.length()<1024){
     Json json(raw);String id=text(json.p,"id"),session=text(json.p,"session"),current;
     {std::lock_guard<std::mutex> lock(mutex_);current=session_;}
     if(id.length()&&id!=lastSeen_&&session==current){Incoming value={};raw.toCharArray(value.raw,sizeof(value.raw));current.toCharArray(value.session,sizeof(value.session));value.received=millis();if(xQueueSend(inbox_,&value,0)==pdTRUE)lastSeen_=id;}
    }
   }
   if(ok&&(!homeConfigAt_||(uint32_t)(millis()-homeConfigAt_)>=30000)){
    homeConfigAt_=millis();String raw;
    if(token()&&request(url_+"/homeConfig/paro.json?auth="+idToken_,HTTP_METHOD_GET,"",raw)){
     Json config(raw);auto* minute=cJSON_GetObjectItemCaseSensitive(config.p,"night_end_minute");
     if(cJSON_IsNumber(minute)&&isfinite(minute->valuedouble)&&floor(minute->valuedouble)==minute->valuedouble&&minute->valuedouble>=0&&minute->valuedouble<=1439&&(int)minute->valuedouble!=nightMinute_.load()){
      Preferences p;if(p.begin("paro_home",false)){if(p.putInt("nightMinute",(int)minute->valuedouble)>0)nightMinute_.store((int)minute->valuedouble);p.end();}
     }
    }
   }
   if(ok&&(!comfortConfigAt_||(uint32_t)(millis()-comfortConfigAt_)>=30000)){comfortConfigAt_=millis();String raw;if(token()&&request(url_+"/comfortPlan/paro.json?auth="+idToken_,HTTP_METHOD_GET,"",raw)){std::lock_guard<std::mutex> lock(mutex_);comfortPlan_=raw;}}
   if(ok&&(!absenceConfigAt_||(uint32_t)(millis()-absenceConfigAt_)>=30000)){absenceConfigAt_=millis();String raw;const int64_t fetchedAt=time(nullptr);if(token()&&request(url_+"/absencePlans/paro.json?auth="+idToken_,HTTP_METHOD_GET,"",raw)){std::lock_guard<std::mutex> lock(mutex_);absencePlan_=raw;absenceFetchedAt_=fetchedAt;}}
   if(ok)push_.tick([this](const String& path,esp_http_client_method_t method,const String& body,String& result,const String& query){return token()&&request(url_+"/"+path+".json?auth="+idToken_+query,method,body,result,"application/json",32768);},[this](){std::lock_guard<std::mutex> lock(mutex_);return std::make_pair(snapshot_,ready_&&(uint32_t)(millis()-snapshotAt_)<3000);});
   if(!ok)offline();
   vTaskDelay(pdMS_TO_TICKS(ok?2000:3000));
  }
 }
 public:
 bool enabled()const{return enabled_;}
 String comfortPlan(){std::lock_guard<std::mutex> lock(mutex_);return comfortPlan_;}
 String absencePlan(int64_t& fetchedAt){std::lock_guard<std::mutex> lock(mutex_);fetchedAt=absenceFetchedAt_;return absencePlan_;}
 int nightMinute()const{return nightMinute_.load();}
 String pushStatus()const{return push_.json();}
 bool provision(const String& line,Print& output){
  if(push_.provision(line,output))return true;
  if(!line.startsWith("SETCLOUD:"))return false;
  if(line=="SETCLOUD:STATUS"){
   std::lock_guard<std::mutex> lock(mutex_);
   output.printf("[cloud] enabled=%d active=%d wifi=%d time=%lld http=%d error=%d heap=%u\r\n",enabled_,active_,WiFi.status()==WL_CONNECTED,(long long)time(nullptr),httpStatus_,(int)httpError_,(unsigned)ESP.getFreeHeap());
   return true;
  }
  Json json(line.substring(9));String key=text(json.p,"apiKey"),url=text(json.p,"databaseURL"),refresh=text(json.p,"refreshToken");
  if(!key.startsWith("AIza")||key.length()!=39||!strlen(PARO_FIREBASE_URL)||url!=PARO_FIREBASE_URL||refresh.length()<20||refresh.length()>2048){output.println("[cloud] Invalid configuration");return true;}
  Preferences p;p.begin("paro_cloud",false);bool ok=p.putString("apiKey",key)&&p.putString("url",url)&&p.putString("refresh",refresh);p.end();
  output.println(ok?"[cloud] Configuration saved; reset module to activate":"[cloud] Configuration was not saved");return true;
 }
 void begin(){
  Preferences p;p.begin("paro_cloud",true);key_=p.getString("apiKey","");url_=p.getString("url","");refresh_=p.getString("refresh","");p.end();
  if(key_.length()!=39||!strlen(PARO_FIREBASE_URL)||url_!=PARO_FIREBASE_URL||refresh_.length()<20)return;
  inbox_=xQueueCreate(1,sizeof(Incoming));outbox_=xQueueCreate(2,sizeof(Reply));if(!inbox_||!outbox_)return;
  configTime(0,0,"time.google.com","pool.ntp.org");
  {Preferences hp;if(hp.begin("paro_home",true)){int minute=hp.getInt("nightMinute",1380);if(minute>=0&&minute<=1439)nightMinute_.store(minute);hp.end();}}
  push_.begin();
  enabled_=xTaskCreatePinnedToCore([](void* self){((Cloud*)self)->run();},"paro-cloud",16384,this,1,nullptr,0)==pdPASS;
 }
 void snapshot(const String& value,bool ready){std::lock_guard<std::mutex> lock(mutex_);snapshot_=value;ready_=ready;snapshotAt_=millis();}
 bool take(String& raw,String& session){
  if(!enabled_)return false;Incoming value;
  if(xQueueReceive(inbox_,&value,0)!=pdTRUE)return false;
  raw=value.raw;session=value.session;return (uint32_t)(millis()-value.received)<5000;
 }
 bool current(const String& session){std::lock_guard<std::mutex> lock(mutex_);return active_&&session==session_&&session.length()==32&&WiFi.status()==WL_CONNECTED;}
 void receipt(const String& id,bool sent,const char* reason){Reply value={};id.toCharArray(value.id,sizeof(value.id));value.sent=sent;strlcpy(value.reason,reason?reason:"",sizeof(value.reason));xQueueSend(outbox_,&value,0);}
};
}
