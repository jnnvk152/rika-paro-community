#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Curier.h>
#include <Preferences.h>
#include <atomic>
#include <deque>
#include <functional>
#include <time.h>
#include "esp_http_client.h"
#include "paro_push_policy.h"
#include "paro_installation.h"

namespace paro {
// The cloud task handles bounded Firebase reads; Curier owns TLS/encryption in
// a separate task. Neither task sends a stove command or runs on the USB loop.
class Push {
 public:
 using Database=std::function<bool(const String&,esp_http_client_method_t,const String&,String&,const String&)>;
 using Snapshot=std::function<std::pair<String,bool>()>;
 private:
 struct Target {String uid,id;};
 struct Job {
  String kind,fingerprint,uid,subscription,nonce,hopperId; int64_t at=0,expiresAt=0,error=0,sub=0,warning=0; bool hasError=false;
  uint32_t sequence=0,retryAt=0;size_t userIndex=0,targetIndex=0;int phase=0,attempts=0;
  std::vector<String> users;std::vector<Target> targets;
 };
 Curier sender_; bool enabled_=false,inFlight_=false;std::atomic<bool> ready_{false};
 String publicKey_,lastProcessed_,queuedAlert_,lastHopper_,queuedHopper_;
 uint32_t configAt_=0,testsAt_=0;std::atomic<uint32_t> sent_{0};std::atomic<int> status_{0};
 std::atomic<bool> completed_{false},success_{false};
 std::deque<Job> jobs_;std::deque<String> seenTests_;
 static bool b64(const String& s,size_t length){if(s.length()!=length)return false;for(char c:s)if(!isalnum((unsigned char)c)&&c!='-'&&c!='_')return false;return true;}
 static bool parse(JsonDocument& doc,const String& value){return !deserializeJson(doc,value)&&doc.is<JsonObject>();}
 static String string(JsonVariantConst value){return value.is<const char*>()?String(value.as<const char*>()):String();}
 static String fingerprint(JsonDocument& doc){auto stove=doc["stove"];if(!stove["has_error"].is<bool>()||!stove["warning_code"].is<int64_t>())return "invalid";return pushFingerprint(stove["has_error"].as<bool>(),stove["error_code"]|int64_t(0),stove["error_sub"]|int64_t(0),stove["warning_code"].as<int64_t>()).c_str();}
 void persistAlert(const String& value){if(lastProcessed_==value)return;Preferences p;if(p.begin("paro_push",false)){p.putString("lastAlert",value);p.end();}lastProcessed_=value;}
 void persistHopper(const String& value){if(lastHopper_==value)return;Preferences p;if(p.begin("paro_push",false)){p.putString("lastHopperId",value);p.end();}lastHopper_=value;}
 void finish(bool processed){
  const auto& job=jobs_.front();
  if(job.kind=="alert"){if(processed)persistAlert(job.fingerprint);else queuedAlert_="";}
  if(job.kind=="refill"){if(processed)persistHopper(job.hopperId);else queuedHopper_="";}
  jobs_.pop_front();
 }
 bool current(const Job& job,const Snapshot& sample){
  int64_t now=(int64_t)time(nullptr)*1000;
  if(job.at<=0||job.at>now+2000||now-job.at>(job.kind=="test"?60000:300000))return false;
  if(job.kind=="test")return job.expiresAt>now;
  auto [value,fresh]=sample();if(!fresh)return false;
  if(job.kind=="refill")return true;
  JsonDocument doc;return parse(doc,value)&&fingerprint(doc)==job.fingerprint;
 }
 void observe(const Snapshot& sample){
  auto [value,fresh]=sample();if(!fresh)return;
  JsonDocument doc;if(!parse(doc,value))return;
  String fp=fingerprint(doc);if(fp=="invalid")return;
  if(!fp.length()){persistAlert("");queuedAlert_="";}
  else if(fp!=lastProcessed_&&fp!=queuedAlert_&&jobs_.size()<4){
   Job job;job.kind="alert";job.fingerprint=fp;job.at=(int64_t)time(nullptr)*1000;
   job.hasError=doc["stove"]["has_error"].as<bool>();job.error=doc["stove"]["error_code"]|int64_t(0);job.sub=doc["stove"]["error_sub"]|int64_t(0);job.warning=doc["stove"]["warning_code"]|int64_t(0);
   jobs_.push_back(std::move(job));queuedAlert_=fp;
  }
  uint32_t sequence=doc["hopper"]["sequence"]|uint32_t(0);
  String hopperId;int64_t at=0;
  for(JsonPairConst pair:doc["hopper"]["events"].as<JsonObjectConst>())if((pair.value()["seq"]|uint32_t(0))==sequence){at=pair.value()["at"]|int64_t(0);hopperId=pair.key().c_str();}
  if(sequence&&hopperId.length()&&hopperId!=lastHopper_&&hopperId!=queuedHopper_&&jobs_.size()<4){
   int64_t now=(int64_t)time(nullptr)*1000;
   if(!at||at>now+2000||now-at>300000){persistHopper(hopperId);return;}
   Job job;job.kind="refill";job.at=at;job.sequence=sequence;job.hopperId=hopperId;jobs_.push_back(std::move(job));queuedHopper_=hopperId;
  }
 }
 void tests(const Database& db){
  String response;if(!db("devicePushTests/paro",HTTP_METHOD_GET,"",response,""))return;
  JsonDocument doc;if(!parse(doc,response))return;
  int64_t now=(int64_t)time(nullptr)*1000;
  for(JsonPairConst pair:doc.as<JsonObjectConst>()){
   String uid=pair.key().c_str(),nonce=string(pair.value()["nonce"]),subscription=string(pair.value()["subscription"]);int64_t at=pair.value()["createdAt"]|int64_t(0),expires=pair.value()["expiresAt"]|int64_t(0);
   String key=uid+":"+nonce;bool seen=false;for(const auto& value:seenTests_)if(value==key)seen=true;
   if(seen||!safePushPart(uid.c_str())||!safePushPart(nonce.c_str(),64)||nonce.length()!=36||!b64(subscription,64)||at>now+2000||now-at>60000||at<=0||expires<=now||expires>now+60000||jobs_.size()>=4)continue;
   Job job;job.kind="test";job.at=at;job.expiresAt=expires;job.uid=uid;job.subscription=subscription;job.nonce=nonce;job.users.push_back(uid);job.phase=1;jobs_.push_back(std::move(job));
   seenTests_.push_back(key);if(seenTests_.size()>32)seenTests_.pop_front();
  }
 }
 void receipt(const Job& job,const Database& db,bool ok,int status){
  if(job.kind!="test")return;
  JsonDocument doc;doc["nonce"]=job.nonce;doc["status"]=ok?"accepted":"failed";doc["http"]=status;doc["updatedAt"][".sv"]="timestamp";
  String body,result;serializeJson(doc,body);db("devicePushReceipts/paro/"+job.uid,HTTP_METHOD_PUT,body,result,"");
 }
 public:
 bool provision(const String& line,Print& output){
  if(!line.startsWith("SETPUSH:"))return false;
  if(line=="SETPUSH:STATUS"){output.printf("[push] enabled=%d ready=%d http=%d sent=%lu\r\n",enabled_,ready_.load(),status_.load(),(unsigned long)sent_.load());return true;}
  JsonDocument doc;if(line.length()>2048||!parse(doc,line.substring(8))){output.println("[push] Invalid configuration");return true;}
  String pub=string(doc["publicKey"]),priv=string(doc["privateKey"]);
  if(!b64(pub,87)||!b64(priv,43)){output.println("[push] Invalid configuration");return true;}
  Preferences p;bool saved=false;if(p.begin("paro_push",false)){saved=p.putString("public",pub)&&p.putString("private",priv);p.end();}
  output.println(saved?"[push] Configuration saved; reset module to activate":"[push] Configuration was not saved");return true;
 }
 void begin(){
  Preferences p;String priv;if(!p.begin("paro_push",true))return;publicKey_=p.getString("public","");priv=p.getString("private","");lastProcessed_=p.getString("lastAlert","");lastHopper_=p.getString("lastHopperId","");p.end();
  if(!b64(publicKey_,87)||!b64(priv,43))return;
  CurierConfig config;config.vapidConfig.subject=PARO_APP_ORIGIN;config.vapidConfig.publicKeyBase64=publicKey_.c_str();config.vapidConfig.privateKeyBase64=priv.c_str();
  config.queueSize=1;config.stackSize=8192;config.coreId=0;config.requestTimeoutMs=6000;config.maxPayloadBytes=1024;config.ttlSeconds=300;config.retry.mode=CurierRetryMode::Disabled;config.retry.maxRetries=0;
  config.memory.taskStack=Strata::Placement::Internal;config.useTlsCertBundle=true;config.skipTlsCommonNameCheck=false;
  enabled_=bool(sender_.init(config));
 }
 String json()const{return String("{\"enabled\":")+(enabled_?"true":"false")+",\"ready\":"+(ready_.load()?"true":"false")+",\"publicKey\":\""+publicKey_+"\",\"http\":"+String(status_.load())+",\"sent\":"+String(sent_.load())+"}";}
 void tick(const Database& db,const Snapshot& sample){
  if(!enabled_)return;
  if(inFlight_){
   if(!completed_.load(std::memory_order_acquire))return;
   inFlight_=false;bool ok=success_.load();int code=status_.load();auto& job=jobs_.front();
   if(ok)sent_++;
   if(!ok&&retryPush(code)&&job.attempts<2&&current(job,sample)){job.attempts++;job.retryAt=millis()+5000U*job.attempts;return;}
   receipt(job,db,ok,code);job.targetIndex++;job.attempts=0;
  }
  if(!configAt_||(uint32_t)(millis()-configAt_)>=15000){
   configAt_=millis();String response;JsonDocument doc;
   ready_=db("notificationConfig/paro",HTTP_METHOD_GET,"",response,"")&&parse(doc,response)&&doc["ready"].is<bool>()&&doc["ready"].as<bool>()&&string(doc["mode"])=="device"&&string(doc["publicKey"])==publicKey_;
   if(!ready_){jobs_.clear();queuedAlert_="";queuedHopper_="";}return;
  }
  if(!ready_)return;
  if(!testsAt_||(uint32_t)(millis()-testsAt_)>=15000){testsAt_=millis();tests(db);return;}
  observe(sample);if(jobs_.empty())return;auto& job=jobs_.front();
  if(!current(job,sample)){finish(false);return;}
  String response;JsonDocument doc;
  if(job.phase==0){
   if(!db("pushSubscriptions",HTTP_METHOD_GET,"",response,"&shallow=true")||!parse(doc,response))return;
   for(JsonPairConst pair:doc.as<JsonObjectConst>()){if(job.users.size()>=8)break;String uid=pair.key().c_str();if(safePushPart(uid.c_str()))job.users.push_back(uid);}
   job.phase=1;return;
  }
  if(job.phase==1){
   if(job.userIndex>=job.users.size()||job.targets.size()>=32){job.phase=2;return;}
   String uid=job.users[job.userIndex];String path="pushSubscriptions/"+uid+(job.kind=="test"?"/"+job.subscription:"");
   if(!db(path,HTTP_METHOD_GET,"",response,job.kind=="test"?"":"&orderBy=%22%24key%22&limitToFirst=10"))return;
   if(parse(doc,response)){
    if(job.kind=="test")job.targets.push_back({uid,job.subscription});
    else for(JsonPairConst pair:doc.as<JsonObjectConst>()){String id=pair.key().c_str();if(b64(id,64)&&job.targets.size()<32)job.targets.push_back({uid,id});}
   }
   job.userIndex++;return;
  }
  if(job.targetIndex>=job.targets.size()){if(job.kind=="test"&&job.targets.empty())receipt(job,db,false,0);finish(true);return;}
  if(job.retryAt&&(int32_t)(millis()-job.retryAt)<0)return;
  const auto& target=job.targets[job.targetIndex];
  if(!db("pushSubscriptions/"+target.uid+"/"+target.id,HTTP_METHOD_GET,"",response,"")){if(job.attempts++<2)job.retryAt=millis()+5000;else{receipt(job,db,false,0);job.targetIndex++;job.attempts=0;}return;}
  if(!parse(doc,response)){receipt(job,db,false,410);job.targetIndex++;job.attempts=0;return;}
  String endpoint=string(doc["endpoint"]),p256dh=string(doc["keys"]["p256dh"]),auth=string(doc["keys"]["auth"]);while(p256dh.endsWith("="))p256dh.remove(p256dh.length()-1);while(auth.endsWith("="))auth.remove(auth.length()-1);
  if(!doc["enabled"].is<bool>()||!doc["enabled"].as<bool>()||string(doc["deviceId"])!="paro"||!doc["owner"].is<bool>()||!pushEndpoint(endpoint.c_str())||!b64(p256dh,87)||!b64(auth,22)){receipt(job,db,false,400);job.targetIndex++;job.attempts=0;return;}
  if(!doc["owner"].as<bool>()){
   String member;if(!db("members/"+target.uid+"/enabled",HTTP_METHOD_GET,"",member,"")||member!="true"){receipt(job,db,false,403);job.targetIndex++;job.attempts=0;return;}
  }
  if(!current(job,sample)){finish(false);return;}
  if(ESP.getFreeHeap()<60000)return;
  CurierSubscription subscription;subscription.endpoint=endpoint.c_str();subscription.p256dh=p256dh.c_str();subscription.auth=auth.c_str();
  CurierPayload payload;payload.tag=job.kind=="test"?"paro-notification-test":job.kind=="refill"?"paro-refill":"paro-stove-alert";payload.timestamp=(uint64_t)job.at;
  payload.hasData=true;payload.data["view"]=job.kind=="refill"?"control":"status";
  if(job.kind=="test"){payload.title="PARO · Notification test";payload.body="Your ESP32 sent this notification without a paid server. No stove command was sent.";}
  else if(job.kind=="refill"){payload.title="PARO · Pellet hopper";payload.body="Did you refill the hopper? Open the app and confirm a full hopper, 15 kg or another amount.";}
  else{payload.title=job.hasError?"PARO · Stove fault":"PARO · Stove warning";payload.body=pushBody(job.hasError,job.error,job.sub,job.warning);}
  completed_.store(false);inFlight_=true;
  auto queued=sender_.send(subscription,payload,[this](CurierSendResult result){success_.store(result.ok());status_.store(result.statusCode);completed_.store(true,std::memory_order_release);});
  if(!queued){inFlight_=false;status_.store(0);receipt(job,db,false,0);job.targetIndex++;}
 }
};
}
