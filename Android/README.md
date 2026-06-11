# Productivity Economy — Android Thin Client

## Architecture
This Android app is a **pure sensor layer**. It has no business logic.
It captures system events and POSTs them to your FastAPI backend.

```
Android (capture)          →    VPS FastAPI (process)
──────────────────               ──────────────────────
UPI notifications          →    POST /events/upi
Bank SMS                   →    POST /events/upi  (same endpoint)
App usage stats            →    POST /events/usage
NFC desk tap               →    POST /events/nfc
Step count                 →    POST /events/steps
```

## Files
- `ApiClient.kt`              — Retrofit HTTP client, auth header, retry logic
- `EventPayload.kt`           — Shared data models for all event types
- `MainForegroundService.kt`  — Keeps everything alive in background
- `UpiNotificationListener.kt`— Intercepts UPI/bank notifications
- `SmsBroadcastReceiver.kt`   — Bank SMS fallback (READ_SMS)
- `UsageTracker.kt`           — Polls UsageStatsManager every 30 min
- `NfcHandler.kt`             — Detects NFC tap, sends start/stop events
- `StepTracker.kt`            — HealthConnect step count, syncs every 2 hrs
- `PermissionSetupActivity.kt`— One-time permission grant UI
- `DeduplicationCache.kt`     — Prevents double-firing same UPI transaction

## Setup
1. Set your VPS URL + API key in `local.properties`:
   ```
   VPS_BASE_URL=https://your-vps-ip:8000
   API_SECRET_KEY=your_secret_key_here
   ```
2. Build and install APK on Nothing Phone 2
3. Grant all permissions via the setup screen
4. The foreground service starts automatically on boot
