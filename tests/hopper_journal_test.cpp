#include <cassert>
#include <cstddef>
#include "../firmware/open-firenet/paro_hopper_policy.h"
int main(){
 paro::HopperJournal journal;
 assert(journal.observe(false,2600,100));assert(journal.events.empty());
 assert(!journal.observe(false,2600,101));
 assert(journal.observe(true,2600,102));assert(journal.events.empty());
 // Saved open state survives a restart; closing produces exactly one event.
 auto restored=journal;
 assert(restored.observe(false,2601,103));assert(restored.events.size()==1);
 assert(restored.events[0].counter==2601);assert(restored.events[0].at==103);
 assert(!restored.observe(false,2602,104));
 for(int i=0;i<40;i++){restored.observe(true,2602+i,200+i*2);restored.observe(false,2602+i,201+i*2);}
 assert(restored.seq==41);assert(restored.events.size()==32);assert(restored.events.front().seq==10);
 assert(!restored.observe(true,-1,300));assert(!restored.open);
}
