# Phone notifications

The preferred path sends stove faults/warnings and hopper-refill questions from the ESP32. An optional separate Cloudflare Worker handles connection loss/recovery, pellet thresholds, ash reminders and return-date checks. Neither needs Firebase Cloud Functions. Your own service limits and charges still apply.

## Direct ESP32 sender

After Firebase, rules and module provisioning:

```sh
node scripts/setup-notifications.cjs --prepare-device
python3 scripts/provision-push.py YOUR_ESP32_SERIAL_PORT
```

Provision while the module is on the computer, disconnected from the stove. VAPID keys stay in `.secrets/web-push.json`; the script transfers them without printing them. Reset only the ESP32, reconnect to the stove and check fresh telemetry. Once `push.enabled` and `push.ready` are true:

```sh
node scripts/setup-notifications.cjs --activate-device
```

In the home-screen app choose Settings → Enable notifications. Enable each phone separately. Send a labelled test, close the app and check actual receipt. Provider acceptance alone does not prove the phone displayed it.

## External monitor

Use your own Cloudflare account. Add its ID to `community.config.json` and run `pnpm configure`; this creates `monitor/wrangler.local.jsonc` with your database/origin. Do not deploy the example configuration.

```sh
node scripts/setup-watchdog.cjs --prepare
pnpm exec wrangler login
pnpm exec wrangler secret bulk .secrets/watchdog-worker-secrets.json --config monitor/wrangler.local.jsonc
pnpm exec wrangler deploy --config monitor/wrangler.local.jsonc
node scripts/setup-watchdog.cjs --activate
node scripts/setup-watchdog.cjs --test
```

Preparation creates a separate restricted identity and saves Worker secrets locally. No administrator credential is sent to Cloudflare. The Worker has cron triggers and no public application endpoint. To pause it: `node scripts/setup-watchdog.cjs --disable`. Check status with `--status`. A labelled pellet test is available with `--test-pellets`; it does not change actual stock or send heating commands.

Thresholds are **strictly below** 50%, 20% and 10%, using unrounded estimated stock. An alert fires once per relevant crossing and rearms after a confirmed refill raises stock. Stale readings, counter resets, missing journal events or an unknown amount suppress misleading stock alerts. Large drops report the most urgent newly crossed level.

The return reminder is at 19:00 Europe/Ljubljana on the previous evening. It lets you extend the date and does not require a reply for the planned morning return. Ash reminders need two actual logged emptyings to establish an interval. No fabricated initial calibration is included.

The `functions/` directory retains an optional legacy Cloud Functions sender for developers. It is not deployed by default and may require billing. Use it only if you deliberately configure that alternative; do not enable two independent senders for the same event unintentionally.
