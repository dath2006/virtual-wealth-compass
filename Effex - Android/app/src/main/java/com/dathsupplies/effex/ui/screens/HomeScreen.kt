package com.dathsupplies.effex.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dathsupplies.effex.core.data.LedgerEntry
import com.dathsupplies.effex.service.LiveSessionState
import com.dathsupplies.effex.ui.theme.*
import com.dathsupplies.effex.ui.viewmodel.HomeViewModel
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.min

@Composable
fun HomeScreen(vm: HomeViewModel = viewModel()) {
    val state  by vm.state.collectAsState()
    val live   by vm.liveSession.collectAsState()

    Box(Modifier.fillMaxSize().background(Background)) {
        if (state.isLoading && state.balance == 0) {
            CircularProgressIndicator(
                color = NeonGreen,
                modifier = Modifier.align(Alignment.Center)
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
            ) {
                Spacer(Modifier.height(20.dp))

                // ── Header ──────────────────────────────────────────────────
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("effex", style = MaterialTheme.typography.titleLarge.copy(color = NeonGreen, fontWeight = FontWeight.Bold))
                    IconButton(onClick = { vm.load() }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh", tint = TextSecondary)
                    }
                }

                Spacer(Modifier.height(20.dp))

                // ── Balance card ─────────────────────────────────────────────
                BalanceCard(balance = state.balance, streak = state.streak)

                // ── Live session banner ──────────────────────────────────────
                live?.let { session ->
                    Spacer(Modifier.height(12.dp))
                    LiveSessionBanner(session)
                }

                // ── Active pass banner ───────────────────────────────────────
                state.activePass?.let { pass ->
                    Spacer(Modifier.height(12.dp))
                    ActivePassBanner(pass)
                }

                Spacer(Modifier.height(20.dp))

                // ── Quick stats row ──────────────────────────────────────────
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    val drain = state.usageToday?.totalDrainedToday?.toInt() ?: 0
                    StatChip(
                        label = "Drain today",
                        value = "₹$drain",
                        color = if (drain > 100) NeonRed else NeonAmber,
                        modifier = Modifier.weight(1f)
                    )
                    StatChip(
                        label = "Steps",
                        value = "${state.stepsToday}",
                        color = NeonBlue,
                        modifier = Modifier.weight(1f)
                    )
                    StatChip(
                        label = "Streak",
                        value = "${state.streak}d",
                        color = NeonGreen,
                        modifier = Modifier.weight(1f)
                    )
                }

                // ── Step progress ring ───────────────────────────────────────
                Spacer(Modifier.height(20.dp))
                StepRingCard(steps = state.stepsToday, goal = 10_000L)

                // ── Top distraction apps ─────────────────────────────────────
                state.usageToday?.apps
                    ?.filter { it.minutesToday > 0 }
                    ?.sortedByDescending { it.minutesToday }
                    ?.take(3)
                    ?.let { apps ->
                        Spacer(Modifier.height(20.dp))
                        SectionHeader("Top Distractions Today")
                        Spacer(Modifier.height(10.dp))
                        apps.forEach { app ->
                            DistractionRow(app.appName, app.minutesToday, app.surgeCostPerMin * app.minutesToday)
                            Spacer(Modifier.height(8.dp))
                        }
                    }

                // ── Recent ledger entries ────────────────────────────────────
                if (state.recentEntries.isNotEmpty()) {
                    Spacer(Modifier.height(20.dp))
                    SectionHeader("Recent")
                    Spacer(Modifier.height(10.dp))
                    state.recentEntries.take(6).forEach { entry ->
                        LedgerRow(entry)
                        Spacer(Modifier.height(8.dp))
                    }
                }

                state.error?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(it, color = NeonRed, style = MaterialTheme.typography.labelMedium)
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun BalanceCard(balance: Int, streak: Int) {
    val isNegative = balance < 0
    val gradientColors = if (isNegative)
        listOf(Color(0xFF2A0A10), Color(0xFF1A0A0A))
    else
        listOf(Color(0xFF0A1A12), Color(0xFF0A120A))

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Brush.verticalGradient(gradientColors))
            .border(1.dp, if (isNegative) NeonRedDim.copy(0.5f) else NeonGreenDim.copy(0.4f), RoundedCornerShape(20.dp))
            .padding(24.dp)
    ) {
        Column {
            Text("Virtual Balance", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Text(
                text  = "₹${if (isNegative) "" else ""}$balance",
                style = MaterialTheme.typography.displayLarge.copy(
                    color      = if (isNegative) NeonRed else NeonGreen,
                    fontWeight = FontWeight.Bold
                )
            )
            if (isNegative) {
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, null, tint = NeonRed, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Bankrupt — earn more to escape", color = NeonRed, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        // Streak badge
        if (streak > 0) {
            Row(
                modifier = Modifier.align(Alignment.TopEnd),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Filled.LocalFireDepartment, null, tint = NeonAmber, modifier = Modifier.size(18.dp))
                Text(" $streak", color = NeonAmber, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            }
        }
    }
}

@Composable
private fun LiveSessionBanner(session: LiveSessionState.Session) {
    val elapsedMin = session.elapsedMs / 60_000f
    val blinkAlpha by rememberInfiniteTransition(label = "blink").animateFloat(
        initialValue = 1f, targetValue = 0.4f,
        animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse),
        label = "blink"
    )
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF1A0D00))
            .border(1.dp, NeonAmber.copy(blinkAlpha), RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(8.dp)
                    .background(NeonRed.copy(blinkAlpha), CircleShape)
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Live: ${session.appLabel}", color = NeonAmber, style = MaterialTheme.typography.titleMedium)
                Text(
                    "%.1f min — session active".format(elapsedMin),
                    color = TextSecondary, style = MaterialTheme.typography.labelMedium
                )
            }
        }
    }
}

@Composable
private fun ActivePassBanner(pass: com.dathsupplies.effex.core.data.ActivePassInfo) {
    val minsLeft = (pass.msRemaining ?: 0L) / 60_000
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF0D0A1A))
            .border(1.dp, NeonPurple.copy(0.5f), RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(passEmoji(pass.passType), fontSize = 24.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("${pass.passType} Pass active", color = NeonPurple, style = MaterialTheme.typography.titleMedium)
                if (pass.msRemaining != null) {
                    Text("${minsLeft}m remaining", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@Composable
private fun StepRingCard(steps: Long, goal: Long) {
    val progress = min(1f, steps.toFloat() / goal.toFloat())
    val animated by animateFloatAsState(progress, tween(1200, easing = EaseOutCubic), label = "ring")

    Surface(
        shape = RoundedCornerShape(20.dp), color = Card,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, CardBorder, RoundedCornerShape(20.dp))
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(80.dp)) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val stroke = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round)
                    drawArc(color = SurfaceVariant, startAngle = -90f, sweepAngle = 360f, useCenter = false, style = stroke)
                    drawArc(color = NeonBlue, startAngle = -90f, sweepAngle = 360f * animated, useCenter = false, style = stroke)
                }
                Text("${(animated * 100).toInt()}%", color = NeonBlue, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold))
            }

            Spacer(Modifier.width(20.dp))

            Column {
                Text("Steps Today", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                Text("$steps", color = TextPrimary, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                Text("Goal: ${goal.toInt()}", color = TextMuted, style = MaterialTheme.typography.labelSmall)
                if (steps >= goal) {
                    Spacer(Modifier.height(4.dp))
                    Text("Goal reached!", color = NeonGreen, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun StatChip(label: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(12.dp), color = Card,
        modifier = modifier.border(1.dp, color.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, color = color, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            Text(label,  color = TextSecondary, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun DistractionRow(name: String, minutes: Int, cost: Int) {
    Surface(shape = RoundedCornerShape(12.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, CardBorder, RoundedCornerShape(12.dp))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(name, color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                Text("${minutes}m used today", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            Text("-₹$cost", color = NeonRed, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun LedgerRow(entry: LedgerEntry) {
    val isPositive = entry.amount >= 0
    val color = if (isPositive) NeonGreen else NeonRed
    val sign  = if (isPositive) "+" else ""
    val time  = remember(entry.timestampMs) {
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(entry.timestampMs))
    }

    Surface(shape = RoundedCornerShape(12.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, CardBorder, RoundedCornerShape(12.dp))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(entry.description.take(36), color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                Text("${entry.category} · $time", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            Text("$sign₹${entry.amount}", color = color,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(text, color = TextSecondary, style = MaterialTheme.typography.labelMedium)
}

private fun passEmoji(type: String) = when (type) {
    "MOVIE" -> "🎬"; "GAMING" -> "🎮"; "BINGE" -> "📺"; "NAP" -> "😴"
    "STUDY_BREAK" -> "☕"; "RESTAURANT" -> "🍽"; "WEEKEND_MODE" -> "🌅"
    else -> "🎟"
}
