package com.dathsupplies.effex.core.api

import android.util.Log
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class AuthInterceptor(private val apiKey: String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val req: Request = chain.request().newBuilder()
            .addHeader("X-API-Key", apiKey)
            .addHeader("Content-Type", "application/json")
            .build()
        return chain.proceed(req)
    }
}

class RetryInterceptor(private val maxRetries: Int = 3) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        var attempt = 0
        var lastEx: Exception? = null
        while (attempt < maxRetries) {
            try {
                val response = chain.proceed(chain.request())
                if (response.isSuccessful) return response
                response.close()
            } catch (e: Exception) {
                lastEx = e
                Log.w("ApiClient", "Attempt ${attempt + 1} failed: ${e.message}")
            }
            attempt++
            Thread.sleep(500L * (1 shl attempt))
        }
        throw lastEx ?: Exception("Request failed after $maxRetries retries")
    }
}

object ApiClient {
    @Volatile private var api: EffexApi? = null
    @Volatile private var currentBaseUrl: String = ""
    @Volatile private var currentApiKey: String = ""

    fun init(baseUrl: String, apiKey: String) {
        if (baseUrl == currentBaseUrl && apiKey == currentApiKey && api != null) return
        currentBaseUrl = baseUrl
        currentApiKey  = apiKey

        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
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
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(okHttp)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(EffexApi::class.java)

        Log.i("ApiClient", "Initialised → $baseUrl")
    }

    fun get(): EffexApi = api ?: error("ApiClient not initialised — call init() first")
    fun isReady(): Boolean = api != null
}
