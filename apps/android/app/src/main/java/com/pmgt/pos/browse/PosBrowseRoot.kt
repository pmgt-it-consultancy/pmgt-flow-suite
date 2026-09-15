package com.pmgt.pos.browse

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.sync.SyncStatus
import kotlinx.coroutines.flow.Flow

/** No global header: each route renders its original RN header. */
@Composable
fun PosBrowseRoot(
    user: SignedInUser,
    repository: BrowseRepository,
    dashboard: Flow<DashboardSummary?>,
    syncLabel: String,
    hasPin: Boolean,
    onLock: () -> Unit,
    onLogout: () -> Unit,
    refreshHistory: suspend () -> Unit,
    onRoute: (String) -> Unit,
    onAction: ((BrowseAction) -> Unit)? = null,
    syncStatus: SyncStatus = SyncStatus.Idle,
    onRetrySync: () -> Unit = {},
) {
    val storeId = user.storeId ?: return
    var route by rememberSaveable { mutableStateOf("HomeScreen") }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    val holder = rememberSaveableStateHolder()
    var unavailable by remember { mutableStateOf(false) }
    val action: (BrowseAction) -> Unit = {
        if (onAction == null) unavailable = true else onAction(it)
    }
    fun back() {
        if (detailId != null) detailId = null
        else if (route != "HomeScreen") {
            holder.removeState(route)
            route = "HomeScreen"
        }
    }
    BackHandler(route != "HomeScreen" || detailId != null) { back() }
    LaunchedEffect(route, detailId) {
        onRoute(if (detailId != null) "OrderDetailScreen" else route)
    }
    holder.SaveableStateProvider(if (detailId != null) "detail:$detailId" else route) {
        if (detailId != null) {
            val flow =
                remember(repository, storeId, detailId) { repository.detail(storeId, detailId!!) }
            val detail by flow.collectAsStateWithLifecycle(initialValue = null)
            OrderDetailScreen(detail, { back() }, action)
        } else
            when (route) {
                "HomeScreen" -> {
                    val flow = remember(repository, storeId) { repository.activeOrders(storeId) }
                    val orders by flow.collectAsStateWithLifecycle(initialValue = null)
                    val summary by dashboard.collectAsStateWithLifecycle(initialValue = null)
                    HomeScreen(
                        user,
                        orders,
                        summary,
                        syncLabel,
                        hasPin,
                        { route = "TablesScreen" },
                        { route = "TakeoutListScreen" },
                        { route = "OrderHistoryScreen" },
                        onLock,
                        onLogout,
                        action,
                        syncStatus,
                        onRetrySync,
                    )
                }
                "TablesScreen" -> {
                    val flow = remember(repository, storeId) { repository.tables(storeId) }
                    val tables by flow.collectAsStateWithLifecycle(initialValue = null)
                    TablesScreen(storeId, user.name, tables, { back() }, action)
                }
                "TakeoutListScreen" -> TakeoutScreen(repository, storeId, { back() }, action)
                "OrderHistoryScreen" ->
                    HistoryScreen(
                        repository,
                        storeId,
                        { back() },
                        { detailId = it },
                        { action(BrowseAction.SystemStatus) },
                        refreshHistory,
                    )
            }
    }
    if (unavailable)
        AlertDialog(
            onDismissRequest = { unavailable = false },
            title = { Text("Unavailable") },
            text = { Text("This action is not available in this build yet.") },
            confirmButton = { TextButton({ unavailable = false }) { Text("OK") } },
        )
}
