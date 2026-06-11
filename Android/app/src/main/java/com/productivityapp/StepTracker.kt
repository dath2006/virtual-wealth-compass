package com.productivityapp

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

// ─────────────────────────────────────────────────────────────────────────────
// StepTracker.kt
//
// Reads today's step count from HealthConnect and sends it to the VPS.
// Called every 2 hours by MainForegroundService.
//
// The VPS decides whether to credit step income (it knows the tiered thresholds
// and whether today's income has already been credited).
//
// HealthConnect setup:
//   - Add health_permissions to Manifest (done)
//   - User must grant READ_STEPS in HealthConnect app
//   - PermissionSetupActivity handles the grant flow
// ─────────────────────────────────────────────────────────────────────────────
class StepTracker(private val context: Context) {

    suspend fun syncSteps() = withContext(Dispatchers.IO) {
        val availability = HealthConnectClient.getSdkStatus(context)
        if (availability != HealthConnectClient.SDK_AVAILABLE) {
            Log.w("StepTracker", "HealthConnect not available (status: $availability)")
            return@withContext
        }

        try {
            val client = HealthConnectClient.getOrCreate(context)
            val today  = LocalDate.now()
            val startOfDay = today.atStartOfDay(ZoneId.systemDefault()).toInstant()

            val request = ReadRecordsRequest(
                recordType      = StepsRecord::class,
                timeRangeFilter = TimeRangeFilter.between(startOfDay, Instant.now())
            )
            val response = client.readRecords(request)
            val stepsToday = response.records.sumOf { it.count }

            Log.i("StepTracker", "Today's steps: $stepsToday")

            val envelope = EventEnvelope(
                deviceId  = BuildConfig.DEVICE_ID,
                eventType = EventType.STEPS_UPDATE.name,
                payload   = StepsPayload(
                    stepsToday = stepsToday,
                    date       = today.toString()  // "2025-06-11"
                )
            )
            ApiClient.get().sendSteps(envelope)

        } catch (e: SecurityException) {
            Log.e("StepTracker", "Missing HealthConnect permission: ${e.message}")
        } catch (e: Exception) {
            Log.e("StepTracker", "HealthConnect error: ${e.message}")
        }
    }

    suspend fun hasPermission(): Boolean {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE)
            return false
        return try {
            val client = HealthConnectClient.getOrCreate(context)
            val granted = client.permissionController.getGrantedPermissions()
            "android.permission.health.READ_STEPS" in granted
        } catch (e: Exception) { false }
    }
}
