# PARO Community · a mobile app for Open Firenet

A phone-first, self-hosted web app and ESP32-S3 extension for a RIKA PARO stove. English interface, installable home-screen app, optional secure remote access, push alerts, pellet estimates and daily statistics. No Home Assistant server is required.

This grew out of the [Open Firenet discussion on the Home Assistant forum](https://community.home-assistant.io/t/open-firenet-local-usb-cdc-gateway-for-rika-pellet-stoves/1012233). I wanted to control my PARO from my phone without buying the official Firenet module. Open Firenet supplied the essential USB communication foundation; I built an app and additional routines around it, with help from Codex. Thanks to the original author and everyone who shared their findings.

**Free and open source under AGPL-3.0.** Use, study, modify and share it as a starting point for your project, subject to the licence. This is source for your own installation, not a shared cloud service. Hosting and third-party service quotas or charges are your responsibility.

## What this adds

- **Mobile controls:** normal on/off, Comfort temperature, Manual power and the stove’s built-in weekly schedule, with two intervals per day, copying days and a setback temperature.
- **Clear live status:** freshness/offline indicators and separate standby, ignition, pellet/wood burning, cleaning and shutdown states. The flame animation requires confirmed current burning.
- **Home Routine:** configurable daytime Comfort, a night break or lower night temperature, native frost protection and a persistent manual pause. It runs on the ESP32 with the app closed.
- **Home/Away and a return date:** pause heating while away and resume the routine on your return morning. An evening reminder offers an extension; answering is optional. A later manual shutdown cancels a pending return.
- **Estimated pellet stock:** after a hopper event, confirm a full hopper, a 15 kg bag, another amount or no refill. The stove’s consumption counter reduces the estimate, shown as kg and percentage beside the stove illustration.
- **Push notifications:** stove faults/warnings, estimated stock below 50%, 20% and 10%, connection loss/recovery, return-date checks and ash-drawer reminders. Each phone opts in separately.
- **Ash reminders:** logged emptyings establish a kg/hour reference from the previous interval. This is an estimate, not an ash sensor.
- **Statistics:** daily pellet kg, estimated pellet/wood burning time, transition time, selectable periods and CSV export. Outages and partial days are visible. Records are retained for about five years.
- **Access management:** Google sign-in, owner-approved users, revocation and separate scoped device/monitor/collector identities.
- **Demo mode:** explore the app without sending stove commands.

The USB protocol, bridge, original local interface, MQTT and reverse engineering originate from [Open Firenet](https://github.com/openfirenet/open-firenet). Derived firmware source, upstream notices and licences remain in `firmware/`. See [credits](CREDITS.md).

## Try the interface

Use Node 24.12+ and pnpm 11.25:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed address with `?demo=1`, or choose **Settings → Enable demo**. Hardware and Firebase are not needed for the demo. An unconfigured sign-in message is expected.

For the optional local launcher: `pnpm build`, then `pnpm local` or `pnpm local:phone` for a phone on the same trusted Wi-Fi. Enter `open-firenet.local` or the module’s private IP in Settings. This path needs a running computer; the Firebase path does not after provisioning. Keep the local launcher and bridge API on your LAN, without port forwarding.

## Install your own system

Read [setup](docs/SETUP.md), [hardware](docs/HARDWARE.md), [Home Routine](docs/HOME-ROUTINE.md), [notifications](docs/NOTIFICATIONS.md) and [statistics](statistics/README.md).

Copy `community.config.example.json` to `community.config.json`, enter your own project details and run `pnpm configure`. This prepares ignored installation files locally; it does not create resources, deploy or send stove commands. The public snapshot has no live owner configuration, Wi-Fi password, refresh token, subscription or flash backup. The original private installation and history remain separate.

The template rules use the invalid address `owner@example.invalid`. Configuration generates owner-specific rules under ignored `.local/`. Authentication rules remain authoritative; never replace them with public read/write access.

## Behaviour and limits

For example, choose Comfort **06:00–21:00 at 21 °C**, with native frost protection overnight. Basic controls remain on the Control screen. Applying the native Schedule explicitly disables Home Routine first.

A normal manual shutdown persistently pauses future automatic starts. A previously planned return from an absence is an explicit exception; a later manual shutdown cancels it too. Rebooting or saving settings does not silently clear a pause.

The calendar is currently **Europe/Ljubljana**, including daylight saving changes, not the phone’s location. Hopper capacity is **30 kg / approximately 47 l**, specific to this PARO setup. Adapt and test these assumptions for another location/model.

The originating setup uses a PARO with stove software **2.29** and an original **ESP32-S3-DevKitC-1-N8R8**. Remote reads/controls, day/night operation, iPhone sign-in and push tests have been exercised there. This English edition adds portable configuration and has its own automated/demo checks; it has not been flashed onto that live stove. Return-date automation is tested in simulation, but a future real-world return boundary has not yet been observed.

Control acknowledgement is not proof of ignition/flame. Unknown fault meanings stay unverified. Pellet stock and burning times are estimates. This is an independent hobby project, not an official RIKA product; check your own equipment before unattended use. Do not interrupt mains power while the stove burns or cools. Official stove update files are not included.

## Development

```sh
pnpm test
pnpm test:rules       # Firebase emulator; Java 21+
pnpm build
bash firmware/test/build_and_test.sh
c++ -std=c++17 tests/return_schedule_test.cpp -o /tmp/paro-return
/tmp/paro-return
```

See [security boundaries](SECURITY.md). Contributions, translations and reports from other RIKA owners are welcome. Remove credentials and private telemetry before sharing logs.
