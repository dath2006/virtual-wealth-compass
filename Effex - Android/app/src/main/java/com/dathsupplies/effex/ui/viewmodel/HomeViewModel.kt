package com.dathsupplies.effex.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.service.LiveSessionState
import com.dathsupplies.effex.service.StepTracker
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class HomeUiState(
    val balance: Int               = 0,
    val streak: Int                = 0,
    val activePass: ActivePassInfo? = null,
    val recentEntries: List<LedgerEntry> = emptyList(),
    val usageToday: UsageTodayResponse? = null,
    val stepsToday: Long           = 0L,
    val isLoading: Boolean         = true,
    val error: String?             = null
)

class HomeViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    val liveSession = LiveSessionState.session

    init {
        load()
        startRefreshLoop()
    }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                val ctx   = getApplication<Application>().applicationContext
                val prefs = PrefsStore(ctx)
                ApiClient.init(prefs.getBaseUrl(), prefs.getApiKey())

                val balance = ApiClient.get().getBalance().body()?.balance ?: 0
                val streak  = ApiClient.get().getStreak().body()?.streak   ?: 0
                val ledger  = ApiClient.get().getLedger(limit = 10).body() ?: emptyList()
                val usage   = ApiClient.get().getUsageToday().body()
                val steps   = StepTracker(ctx).getTodaySteps()

                _state.update {
                    it.copy(
                        balance       = balance,
                        streak        = streak,
                        recentEntries = ledger,
                        usageToday    = usage,
                        stepsToday    = steps,
                        isLoading     = false
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = "Cannot reach server") }
            }
        }
    }

    private fun startRefreshLoop() {
        viewModelScope.launch {
            delay(60_000)
            while (true) {
                load()
                delay(60_000)
            }
        }
    }
}
