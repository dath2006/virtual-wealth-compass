package com.dathsupplies.effex

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.lifecycleScope
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.ui.nav.EffexNavGraph
import com.dathsupplies.effex.ui.nav.Route
import com.dathsupplies.effex.ui.theme.EffexTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            EffexTheme {
                val context = LocalContext.current
                var startRoute by remember { mutableStateOf<String?>(null) }

                LaunchedEffect(Unit) {
                    val prefs = PrefsStore(context)
                    startRoute = if (prefs.isConfigured()) Route.HOME else Route.ONBOARDING
                }

                startRoute?.let { start ->
                    EffexNavGraph(startDestination = start)
                }
            }
        }
    }
}
