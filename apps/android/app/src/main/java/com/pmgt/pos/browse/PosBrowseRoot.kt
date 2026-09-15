package com.pmgt.pos.browse

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.catalog.CatalogRepository
import com.pmgt.pos.orders.*
import com.pmgt.pos.sync.SyncStatus
import kotlinx.coroutines.*
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
    entryRepository: OrderEntryRepository? = null,
    catalogRepository: CatalogRepository? = null,
    onCheckout: ((CheckoutRoute) -> Unit)? = null,
    editorSessions: EditorSessions? = null,
) {
    val storeId = user.storeId ?: return
    var route by rememberSaveable { mutableStateOf("HomeScreen") }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    val holder = rememberSaveableStateHolder()
    var unavailable by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var editorTableId by rememberSaveable { mutableStateOf<String?>(null) }
    var editorName by rememberSaveable { mutableStateOf("") }
    var editorOrderId by rememberSaveable { mutableStateOf<String?>(null) }
    var editorReturn by rememberSaveable { mutableStateOf("HomeScreen") }
    var editorKey by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val sessions = editorSessions ?: remember { EditorSessions(scope) }
    val editorOwner = "${user.id}:$storeId"
    var creating by remember { mutableStateOf(false) }
    fun openEditor(next: EditorRoute) {
        editorReturn = route
        editorTableId = next.tableId
        editorName = next.tableName
        editorOrderId = next.orderId
        editorKey = java.util.UUID.randomUUID().toString()
        route = if (next.takeout) "TakeoutOrderScreen" else "OrderScreen"
    }
    val action: (BrowseAction) -> Unit = { event ->
        if (entryRepository != null && catalogRepository != null)
            when (event) {
                is BrowseAction.OpenDineIn ->
                    openEditor(
                        EditorRoute(event.storeId, event.tableId, event.tableName, event.orderId)
                    )
                is BrowseAction.OpenTakeout ->
                    openEditor(EditorRoute(event.storeId, orderId = event.orderId, takeout = true))
                is BrowseAction.NewTakeout,
                is BrowseAction.NewTableTab ->
                    if (!creating) {
                        creating = true
                        scope.launch {
                            try {
                                when (event) {
                                    is BrowseAction.NewTakeout ->
                                        openEditor(
                                            EditorRoute(
                                                event.storeId,
                                                orderId =
                                                    entryRepository.createDraft(event.storeId),
                                                takeout = true,
                                            )
                                        )
                                    is BrowseAction.NewTableTab ->
                                        openEditor(
                                            EditorRoute(
                                                event.storeId,
                                                event.tableId,
                                                event.tableName,
                                                entryRepository.createOrder(
                                                    NewOrder(
                                                        event.storeId,
                                                        tableId = event.tableId,
                                                        requestId =
                                                            java.util.UUID.randomUUID().toString(),
                                                    )
                                                ),
                                            )
                                        )
                                    else -> Unit
                                }
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (error: Exception) {
                                actionError = error.message ?: "Failed to create order"
                            } finally {
                                creating = false
                            }
                        }
                    }
                is BrowseAction.DiscardDraft,
                is BrowseAction.AdvanceTakeout ->
                    scope.launch {
                        try {
                            when (event) {
                                is BrowseAction.DiscardDraft ->
                                    entryRepository.discardDraft(event.orderId)
                                is BrowseAction.AdvanceTakeout ->
                                    entryRepository.advanceTakeout(event.orderId, event.nextStatus)
                                else -> Unit
                            }
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (error: Exception) {
                            actionError = error.message ?: "Failed to update order"
                        }
                    }
                is BrowseAction.Checkout ->
                    if (onCheckout == null) unavailable = true
                    else onCheckout(CheckoutRoute(event.orderId, event.orderType))
                else -> if (onAction == null) unavailable = true else onAction(event)
            }
        else if (onAction == null) unavailable = true else onAction(event)
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
                "OrderScreen",
                "TakeoutOrderScreen" ->
                    if (entryRepository != null && catalogRepository != null) {
                        val session =
                            remember(editorKey, editorOwner) {
                                sessions.get(
                                    editorOwner,
                                    editorKey,
                                    EditorRoute(
                                        storeId,
                                        editorTableId,
                                        editorName,
                                        editorOrderId,
                                        route == "TakeoutOrderScreen",
                                    ),
                                    entryRepository,
                                )
                            }
                        val editorState by session.state.collectAsStateWithLifecycle()
                        LaunchedEffect(editorState.orderId) { editorOrderId = editorState.orderId }
                        OrderEditorScreen(
                            session,
                            entryRepository,
                            catalogRepository,
                            onBack = {
                                sessions.remove(editorOwner, editorKey)
                                route = editorReturn
                            },
                            onStatus = { action(BrowseAction.SystemStatus) },
                            onCheckout = {
                                if (onCheckout == null) unavailable = true else onCheckout(it)
                            },
                        )
                    }
            }
    }
    if (unavailable)
        AlertDialog(
            onDismissRequest = { unavailable = false },
            title = { Text("Unavailable") },
            text = { Text("This action is not available in this build yet.") },
            confirmButton = { TextButton({ unavailable = false }) { Text("OK") } },
        )
    actionError?.let { message ->
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Error") },
            text = { Text(message) },
            confirmButton = { TextButton({ actionError = null }) { Text("OK") } },
        )
    }
}
