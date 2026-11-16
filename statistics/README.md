# Daily statistics

A separate minute-cron Worker reads eight narrow telemetry leaves and publishes daily aggregates. It does not control heating or read user subscriptions, commands, full telemetry or Comfort settings.

After configuring your Firebase project, rules and optional Cloudflare account:

```sh
node scripts/setup-statistics.cjs
pnpm exec wrangler secret bulk .secrets/statistics-worker-secrets.json --config statistics/wrangler.local.jsonc
pnpm exec wrangler deploy --config statistics/wrangler.local.jsonc
```

The script registers a dedicated scoped identity, verifies selected allowed/denied reads and saves credentials only in `.secrets/`. It sends no stove commands. The Worker reads the generated `PARO_DATABASE_URL` setting and `PARO_STATISTICS_FIREBASE` secret.

Daily records live in `statistics/paro/days/YYYY-MM-DD`; status is in `statistics/paro/status`. The private cursor at `statisticsRuntime/paro` advances with conditional ETags. Concurrent invocations cannot double-count an increment. Failed daily publications are repaired; retained rollover data protects the preceding day.

Pellet consumption is the lifetime counter difference, with 1 kg granularity. Counter resets and implausible jumps do not become consumption. Long gaps leave kg explicitly unassigned. There is no reconstruction of history before the collector starts.

Pellet and wood burning times are observed estimates from confirmed operating phases. Ignition, cleaning and cooling are separate transition time. Standby is idle. Therefore **total operating time minus pellet burning is not simply wood burning**. Outages do not invent burning time; partial days remain marked. Native pellet-hour counter changes are retained for CSV audit.

Days use Europe/Ljubljana, including 23/25-hour clock-change days. Records older than 1827 days are pruned in bounded batches; rules reject deletion of recent days. The app loads only the selected period, at most one year at once. CSV contains actual records rather than invented zero days.

Compact daily rows for about five years are expected to take roughly 1 MB, depending on record contents. This is an estimate; monitor storage, download and invocation usage in your own service dashboards. No raw minute-by-minute telemetry history is stored by this component.
