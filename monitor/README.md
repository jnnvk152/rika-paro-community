# Background monitoring

Setup: [notifications](../docs/NOTIFICATIONS.md). Use generated `wrangler.local.jsonc`, not the example configuration. The Worker uses your `PARO_DATABASE_URL` and `PARO_APP_ORIGIN`, plus `PARO_WATCH_FIREBASE` and `PARO_WATCH_VAPID` secret bindings.

Three bounded cron paths share one separately restricted identity: connection monitoring each minute, pellet thresholds on even minutes, and ash reminders on odd minutes. It reads only approved metadata, pellet inputs, emptying records, absence dates and subscription/access checks. It cannot read full private telemetry or create heating commands.

Conditional ETags, leases and persisted per-phone receipts reduce duplicate delivery and reject superseded events. Expired/revoked recipients are skipped. Transient failures can retry; tests are explicitly labelled and never forge production readings. Provider acceptance and actual phone presentation are separate facts.

The Worker has no public HTTP endpoint. No administrator identity or CLI token is uploaded. Check your own Cloudflare CPU/usage limits; delivery depends on the selected services and the phone’s settings. The component does not control the stove’s heating policy.
