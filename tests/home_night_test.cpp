#include <cassert>
#include "../firmware/open-firenet/paro_home_guard.h"
#include "../firmware/open-firenet/paro_home_policy.h"
int main(){
 // 24 October 2026 20:00 UTC = 22:00 Ljubljana.
 const int64_t start=1792872000LL;
 paro::HomeNightPolicy p;assert(p.observe(true,start));assert(!p.due(start+3599,1380));
 const auto boundary=p.due(start+3600,1380);assert(boundary);p.appliedBoundary=boundary;assert(!p.due(start+7200,1380));
 // An actual OFF/Away observation cancels the manual session; never starts it.
 assert(p.observe(false,start+7200));assert(!p.due(start+90000,1380));
 // A reboot with a saved session catches a missed evening cutoff.
 p.manualSince=start;p.appliedBoundary=0;assert(p.due(start+7200,1380));
 // A deliberate new manual session after the cutoff lasts until the next one.
 p.manualSince=start+3700;assert(!p.due(start+7200,1380));assert(!p.due(start+90000,1380));assert(p.due(start+97200,1380));
 assert(!p.due(0,1380));assert(!p.due(start-1,1380));assert(!p.due(start+90000,1440));
 // OFF intent survives stale ON telemetry and a persisted/reloaded policy.
 p.manualSince=start;p.requestOff();assert(!p.due(start+7200,1380));
 assert(!p.observe(true,start+7200,true));auto reboot=p;assert(!reboot.due(start+97200,1380));
 assert(reboot.observe(false,start+7300,false));assert(!reboot.blockedOff);
 assert(reboot.observe(true,start+7400,true));assert(!reboot.due(start+7500,1380));
 reboot.requestOff();reboot.requestOn();assert(!reboot.blockedOff&&!reboot.manualSince);
 // The requested 03:00 cutoff across the 25 October clock change occurs once,
 // at 02:00 UTC after the repeated 02:00 local hour.
 paro::HomeNightPolicy three;three.observe(true,start);
 assert(!three.due(start+6*3600-1,180));assert(three.due(start+6*3600,180));
 three.appliedBoundary=three.due(start+6*3600,180);assert(!three.due(start+7*3600,180));

 // Use the real protocol model and field contract, not a synthetic "error" flag.
 assert(firenet::sensName(3)=="errMask32");
 firenet::StoveModel actual;actual.sensors={{"errMask32",0},{"roomTemp",200},{"mainState",1},{"subState",3}};
 assert(paro::nightErrorFree(actual));
 actual.sensors["errMask32"]=512;actual.sensors["error"]=0;assert(!paro::nightErrorFree(actual));
 actual.sensors.clear();actual.sensors["error"]=0;assert(!paro::nightErrorFree(actual));
 actual.sensors.clear();actual.sensors_pos={200,0,0,0};assert(paro::nightErrorFree(actual));
 actual.sensors_pos[3]=512;assert(!paro::nightErrorFree(actual));
 actual.sensors_pos.clear();assert(!paro::nightErrorFree(actual));
 // The real error guard and persisted policy together permit exactly one 03:00
 // restoration on a healthy model, without permitting a fault or missing mask.
 actual.sensors["errMask32"]=0;paro::HomeNightPolicy integration;integration.observe(true,start);
 const auto atThree=start+6*3600;assert(integration.due(atThree,180)&&paro::nightErrorFree(actual));
 actual.sensors["errMask32"]=512;assert(!(integration.due(atThree,180)&&paro::nightErrorFree(actual)));
 actual.sensors["errMask32"]=0;integration.appliedBoundary=integration.due(atThree,180);assert(!integration.due(atThree+60,180));
 // Upgrade discards the missed session, preserving both OFF protection and the
 // previous attempt marker. It cannot send a catch-up command during install.
 integration.manualSince=start;integration.blockedOff=true;auto savedBoundary=integration.appliedBoundary;
 integration.upgradeGuard();assert(!integration.manualSince&&integration.blockedOff&&integration.appliedBoundary==savedBoundary);
 integration.requestOn();integration.observe(true,atThree+4*3600);assert(!integration.due(atThree+4*3600,180));
 assert(integration.due(atThree+86400,180));
 assert(paro::ljubljanaOffset(1792889999LL)==7200);
 assert(paro::ljubljanaOffset(1792890000LL)==3600);
}
