# Security boundaries

Use your own projects. Generated installation files, refresh tokens, VAPID private keys and flash backups stay out of Git.

Google sign-in and server-side Firebase rules control remote access; knowing the address does not grant access. The owner is selected by verified Google email in generated rules. Approved members can also control the stove.

The ESP32 has a scoped anonymous identity: publish its telemetry/receipts and read its commands/configuration. It cannot approve users or create heating commands. Separate monitor and collector identities have narrow permissions and cannot control heating. No administrator/service-account key belongs on a module or Worker.

Commands require a fresh ready session, short expiry and appropriate stove/sensor state. Persisted claims prevent automatic retries of uncertain commands. The original LAN API is not protected by the app’s remote login; keep it on a trusted network without port forwarding. HTTPS certificate checks remain enabled. Flash encryption is not enabled, so physical access may expose stored scoped credentials.

Report issues without credentials, subscription endpoints or private telemetry. Revoke exposed credentials; deleting a current file does not erase Git history.
