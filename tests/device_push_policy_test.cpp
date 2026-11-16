#include <cassert>
#include "../firmware/open-firenet/paro_push_policy.h"
int main(){
 std::string token(50,'a');
 for(const char* base:{"https://fcm.googleapis.com/fcm/send/","https://web.push.apple.com/","https://updates.push.services.mozilla.com/wpush/v2/"})assert(paro::pushEndpoint(std::string(base)+token));
 for(const char* url:{"http://fcm.googleapis.com/fcm/send/","https://127.0.0.1/","https://fcm.googleapis.com.evil.test/fcm/send/","https://user:pass@web.push.apple.com/","https://web.push.apple.com:443/","https://example.org/"})assert(!paro::pushEndpoint(std::string(url)+token));
 assert(!paro::pushEndpoint("https://web.push.apple.com/"+token+"?url=x"));
 assert(paro::safePushPart("Google_UID-123"));assert(!paro::safePushPart("../owner"));
 assert(paro::pushFingerprint(false,0,0,0).empty());
 assert(paro::pushFingerprint(true,512,8,0)!=paro::pushFingerprint(true,512,9,0));
 assert(paro::pushBody(false,0,0,2).find("Pellet hopper lid")!=std::string::npos);
 assert(paro::pushBody(true,512,8,0).find("512 / 8")!=std::string::npos);
 assert(paro::pushBody(false,0,0,8).find("Unrecognised")!=std::string::npos);
 assert(paro::retryPush(503));assert(!paro::retryPush(403));assert(!paro::retryPush(410));
}
