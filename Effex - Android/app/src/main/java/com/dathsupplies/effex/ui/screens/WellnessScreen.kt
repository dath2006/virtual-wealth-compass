package com.dathsupplies.effex.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.ui.theme.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

// ── ViewModel ─────────────────────────────────────────────────────────────────

class WellnessViewModel : ViewModel() {
    private val _dashboard = MutableStateFlow<WellnessDashboard?>(null)
    val dashboard = _dashboard.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _snackbar = MutableStateFlow<String?>(null)
    val snackbar = _snackbar.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            try {
                _dashboard.value = ApiClient.get().getWellnessDashboard().body()
            } catch (e: Exception) {
                _snackbar.value = "Could not load wellness data"
            } finally {
                _loading.value = false
            }
        }
    }

    fun sleepStart() {
        viewModelScope.launch {
            try {
                ApiClient.get().sleepStart()
                _snackbar.value = "Sleep session started. Good night!"
                load()
            } catch (e: Exception) {
                _snackbar.value = "Failed to start sleep: ${e.message?.take(60)}"
            }
        }
    }

    fun sleepWake() {
        viewModelScope.launch {
            try {
                val resp = ApiClient.get().sleepWake().body()
                val msg  = resp?.get("message")?.toString() ?: "Good morning! Sleep logged."
                _snackbar.value = msg
                load()
            } catch (e: Exception) {
                _snackbar.value = "Failed to log wake: ${e.message?.take(60)}"
            }
        }
    }

    fun logExercise(type: String, durationMin: Float) {
        viewModelScope.launch {
            try {
                val resp = ApiClient.get().logExercise(ExerciseLogRequest(type, durationMin)).body()
                _snackbar.value = "Earned ₹${resp?.earned ?: 0} for ${type.lowercase()} (${durationMin.toInt()}min)"
                load()
            } catch (e: Exception) {
                _snackbar.value = "Failed to log exercise: ${e.message?.take(60)}"
            }
        }
    }

    fun clearSnackbar() { _snackbar.value = null }
}

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun WellnessScreen(vm: WellnessViewModel = viewModel()) {
    val dashboard     by vm.dashboard.collectAsState()
    val loading       by vm.loading.collectAsState()
    val snackbar      by vm.snackbar.collectAsState()
    val snackbarState = remember { SnackbarHostState() }

    var showExerciseDialog by remember { mutableStateOf(false) }

    LaunchedEffect(snackbar) {
        snackbar?.let {
            snackbarState.showSnackbar(it)
            vm.clearSnackbar()
        }
    }

    if (showExerciseDialog) {
        ExerciseDialog(
            onDismiss = { showExerciseDialog = false },
            onLog     = { type, mins ->
                vm.logExercise(type, mins)
                showExerciseDialog = false
            }
        )
    }

    Scaffold(containerColor = Background, snackbarHost = { SnackbarHost(snackbarState) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = 20.dp, end = 20.dp,
                    top = padding.calculateTopPadding() + 16.dp,
                    bottom = padding.calculateBottomPadding() + 16.dp
                )
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Wellness", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                IconButton(onClick = { vm.load() }) {
                    Icon(Icons.Filled.Refresh, null, tint = TextSecondary)
                }
            }

            Spacer(Modifier.height(4.dp))

            // Sleep multiplier chip
            dashboard?.sleepMultiplierToday?.let { mult ->
                val multColor = when {
                    mult >= 1.3f -> NeonGreen
                    mult >= 1.0f -> NeonBlue
                    else         -> NeonAmber
                }
                Surface(
                    shape = RoundedCornerShape(8.dp), color = multColor.copy(0.1f),
                    modifier = Modifier.border(1.dp, multColor.copy(0.4f), RoundedCornerShape(8.dp))
                ) {
                    Text(
                        "Sleep multiplier today: ×${"%.2f".format(mult)}",
                        color    = multColor,
                        style    = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
                Spacer(Modifier.height(16.dp))
            }

            // ── Sleep quick-actions ──────────────────────────────────────────
            val isSleeping = dashboard?.currentSleep?.isSleeping == true

            Text("Sleep", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                WellnessActionButton(
                    label   = if (isSleeping) "Wake Up" else "Sleep",
                    icon    = if (isSleeping) Icons.Filled.WbSunny else Icons.Filled.Bedtime,
                    color   = if (isSleeping) NeonAmber else NeonBlue,
                    onClick = { if (isSleeping) vm.sleepWake() else vm.sleepStart() },
                    modifier = Modifier.weight(1f)
                )
                WellnessActionButton(
                    label    = "Log Exercise",
                    icon     = Icons.Filled.FitnessCenter,
                    color    = NeonGreen,
                    onClick  = { showExerciseDialog = true },
                    modifier = Modifier.weight(1f)
                )
            }

            // ── Sleep history ────────────────────────────────────────────────
            val sleepHistory = dashboard?.sleepHistory ?: emptyList()
            if (sleepHistory.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Sleep History", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(8.dp))
                sleepHistory.take(7).forEach { s ->
                    SleepRow(s)
                    Spacer(Modifier.height(8.dp))
                }
            }

            // ── Exercise history ─────────────────────────────────────────────
            val exerciseHistory = dashboard?.exerciseHistory ?: emptyList()
            if (exerciseHistory.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Exercise History", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(8.dp))
                exerciseHistory.take(7).forEach { e ->
                    ExerciseRow(e)
                    Spacer(Modifier.height(8.dp))
                }
            }

            // ── Step history ─────────────────────────────────────────────────
            val stepHistory = dashboard?.stepHistory ?: emptyList()
            if (stepHistory.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Step Income History", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(8.dp))
                stepHistory.take(7).forEach { s ->
                    StepHistoryRow(s)
                    Spacer(Modifier.height(8.dp))
                }
            }

            if (loading) {
                Spacer(Modifier.height(24.dp))
                CircularProgressIndicator(color = NeonGreen, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
        }
    }
}

@Composable
private fun WellnessActionButton(
    label: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color, onClick: () -> Unit, modifier: Modifier = Modifier
) {
    Button(
        onClick  = onClick,
        modifier = modifier.height(56.dp),
        shape    = RoundedCornerShape(14.dp),
        colors   = ButtonDefaults.buttonColors(containerColor = color.copy(0.15f), contentColor = color),
        border   = BorderStroke(1.dp, color.copy(0.4f))
    ) {
        Icon(icon, null, Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun SleepRow(s: SleepEntry) {
    val qualityColor = when (s.quality) {
        "EXCELLENT" -> NeonGreen; "GOOD" -> NeonBlue; "FAIR" -> NeonAmber; else -> TextMuted
    }
    Surface(shape = RoundedCornerShape(12.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, CardBorder, RoundedCornerShape(12.dp))
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🌙", modifier = Modifier.padding(end = 10.dp))
            Column(Modifier.weight(1f)) {
                Text(s.date, color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                s.durationHours?.let { h ->
                    Text("${"%.1f".format(h)}h sleep", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
                }
            }
            s.quality?.let { Text(it, color = qualityColor, style = MaterialTheme.typography.labelSmall) }
            s.multiplier?.let { m ->
                Spacer(Modifier.width(8.dp))
                Text("×${"%.2f".format(m)}", color = NeonGreen, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
            }
        }
    }
}

@Composable
private fun ExerciseRow(e: ExerciseEntry) {
    Surface(shape = RoundedCornerShape(12.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, CardBorder, RoundedCornerShape(12.dp))
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("💪", modifier = Modifier.padding(end = 10.dp))
            Column(Modifier.weight(1f)) {
                Text(e.exerciseType.replaceFirstChar { it.uppercase() }, color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                Text("${e.durationMinutes.toInt()}min · ${e.date}", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            Text("+₹${e.earned}", color = NeonGreen, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
        }
    }
}

@Composable
private fun StepHistoryRow(s: StepEntry) {
    Surface(shape = RoundedCornerShape(12.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, CardBorder, RoundedCornerShape(12.dp))
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("👟", modifier = Modifier.padding(end = 10.dp))
            Column(Modifier.weight(1f)) {
                Text("${s.steps} steps", color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                Text(s.date, color = TextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            if (s.stepIncome > 0) {
                Text("+₹${s.stepIncome}", color = NeonGreen, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ExerciseDialog(onDismiss: () -> Unit, onLog: (String, Float) -> Unit) {
    val exerciseTypes = listOf("Running", "Walking", "Cycling", "Swimming", "Gym", "Yoga", "Other")
    var selectedType by remember { mutableStateOf("Running") }
    var duration     by remember { mutableStateOf("30") }
    var expanded     by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor   = Surface,
        title            = { Text("Log Exercise", color = TextPrimary) },
        text             = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Type dropdown
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value         = selectedType,
                        onValueChange = {},
                        readOnly      = true,
                        label         = { Text("Type") },
                        trailingIcon  = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        colors        = effexFieldColors(),
                        modifier      = Modifier.menuAnchor().fillMaxWidth(),
                        shape         = RoundedCornerShape(10.dp)
                    )
                    ExposedDropdownMenu(
                        expanded         = expanded,
                        onDismissRequest = { expanded = false },
                        containerColor   = Card
                    ) {
                        exerciseTypes.forEach { type ->
                            DropdownMenuItem(
                                text    = { Text(type, color = TextPrimary) },
                                onClick = { selectedType = type; expanded = false }
                            )
                        }
                    }
                }
                // Duration
                OutlinedTextField(
                    value         = duration,
                    onValueChange = { duration = it },
                    label         = { Text("Duration (minutes)") },
                    singleLine    = true,
                    colors        = effexFieldColors(),
                    modifier      = Modifier.fillMaxWidth(),
                    shape         = RoundedCornerShape(10.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val mins = duration.toFloatOrNull() ?: return@Button
                    onLog(selectedType.lowercase(), mins)
                },
                colors = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Background)
            ) { Text("Log") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = TextSecondary) }
        }
    )
}
