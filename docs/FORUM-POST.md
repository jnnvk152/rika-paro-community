Hi everyone,

I found this thread while looking for a way to control my RIKA PARO from my phone without buying the official Firenet module. Your work encouraged me to try an ESP32-S3, starting with Open Firenet and my PARO running stove software 2.29. Thank you to the original author and everyone who shared their findings here—the USB bridge and protocol work made this possible.

Since then, I’ve built a phone-first web app around that foundation, with help from Codex. It works without a Home Assistant server. My additions include:

- **Home Routine:** configurable daytime Comfort, a night break or lower night temperature, frost protection and Home/Away settings. It runs on the ESP32 with the app closed.
- Comfort, Manual power and an editable weekly schedule, with clear live stove status and an animated flame.
- Secure remote access with Google sign-in and owner-approved additional users.
- Push alerts for faults, connection loss and estimated pellet stock below 50%, 20% and 10%.
- A hopper estimate based on confirmed refills and the stove’s consumption counter, plus ash-drawer reminders.
- Daily pellet-consumption and estimated pellet/wood burning statistics, with CSV export.

I’ve prepared a separate **English version**, without my personal installation settings:

**https://github.com/jnnvk152/rika-paro-community**

The source is **free to use, modify and share under AGPL-3.0**. You’re welcome to use it as a starting point for your own project; you configure your own hardware and cloud services. It includes a demo and setup instructions. Return-date automation is included but still awaiting a real-world scheduled-return test.

Feedback, improvements and experiences with other RIKA models are very welcome!
