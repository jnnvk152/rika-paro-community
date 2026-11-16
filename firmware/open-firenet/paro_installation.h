#pragma once
#if __has_include("community_config.h")
#include "community_config.h"
#else
// Local USB/LAN operation remains available. Cloud access is unconfigured.
#define PARO_FIREBASE_URL ""
#define PARO_APP_ORIGIN "https://github.com/jnnvk152/rika-paro-community"
#endif
