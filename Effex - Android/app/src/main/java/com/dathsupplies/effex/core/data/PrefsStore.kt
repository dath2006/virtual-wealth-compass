package com.dathsupplies.effex.core.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "effex_prefs")

class PrefsStore(private val context: Context) {

    companion object {
        val KEY_BASE_URL  = stringPreferencesKey("base_url")
        val KEY_API_KEY   = stringPreferencesKey("api_key")
        val KEY_DEVICE_ID = stringPreferencesKey("device_id")
    }

    val baseUrl: Flow<String>  = context.dataStore.data.map { it[KEY_BASE_URL]  ?: "" }
    val apiKey: Flow<String>   = context.dataStore.data.map { it[KEY_API_KEY]   ?: "" }
    val deviceId: Flow<String> = context.dataStore.data.map { it[KEY_DEVICE_ID] ?: "effex_device" }

    suspend fun getBaseUrl()  = baseUrl.first()
    suspend fun getApiKey()   = apiKey.first()
    suspend fun getDeviceId() = deviceId.first()

    suspend fun isConfigured(): Boolean {
        val url = getBaseUrl()
        val key = getApiKey()
        return url.isNotBlank() && key.isNotBlank()
    }

    suspend fun save(baseUrl: String, apiKey: String, deviceId: String) {
        context.dataStore.edit { prefs ->
            prefs[KEY_BASE_URL]  = baseUrl.trimEnd('/')
            prefs[KEY_API_KEY]   = apiKey
            prefs[KEY_DEVICE_ID] = deviceId.ifBlank { "effex_device" }
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
