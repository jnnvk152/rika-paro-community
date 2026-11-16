#pragma once
#include <stdint.h>
#include <cstddef>
#include <vector>
namespace paro {
struct HopperEvent {uint32_t seq; int64_t at; int64_t counter;};
struct HopperJournal {
 static constexpr size_t limit=32;
 uint32_t seq=0; bool known=false,open=false;
 std::vector<HopperEvent> events;
 bool observe(bool next,int64_t counter,int64_t at){
  if(counter<0||counter>1000000000LL)return false;
  if(known&&next==open)return false;
  bool closed=known&&open&&!next;known=true;open=next;
  if(closed){events.push_back({++seq,at,counter});if(events.size()>limit)events.erase(events.begin());}
  return true;
 }
};
}
