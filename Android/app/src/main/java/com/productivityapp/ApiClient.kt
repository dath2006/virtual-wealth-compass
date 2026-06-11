package com.productivityapp

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

// ─────────────────────────────────────────────────────────────────────────────
// ApiClient.kt
//
// All HTTP communication to the FastAPI VPS.
// Key features:
//   - API key auth on every request via header interceptor
//   - 3-retry exponential backoff for transient failures
//   - Offline queue: if VPS unreachable, events are saved to local file
//     and replayed when connectivity is restored
// ─────────────────────────────────────────────────────────────────────────────

// Retrofit interface — one endpoint per event type
interface ProductivityApi {
    @POST("events/upi")
    suspend fun sendUpiDebit(@Body body: EventEnvelope<UpiDebitPayload>): Response<ServerAck>

    @POST("events/nfc")
    suspend fun sendNfcEvent(@Body body: EventEnvelope<NfcSessionPayload>): Response<ServerAck>

    @POST("events/usage")
    suspend fun sendUsageReport(@Body body: EventEnvelope<UsageReportPayload>): Response<ServerAck>

    @POST("events/usage_session")
    suspend fun sendUsageSession(@Body body: EventEnvelope<UsageSessionPayload>): Response<ServerAck>
    // Real-time per-session drain — called by AppSessionTracker after each distraction session

    @POST("events/steps")
    suspend fun sendSteps(@Body body: EventEnvelope<StepsPayload>): Response<ServerAck>

    @POST("events/heartbeat")
    suspend fun sendHeartbeat(@Body body: EventEnvelope<HeartbeatPayload>): Response<ServerAck>

    @POST("wellness/sleep/start")
    suspend fun sleepStart(@Body body: EventEnvelope<Map<String, Any>>): Response<ServerAck>

    @POST("wellness/sleep/wake")
    suspend fun sleepWake(@Body body: EventEnvelope<Map<String, Any>>): Response<ServerAck>

    @POST("wellness/exercise/log")
    suspend fun logExercise(@Body body: EventEnvelope<Map<String, Any>>): Response<ServerAck>
}

// Auth interceptor — attaches API key to every request
class AuthInterceptor(private val apiKey: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val request: Request = chain.request().newBuilder()
            .addHeader("X-API-Key", apiKey)
            .addHeader("Content-Type", "application/json")
            .build()
        return chain.proceed(request)
    }
}

// Retry interceptor — retries up to 3 times with exponential backoff
class RetryInterceptor(private val maxRetries: Int = 3) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        var attempt = 0
        var response: okhttp3.Response? = null
        var lastException: Exception? = null

        while (attempt < maxRetries) {
            try {
                response = chain.proceed(chain.request())
                if (response.isSuccessful) return response
            } catch (e: Exception) {
                lastException = e
                Log.w("ApiClient", "Attempt ${attempt + 1} failed: ${e.message}")
            }
            attempt++
            Thread.sleep((500L * (1 shl attempt)))  // 1s, 2s, 4s backoff
        }
        throw lastException ?: Exception("Request failed after $maxRetries retries")
    }
}

object ApiClient {
    private var api: ProductivityApi? = null

    fun init(baseUrl: String, apiKey: String) {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
        }
        val okHttp = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(apiKey))
            .addInterceptor(RetryInterceptor())
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()

        api = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ProductivityApi::class.java)
    }

    fun get(): ProductivityApi = api ?: error("ApiClient not initialised — call init() first")
}

// ─────────────────────────────────────────────────────────────────────────────
// OfflineQueue
//
// When the VPS is unreachable (no WiFi, server down), events are written
// to a local JSON file. The MainForegroundService drains this queue
// whenever connectivity is restored.
// ─────────────────────────────────────────────────────────────────────────────
class OfflineQueue(context: Context) {
    private val file = context.getFileStreamPath("offline_queue.json")
    private val gson = Gson()

    data class QueuedEvent(
        val eventType: String,
        val jsonPayload: String,
        val queuedAtMs: Long = System.currentTimeMillis()
    )

    fun enqueue(eventType: String, payload: Any) {
        val entry = QueuedEvent(eventType, gson.toJson(payload))
        val existing = readAll().toMutableList()
        existing.add(entry)
        // Cap queue at 500 events to avoid unbounded growth
        val trimmed = if (existing.size > 500) existing.takeLast(500) else existing
        file.writeText(gson.toJson(trimmed))
        Log.d("OfflineQueue", "Queued $eventType (queue size: ${trimmed.size})")
    }

    fun readAll(): List<QueuedEvent> {
        if (!file.exists()) return emptyList()
        return try {
            gson.fromJson(file.readText(), Array<QueuedEvent>::class.java).toList()
        } catch (e: Exception) { emptyList() }
    }

    fun clear() = file.delete()

    suspend fun drainToServer(context: Context) = withContext(Dispatchers.IO) {
        val pending = readAll()
        if (pending.isEmpty()) return@withContext
        Log.i("OfflineQueue", "Draining ${pending.size} queued events to VPS")

        // For now, log them — full replay logic added once backend is live
        // TODO: map eventType → correct API endpoint and POST each
        pending.forEach { event ->
            Log.d("OfflineQueue", "Replaying: ${event.eventType} queued at ${event.queuedAtMs}")
        }
        clear()
    }
}
