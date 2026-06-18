package com.dathsupplies.effex.ui.screens

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.PermissionController
import com.dathsupplies.effex.service.MainForegroundService
import com.dathsupplies.effex.service.StepTracker
import com.dathsupplies.effex.service.UpiNotificationListener
import com.dathsupplies.effex.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

@Composable
fun SetupScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    var tick    by remember { mutableStateOf(0) }

    var healthGranted by remember { mutableStateOf(false) }
    val healthLauncher = rememberLauncherForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        healthGranted = "android.permission.health.READ_STEPS" in granted
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            healthGranted = StepTracker(context).hasPermission()
            tick++
            delay(2_000)
        }
    }

    fun isNotifListenerOn(): Boolean {
        val cn   = ComponentName(context, UpiNotificationListener::class.java)
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(cn.flattenToString())
    }

    fun isSmsGranted() = ContextCompat.checkSelfPermission(
        context, android.Manifest.permission.READ_SMS
    ) == PackageManager.PERMISSION_GRANTED

    fun isUsageGranted(): Boolean {
        val ops  = context.getSystemService(AppOpsManager::class.java)
        val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun isPostNotifGranted() = ContextCompat.checkSelfPermission(
        context, android.Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED

    data class Perm(
        val title: String, val desc: String,
        val isGranted: () -> Boolean, val action: () -> Unit
    )

    val perms = listOf(
        Perm("Notification Access", "Intercept UPI payment notifications",
            { isNotifListenerOn() },
            { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        ),
        Perm("SMS Permission", "Bank SMS fallback for payments",
            { isSmsGranted() },
            { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }
        ),
        Perm("Usage Stats Access", "Track distraction app screen time",
            { isUsageGranted() },
            { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply { data = Uri.parse("package:${context.packageName}") }) }
        ),
        Perm("Post Notifications", "Show balance updates and alerts",
            { isPostNotifGranted() },
            { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }
        ),
        Perm("HealthConnect (Steps)", "Earn virtual income by walking",
            { healthGranted },
            { healthLauncher.launch(setOf("android.permission.health.READ_STEPS")) }
        )
    )

    // Required = first 4 (HealthConnect is optional)
    val allRequired by remember(tick) { derivedStateOf { perms.dropLast(1).all { it.isGranted() } } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
        ) {
            Spacer(Modifier.height(24.dp))
            Text("Permissions", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            Text(
                "Grant access so Effex can track your economy in the background.",
                style = MaterialTheme.typography.bodyMedium, color = TextSecondary,
                modifier = Modifier.padding(top = 6.dp, bottom = 24.dp)
            )

            perms.forEachIndexed { i, perm ->
                val granted by remember(tick) { derivedStateOf { perm.isGranted() } }
                PermissionRow(
                    title    = perm.title,
                    desc     = perm.desc,
                    granted  = granted,
                    optional = i == perms.lastIndex,
                    onClick  = perm.action
                )
                Spacer(Modifier.height(12.dp))
            }

            Spacer(Modifier.height(16.dp))

            Button(
                onClick  = {
                    MainForegroundService.start(context)
                    onDone()
                },
                enabled  = allRequired,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape    = RoundedCornerShape(14.dp),
                colors   = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Background)
            ) {
                Text("Start Economy Engine", style = MaterialTheme.typography.titleMedium)
            }

            if (!allRequired) {
                Spacer(Modifier.height(8.dp))
                Text("Grant the first 4 permissions to continue", color = TextSecondary,
                    style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(bottom = 24.dp))
            }
        }
    }
}

@Composable
private fun PermissionRow(
    title: String, desc: String, granted: Boolean, optional: Boolean, onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Card,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, if (granted) NeonGreenDim.copy(alpha = 0.4f) else CardBorder, RoundedCornerShape(14.dp))
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(if (granted) NeonGreen.copy(alpha = 0.15f) else SurfaceVariant, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (granted) Icon(Icons.Filled.Check, null, tint = NeonGreen, modifier = Modifier.size(20.dp))
                else         Icon(Icons.Outlined.Circle, null, tint = TextMuted,  modifier = Modifier.size(20.dp))
            }

            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = MaterialTheme.typography.titleMedium, color = TextPrimary)
                    if (optional) {
                        Spacer(Modifier.width(8.dp))
                        Text("optional", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                    }
                }
                Text(desc, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
            }

            Spacer(Modifier.width(12.dp))

            if (!granted) {
                TextButton(onClick = onClick) {
                    Text("Grant", color = NeonGreen)
                }
            }
        }
    }
}
