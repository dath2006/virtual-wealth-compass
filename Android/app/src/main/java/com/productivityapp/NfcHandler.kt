package com.productivityapp

import android.app.Activity
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.nio.charset.Charset

// ─────────────────────────────────────────────────────────────────────────────
// NfcHandler.kt
//
// Handles NFC desk tag detection.
//
// Flow:
//   1. User taps NFC tag → NfcDispatchActivity receives intent
//   2. Tag ID is read + any NDEF label ("Desk", "Library", etc.)
//   3. Server tracks open/close sessions — Android only sends the tap event
//      Server decides: "is this a START (no open session) or STOP (session open)?"
//      This keeps the state machine server-side, not on the phone.
//
// Tag setup (one-time):
//   Use NFC Tools app to write NDEF record with MIME type:
//   application/com.productivityapp.desktag
//   And text content: "Desk Tag" or "Library Tag" (the label)
// ─────────────────────────────────────────────────────────────────────────────
object NfcHandler {

    private val scope = CoroutineScope(Dispatchers.IO)

    fun handleIntent(intent: Intent) {
        val tag = intent.getParcelableExtra<Tag>(NfcAdapter.EXTRA_TAG) ?: return
        val tagId = bytesToHex(tag.id)
        val label = readNdefLabel(tag) ?: "Desk Tag"  // default label if unwritten

        Log.i("NfcHandler", "Tag tapped: $tagId ($label)")

        scope.launch {
            try {
                val envelope = EventEnvelope(
                    deviceId  = BuildConfig.DEVICE_ID,
                    // Server decides START vs STOP based on open session state
                    eventType = EventType.NFC_SESSION_START.name,
                    payload   = NfcSessionPayload(
                        tagId    = tagId,
                        tagLabel = label
                    )
                )
                val response = ApiClient.get().sendNfcEvent(envelope)
                response.body()?.notification?.let { push ->
                    // Server response tells user: "Session started" or "Session stopped, earned ₹120"
                    Log.i("NfcHandler", "Server: ${push.body}")
                }
            } catch (e: Exception) {
                Log.e("NfcHandler", "Failed to send NFC event: ${e.message}")
                OfflineQueue(
                    // Note: NFC events in offline queue are tricky — if server never got START,
                    // the STOP will be orphaned. Mark as "needs_reconciliation" on server.
                    // For now, log it — full offline reconciliation in v2.
                    context = ProductivityApp.appContext
                ).enqueue(EventType.NFC_SESSION_START.name,
                    NfcSessionPayload(tagId, label))
            }
        }
    }

    // Read NDEF text record from tag (the label written with NFC Tools app)
    private fun readNdefLabel(tag: Tag): String? {
        return try {
            val ndef = Ndef.get(tag) ?: return null
            ndef.connect()
            val message = ndef.cachedNdefMessage ?: return null
            ndef.close()

            val record = message.records.firstOrNull() ?: return null
            val payload = record.payload

            // NDEF Text Record format: [status_byte][lang_code][text]
            // Status byte encodes UTF encoding and language code length
            val textEncoding = if ((payload[0].toInt() and 0x80) == 0) Charsets.UTF_8
                               else Charset.forName("UTF-16")
            val langCodeLength = payload[0].toInt() and 0x3F
            String(payload, 1 + langCodeLength, payload.size - 1 - langCodeLength, textEncoding)
        } catch (e: Exception) {
            Log.w("NfcHandler", "Could not read NDEF label: ${e.message}")
            null
        }
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02X".format(it) }
}

// ─────────────────────────────────────────────────────────────────────────────
// NfcDispatchActivity.kt
//
// Transparent activity that only exists to receive NFC intents.
// It has no UI — it handles the tag and finishes immediately.
// This avoids needing the app to be in foreground for NFC to work.
// ─────────────────────────────────────────────────────────────────────────────
class NfcDispatchActivity : Activity() {

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        NfcHandler.handleIntent(intent)
        finish()
    }

    override fun onResume() {
        super.onResume()
        intent?.let {
            NfcHandler.handleIntent(it)
            finish()
        }
    }
}
