#include <cassert>
#include <cstring>
#include "../firmware/open-firenet/paro_cloud_policy.h"
int main(){
 const int64_t now=1700000000000LL;
 paro::Action a;a.id="command-123456789";a.session=std::string(32,'a');a.issued=now;a.expires=now+12000;a.hasOn=true;a.on=true;
 auto check=[&](const paro::Action& value,bool online=true,bool ready=true,bool error=false,bool wood=false,bool room=true){return paro::policy(value,a.session,"",now,online,ready,error,wood,room);};
 assert(!check(a));assert(check(a,false));assert(check(a,true,false));assert(check(a,true,true,true));assert(check(a,true,true,false,true));
 auto expired=a;expired.expires=now;assert(check(expired));expired=a;expired.issued=now+5000;assert(check(expired));expired=a;expired.expires=now+60000;assert(check(expired));
 auto wrong=a;wrong.session=std::string(32,'b');assert(check(wrong));assert(std::strcmp(paro::policy(a,a.session,a.id,now,true,true,false,false,true),"duplicate")==0);
 a.on=false;assert(!check(a,true,true,true));
 a.hasOn=false;a.hasMode=true;a.mode="comfort";assert(check(a,true,true,false,false,false));
 a.mode="manual";assert(!check(a,true,true,false,false,false));a.mode="auto";assert(!check(a));a.mode="unknown";assert(check(a));
 a.hasMode=false;a.hasPower=true;a.power=30;assert(!check(a));a.power=100;assert(!check(a));a.power=101;assert(check(a));a.hasPower=false;
 a.hasTemperature=true;a.temperature=14;assert(!check(a));a.temperature=28;assert(!check(a));a.temperature=29;assert(check(a));
 a.hasTemperature=false;assert(check(a));
 a.hasSchedule=true;a.scheduleActive=true;a.setback=16;a.hasMode=true;a.mode="auto";a.hasPower=true;a.power=70;
 auto scheduleCheck=[&](){return paro::policy(a,a.session,"",now,true,true,false,false,true,true);};
 assert(check(a));assert(!scheduleCheck());
 for(int i=0;i<14;i++){a.slots[i]=6000900;assert(!scheduleCheck());a.slots[i]=6000960;assert(scheduleCheck());a.slots[i]=9000600;assert(scheduleCheck());a.slots[i]=0;}
 for(int i=0;i<14;i+=2){a.slots[i]=6000900;a.slots[i+1]=8591200;assert(scheduleCheck());a.slots[i+1]=9001200;assert(!scheduleCheck());a.slots[i]=0;a.slots[i+1]=0;}
 a.hasOn=true;a.on=false;assert(scheduleCheck());a.hasOn=false;a.hasTemperature=true;assert(scheduleCheck());a.hasTemperature=false;
 a.mode="manual";assert(scheduleCheck());a.mode="auto";a.setback=23;assert(scheduleCheck());a.setback=12;assert(!scheduleCheck());
 a.hasMode=false;a.hasPower=false;a.scheduleActive=false;assert(!scheduleCheck());
 a.id="tiny";assert(scheduleCheck());
 a.id="cycle-command-1234567";a.hasSchedule=false;a.hasCycleAction=true;a.cycleAction="pause";assert(!check(a,true,true,true,false,false));
 a.cycleAction="resume";assert(check(a,true,true,true));assert(check(a,true,true,false,true));assert(check(a,true,true,false,false,false));assert(!check(a));
 a.hasOn=true;assert(check(a));a.hasOn=false;a.cycleAction="unknown";assert(check(a));
}
