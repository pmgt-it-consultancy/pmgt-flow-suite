package com.pmgt.pos.browse

import com.pmgt.pos.posDialogProperties

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.catalog.CatalogRepository
import com.pmgt.pos.checkout.*
import com.pmgt.pos.orders.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.pmgt.pos.closing.DayClosingScreen
import com.pmgt.pos.printer.settings.PrinterSettingsScreen
import com.pmgt.pos.settings.AutoLockUpdateResult
import com.pmgt.pos.settings.LocalSystemOverallStatus
import com.pmgt.pos.settings.SettingsRefreshResult
import com.pmgt.pos.settings.SettingsScreen
import com.pmgt.pos.settings.SystemStatusDropdown
import com.pmgt.pos.settings.SystemStatusProjection
import com.pmgt.pos.sync.SyncStatus
import com.pmgt.pos.updater.ForceUpdateModal
import com.pmgt.pos.updater.OptionalUpdateDialog
import com.pmgt.pos.updater.SOFTWARE_UPDATE_ROUTE
import com.pmgt.pos.updater.SoftwareUpdateScreen
import com.pmgt.pos.updater.shouldShowForcedPrompt
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

private const val REFRESH_PERMISSION_MESSAGE =
    "Only managers with settings access can refresh downloaded POS data."

/** Ports the source `messageForResyncReadiness`; a ready refresh shows no alert. */
private fun refreshNotice(result: SettingsRefreshResult): Pair<String, String>? =
    when (result) {
        SettingsRefreshResult.Ready -> null
        SettingsRefreshResult.PermissionDenied ->
            "Permission Required" to REFRESH_PERMISSION_MESSAGE
        SettingsRefreshResult.StaleSession ->
            "Refresh Not Available" to
                "The signed-in session changed before POS data could refresh. Existing POS data was retained."
        is SettingsRefreshResult.Unavailable ->
            "Refresh Not Available" to
                when (result.reason) {
                    SettingsRefreshResult.Reason.OFFLINE ->
                        "Connect to the internet before refreshing POS data."
                    SettingsRefreshResult.Reason.SYNCING ->
                        "Wait for the current synchronization to finish."
                    SettingsRefreshResult.Reason.PENDING ->
                        "Pending sales or changes must finish syncing before POS data can refresh."
                    SettingsRefreshResult.Reason.FAILED ->
                        "POS data could not be verified. Check the connection and try again."
                }
    }

/** One receipt preview, opened either by a completed checkout or by a stored paid order. */
private class ReceiptPreviewRequest(
    val receipt: com.pmgt.pos.printer.ReceiptDocument,
    val kitchen: com.pmgt.pos.printer.KitchenTicketDocument,
    val onDone: () -> Unit,
)

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
    correctionRepository: CorrectionRepository? = null,
    correctionSessions: CorrectionSessions? = null,
    modules: PosModules? = null,
    reprintAudit: ReprintAudit? = null,
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
    val corrections = correctionSessions ?: remember { CorrectionSessions(scope) }
    var correctionOrderId by remember { mutableStateOf(corrections.visibleOrderId) }
    var correctedOrderId by remember { mutableStateOf<String?>(null) }
    fun correctionSession(id: String) =
        corrections.get("$editorOwner:$id") { owned ->
            CorrectionSession(
                checkoutOwner,
                id,
                requireNotNull(correctionRepository),
                requireNotNull(checkoutHttp),
                owned,
                checkoutIsCurrent,
            )
        }
    var checkoutJson by rememberSaveable { mutableStateOf<String?>(null) }
    var checkoutReturn by rememberSaveable { mutableStateOf("HomeScreen") }
    var receiptUnavailable by remember { mutableStateOf(false) }
    var nestedReturn by rememberSaveable { mutableStateOf("SettingsScreen") }
    var refreshNotice by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmRefresh by remember { mutableStateOf(false) }
    var reprinting by remember { mutableStateOf(false) }
    var statusVisible by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<ReceiptPreviewRequest?>(null) }
    var receiptResult by remember { mutableStateOf(PreviewPrintResult.NONE) }
    var kitchenResult by remember { mutableStateOf(PreviewPrintResult.NONE) }
    var receiptPrinting by remember { mutableStateOf(false) }
    var kitchenPrinting by remember { mutableStateOf(false) }
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
        preview = null
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
                is BrowseAction.Void,
                is BrowseAction.Refund -> {
                    if (correctionRepository == null || checkoutHttp == null) unavailable = true
                    else {
                        val id =
                            when (event) {
                                is BrowseAction.Void -> event.orderId
                                is BrowseAction.Refund -> event.orderId
                                else -> error("Invalid correction")
                            }
                        correctionOrderId = id
                        corrections.visibleOrderId = id
                        correctionSession(id)
                            .open(if (event is BrowseAction.Void) "void" else "refund")
                    }
                }
                is BrowseAction.Reprint,
                is BrowseAction.ReceiptPreview -> {
                    val id =
                        when (event) {
                            is BrowseAction.Reprint -> event.orderId
                            is BrowseAction.ReceiptPreview -> event.orderId
                            else -> error("Invalid receipt action")
                        }
                    val audit = reprintAudit
                    // Reprint needs the audit seam as well; without it the action stays unavailable
                    // rather than crashing inside the coroutine. A reprint already in flight is
                    // ignored: a second run would write a second audit row and print twice.
                    if (modules == null || (event is BrowseAction.Reprint && audit == null))
                        unavailable = true
                    else if (event is BrowseAction.Reprint && reprinting) Unit
                    else
                        scope.launch {
                            val stored =
                                repository.detail(storeId, id).filterNotNull().first()
                            if (event is BrowseAction.ReceiptPreview) {
                                // Source's paid detail preview writes no reprint audit.
                                receiptResult = PreviewPrintResult.NONE
                                kitchenResult = PreviewPrintResult.NONE
                                receiptPrinting = false
                                kitchenPrinting = false
                                preview =
                                    ReceiptPreviewRequest(
                                        stored.toReceipt(),
                                        stored.toKitchenTicket(java.time.LocalDateTime.now()),
                                    ) {
                                        preview = null
                                    }
                                return@launch
                            }
                            reprinting = true
                            actionError =
                                try {
                                    when (
                                        reprintReceipt(
                                            stored,
                                            requireNotNull(audit),
                                            modules.printers::printReceipt,
                                        )
                                    ) {
                                        ReprintResult.Printed -> null
                                        ReprintResult.NotSynced ->
                                            "This order has not synced yet, so the reprint cannot be recorded. Connect and sync, then try again."
                                        ReprintResult.AuditFailed,
                                        ReprintResult.PrintFailed -> "Failed to reprint receipt"
                                    }
                                } finally {
                                    reprinting = false
                                }
                        }
                }
                is BrowseAction.SystemStatus ->
                    if (modules == null) unavailable = true else statusVisible = true
                is BrowseAction.Settings ->
                    if (modules == null) unavailable = true else route = "SettingsScreen"
                is BrowseAction.DayClosing ->
                    if (modules == null) unavailable = true else route = "DayClosingScreen"
                else -> if (onAction == null) unavailable = true else onAction(event)
            }
        else if (onAction == null) unavailable = true else onAction(event)
    }
    fun back() {
        if (detailId != null) detailId = null
        else if (route != "HomeScreen") {
            holder.removeState(route)
            // Printers and Software Update are pushed above Settings, exactly as the source stack.
            route =
                if (route == "PrinterSettingsScreen" || route == SOFTWARE_UPDATE_ROUTE) nestedReturn
                else "HomeScreen"
        }
    }
    fun openUpdates() {
        modules?.updates?.dismiss()
        nestedReturn = if (route == "SettingsScreen") "SettingsScreen" else route
        route = SOFTWARE_UPDATE_ROUTE
    }
    BackHandler(route != "HomeScreen" || detailId != null) { back() }
    LaunchedEffect(route, detailId) {
        onRoute(if (detailId != null) "OrderDetailScreen" else route)
    }
    // Only the overall status, so sync progress ticks don't recompose every route.
    val overallStatus by
        remember(modules) {
                modules?.settings?.state?.map { it.systemStatus.overall }?.distinctUntilChanged()
                    ?: flowOf(SystemStatusProjection.empty.overall)
            }
            .collectAsStateWithLifecycle(SystemStatusProjection.empty.overall)
    CompositionLocalProvider(LocalSystemOverallStatus provides overallStatus) {
        holder.SaveableStateProvider(if (detailId != null) "detail:$detailId" else route) {
            if (detailId != null) {
                val flow =
                    remember(repository, storeId, detailId) { repository.detail(storeId, detailId!!) }
                val detail by flow.collectAsStateWithLifecycle(initialValue = null)
                OrderDetailScreen(detail, { back() }, action, reprinting)
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
                    "TakeoutListScreen" ->
                        TakeoutScreen(repository, storeId, { back() }, action, correctedOrderId)
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
                                    else if (modules == null) receiptUnavailable = true
                                    else {
                                        receiptResult = PreviewPrintResult.NONE
                                        kitchenResult = PreviewPrintResult.NONE
                                        receiptPrinting = false
                                        kitchenPrinting = false
                                        preview =
                                            ReceiptPreviewRequest(
                                                complete.toReceipt(),
                                                complete.toKitchenTicket(
                                                    java.time.LocalDateTime.now()
                                                ),
                                                ::exitCheckout,
                                            )
                                        scope.launch {
                                            // Source opens the drawer after the commit whenever the
                                            // toggle is on, regardless of tender, and never blocks
                                            // checkout when the drawer fails.
                                            if (modules.printers.state.value.cashDrawerEnabled) {
                                                try {
                                                    modules.printers.openCashDrawer()
                                                } catch (cancelled: CancellationException) {
                                                    throw cancelled
                                                } catch (_: Exception) {
                                                    // Deliberately swallowed, as in the source.
                                                }
                                            }
                                        }
                                    }
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
                                printKitchen = { request ->
                                    // Source resolves a disabled, unconfigured or unreachable kitchen
                                    // printer silently; the caller still reports items as sent.
                                    if (modules == null)
                                        error(
                                            "Kitchen printing is not available in this build yet. The order is saved locally."
                                        )
                                    modules.printers.printKitchenTicket(
                                        request.toTicket(java.time.LocalDateTime.now())
                                    )
                                },
                                printBill = { orderId ->
                                    val view =
                                        checkoutRepository
                                            ?.observe(checkoutOwner, orderId)
                                            ?.first()
                                            ?: error("Bill is unavailable. Please try again.")
                                    val activeModules =
                                        modules
                                            ?: error(
                                                "Receipt printing is not available in this build."
                                            )
                                    activeModules.printers.printBill(
                                        view.toBill(user.name, java.time.LocalDateTime.now())
                                    )
                                },
                            )
                        }
                    "SettingsScreen" ->
                        if (modules != null) {
                            val settingsState by
                                modules.settings.state.collectAsStateWithLifecycle()
                            LaunchedEffect(modules.settings) { modules.settings.load() }
                            SettingsScreen(
                                settingsState,
                                onBack = { back() },
                                onPrinters = {
                                    nestedReturn = "SettingsScreen"
                                    route = "PrinterSettingsScreen"
                                },
                                // Source gates on permission, ignores taps while syncing, then
                                // confirms before any resync runs.
                                onRefreshRequested = {
                                    when {
                                        !settingsState.canManageSettings ->
                                            refreshNotice =
                                                "Permission Required" to REFRESH_PERMISSION_MESSAGE
                                        settingsState.isSyncing -> Unit
                                        else -> confirmRefresh = true
                                    }
                                },
                                onUpdates = { openUpdates() },
                                onAutoLockRequested = {
                                    if (!modules.settings.openAutoLock())
                                        actionError = "Only a manager can change the auto-lock timeout."
                                },
                                onAutoLockSelected = { minutes ->
                                    scope.launch {
                                        val result = modules.settings.updateAutoLock(minutes)
                                        (result as? AutoLockUpdateResult.Failed)?.let {
                                            actionError = it.message
                                        }
                                    }
                                },
                                onAutoLockDismissed = modules.settings::closeAutoLock,
                                onSystemStatus = { action(BrowseAction.SystemStatus) },
                            )
                        }
                    "PrinterSettingsScreen" ->
                        if (modules != null)
                            PrinterSettingsScreen(
                                modules.printers,
                                onBack = { back() },
                                onSystemStatus = { action(BrowseAction.SystemStatus) },
                            )
                    SOFTWARE_UPDATE_ROUTE ->
                        if (modules != null) {
                            val updateState by modules.updates.state.collectAsStateWithLifecycle()
                            LaunchedEffect(modules.updates) {
                                modules.updates.restore()
                                modules.updates.check()
                            }
                            SoftwareUpdateScreen(
                                updateState,
                                modules.currentVersion,
                                onBack = { back() },
                                onCheck = { scope.launch { modules.updates.check() } },
                                onDownload = { scope.launch { modules.updates.startDownload() } },
                                onInstall = { scope.launch { modules.updates.install() } },
                                onSystemStatus = { action(BrowseAction.SystemStatus) },
                            )
                        }
                    "DayClosingScreen" ->
                        if (modules != null)
                            DayClosingScreen(
                                storeId,
                                modules.closing,
                                onBack = { back() },
                                onSystemStatus = { action(BrowseAction.SystemStatus) },
                            )
                }
        }
    }
    if (statusVisible && modules != null) {
        val settingsState by modules.settings.state.collectAsStateWithLifecycle()
        LaunchedEffect(modules.settings) { modules.settings.load() }
        SystemStatusDropdown(
            status = settingsState.systemStatus,
            now = System.currentTimeMillis(),
            onRetryServer = onRetrySync,
            onReconnectReceipt = {
                modules.printers.state.value.receiptPrinter?.let { printer ->
                    scope.launch { modules.printers.reconnect(printer.id) }
                }
            },
            onReconnectKitchen = {
                modules.printers.state.value.kitchenPrinter?.let { printer ->
                    scope.launch { modules.printers.reconnect(printer.id) }
                }
            },
            onClose = { statusVisible = false },
        )
    }
    preview?.let { sale ->
        if (modules != null) {
            val printerState by modules.printers.state.collectAsStateWithLifecycle()
            // Mapped once when the preview opened: a reprint never rebuilds it from the database.
            val receipt = sale.receipt
            val kitchen = sale.kitchen
            Dialog(
                onDismissRequest = {},
                properties =
                    posDialogProperties(
                        dismissOnBackPress = false,
                        usePlatformDefaultWidth = false,
                    ),
            ) {
                HideSystemBarsInDialog()
                Surface(
                    Modifier.fillMaxWidth(0.94f).fillMaxHeight(0.92f),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.fillMaxSize()) {
                        Text(
                            "Receipt Preview",
                            Modifier.padding(start = 20.dp, top = 20.dp, bottom = 4.dp),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        ReceiptPreview(
                            receipt = receipt,
                            printers = printerState,
                            hasKitchenTicket = kitchen.items.isNotEmpty(),
                            receiptResult = receiptResult,
                            kitchenResult = kitchenResult,
                            isPrinting = receiptPrinting,
                            isKitchenPrinting = kitchenPrinting,
                            onPrint = {
                                receiptPrinting = true
                                receiptResult = PreviewPrintResult.NONE
                                scope.launch {
                                    receiptResult =
                                        try {
                                            modules.printers.printReceipt(receipt)
                                            PreviewPrintResult.SUCCESS
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (_: Exception) {
                                            PreviewPrintResult.ERROR
                                        }
                                    receiptPrinting = false
                                }
                            },
                            onPrintKitchen = {
                                kitchenPrinting = true
                                kitchenResult = PreviewPrintResult.NONE
                                scope.launch {
                                    kitchenResult =
                                        try {
                                            modules.printers.printPreviewKitchenTicket(kitchen)
                                            PreviewPrintResult.SUCCESS
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (_: Exception) {
                                            PreviewPrintResult.ERROR
                                        }
                                    kitchenPrinting = false
                                }
                            },
                            onSkip = sale.onDone,
                        )
                    }
                }
            }
        }
    }
    if (modules != null) {
        val updateState by modules.updates.state.collectAsStateWithLifecycle()
        val info = updateState.updateInfo
        // Source renders these above the authenticated stack; the approved repair only suppresses
        // the forced overlay on the Software Update route itself. Dismissal remains a no-op.
        if (shouldShowForcedPrompt(authenticated = true, currentRoute = route, updateInfo = info)) {
            ForceUpdateModal(requireNotNull(info), ::openUpdates)
        } else if (info != null && !info.isForced && !updateState.dialogDismissed) {
            OptionalUpdateDialog(info, ::openUpdates, modules.updates::dismiss)
        }
    }
    if (confirmRefresh && modules != null)
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = { confirmRefresh = false },
            title = { Text("Refresh POS Data") },
            text = {
                Text(
                    "Pending changes will be sent and verified first. Downloaded data reloads only when it is safe. Continue?"
                )
            },
            dismissButton = { TextButton({ confirmRefresh = false }) { Text("Cancel") } },
            confirmButton = {
                TextButton({
                    confirmRefresh = false
                    scope.launch {
                        refreshNotice = refreshNotice(modules.settings.refresh())
                    }
                }) {
                    Text("Refresh")
                }
            },
        )
    refreshNotice?.let { notice ->
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = { refreshNotice = null },
            title = { Text(notice.first) },
            text = { Text(notice.second) },
            confirmButton = { TextButton({ refreshNotice = null }) { Text("OK") } },
        )
    }
    if (unavailable)
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = { unavailable = false },
            title = { Text("Unavailable") },
            text = { Text("This action is not available in this build yet.") },
            confirmButton = { TextButton({ unavailable = false }) { Text("OK") } },
        )
    if (receiptUnavailable)
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = {},
            title = { Text("Unavailable") },
            text = { Text("Receipt printing is not available in this build yet.") },
            confirmButton = { TextButton(::exitCheckout) { Text("Skip") } },
        )
    correctionOrderId?.let { id ->
        if (correctionRepository != null && checkoutHttp != null) {
            val detailFlow = remember(repository, storeId, id) { repository.detail(storeId, id) }
            val detail by detailFlow.collectAsStateWithLifecycle(initialValue = null)
            CorrectionDialogs(correctionSession(id), detail) {
                corrections.remove("$editorOwner:$id")
                correctionOrderId = null
                correctedOrderId = id
                if (detailId == id) detailId = null
            }
        }
    }
    recoveryCandidate?.let { saved ->
        fun later() {
            checkouts.deferredRecovery += saved.orderId
            recoveryCandidate = null
            recoveryDecisions++
        }
        AlertDialog(
            properties = posDialogProperties(),
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
            properties = posDialogProperties(),
            onDismissRequest = { actionError = null },
            title = { Text("Error") },
            text = { Text(message) },
            confirmButton = { TextButton({ actionError = null }) { Text("OK") } },
        )
    }
}
