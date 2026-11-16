# Hardware

- Original **Espressif ESP32-S3-DevKitC-1-N8R8**, two Micro-USB sockets. A non-S3 ESP32 without native USB device capability is not equivalent.
- A known working USB **data** cable from stove USB-A to the board’s **USB / ESP32-S3 USB** socket. The **UART / USB-to-UART** socket can light the power LED without establishing the stove protocol.
- Computer data cable for flashing/provisioning. Use one power source at a time.
- 2.4 GHz home Wi-Fi; internet for remote access and push.
- RIKA room sensor for Comfort and Home Routine.
- An enclosure that fits your exact board.

The stove USB port normally powers the ESP32. No Raspberry Pi, Home Assistant server or running computer is required for the Firebase route; the optional LAN launcher needs a computer.

The original stove runs 2.29. Obtain official stove updates/compatibility advice from RIKA or a dealer. Flashing the ESP32 is a separate operation. For module maintenance, disconnect only its USB cable; never interrupt stove mains power during burning/cooling. Use the native USB socket and known data cable when reconnecting.

Example STL files: broodforce, [Thingiverse 6640089](https://www.thingiverse.com/thing:6640089), CC BY 4.0. Check dimensions before printing; clones and board revisions differ.
