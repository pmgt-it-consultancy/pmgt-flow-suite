package com.pmgt.pos.browse

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.catalog.CatalogRepository
import com.pmgt.pos.checkout.*
import com.pmgt.pos.orders.*
import com.pmgt.pos.sync.SyncStatus
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.Json

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
    checkoutRepository: CheckoutRepository? = null,
    checkoutHttp: ConvexHttp? = null,
    checkoutSessions: CheckoutSessions? = null,
    checkoutIsCurrent: () -> Boolean = { true },
    onCheckoutCompleted: ((CompletedCheckout, () -> Unit) -> Unit)? = null,
) {
    val storeId = user.storeId ?: return
    var route by rememberSaveable { mutableStateOf("HomeScreen") }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var navigationEpoch by rememberSaveable { mutableIntStateOf(0) }
    val holder = key(navigationEpoch) { rememberSaveableStateHolder() }
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
    val checkoutOwner = CheckoutOwner(user.id, storeId)
    val checkouts = checkoutSessions ?: remember { CheckoutSessions(scope) }
    var checkoutJson by rememberSaveable { mutableStateOf<String?>(null) }
    var checkoutReturn by rememberSaveable { mutableStateOf("HomeScreen") }
    var receiptUnavailable by remember { mutableStateOf(false) }
    val financialActions =
        remember(checkoutRepository, storeId) {
            checkoutRepository?.pendingActions(storeId) ?: flowOf(emptyList())
        }
    val pendingActions by financialActions.collectAsStateWithLifecycle(initialValue = emptyList())
    var recoveryCandidate by remember { mutableStateOf<CheckoutRoute?>(null) }
    var recoveryDecisions by remember { mutableIntStateOf(0) }
    LaunchedEffect(pendingActions, route, detailId, recoveryDecisions, checkoutRepository) {
        recoveryCandidate = null
        if (
            route == "HomeScreen" &&
                detailId == null &&
                checkoutIsCurrent() &&
                checkoutRepository != null
        ) {
            for (pending in
                pendingActions
                    .filter { it.kind == "payment" && it.state == FinancialActionState.Recoverable }
                    .sortedBy { it.orderId }) {
                val id = pending.orderId ?: continue
                if (id in checkouts.deferredRecovery) continue
                val saved =
                    try {
                        checkoutRepository.recoverablePayment(checkoutOwner, id)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        null
                    }
                if (saved != null && checkoutIsCurrent()) {
                    recoveryCandidate = saved
                    break
                }
            }
        }
    }
    fun openCheckout(next: CheckoutRoute) {
        if (onCheckout != null) onCheckout(next)
        else if (checkoutRepository == null || checkoutHttp == null) unavailable = true
        else {
            checkoutReturn = route
            checkoutJson = Json.encodeToString(next)
            route = "CheckoutScreen"
        }
    }
    fun exitCheckout() {
        checkoutJson?.let {
            checkouts.remove("$editorOwner:${Json.decodeFromString<CheckoutRoute>(it).orderId}")
        }
        receiptUnavailable = false
        checkoutJson = null
        sessions.remove(editorOwner, editorKey)
        navigationEpoch++
        editorTableId = null
        editorName = ""
        editorOrderId = null
        editorKey = ""
        editorReturn = "HomeScreen"
        checkoutReturn = "HomeScreen"
        detailId = null
        // RN reset uses index 0: Home is active, with Tables/Takeout as its next route.
        route = "HomeScreen"
    }
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
                    openCheckout(CheckoutRoute(event.orderId, event.orderType))
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
                "CheckoutScreen" ->
                    if (
                        checkoutRepository != null && checkoutHttp != null && checkoutJson != null
                    ) {
                        val checkoutRoute =
                            remember(checkoutJson) {
                                Json.decodeFromString<CheckoutRoute>(checkoutJson!!)
                            }
                        val checkoutKey = "$editorOwner:${checkoutRoute.orderId}"
                        val checkoutSession =
                            remember(checkoutKey, checkoutRepository) {
                                checkouts.get(checkoutKey) { ownedScope ->
                                    CheckoutSession(
                                        checkoutOwner,
                                        checkoutRoute,
                                        checkoutRepository,
                                        checkoutHttp,
                                        user.name,
                                        ownedScope,
                                        checkoutIsCurrent,
                                    )
                                }
                            }
                        CheckoutScreen(
                            checkoutOwner,
                            checkoutRoute,
                            checkoutRepository,
                            checkoutHttp,
                            user.name,
                            checkoutIsCurrent,
                            onBack = {
                                checkouts.remove(checkoutKey)
                                checkoutJson = null
                                route = checkoutReturn
                            },
                            onCompleted = { complete ->
                                if (onCheckoutCompleted != null)
                                    onCheckoutCompleted(complete, ::exitCheckout)
                                else receiptUnavailable = true
                            },
                            memory = checkoutSession,
                            onStatus = { action(BrowseAction.SystemStatus) },
                        )
                    }
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
                            onCheckout = { openCheckout(it) },
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
    if (receiptUnavailable)
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Unavailable") },
            text = { Text("Receipt printing is not available in this build yet.") },
            confirmButton = { TextButton(::exitCheckout) { Text("Skip") } },
        )
    recoveryCandidate?.let { saved ->
        fun later() {
            checkouts.deferredRecovery += saved.orderId
            recoveryCandidate = null
            recoveryDecisions++
        }
        AlertDialog(
            onDismissRequest = ::later,
            title = { Text("Saved checkout") },
            text = {
                Text(
                    "A locally paid checkout needs its remaining local steps completed. Saved payment records will be reused."
                )
            },
            dismissButton = { TextButton(::later) { Text("Later") } },
            confirmButton = {
                TextButton({
                    scope.launch {
                        if (!checkoutIsCurrent()) return@launch
                        val current =
                            try {
                                checkoutRepository?.recoverablePayment(checkoutOwner, saved.orderId)
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                null
                            }
                        if (!checkoutIsCurrent()) return@launch
                        later()
                        if (current != null) openCheckout(current)
                        else
                            actionError =
                                "Saved checkout has changed. Existing work is retained for review."
                    }
                }) {
                    Text("Resume saved checkout")
                }
            },
        )
    }
    actionError?.let { message ->
        AlertDialog(
            onDismissRequest = { actionError = null },
            title = { Text("Error") },
            text = { Text(message) },
            confirmButton = { TextButton({ actionError = null }) { Text("OK") } },
        )
    }
}
