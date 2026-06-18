package com.dathsupplies.effex.service

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class StepTracker(private val context: Context) {

    suspend fun syncSteps() = withContext(Dispatchers.IO) {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return@withContext
        if (!ApiClient.isReady()) return@withContext

        try {
            val client   = HealthConnectClient.getOrCreate(context)
            val today    = LocalDate.now()
            val startOfDay = today.atStartOfDay(ZoneId.systemDefault()).toInstant()
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType      = StepsRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(startOfDay, Instant.now())
                )
            )
            val steps = response.records.sumOf { it.count }
            Log.i("StepTracker", "Steps today: $steps")

            val prefs = PrefsStore(context)
            ApiClient.get().sendSteps(
                EventEnvelope(
                    deviceId  = prefs.getDeviceId(),
                    eventType = EventType.STEPS_UPDATE.name,
                    payload   = StepsPayload(steps, today.toString())
                )
            )
        } catch (e: SecurityException) {
            Log.e("StepTracker", "Missing HealthConnect permission")
        } catch (e: Exception) {
            Log.e("StepTracker", "Error: ${e.message}")
        }
    }

    suspend fun hasPermission(): Boolean {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return false
        return try {
            "android.permission.health.READ_STEPS" in
                HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
        } catch (e: Exception) { false }
    }

    suspend fun getTodaySteps(): Long {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return 0L
        return try {
            val client   = HealthConnectClient.getOrCreate(context)
            val startOfDay = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant()
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType      = StepsRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(startOfDay, Instant.now())
                )
            )
            response.records.sumOf { it.count }
        } catch (e: Exception) { 0L }
    }
}
