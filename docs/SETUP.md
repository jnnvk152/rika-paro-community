# Set up your own installation

Start with the demo. The source snapshot contains no working cloud credentials or connection to the author’s stove. Each installation uses its own Firebase project, Google web client and optional Cloudflare account.

## 1. Firebase and local configuration

Install Node 24.12+, pnpm 11.25 and Java 21+ for emulator tests, then run `pnpm install --frozen-lockfile` from the repository root.

In your Firebase project, create a web app and an EU Realtime Database. Enable Firebase Authentication with **Google** for people and **Anonymous** for the limited device/monitor/collector identities. Approve only your intended app origins/domains in Firebase Authentication and the matching Google OAuth web client. Use HTTPS Firebase Hosting for the app.

Copy `community.config.example.json` to `community.config.json`. Fill in Firebase’s web configuration, the Google OAuth web client ID, the owner’s verified Google email, and your app origin. Use the same Hosting domain for `authDomain` and `appOrigin`. If using Workers, add your Cloudflare account ID. These are your values, not credentials from an existing installation.

```sh
pnpm configure
pnpm test
pnpm test:rules
```

Configuration writes ignored files: `.local/database.rules.json`, `.firebaserc`, `web/public/firebase-config.json`, `firmware/open-firenet/community_config.h`, local Worker configurations and optional legacy function configuration. It performs no network requests. Do not commit these files. Owner email is used in server rules, not exposed in the web client config.

Deploy only to your selected project:

```sh
pnpm exec firebase login
pnpm exec firebase deploy --only database --project YOUR_PROJECT_ID
pnpm build
pnpm exec firebase deploy --only hosting --project YOUR_PROJECT_ID
```

The shipped `firebase.json` does not deploy Cloud Functions. The normal notification route uses ESP32 and optional Workers. Firebase rules deny unauthorised access; keep them in place. From the app, additional people sign in, request access, and are approved by the owner in Settings.

## 2. Build the ESP32 firmware

Read `firmware/README.md` for the original bridge setup, USB details and available board targets. Use **this repository’s source**, not an unmodified upstream binary, for the app extensions. Run `pnpm configure` before building so the firmware is pinned to your own database URL.

The originating DevKitC setup used Arduino ESP32 core 3.3.11 and this 4 MB partition layout on an 8 MB board:

```sh
arduino-cli core install esp32:esp32@3.3.11 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli compile \
  --fqbn esp32:esp32:esp32s3:USBMode=default,CDCOnBoot=default,FlashSize=4M,PartitionScheme=min_spiffs \
  --libraries firmware/libraries \
  --output-dir build/community firmware/open-firenet
```

Verify your own board and partition layout. Back up an existing module privately before flashing; do not erase its whole flash to perform an ordinary update. Select the correct board/port in Arduino tooling. A fresh installation may need bootloader and partition files; an update must target the actual active application partition, not a guessed offset. No universal preconfigured binary is supplied.

Disconnect the module from the stove before connecting it to the computer. Preserve stove mains power during burning/cooling. The bridge’s first-boot `Open-Firenet-Setup` portal configures home Wi-Fi, as documented upstream. Provision privately; never post a Wi-Fi command or password in a public issue.

## 3. Provision the cloud identity

With your rules already deployed and the module attached to the computer:

```sh
node scripts/setup-device.cjs
python3 -m pip install pyserial
python3 scripts/provision-serial.py YOUR_ESP32_SERIAL_PORT
```

The script uses the locally authorised Firebase CLI session to register a restricted anonymous device identity. Its refresh token is saved in ignored `.secrets/device-credentials.json`, then sent to the ESP32 without printing it. Reset **only the ESP32** after saving. Administrator tokens/service-account keys are never provisioned to the module.

Return the module to the stove using its **native USB** connector and a known data cable. First verify fresh readings, USB/version acknowledgement, correct clock and absence of faults. A power LED alone is insufficient. Only then try a deliberate normal control while someone can observe the stove.

## 4. Optional background features

Follow [notifications](NOTIFICATIONS.md) for direct ESP32 alerts and the external monitor, and [statistics](../statistics/README.md) for the separate collector. The app can be added to a phone’s home screen. On iPhone, enable push from the installed home-screen app and confirm a test actually reaches the phone with the app closed.

Home Routine uses Europe/Ljubljana and a PARO 30 kg hopper assumption. Confirm those assumptions for your system. Scheduled-return logic is included but has not yet had a real future return boundary verified in this community edition.
