package com.pmgt.pos.orders

import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.R
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

@Composable
fun OrderEditorScreen(
    session: OrderEditorSession,
    repository: OrderEntryRepository,
    catalog: CatalogRepository,
    onBack: () -> Unit,
    onStatus: () -> Unit,
    onCheckout: (CheckoutRoute) -> Unit,
    printKitchen: suspend (KitchenRequest) -> Unit = {
        error("Kitchen printing is not available in this build yet. The order is saved locally.")
    },
) {
    val state by session.state.collectAsStateWithLifecycle()
    val pending by session.edits.pending.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val dialogs = session.dialogs
    fun run(title: String = "Error", block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                dialogs.error = title to (failure.message ?: "Please try again.")
            }
        }
    }
    fun back() {
        run("Quantity not saved") {
            session.leave()
            onBack()
        }
    }
    BackHandler { back() }
    LaunchedEffect(state.quantityErrors) {
        if (state.quantityErrors > 0)
            dialogs.error =
                "Quantity not saved" to "Try checkout again to retry saving your quantity changes."
    }
    LaunchedEffect(session) {
        try {
            session.initialize()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            dialogs.error = "Error" to "Failed to update order category"
        }
    }
    key(state.orderId) {
        if (state.orderId != null) {
            val flow =
                remember(repository, state.orderId) {
                    repository.cart(session.route.storeId, state.orderId!!).catch { failure ->
                        if (failure is CancellationException) throw failure
                        dialogs.error =
                            "Error" to "Could not load this order. Please return and try again."
                        emit(null)
                    }
                }
            // RN useObservable keeps its same-order snapshot while blurred. A remount's
            // loading state must not masquerade as a missing order/customer-field change.
            val cart by flow.collectAsStateWithLifecycle(initialValue = state.cart)
            LaunchedEffect(cart) { session.loaded(cart) }
        }
    }
    fun send(pax: Double? = null) {
        run {
            session.send(pax)?.let { request ->
                // Until Task11 is integrated, this explicit seam cannot report printed/sent
                // success.
                printKitchen(request)
                dialogs.success = true
            }
        }
    }
    if (!state.draftMode && state.cart == null && !state.needsRecalculation) Loading()
    else
        Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
            if (session.route.takeout)
                PageHeader(
                    state.customer.trim().ifEmpty { "Takeout Order" },
                    if (state.cart?.status == "draft") "Draft order" else "Order in progress",
                    { back() },
                    onStatus,
                    badges = {
                        Box(
                            Modifier.background(Color(0xFFFFF7ED), RoundedCornerShape(999.dp))
                                .border(1.dp, Color(0xFFFDBA74), RoundedCornerShape(999.dp))
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Label("Takeout", 12, OrangeInk, FontWeight.Bold)
                        }
                    },
                    titleSize = 20,
                    titleWeight = FontWeight.SemiBold,
                )
            else {
                Row(
                    Modifier.fillMaxWidth()
                        .background(Color.White)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconAction("Back", Glyph.Back, { back() })
                    Row(
                        Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Label(state.tableName, 18, weight = FontWeight.Bold)
                        Label(
                            if (state.draftMode) "New Order"
                            else
                                state.cart
                                    ?.pax
                                    ?.takeIf { it != 0.0 }
                                    ?.let { "Dine-In · ${numberText(it)} pax" } ?: "Dine-In",
                            14,
                            BrowseColors.Muted,
                        )
                        if (state.cart?.tabNumber != null && !state.cart?.tabName.isNullOrEmpty())
                            EntryButton(
                                state.cart!!.tabName!!,
                                {
                                    dialogs.input = state.cart!!.tabName!!
                                    dialogs.modal = "tab"
                                },
                                color = BrowseColors.Background,
                                ink = BrowseColors.Muted,
                                small = true,
                                glyph = Glyph.Edit,
                            )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SystemIndicator(onStatus)
                        if (!state.draftMode) {
                            if (state.cart?.orderType == "dine_in")
                                EntryButton(
                                    "Update Pax",
                                    {
                                        dialogs.input = state.cart?.pax?.let(::numberText).orEmpty()
                                        dialogs.modal = "pax"
                                    },
                                    color = Color.White,
                                    ink = BrowseColors.Ink,
                                    small = true,
                                    outline = true,
                                    enabled = "pax" !in state.busy && "send" !in state.busy,
                                )
                            EntryButton(
                                "Transfer",
                                { dialogs.modal = "transfer" },
                                color = Color.White,
                                ink = BrowseColors.Ink,
                                small = true,
                                outline = true,
                            )
                            if (state.cart?.orderType == "dine_in")
                                EntryButton(
                                    "New Tab",
                                    { run { session.newTab() } },
                                    color = Color.White,
                                    ink = BrowseColors.Ink,
                                    small = true,
                                    outline = true,
                                    enabled = "newTab" !in state.busy,
                                )
                        }
                    }
                }
                HorizontalDivider(color = BrowseColors.Border)
            }
            Row(Modifier.weight(1f)) {
                Column(Modifier.weight(2f).fillMaxHeight().testTag("order-menu")) {
                    if (session.route.takeout)
                        TakeoutMetadata(
                            state,
                            session::customerText,
                            session::markerText,
                            { run { session.saveCustomer() } },
                            { run { session.saveMarker() } },
                            { run { session.category(it) } },
                        )
                    CatalogMenu(
                        session.route.storeId,
                        catalog,
                        {
                            dialogs.selectedIntent = uid()
                            dialogs.selected = it
                        },
                        Modifier.weight(1f),
                    )
                }
                VerticalDivider(color = BrowseColors.Border)
                EntryCart(
                    state,
                    session.route.takeout,
                    pending,
                    { id, delta ->
                        if (!session.changeQuantity(id, delta)) {
                            val line = session.state.value.lines.firstOrNull { it.item.id == id }
                            if (state.draftMode) run { session.remove(id) }
                            else dialogs.removing = line
                        }
                    },
                    { line ->
                        if (line.item.isSentToKitchen) {
                            dialogs.voiding = line
                            dialogs.input = ""
                        } else if (state.draftMode) run { session.remove(line.item.id) }
                        else dialogs.removing = line
                    },
                    { id, type -> run { session.changeService(id, type) } },
                    {
                        if (state.draftMode) {
                            dialogs.input = ""
                            dialogs.modal = "sendPax"
                        } else send()
                    },
                    { run("Quantity not saved") { session.checkout()?.let(onCheckout) } },
                    {
                        if (state.draftMode && state.lines.isEmpty()) back()
                        else dialogs.cancelling = true
                    },
                    { dialogs.modal = "bill" },
                    {
                        run {
                            state.cart?.let { cart ->
                                printKitchen(
                                    KitchenRequest(
                                        cart.id,
                                        cart.orderNumber,
                                        state.tableName,
                                        cart.pax,
                                        cart.lines,
                                        state.category,
                                        state.marker,
                                        cart.customerName,
                                        session.route.takeout,
                                    )
                                )
                            }
                        }
                    },
                    Modifier.weight(1f).fillMaxHeight(),
                )
            }
        }
    ProductSelectionSheet(
        session.route.storeId,
        dialogs.selected,
        catalog,
        if (session.route.takeout) CatalogEntryPoint.Takeout else CatalogEntryPoint.DineIn,
        "add" in state.busy || "send" in state.busy,
        {
            run {
                session.finishPendingAdd()
                dialogs.selected = null
            }
        },
        { choice ->
            run {
                session.add(choice, dialogs.selectedIntent)
                dialogs.selected = null
            }
        },
        stateOwner = dialogs.options,
    )
    if (dialogs.modal == "sendPax" || dialogs.modal == "pax")
        EntryDialog(
            if (dialogs.modal == "sendPax") "Guest Count (PAX)" else "Update Guest Count",
            { dialogs.modal = null },
            pax = true,
        ) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { focus.requestFocus() }
            EntryField(
                dialogs.input,
                { dialogs.input = it },
                "Number of guests",
                Modifier.fillMaxWidth().testTag("pax-input").focusRequester(focus),
                18,
                true,
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                EntryButton(
                    "Cancel",
                    { dialogs.modal = null },
                    Modifier.weight(1f),
                    Color(0xFFE5E7EB),
                    Color(0xFF374151),
                    vertical = 12,
                    radius = 8,
                )
                EntryButton(
                    "Confirm",
                    {
                        val count =
                            Regex("^[+-]?\\d+")
                                .find(dialogs.input.trimStart())
                                ?.value
                                ?.toDoubleOrNull()
                        if (count == null || count < 1)
                            dialogs.error =
                                "Invalid Input" to
                                    "Please enter a valid number of guests (at least 1)."
                        else {
                            val sending = dialogs.modal == "sendPax"
                            dialogs.modal = null
                            if (sending) send(count) else run { session.updatePax(count) }
                        }
                    },
                    Modifier.weight(1f),
                    enabled = "send" !in state.busy && "pax" !in state.busy,
                    vertical = 12,
                    radius = 8,
                )
            }
        }
    if (dialogs.modal == "tab")
        EntryDialog("Edit Tab Name", { dialogs.modal = null }) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { focus.requestFocus() }
            Label(
                "Customize the name for this tab. Leave blank to use the default name.",
                14,
                BrowseColors.Muted,
            )
            Spacer(Modifier.height(16.dp))
            val default = "Tab ${state.cart?.tabNumber?.let(::numberText) ?: "1"}"
            EntryField(
                dialogs.input,
                { dialogs.input = it.take(50) },
                default,
                Modifier.fillMaxWidth().testTag("tab-name").focusRequester(focus),
            )
            EntryButton(
                "Reset to Default",
                { dialogs.input = default },
                Modifier.align(Alignment.End),
                Color.White,
                BrowseColors.Muted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                EntryButton(
                    "Cancel",
                    { dialogs.modal = null },
                    Modifier.weight(1f),
                    Color.White,
                    BrowseColors.Ink,
                    outline = true,
                )
                EntryButton(
                    "Save",
                    {
                        run {
                            session.updateTab(dialogs.input.trim().ifEmpty { default })
                            dialogs.modal = null
                        }
                    },
                    Modifier.weight(1f),
                    enabled = "tab" !in state.busy,
                )
            }
        }
    if (dialogs.modal == "transfer") {
        val flow = remember(repository) { repository.availableTables(session.route.storeId) }
        val tables by flow.collectAsStateWithLifecycle(initialValue = null)
        EntryDialog("Transfer Table", { dialogs.modal = null }, scrollable = false) {
            Label("Move order from ${state.tableName} to:", 14, BrowseColors.Muted)
            Spacer(Modifier.height(16.dp))
            if (tables == null) Loading(Modifier.height(100.dp))
            else if (tables!!.isEmpty()) Label("No available tables", 16, BrowseColors.Muted)
            else
                LazyColumn(Modifier.heightIn(max = 300.dp)) {
                    items(tables!!, key = { it.id }) { table ->
                        Row(
                            Modifier.fillMaxWidth()
                                .clickable(enabled = "transfer" !in state.busy) {
                                    run {
                                        session.transfer(table.id, table.name)
                                        dialogs.modal = null
                                        dialogs.error =
                                            "Transferred" to "Order moved to ${table.name}"
                                    }
                                }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Ion(Glyph.Available)
                            Spacer(Modifier.width(12.dp))
                            Label(table.name, modifier = Modifier.weight(1f))
                            if (table.capacity != 0.0)
                                Label("${numberText(table.capacity)} seats", 12, BrowseColors.Muted)
                        }
                    }
                }
        }
    }
    if (dialogs.modal == "bill") EntryBill(state, { dialogs.modal = null })
    dialogs.voiding?.let { line ->
        EntryDialog("Void Item", { dialogs.voiding = null }) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { focus.requestFocus() }
            Label(
                "${numberText(line.item.quantity)}x ${line.item.productName}",
                weight = FontWeight.Medium,
            )
            Label(
                "This item has been sent to the kitchen. Please provide a reason for voiding.",
                14,
                BrowseColors.Muted,
                modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
            )
            EntryField(
                dialogs.input,
                { dialogs.input = it },
                "Reason for voiding...",
                Modifier.fillMaxWidth().testTag("void-reason").focusRequester(focus),
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                EntryButton(
                    "Cancel",
                    { dialogs.voiding = null },
                    Modifier.weight(1f),
                    Color.White,
                    BrowseColors.Ink,
                    outline = true,
                )
                EntryButton(
                    "Confirm Void",
                    {
                        run {
                            try {
                                session.remove(line.item.id, dialogs.input.trim())
                            } finally {
                                dialogs.voiding = null
                            }
                        }
                    },
                    Modifier.weight(1f),
                    BrowseColors.Red,
                    enabled = dialogs.input.trim().isNotEmpty() && "remove" !in state.busy,
                )
            }
        }
    }
    dialogs.removing?.let { line ->
        AlertDialog(
            onDismissRequest = { dialogs.removing = null },
            title = { Text("Remove Item") },
            text = { Text("Are you sure you want to remove this item?") },
            dismissButton = { TextButton({ dialogs.removing = null }) { Text("Cancel") } },
            confirmButton = {
                TextButton({
                    dialogs.removing = null
                    run { session.remove(line.item.id) }
                }) {
                    Text("Remove")
                }
            },
        )
    }
    if (dialogs.cancelling) {
        val draft = session.route.takeout && state.cart?.status == "draft"
        AlertDialog(
            onDismissRequest = { dialogs.cancelling = false },
            title = { Text(if (draft) "Discard Draft" else "Cancel Order") },
            text = {
                Text(
                    if (draft)
                        "If you just need to take another customer's order, tap Keep Draft and go back. Only discard this draft if you're sure you no longer need this cart."
                    else if (state.draftMode) "Discard all items and go back?"
                    else "Are you sure you want to cancel this order? All items will be removed."
                )
            },
            dismissButton = {
                TextButton({
                    dialogs.cancelling = false
                    if (draft) back()
                }) {
                    Text(if (draft) "Keep Draft" else "No")
                }
            },
            confirmButton = {
                TextButton({
                    dialogs.cancelling = false
                    run {
                        session.discard()
                        onBack()
                    }
                }) {
                    Text(if (draft || state.draftMode) "Yes, Discard" else "Yes, Cancel")
                }
            },
        )
    }
    dialogs.error?.let { (title, message) ->
        AlertDialog(
            onDismissRequest = { dialogs.error = null },
            title = { Text(title) },
            text = { Text(message) },
            confirmButton = { TextButton({ dialogs.error = null }) { Text("OK") } },
        )
    }
    if (dialogs.success)
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Sent") },
            text = {
                Text(
                    if (session.route.takeout) "New items sent to kitchen"
                    else "Items sent to kitchen"
                )
            },
            confirmButton = {
                TextButton({
                    dialogs.success = false
                    onBack()
                }) {
                    Text("OK")
                }
            },
        )
}

@Composable
internal fun EntryDialog(
    title: String,
    onClose: () -> Unit,
    pax: Boolean = false,
    wide: Boolean = false,
    scrollable: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onClose,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        HideSystemBarsInDialog()
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            if (!pax) window?.setWindowAnimations(R.style.CatalogDialogAnimation)
        }
        Box(Modifier.fillMaxSize().imePadding(), contentAlignment = Alignment.Center) {
            Box(
                Modifier.fillMaxSize()
                    .background(Color.Black.copy(alpha = .5f))
                    .clickable(onClick = onClose)
            )
            Column(
                Modifier.then(
                        if (wide) Modifier.fillMaxWidth(.9f)
                        else if (pax) Modifier.width(288.dp)
                        else
                            Modifier.padding(horizontal = 16.dp)
                                .widthIn(max = 448.dp)
                                .fillMaxWidth()
                    )
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .then(
                        if (scrollable && !pax) Modifier.verticalScroll(rememberScrollState())
                        else Modifier
                    )
                    .padding(if (pax) 24.dp else 20.dp)
                    .testTag("entry-dialog")
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement =
                        if (pax) Arrangement.Center else Arrangement.SpaceBetween,
                ) {
                    Label(title, 18, weight = FontWeight.Bold)
                    if (!pax) IconAction("Close dialog", Glyph.Close, onClose)
                }
                content()
            }
        }
    }
}

@Composable
private fun EntryBill(state: EditorState, close: () -> Unit) {
    EntryDialog("Current Bill", close, wide = true, scrollable = false) {
        Label(
            "${state.tableName.takeIf { it.isNotEmpty() }?.plus(" - ").orEmpty()}Order #${state.cart?.orderNumber.orEmpty()}",
            14,
            BrowseColors.Muted,
        )
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        LazyColumn(Modifier.heightIn(max = 300.dp)) {
            items(state.lines, key = { it.item.id }) { line ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Label(line.item.productName)
                            line.item.serviceType?.let {
                                StatusBadge(if (it == "takeout") "TAKEOUT" else "DINE IN")
                            }
                        }
                        Label(
                            "${numberText(line.item.quantity)}x ${money(line.item.productPrice)}",
                            12,
                            Color(0xFF9CA3AF),
                        )
                    }
                    Label(money(line.total), weight = FontWeight.Medium)
                }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        listOf(
                "Subtotal" to state.cart?.totals?.grossSales,
                "VAT (12%)" to state.cart?.totals?.vatAmount,
                "Total" to state.cart?.totals?.netSales,
            )
            .forEach { (label, amount) ->
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Label(
                        label,
                        if (label == "Total") 16 else 14,
                        weight = if (label == "Total") FontWeight.Bold else FontWeight.Normal,
                    )
                    Label(money(amount ?: 0.0))
                }
            }
    }
}
