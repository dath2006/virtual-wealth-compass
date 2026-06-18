package com.dathsupplies.effex.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.LedgerEntry
import com.dathsupplies.effex.ui.theme.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

// ── ViewModel ─────────────────────────────────────────────────────────────────

class LedgerViewModel : ViewModel() {
    private val _entries = MutableStateFlow<List<LedgerEntry>>(emptyList())
    val entries = _entries.asStateFlow()

    private val _loading = MutableStateFlow(false)
    val loading = _loading.asStateFlow()

    private val _canLoadMore = MutableStateFlow(true)
    val canLoadMore = _canLoadMore.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    private var currentOffset = 0
    private val pageSize = 50

    init { loadNext() }

    fun loadNext() {
        if (_loading.value || !_canLoadMore.value) return
        viewModelScope.launch {
            _loading.value = true
            try {
                val page = ApiClient.get().getLedger(limit = pageSize, offset = currentOffset).body() ?: emptyList()
                if (page.size < pageSize) _canLoadMore.value = false
                _entries.update { it + page }
                currentOffset += page.size
            } catch (e: Exception) {
                _error.value = "Failed to load ledger"
            } finally {
                _loading.value = false
            }
        }
    }

    fun refresh() {
        currentOffset = 0
        _canLoadMore.value = true
        _entries.value = emptyList()
        loadNext()
    }
}

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun LedgerScreen(vm: LedgerViewModel = viewModel()) {
    val entries    by vm.entries.collectAsState()
    val loading    by vm.loading.collectAsState()
    val canLoadMore by vm.canLoadMore.collectAsState()
    val error      by vm.error.collectAsState()

    val categories = listOf("All", "DISTRACTION", "UPI_DEBIT", "STEP_INCOME", "EXERCISE_INCOME", "FOCUS_INCOME", "MERCY_SPEND")
    var selected by remember { mutableStateOf("All") }
    val filtered = if (selected == "All") entries else entries.filter { it.category == selected }

    Column(Modifier.fillMaxSize().background(Background)) {
        // Top bar
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Ledger", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
            TextButton(onClick = { vm.refresh() }) { Text("Refresh", color = NeonGreen) }
        }

        // Filter chips
        LazyRow(
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(bottom = 12.dp)
        ) {
            items(categories) { cat ->
                FilterChip(
                    selected = selected == cat,
                    onClick  = { selected = cat },
                    label    = { Text(cat.replace("_", " "), style = MaterialTheme.typography.labelSmall) },
                    colors   = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = NeonGreen.copy(0.2f),
                        selectedLabelColor     = NeonGreen,
                        containerColor         = Card,
                        labelColor             = TextSecondary
                    ),
                    border = FilterChipDefaults.filterChipBorder(
                        enabled = true,
                        selected = selected == cat,
                        selectedBorderColor = NeonGreen.copy(0.5f),
                        borderColor = CardBorder,
                        selectedBorderWidth = 1.dp,
                        borderWidth = 1.dp
                    )
                )
            }
        }

        if (loading && entries.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = NeonGreen)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (filtered.isEmpty()) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                            Text("No entries", color = TextMuted, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                } else {
                    items(filtered, key = { it.id }) { entry ->
                        LedgerDetailRow(entry)
                    }
                    // Load-more footer (only when unfiltered and more pages exist)
                    if (selected == "All" && canLoadMore) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                if (loading) {
                                    CircularProgressIndicator(color = NeonGreen, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                                } else {
                                    TextButton(onClick = { vm.loadNext() }) { Text("Load more", color = NeonGreen) }
                                }
                            }
                        }
                    }
                }
            }
        }

        error?.let {
            Snackbar(modifier = Modifier.padding(16.dp)) { Text(it, color = NeonRed) }
        }
    }
}

@Composable
private fun LedgerDetailRow(entry: LedgerEntry) {
    val isPos = entry.amount >= 0
    val color = when {
        isPos && entry.category.contains("INCOME") -> NeonGreen
        isPos                                       -> NeonBlue
        entry.category == "DISTRACTION"             -> NeonRed
        else                                        -> NeonAmber
    }
    val sign = if (isPos) "+" else ""
    val date = remember(entry.timestampMs) {
        SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault()).format(Date(entry.timestampMs))
    }

    Surface(
        shape = RoundedCornerShape(14.dp), color = Card,
        modifier = Modifier.fillMaxWidth().border(1.dp, color.copy(0.2f), RoundedCornerShape(14.dp))
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(color, RoundedCornerShape(50)))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(entry.description, color = TextPrimary, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
                Spacer(Modifier.height(2.dp))
                Row {
                    Text(entry.category.replace("_", " "), color = color.copy(0.8f), style = MaterialTheme.typography.labelSmall)
                    Text(" · $date", color = TextMuted, style = MaterialTheme.typography.labelSmall)
                }
                entry.merchantName?.let { merchant ->
                    Text(merchant, color = TextSecondary, style = MaterialTheme.typography.labelSmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(
                "$sign₹${entry.amount}",
                color = color,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        }
    }
}
