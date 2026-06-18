package com.dathsupplies.effex.ui.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.dathsupplies.effex.ui.screens.HomeScreen
import com.dathsupplies.effex.ui.screens.LedgerScreen
import com.dathsupplies.effex.ui.screens.MarketplaceScreen
import com.dathsupplies.effex.ui.screens.OnboardingScreen
import com.dathsupplies.effex.ui.screens.SetupScreen
import com.dathsupplies.effex.ui.screens.WellnessScreen
import com.dathsupplies.effex.ui.theme.Background
import com.dathsupplies.effex.ui.theme.NeonGreen
import com.dathsupplies.effex.ui.theme.SurfaceVariant
import com.dathsupplies.effex.ui.theme.TextSecondary

private data class BottomNavItem(
    val route: String,
    val label: String,
    val icon: ImageVector
)

private val bottomNavItems = listOf(
    BottomNavItem(Route.HOME,        "Home",       Icons.Filled.Home),
    BottomNavItem(Route.LEDGER,      "Ledger",     Icons.Filled.Receipt),
    BottomNavItem(Route.MARKETPLACE, "Shop",       Icons.Filled.Store),
    BottomNavItem(Route.WELLNESS,    "Wellness",   Icons.Filled.FitnessCenter),
)

private val bottomNavRoutes = bottomNavItems.map { it.route }.toSet()

@Composable
fun EffexNavGraph(startDestination: String) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute   = backStackEntry?.destination?.route
    val showBottomBar  = currentRoute in bottomNavRoutes

    Scaffold(
        containerColor = Background,
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = SurfaceVariant) {
                    val hierarchy = backStackEntry?.destination?.hierarchy
                    bottomNavItems.forEach { item ->
                        val selected = hierarchy?.any { it.route == item.route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick  = {
                                navController.navigate(item.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState    = true
                                }
                            },
                            icon  = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor   = NeonGreen,
                                selectedTextColor   = NeonGreen,
                                unselectedIconColor = TextSecondary,
                                unselectedTextColor = TextSecondary,
                                indicatorColor      = Background
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController    = navController,
            startDestination = startDestination,
            modifier         = Modifier.padding(innerPadding)
        ) {
            composable(Route.ONBOARDING) {
                OnboardingScreen(onDone = {
                    navController.navigate(Route.SETUP) {
                        popUpTo(Route.ONBOARDING) { inclusive = true }
                    }
                })
            }
            composable(Route.SETUP) {
                SetupScreen(onDone = {
                    navController.navigate(Route.HOME) {
                        popUpTo(Route.SETUP) { inclusive = true }
                    }
                })
            }
            composable(Route.HOME)        { HomeScreen() }
            composable(Route.LEDGER)      { LedgerScreen() }
            composable(Route.MARKETPLACE) { MarketplaceScreen() }
            composable(Route.WELLNESS)    { WellnessScreen() }
        }
    }
}
