package com.productivityapp

import android.app.AppOpsManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import android.util.Log

// ─────────────────────────────────────────────────────────────────────────────
// PermissionSetupActivity.kt
//
// The ONLY Activity with a UI. It's a simple permission checklist.
// Once all permissions are granted, it starts the foreground service
// and shows a "All set" confirmation.
//
// Built with pure Android Views (no Compose, no XML layout) to keep
// the thin client truly minimal. No navigation, no fragments.
// ─────────────────────────────────────────────────────────────────────────────
class PermissionSetupActivity : AppCompatActivity() {

    data class PermCheck(
        val title: String,
        val description: String,
        val isGranted: () -> Boolean,
        val requestGrant: () -> Unit
    )

    private var isHealthGranted = false

    private val requestHealthPermissionLauncher = registerForActivityResult(
        androidx.health.connect.client.PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        isHealthGranted = granted.contains("android.permission.health.READ_STEPS")
        Log.d("PermissionSetupActivity", "Health Connect steps permission status updated: $isHealthGranted")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }
        setContentView(root)

        // Title
        root.addView(TextView(this).apply {
            text = "Productivity Economy"
            textSize = 22f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 8)
        })
        root.addView(TextView(this).apply {
            text = "Grant permissions to start tracking"
            textSize = 14f
            setTextColor(0xFF888888.toInt())
            setPadding(0, 0, 0, 32)
        })

        val permissions = buildPermissionList()
        val rows = mutableListOf<Triple<PermCheck, TextView, View>>()

        permissions.forEach { perm ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, 12, 0, 12)
            }

            val statusDot = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(16, 16).apply { marginEnd = 16 }
                setBackgroundResource(android.R.drawable.presence_online)
            }

            val textCol = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val titleView = TextView(this).apply { text = perm.title; textSize = 15f }
            val descView  = TextView(this).apply {
                text = perm.description; textSize = 12f
                setTextColor(0xFF888888.toInt())
            }
            textCol.addView(titleView)
            textCol.addView(descView)

            val btn = Button(this).apply {
                text = if (perm.isGranted()) "✓" else "Grant"
                isEnabled = !perm.isGranted()
                setOnClickListener { perm.requestGrant(); refreshAll(rows, null) }
            }

            row.addView(statusDot)
            row.addView(textCol)
            row.addView(btn)
            root.addView(row)
            rows.add(Triple(perm, titleView, btn))

            // Divider
            root.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1)
                setBackgroundColor(0xFFEEEEEE.toInt())
            })
        }

        val startBtn = Button(this).apply {
            text = "Start Service"
            setPadding(0, 16, 0, 0)
            isEnabled = allGranted(permissions)
            setOnClickListener {
                MainForegroundService.start(this@PermissionSetupActivity)
                Toast.makeText(this@PermissionSetupActivity,
                    "Economy engine running", Toast.LENGTH_SHORT).show()
            }
        }
        root.addView(startBtn)

        // Check every 2 seconds while activity is visible (permissions granted in other apps)
        val checkRunnable = object : Runnable {
            override fun run() {
                lifecycleScope.launch {
                    isHealthGranted = StepTracker(this@PermissionSetupActivity).hasPermission()
                    refreshAll(rows, startBtn)
                }
                root.postDelayed(this, 2000)
            }
        }
        root.postDelayed(checkRunnable, 2000)
    }

    private fun buildPermissionList(): List<PermCheck> = listOf(
        PermCheck(
            title = "Notification Access",
            description = "Read UPI app notifications to track spending",
            isGranted = { isNotificationListenerEnabled() },
            requestGrant = {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        ),
        PermCheck(
            title = "SMS Permission",
            description = "Bank SMS fallback for UPI transactions",
            isGranted = {
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_SMS) ==
                PackageManager.PERMISSION_GRANTED
            },
            requestGrant = {
                ActivityCompat.requestPermissions(this,
                    arrayOf(android.Manifest.permission.READ_SMS,
                            android.Manifest.permission.RECEIVE_SMS), 101)
            }
        ),
        PermCheck(
            title = "Usage Stats",
            description = "Track which apps you use and for how long",
            isGranted = { isUsageStatsGranted() },
            requestGrant = {
                startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                })
            }
        ),
        PermCheck(
            title = "Post Notifications",
            description = "Show balance updates and bankrupt alerts",
            isGranted = {
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            },
            requestGrant = {
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    ActivityCompat.requestPermissions(this,
                        arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 102)
                }
            }
        ),
        PermCheck(
            title = "HealthConnect (Steps)",
            description = "Optional — earn virtual income by walking",
            isGranted = { isHealthGranted },
            requestGrant = {
                try {
                    requestHealthPermissionLauncher.launch(setOf("android.permission.health.READ_STEPS"))
                } catch (e: Exception) {
                    Log.e("PermissionSetupActivity", "Failed to launch Health Connect permission dialog: ${e.message}")
                    val intent = Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS")
                    startActivity(intent)
                }
            }
        )
    )

    private fun isNotificationListenerEnabled(): Boolean {
        val cn = android.content.ComponentName(this, UpiNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver,
            "enabled_notification_listeners") ?: return false
        return flat.contains(cn.flattenToString())
    }

    private fun isUsageStatsGranted(): Boolean {
        val appOps = getSystemService(APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(), packageName
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun allGranted(perms: List<PermCheck>) = perms.dropLast(1).all { it.isGranted() }

    private fun refreshAll(rows: List<Triple<PermCheck, TextView, View>>, startBtn: Button?) {
        rows.forEach { (perm, _, btn) ->
            (btn as? Button)?.apply {
                text = if (perm.isGranted()) "✓" else "Grant"
                isEnabled = !perm.isGranted()
            }
        }
        startBtn?.isEnabled = allGranted(rows.map { it.first })
    }
}
