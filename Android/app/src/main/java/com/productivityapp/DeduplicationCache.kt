package com.productivityapp

import android.content.Context
import java.security.MessageDigest

// ─────────────────────────────────────────────────────────────────────────────
// DeduplicationCache.kt
//
// Problem: the same UPI transaction fires on BOTH channels:
//   1. NotificationListenerService (app notification)
//   2. SmsBroadcastReceiver (bank SMS, arrives ~2-5 seconds later)
//
// This cache prevents inserting the same debit twice.
//
// Strategy: hash(amount + 30-second time bucket) → if seen in last 60s, skip.
// ─────────────────────────────────────────────────────────────────────────────
class DeduplicationCache(context: Context) {
    // In-memory set — clears on process restart (fine, process restart means
    // new events, and the server has its own dedup by timestamp+amount)
    private val seen = mutableSetOf<String>()
    private val cleanupMs = 90_000L  // forget keys after 90 seconds

    data class SeenEntry(val key: String, val seenAtMs: Long)
    private val entries = mutableListOf<SeenEntry>()

    // Generate a dedup key: SHA1(amount + 30-second bucket)
    // Two events for ₹250 within the same 30-second window get the same key
    fun buildKey(amountRupees: Int, timestampMs: Long = System.currentTimeMillis()): String {
        val bucket = timestampMs / 30_000  // 30-second window
        val raw    = "${amountRupees}_$bucket"
        return MessageDigest.getInstance("SHA-1")
            .digest(raw.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(16)
    }

    // Returns true if this is a NEW event (should be processed)
    // Returns false if it's a duplicate (should be skipped)
    fun checkAndMark(key: String): Boolean {
        evictExpired()
        if (entries.any { it.key == key }) {
            return false  // duplicate — skip
        }
        entries.add(SeenEntry(key, System.currentTimeMillis()))
        return true  // new event — process it
    }

    private fun evictExpired() {
        val now = System.currentTimeMillis()
        entries.removeAll { now - it.seenAtMs > cleanupMs }
    }
}
