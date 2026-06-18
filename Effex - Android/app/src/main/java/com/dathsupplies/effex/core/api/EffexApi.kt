package com.dathsupplies.effex.core.api

import com.dathsupplies.effex.core.data.*
import retrofit2.Response
import retrofit2.http.*

interface EffexApi {

    // ── POST events (Android → server) ────────────────────────────────────────

    @POST("events/upi")
    suspend fun sendUpiDebit(@Body body: EventEnvelope<UpiDebitPayload>): Response<ServerAck>

    @POST("events/nfc")
    suspend fun sendNfcEvent(@Body body: EventEnvelope<NfcSessionPayload>): Response<ServerAck>

    @POST("events/usage")
    suspend fun sendUsageReport(@Body body: EventEnvelope<UsageReportPayload>): Response<ServerAck>

    @POST("events/usage_session")
    suspend fun sendUsageSession(@Body body: EventEnvelope<UsageSessionPayload>): Response<ServerAck>

    @POST("events/steps")
    suspend fun sendSteps(@Body body: EventEnvelope<StepsPayload>): Response<ServerAck>

    @POST("events/heartbeat")
    suspend fun sendHeartbeat(@Body body: EventEnvelope<HeartbeatPayload>): Response<ServerAck>

    // ── Wellness actions ──────────────────────────────────────────────────────

    @POST("wellness/sleep/start")
    suspend fun sleepStart(): Response<Map<String, Any>>

    @POST("wellness/sleep/wake")
    suspend fun sleepWake(): Response<Map<String, Any>>

    @POST("wellness/exercise/log")
    suspend fun logExercise(@Body req: ExerciseLogRequest): Response<ExerciseLogResponse>

    // ── GET data (dashboard) ──────────────────────────────────────────────────

    @GET("balance")
    suspend fun getBalance(): Response<BalanceResponse>

    @GET("stats/streak")
    suspend fun getStreak(): Response<StreakResponse>

    @GET("ledger")
    suspend fun getLedger(
        @Query("limit")  limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("category") category: String? = null
    ): Response<List<LedgerEntry>>

    @GET("usage/today")
    suspend fun getUsageToday(): Response<UsageTodayResponse>

    @GET("marketplace/catalogue")
    suspend fun getMarketplaceCatalogue(): Response<MarketplaceCatalogueResponse>

    @POST("marketplace/purchase")
    suspend fun purchasePass(@Body req: Map<String, String>): Response<PurchaseResponse>

    @POST("marketplace/activate/{passId}")
    suspend fun activatePass(@Path("passId") passId: Int): Response<ActivatePassResponse>

    @GET("marketplace/my-passes")
    suspend fun getMyPasses(): Response<List<MyPassEntry>>

    @GET("wellness/dashboard")
    suspend fun getWellnessDashboard(): Response<WellnessDashboard>

    @GET("health")
    suspend fun healthCheck(): Response<Map<String, Any>>
}
