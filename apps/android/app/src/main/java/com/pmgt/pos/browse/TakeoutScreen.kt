package com.pmgt.pos.browse

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TakeoutScreen(
    repository: BrowseRepository,
    storeId: String,
    onBack: () -> Unit,
    onAction: (BrowseAction) -> Unit,
) {
    var dayValue by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    val day = LocalDate.parse(dayValue)
    val today = LocalDate.now()
    val isToday = day == today
    val dayLabel =
        when (day) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> day.format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US))
        }
    val flow =
        remember(repository, storeId, dayValue) { repository.takeout(storeId, DayRange.of(day)) }
    val lane = key(flow) { flow.collectAsStateWithLifecycle(initialValue = null).value }
    var selectedOrder by rememberSaveable { mutableStateOf<String?>(null) }
    var discard by remember { mutableStateOf<OrderSummary?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
        PageHeader(
            "Takeout Orders",
            "$dayLabel's takeout orders",
            onBack,
            { onAction(BrowseAction.SystemStatus) },
            right = {
                ActionButton(
                    "New Order",
                    { onAction(BrowseAction.NewTakeout(storeId)) },
                    glyph = Glyph.Add,
                )
            },
        )
        Row(
            Modifier.fillMaxWidth()
                .background(Color.White)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction("Previous day", Glyph.Previous, { dayValue = day.minusDays(1).toString() })
            Box(Modifier.widthIn(min = 120.dp), contentAlignment = Alignment.Center) {
                Label(dayLabel, 14, weight = FontWeight.Bold)
            }
            IconAction(
                "Next day",
                Glyph.Next,
                { dayValue = day.plusDays(1).toString() },
                enabled = !isToday,
            )
            if (!isToday) ActionButton("Today", { dayValue = today.toString() }, outline = true)
        }
        HorizontalDivider(color = BrowseColors.Border)
        lane
            ?.drafts
            ?.takeIf { it.isNotEmpty() }
            ?.let { drafts ->
                Column(
                    Modifier.fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 8.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Label("Drafts (${drafts.size})", 16, Color(0xFF92400E), FontWeight.Bold)
                    drafts.forEach { draft ->
                        Row(
                            Modifier.fillMaxWidth()
                                .background(Color(0xFFFEF3C7), RoundedCornerShape(12.dp))
                                .border(2.dp, BrowseColors.Amber, RoundedCornerShape(12.dp))
                                .padding(14.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(
                                Modifier.weight(1f).clickable {
                                    onAction(BrowseAction.OpenTakeout(storeId, draft.id))
                                }
                            ) {
                                Label(draftName(draft), 16, weight = FontWeight.Bold)
                                Label(
                                    "${dateText(draft.createdAt, "h:mm a", Locale.US)} · ${quantity(draft.itemCount)} items · ${money(draft.netSales)}",
                                    14,
                                    BrowseColors.Muted,
                                )
                            }
                            IconAction(
                                "Discard ${draftName(draft)}",
                                Glyph.Trash,
                                { discard = draft },
                            )
                            ActionButton(
                                "Resume",
                                { onAction(BrowseAction.OpenTakeout(storeId, draft.id)) },
                                color = BrowseColors.Amber,
                            )
                        }
                    }
                }
            }
        PullToRefreshBox(
            refreshing,
            {
                scope.launch {
                    refreshing = true
                    delay(500)
                    refreshing = false
                }
            },
            Modifier.weight(1f),
        ) {
            if (lane == null) Loading()
            else {
                val sections =
                    listOf(
                        "Needs Attention" to lane!!.attention,
                        "In Progress" to lane!!.progress,
                        "History" to lane!!.history,
                    )
                LazyColumn(Modifier.fillMaxSize(), state = rememberLazyListState()) {
                    if (sections.all { it.second.isEmpty() })
                        item {
                            Column(
                                Modifier.fillMaxWidth().padding(vertical = 64.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Ion(Glyph.Bag, 48, Color(0xFFD1D5DB))
                                Label(
                                    "No takeout orders ${if (isToday) "today" else "on this day"}",
                                    16,
                                    BrowseColors.Muted,
                                    modifier = Modifier.padding(top = 12.dp),
                                )
                                if (isToday)
                                    ActionButton(
                                        "Create First Order",
                                        { onAction(BrowseAction.NewTakeout(storeId)) },
                                        Modifier.padding(top = 16.dp),
                                    )
                            }
                        }
                    sections.forEach { (title, orders) ->
                        if (orders.isNotEmpty())
                            item(key = title) {
                                Label(
                                    "$title (${orders.size})",
                                    14,
                                    weight = FontWeight.Bold,
                                    modifier =
                                        Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp),
                                )
                            }
                        items(orders, key = { it.id }) { order ->
                            TakeoutCard(
                                order,
                                { onAction(BrowseAction.OpenTakeout(storeId, order.id)) },
                                { selectedOrder = order.id },
                                onAction,
                            )
                        }
                    }
                }
            }
        }
    }
    selectedOrder?.let { id ->
        val details = remember(repository, storeId, id) { repository.detail(storeId, id) }
        val order = key(details) { details.collectAsStateWithLifecycle(initialValue = null).value }
        TakeoutDetailModal(order, { selectedOrder = null }, onAction)
    }
    discard?.let { draft ->
        AlertDialog(
            onDismissRequest = { discard = null },
            title = { Text("Discard Draft") },
            text = { Text("Discard \"${draftName(draft)}\"? This cannot be undone.") },
            confirmButton = {
                TextButton({
                    discard = null
                    onAction(BrowseAction.DiscardDraft(draft.id))
                }) {
                    Text("Discard", color = BrowseColors.Red)
                }
            },
            dismissButton = { TextButton({ discard = null }) { Text("Cancel") } },
        )
    }
}

private fun draftName(order: OrderSummary) =
    order.customerName?.takeIf { it.isNotEmpty() }
        ?: order.draftLabel?.takeIf { it.isNotEmpty() }
        ?: "Draft"

@Composable
internal fun WorkflowBadge(status: String) {
    val label =
        when (status) {
            "ready_for_pickup" -> "Ready"
            else -> status.replaceFirstChar { it.uppercase() }
        }
    val color =
        when (status) {
            "pending" -> BrowseColors.Amber
            "preparing" -> BrowseColors.Brand
            "ready_for_pickup" -> BrowseColors.Green
            "cancelled" -> BrowseColors.Red
            else -> BrowseColors.Muted
        }
    StatusBadge(label, color, color.copy(alpha = .15f))
}

@Composable
private fun TakeoutCard(
    order: OrderSummary,
    onResume: () -> Unit,
    onDetails: () -> Unit,
    onAction: (BrowseAction) -> Unit,
) {
    val open = order.status == "open"
    val advance = open && order.takeoutStatus in setOf("preparing", "ready_for_pickup")
    val next =
        when (order.takeoutStatus) {
            "pending" -> "preparing" to "Start Preparing"
            "preparing" -> "ready_for_pickup" to "Ready for Pickup"
            "ready_for_pickup" -> "completed" to "Complete"
            else -> null
        }
    val canAdvance = order.status == "paid" && next != null
    val bg = if (advance) Color(0xFFEFF6FF) else if (open) Color(0xFFFFFBEB) else Color.White
    val border =
        if (advance) Color(0xFF93C5FD) else if (open) Color(0xFFFCD34D) else BrowseColors.Background
    Column(
        Modifier.fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 12.dp)
            .background(bg, RoundedCornerShape(12.dp))
            .border(1.dp, border, RoundedCornerShape(12.dp))
            .padding(16.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Label(order.orderNumber, 18, weight = FontWeight.Bold)
                order.customerName
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { Label(it, 14, BrowseColors.Muted) }
            }
            Column(
                verticalArrangement = Arrangement.spacedBy(6.dp),
                horizontalAlignment = Alignment.End,
            ) {
                WorkflowBadge(order.takeoutStatus)
                if (order.status == "paid") PaymentBadge("paid")
                else StatusBadge("Unpaid", BrowseColors.Amber, Color(0xFFFEF3C7))
            }
        }
        Row(
            Modifier.padding(top = 10.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Label(dateText(order.createdAt, "hh:mm a", Locale.getDefault()), 14, BrowseColors.Muted)
            Label("${quantity(order.itemCount)} items", 14, BrowseColors.Muted)
            Label(money(order.netSales), 16, weight = FontWeight.Bold)
        }
        Label(
            when {
                advance -> "Ticket sent. Advance or collect payment below."
                open -> "Open order. Resume to edit or take payment."
                canAdvance -> "Paid order ready for the next kitchen step."
                else -> "Past order — open to reprint the receipt."
            },
            12,
            BrowseColors.Muted,
            modifier = Modifier.padding(bottom = 12.dp),
        )
        when {
            advance ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton(
                        "Add Items",
                        onResume,
                        Modifier.weight(1f),
                        color = BrowseColors.Amber,
                        glyph = Glyph.AddCircle,
                    )
                    ActionButton(
                        "Take Payment",
                        { onAction(BrowseAction.Checkout(order.id, "takeout")) },
                        Modifier.weight(1f),
                        glyph = Glyph.Card,
                    )
                }
            open ->
                ActionButton(
                    "Resume Order",
                    onResume,
                    Modifier.fillMaxWidth(),
                    color = BrowseColors.Amber,
                    glyph = Glyph.Edit,
                )
            canAdvance ->
                ActionButton(
                    next!!.second,
                    { onAction(BrowseAction.AdvanceTakeout(order.id, next.first)) },
                    Modifier.fillMaxWidth(),
                    color =
                        if (order.takeoutStatus == "pending") BrowseColors.Brand
                        else BrowseColors.Green,
                    glyph = if (order.takeoutStatus == "pending") Glyph.Dining else Glyph.Check,
                )
        }
        if (!open)
            ActionButton(
                if (canAdvance) "View Receipt" else "View Details",
                onDetails,
                Modifier.fillMaxWidth().padding(top = if (canAdvance) 10.dp else 0.dp),
                color = Color(0xFF475569),
                outline = true,
                glyph = if (canAdvance) Glyph.Receipt else Glyph.Document,
            )
    }
}
