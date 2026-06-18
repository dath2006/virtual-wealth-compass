package com.dathsupplies.effex.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val scope   = rememberCoroutineScope()

    var url      by remember { mutableStateOf("") }
    var apiKey   by remember { mutableStateOf("") }
    var deviceId by remember { mutableStateOf("effex_device") }
    var showKey  by remember { mutableStateOf(false) }
    var testing  by remember { mutableStateOf(false) }
    var error    by remember { mutableStateOf<String?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(24.dp))

            Text(
                text  = "effex",
                style = MaterialTheme.typography.displayMedium,
                color = NeonGreen
            )
            Text(
                text  = "virtual economy engine",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(top = 4.dp, bottom = 48.dp)
            )

            Text(
                text  = "Connect to your server",
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimary
            )
            Text(
                text      = "Enter the URL and API key for your Effex backend instance.",
                style     = MaterialTheme.typography.bodyMedium,
                color     = TextSecondary,
                textAlign = TextAlign.Center,
                modifier  = Modifier.padding(top = 8.dp, bottom = 32.dp)
            )

            // Server URL
            OutlinedTextField(
                value         = url,
                onValueChange = { url = it; error = null },
                label         = { Text("Server URL") },
                placeholder   = { Text("https://your-server.com", color = TextMuted) },
                singleLine    = true,
                modifier      = Modifier.fillMaxWidth(),
                colors        = effexFieldColors(),
                shape         = RoundedCornerShape(12.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
            )

            Spacer(Modifier.height(16.dp))

            // API Key
            OutlinedTextField(
                value               = apiKey,
                onValueChange       = { apiKey = it; error = null },
                label               = { Text("API Key") },
                singleLine          = true,
                modifier            = Modifier.fillMaxWidth(),
                colors              = effexFieldColors(),
                shape               = RoundedCornerShape(12.dp),
                visualTransformation = if (showKey) VisualTransformation.None
                                       else PasswordVisualTransformation(),
                trailingIcon        = {
                    TextButton(onClick = { showKey = !showKey }) {
                        Text(if (showKey) "Hide" else "Show", color = NeonGreen)
                    }
                }
            )

            Spacer(Modifier.height(16.dp))

            // Device ID
            OutlinedTextField(
                value         = deviceId,
                onValueChange = { deviceId = it },
                label         = { Text("Device ID (optional)") },
                placeholder   = { Text("effex_device", color = TextMuted) },
                singleLine    = true,
                modifier      = Modifier.fillMaxWidth(),
                colors        = effexFieldColors(),
                shape         = RoundedCornerShape(12.dp)
            )

            error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = NeonRed, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.height(32.dp))

            Button(
                onClick = {
                    if (url.isBlank()) { error = "Server URL is required"; return@Button }
                    if (apiKey.isBlank()) { error = "API Key is required"; return@Button }
                    testing = true
                    scope.launch {
                        try {
                            ApiClient.init(url.trim(), apiKey.trim())
                            val resp = ApiClient.get().healthCheck()
                            if (resp.isSuccessful) {
                                PrefsStore(context).save(url.trim(), apiKey.trim(), deviceId.trim())
                                onDone()
                            } else {
                                error = "Server returned ${resp.code()} — check your URL and key"
                            }
                        } catch (e: Exception) {
                            error = "Cannot reach server: ${e.message?.take(80)}"
                        } finally {
                            testing = false
                        }
                    }
                },
                enabled  = !testing,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp),
                shape    = RoundedCornerShape(14.dp),
                colors   = ButtonDefaults.buttonColors(containerColor = NeonGreen, contentColor = Background)
            ) {
                if (testing) {
                    CircularProgressIndicator(color = Background, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Text("Connect & Continue", style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

@Composable
fun effexFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor   = NeonGreen,
    unfocusedBorderColor = CardBorder,
    focusedLabelColor    = NeonGreen,
    unfocusedLabelColor  = TextSecondary,
    focusedTextColor     = TextPrimary,
    unfocusedTextColor   = TextPrimary,
    cursorColor          = NeonGreen,
    focusedContainerColor   = Card,
    unfocusedContainerColor = Card
)
