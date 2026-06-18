package com.dathsupplies.effex.service

import android.app.Activity
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.util.Log
import com.dathsupplies.effex.EffexApp
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import kotlinx.coroutines.*
import java.nio.charset.Charset

object NfcHandler {
    private val scope = CoroutineScope(Dispatchers.IO)

    fun handleIntent(intent: Intent, context: android.content.Context) {
        val tag   = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java) ?: return
        val tagId = tag.id.joinToString("") { "%02X".format(it) }
        val label = readLabel(tag) ?: "Desk Tag"

        Log.i("NfcHandler", "Tag: $tagId ($label)")

        scope.launch {
            try {
                if (!ApiClient.isReady()) return@launch
                val prefs = PrefsStore(context)
                val resp  = ApiClient.get().sendNfcEvent(
                    EventEnvelope(
                        deviceId  = prefs.getDeviceId(),
                        eventType = EventType.NFC_SESSION_START.name,
                        payload   = NfcSessionPayload(tagId, label)
                    )
                )
                resp.body()?.notification?.let { push ->
                    EffexApp.notify(context, push)
                    Log.i("NfcHandler", "Server: ${push.body}")
                }
            } catch (e: Exception) {
                Log.e("NfcHandler", "Failed: ${e.message}")
                EffexApp.offlineQueue?.enqueue(EventType.NFC_SESSION_START.name,
                    NfcSessionPayload(tagId, label))
            }
        }
    }

    private fun readLabel(tag: Tag): String? = try {
        val ndef = Ndef.get(tag) ?: return null
        ndef.connect()
        val msg  = ndef.cachedNdefMessage ?: return null
        ndef.close()
        val payload = msg.records.firstOrNull()?.payload ?: return null
        val enc  = if ((payload[0].toInt() and 0x80) == 0) Charsets.UTF_8 else Charset.forName("UTF-16")
        val langLen = payload[0].toInt() and 0x3F
        String(payload, 1 + langLen, payload.size - 1 - langLen, enc)
    } catch (e: Exception) { null }
}

class NfcDispatchActivity : Activity() {
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        NfcHandler.handleIntent(intent, this)
        finish()
    }

    override fun onResume() {
        super.onResume()
        intent?.let {
            NfcHandler.handleIntent(it, this)
            finish()
        }
    }
}
