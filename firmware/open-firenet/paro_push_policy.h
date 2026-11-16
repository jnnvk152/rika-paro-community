#pragma once
#include <string>
#include <cstdint>
#include <cctype>
#include <utility>
#include <cstddef>
namespace paro {
inline bool safePushPart(const std::string& s,size_t max=128){if(s.empty()||s.size()>max)return false;for(unsigned char c:s)if(!std::isalnum(c)&&c!='_'&&c!='-')return false;return true;}
inline bool pushEndpoint(const std::string& url){
 if(url.size()>2048||url.find_first_of("?#@\\\r\n ")!=std::string::npos)return false;
 for(const char* base:{"https://fcm.googleapis.com/fcm/send/","https://web.push.apple.com/","https://updates.push.services.mozilla.com/wpush/v2/"}){
  std::string prefix(base);if(url.rfind(prefix,0)!=0||url.size()<prefix.size()+20)continue;
  for(size_t i=prefix.size();i<url.size();i++){unsigned char c=url[i];if(!std::isalnum(c)&&std::string("_:.=/+-").find(c)==std::string::npos)return false;}
  return true;
 }
 return false;
}
inline std::string pushFingerprint(bool error,int64_t code,int64_t sub,int64_t warning){return !error&&warning==0?std::string():std::to_string(error)+":"+std::to_string(code)+":"+std::to_string(sub)+":"+std::to_string(warning);}
inline bool retryPush(int status){return status==0||status==408||status==429||status>=500;}
inline std::string pushBody(bool error,int64_t code,int64_t sub,int64_t warning){
 if(error)return "The stove reports fault "+std::to_string(code)+" / "+std::to_string(sub)+". Check the stove display.";
 const char* first=nullptr;int count=0;uint32_t known=0;
 for(const auto& pair:{std::pair<uint32_t,const char*>{1,"Room sensor connection lost"},{2,"Pellet hopper lid open"},{4,"Firebox door open"},{16,"Insufficient negative pressure"},{32,"Pressure sensor deviation too high"},{64,"Calibrating air flaps"},{128,"Flue gas or burn-back flap not in heating position"},{256,"Stove not in operating position"}}){known|=pair.first;if(warning>=0&&(uint64_t(warning)&pair.first)){if(!first)first=pair.second;count++;}}
 bool unknown=warning<0||(uint64_t(warning)&~uint64_t(known));
 std::string body=first?first:"Unrecognised stove warning";
 body+=". Code "+std::to_string(warning)+".";if(count>1||(unknown&&first))body+=" Other warnings are also present.";
 return body+" Open the app for details.";
}
}
