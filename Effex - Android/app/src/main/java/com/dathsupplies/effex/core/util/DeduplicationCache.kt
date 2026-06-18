package com.dathsupplies.effex.core.util

import java.security.MessageDigest

class DeduplicationCache {
    private data class Entry(val key: String, val seenAtMs: Long)
    private val entries = mutableListOf<Entry>()
    private val ttlMs = 90_000L

    fun buildKey(amountRupees: Int, timestampMs: Long = System.currentTimeMillis()): String {
        val bucket = timestampMs / 30_000
        val raw    = "${amountRupees}_$bucket"
        return MessageDigest.getInstance("SHA-1")
            .digest(raw.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(16)
    }

    @Synchronized
    fun checkAndMark(key: String): Boolean {
        evictExpired()
        if (entries.any { it.key == key }) return false
        entries.add(Entry(key, System.currentTimeMillis()))
        return true
    }

    private fun evictExpired() {
        val now = System.currentTimeMillis()
        entries.removeAll { now - it.seenAtMs > ttlMs }
    }
}
