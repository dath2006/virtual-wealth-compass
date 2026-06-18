package com.dathsupplies.effex.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val EffexColorScheme = darkColorScheme(
    primary          = NeonGreen,
    onPrimary        = Background,
    primaryContainer = NeonGreenDim,
    secondary        = NeonBlue,
    onSecondary      = Background,
    tertiary         = NeonPurple,
    background       = Background,
    onBackground     = TextPrimary,
    surface          = Surface,
    onSurface        = TextPrimary,
    surfaceVariant   = SurfaceVariant,
    onSurfaceVariant = TextSecondary,
    error            = NeonRed,
    onError          = Background,
    outline          = CardBorder,
)

@Composable
fun EffexTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = EffexColorScheme,
        typography  = Typography,
        content     = content
    )
}
