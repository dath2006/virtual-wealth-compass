package com.dathsupplies.effex.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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

data class MarketplaceUiState(
    val catalogue: MarketplaceCatalogueResponse? = null,
    val myPasses: List<MyPassEntry>              = emptyList(),
    val isLoading: Boolean                       = false,
    val snackbar: String?                        = null
)

class MarketplaceViewModel : ViewModel() {
    private val _state = MutableStateFlow(MarketplaceUiState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val cat     = ApiClient.get().getMarketplaceCatalogue().body()
                val myPasses = ApiClient.get().getMyPasses().body() ?: emptyList()
                _state.update { it.copy(catalogue = cat, myPasses = myPasses, isLoading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, snackbar = "Failed to load marketplace") }
            }
        }
    }

    fun purchase(passType: String) {
        viewModelScope.launch {
            try {
                val resp = ApiClient.get().purchasePass(mapOf("pass_type" to passType)).body()
                _state.update { it.copy(snackbar = resp?.message ?: "Purchased!") }
                load()
            } catch (e: Exception) {
                _state.update { it.copy(snackbar = "Purchase failed: ${e.message?.take(60)}") }
            }
        }
    }

    fun activate(passId: Int) {
        viewModelScope.launch {
            try {
                val resp = ApiClient.get().activatePass(passId).body()
                _state.update { it.copy(snackbar = resp?.message ?: "Activated!") }
                load()
            } catch (e: Exception) {
                _state.update { it.copy(snackbar = "Activation failed: ${e.message?.take(60)}") }
            }
        }
    }

    fun clearSnackbar() = _state.update { it.copy(snackbar = null) }
}

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun MarketplaceScreen(vm: MarketplaceViewModel = viewModel()) {
    val state   by vm.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.snackbar) {
        state.snackbar?.let {
            snackbarHostState.showSnackbar(it)
            vm.clearSnackbar()
        }
    }

    // Active pass from my-passes
    val activePass = state.myPasses.firstOrNull { it.status == "ACTIVE" }
    val purchasedPasses = state.myPasses.filter { it.status == "PURCHASED" }

    Scaffold(
        containerColor    = Background,
        snackbarHost      = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        if (state.isLoading && state.catalogue == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = NeonGreen)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 20.dp, end = 20.dp,
                    top = padding.calculateTopPadding() + 16.dp,
                    bottom = padding.calculateBottomPadding() + 16.dp
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Header
                item {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Marketplace", style = MaterialTheme.typography.titleLarge, color = TextPrimary)
                            state.catalogue?.let {
                                Text(
                                    "₹${it.currentBalance} balance · ₹${it.monthlySpent}/${it.monthlyCap} spent this month",
                                    style = MaterialTheme.typography.labelMedium, color = TextSecondary
                                )
                            }
                        }
                        IconButton(onClick = { vm.load() }) {
                            Icon(Icons.Filled.Refresh, null, tint = TextSecondary)
                        }
                    }
                }

                // Active pass
                activePass?.let { pass ->
                    item {
                        val msLeft = pass.msRemaining ?: 0L
                        val minsLeft = msLeft / 60_000
                        Surface(
                            shape = RoundedCornerShape(16.dp), color = Color(0xFF0D0A1A),
                            modifier = Modifier.fillMaxWidth().border(1.dp, NeonPurple.copy(0.6f), RoundedCornerShape(16.dp))
                        ) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(passEmoji(pass.passType), style = MaterialTheme.typography.titleLarge)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("${pass.passType} — ACTIVE", color = NeonPurple, style = MaterialTheme.typography.titleMedium)
                                    Text("${minsLeft}m remaining", color = TextSecondary, style = MaterialTheme.typography.labelMedium)
                                }
                                Icon(Icons.Filled.PlayArrow, null, tint = NeonPurple)
                            }
                        }
                    }
                }

                // Purchased (not yet activated)
                if (purchasedPasses.isNotEmpty()) {
                    item { Text("Ready to Activate", color = TextSecondary, style = MaterialTheme.typography.labelMedium) }
                    items(purchasedPasses) { pass ->
                        Surface(
                            shape = RoundedCornerShape(14.dp), color = Card,
                            modifier = Modifier.fillMaxWidth().border(1.dp, NeonAmber.copy(0.4f), RoundedCornerShape(14.dp))
                        ) {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(passEmoji(pass.passType), style = MaterialTheme.typography.titleLarge)
                                Spacer(Modifier.width(12.dp))
                                Text(pass.passType.replace("_", " "), color = NeonAmber,
                                    style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                Button(
                                    onClick = { vm.activate(pass.id) },
                                    colors  = ButtonDefaults.buttonColors(containerColor = NeonAmber, contentColor = Background),
                                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                                    shape   = RoundedCornerShape(8.dp)
                                ) { Text("Start") }
                            }
                        }
                    }
                }

                // Catalogue by category
                val grouped = state.catalogue?.passes?.groupBy { it.category } ?: emptyMap()
                grouped.forEach { (category, passes) ->
                    item {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            category.replace("_", " "),
                            color = TextSecondary,
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                    items(passes, key = { it.passType }) { pass ->
                        PassCard(pass = pass, balance = state.catalogue?.currentBalance ?: 0, onBuy = { vm.purchase(pass.passType) })
                    }
                }
            }
        }
    }
}

@Composable
private fun PassCard(pass: MarketplacePass, balance: Int, onBuy: () -> Unit) {
    val canBuy   = pass.canPurchase && balance >= pass.totalPrice
    val accent   = if (canBuy) NeonGreen else TextMuted

    Surface(
        shape = RoundedCornerShape(16.dp), color = Card,
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, if (canBuy) NeonGreenDim.copy(0.35f) else CardBorder, RoundedCornerShape(16.dp))
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(passEmoji(pass.passType), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(pass.displayName, color = TextPrimary, style = MaterialTheme.typography.titleMedium)
                    pass.durationMinutes?.let {
                        Text("${it}m", color = TextSecondary, style = MaterialTheme.typography.labelSmall)
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("₹${pass.totalPrice}", color = accent,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
                    if (pass.guiltTaxAmount > 0) {
                        Text("+₹${pass.guiltTaxAmount} guilt tax", color = NeonAmber,
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
            }

            Text(pass.description, color = TextSecondary, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 6.dp, start = 4.dp))

            pass.blockedReason?.let { reason ->
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Lock, null, tint = NeonAmber, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(reason, color = NeonAmber, style = MaterialTheme.typography.labelSmall)
                }
            }

            if (pass.weeklyUsed > 0) {
                Text("${pass.weeklyUsed}/${pass.weeklyLimit} used this week", color = TextMuted,
                    style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 2.dp, start = 4.dp))
            }

            Spacer(Modifier.height(10.dp))
            Button(
                onClick   = onBuy,
                enabled   = canBuy,
                modifier  = Modifier.fillMaxWidth().height(40.dp),
                shape     = RoundedCornerShape(10.dp),
                colors    = ButtonDefaults.buttonColors(
                    containerColor = NeonGreen, contentColor = Background,
                    disabledContainerColor = SurfaceVariant, disabledContentColor = TextMuted
                )
            ) {
                Text(if (canBuy) "Buy Pass" else (pass.blockedReason?.take(24) ?: "Locked"),
                    style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

private fun passEmoji(type: String) = when (type) {
    "MOVIE" -> "🎬"; "GAMING" -> "🎮"; "BINGE" -> "📺"; "NAP" -> "😴"
    "STUDY_BREAK" -> "☕"; "RESTAURANT" -> "🍽"; "WEEKEND_OUTING" -> "🚶"
    "BOOK_PURCHASE" -> "📚"; "WEEKEND_MODE" -> "🌅"; "VACATION_MODE" -> "✈"
    else -> "🎟"
}

