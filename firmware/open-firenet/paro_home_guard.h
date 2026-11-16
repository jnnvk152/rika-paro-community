#pragma once
#include "firenet_link.h"
namespace paro {
// The sensor table calls the stove fault mask errMask32. The CDC status field
// called "error" is a different record and is never a stove sensor alias.
inline bool nightErrorFree(const firenet::StoveModel& model){
 const auto named=model.sensors.find("errMask32");
 if(named!=model.sensors.end())return named->second==0;
 const int index=firenet::sensIndexByName("errMask32");
 return index>=0&&static_cast<size_t>(index)<model.sensors_pos.size()&&model.sensors_pos[index]==0;
}
}
