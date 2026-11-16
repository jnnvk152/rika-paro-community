#pragma once
#include <cstdint>
#include <ctime>
namespace paro {
inline int weekday(int year,int month,int day){
 static const int offset[]={0,3,2,5,0,3,5,1,4,6,2,4};
 if(month<3)year--;return (year+year/4-year/100+year/400+offset[month-1]+day)%7;
}
// EU summer time changes at 01:00 UTC on the last Sunday in March/October.
// No global timezone is changed: cloud token expiry continues to use UTC.
inline int ljubljanaOffset(int64_t epoch){
 time_t at=(time_t)epoch;tm u={};gmtime_r(&at,&u);const int month=u.tm_mon+1,year=u.tm_year+1900;
 const int march=31-weekday(year,3,31),october=31-weekday(year,10,31);
 bool summer=(month>3&&month<10)||(month==3&&(u.tm_mday>march||(u.tm_mday==march&&u.tm_hour>=1)))||(month==10&&(u.tm_mday<october||(u.tm_mday==october&&u.tm_hour<1)));
 return summer?7200:3600;
}
inline int64_t localWall(int64_t epoch){return epoch+ljubljanaOffset(epoch);}
inline int64_t latestNightBoundary(int64_t now,int minute){
 if(now<1700000000||minute<0||minute>1439)return 0;
 const int64_t wall=localWall(now);int64_t boundary=wall/86400*86400+minute*60;
 if(boundary>wall)boundary-=86400;return boundary;
}
struct HomeNightPolicy {
 int64_t manualSince=0,appliedBoundary=0;
 bool blockedOff=false;
 // A firmware upgrade must not replay a missed cutoff immediately on reconnect.
 void upgradeGuard(){manualSince=0;}
 void requestOff(){blockedOff=true;manualSince=0;}
 void requestOn(){blockedOff=false;manualSince=0;}
 bool observe(bool manual,int64_t now,bool actualOn=true){
  if(blockedOff){if(actualOn)return false;blockedOff=false;manualSince=0;return true;}
  if(!manual&&manualSince){manualSince=0;return true;}
  if(manual&&!manualSince&&now>=1700000000){manualSince=now;return true;}
  return false;
 }
 int64_t due(int64_t now,int minute)const{
  if(blockedOff||!manualSince||now<manualSince||now<1700000000)return 0;
  const auto boundary=latestNightBoundary(now,minute);
  return boundary>localWall(manualSince)&&boundary>appliedBoundary?boundary:0;
 }
};
}
