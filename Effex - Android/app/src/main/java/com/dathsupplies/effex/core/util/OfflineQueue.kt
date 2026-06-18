package com.dathsupplies.effex.core.util

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class OfflineQueue(context: Context) {
    private val file = context.getFileStreamPath("effex_offline_queue.json")
    private val gson = Gson()

    data class QueuedEvent(
        val eventType: String,
        val jsonPayload: String,
        val queuedAtMs: Long = System.currentTimeMillis()
    )

    @Synchronized
    fun enqueue(eventType: String, payload: Any) {
        val entry    = QueuedEvent(eventType, gson.toJson(payload))
        val existing = readAll().toMutableList()
        existing.add(entry)
        val trimmed  = if (existing.size > 500) existing.takeLast(500) else existing
        file.writeText(gson.toJson(trimmed))
        Log.d("OfflineQueue", "Queued $eventType (size: ${trimmed.size})")
    }

    fun readAll(): List<QueuedEvent> {
        if (!file.exists()) return emptyList()
        return try {
            gson.fromJson(file.readText(), Array<QueuedEvent>::class.java).toList()
        } catch (e: Exception) { emptyList() }
    }

    fun size(): Int = readAll().size

    fun clear() = file.delete()

    suspend fun drainToServer() = withContext(Dispatchers.IO) {
        val pending = readAll()
        if (pending.isEmpty()) return@withContext
        Log.i("OfflineQueue", "Drain: ${pending.size} events pending")
        // TODO: map eventType → endpoint and replay — server dedup prevents double counts
        clear()
    }
}
