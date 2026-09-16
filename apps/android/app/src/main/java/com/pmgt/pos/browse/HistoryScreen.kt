package com.pmgt.pos.browse

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HistoryScreen(
    repository: BrowseRepository,
    storeId: String,
    onBack: () -> Unit,
    onOrder: (String) -> Unit,
    onStatus: () -> Unit,
    refresh: suspend () -> Unit,
) {
    var preset by rememberSaveable { mutableStateOf(DatePreset.Today) }
    var status by rememberSaveable { mutableStateOf(HistoryStatus.All) }
    var search by rememberSaveable { mutableStateOf("") }
    // Date range remains stable while this preset is selected, including over midnight/focus
    // changes.
    var rangeStart by rememberSaveable {
        mutableLongStateOf(DayRange.preset(DatePreset.Today).start)
    }
    var rangeEnd by rememberSaveable { mutableLongStateOf(DayRange.preset(DatePreset.Today).end) }
    val flow =
        remember(repository, storeId, rangeStart, rangeEnd, status, search) {
            repository.history(
                storeId,
                HistoryFilter(DayRange(rangeStart, rangeEnd), status, search),
            )
        }
    val orders = key(flow) { flow.collectAsStateWithLifecycle(initialValue = null).value }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
        PageHeader("Order History", onBack = onBack, onStatus = onStatus)
        FilterStrip {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DatePreset.entries.forEach { value ->
                    FilterChipText(value.label, value == preset) {
                        if (preset != value) {
                            preset = value
                            DayRange.preset(value).let {
                                rangeStart = it.start
                                rangeEnd = it.end
                            }
                        }
                    }
                }
            }
        }
        FilterStrip {
            Row(
                Modifier.fillMaxWidth()
                    .background(BrowseColors.Background, RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Ion(Glyph.Search, 18, Color(0xFF9CA3AF))
                BasicTextField(
                    search,
                    { search = it },
                    Modifier.weight(1f).padding(start = 8.dp).semantics {
                        contentDescription = "Search orders"
                    },
                    textStyle = TextStyle(color = BrowseColors.Ink, fontSize = 16.sp),
                    singleLine = true,
                    decorationBox = { inner ->
                        Box {
                            if (search.isEmpty())
                                Label(
                                    "Search by order # or customer name...",
                                    16,
                                    Color(0xFF9CA3AF),
                                )
                            inner()
                        }
                    },
                )
                if (search.isNotEmpty()) IconAction("Clear search", Glyph.Clear, { search = "" })
            }
        }
        FilterStrip {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HistoryStatus.entries.forEach {
                    FilterChipText(it.label, it == status) { status = it }
                }
            }
        }
        PullToRefreshBox(
            refreshing,
            {
                scope.launch {
                    refreshing = true
                    try {
                        refresh()
                    } finally {
                        refreshing = false
                    }
                }
            },
            Modifier.weight(1f),
        ) {
            when {
                orders == null -> Loading()
                orders!!.isEmpty() -> EmptyOrders("No orders found", "Try adjusting your filters")
                else ->
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
                        state = rememberLazyListState(),
                    ) {
                        items(orders!!, key = { it.id }) { order ->
                            HistoryRow(order) { onOrder(order.id) }
                        }
                    }
            }
        }
    }
}

@Composable
private fun FilterStrip(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color.White)) {
        Box(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) { content() }
        HorizontalDivider(color = BrowseColors.Border)
    }
}

@Composable
private fun HistoryRow(order: OrderSummary, onClick: () -> Unit) {
    Surface(
        onClick,
        Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 8.dp),
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        border = BorderStroke(1.dp, BrowseColors.Background),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Label("#${order.orderNumber}", 16, weight = FontWeight.Bold)
                PaymentBadge(order.status)
                Spacer(Modifier.weight(1f))
                Label(money(order.netSales), 16, weight = FontWeight.Bold)
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Ion(if (order.orderType == "dine_in") Glyph.Dining else Glyph.Bag, 14)
                Label(orderType(order.orderType), 14, BrowseColors.Muted)
                (order.tableName ?: order.customerName)
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { Label(it, 14, BrowseColors.Muted) }
                when (order.paymentMethod) {
                    "cash" -> Label("Cash", 14, BrowseColors.Muted)
                    "card_ewallet" -> Label("Card", 14, BrowseColors.Muted)
                }
                Label(dateText(order.createdAt, "h:mm a"), 14, BrowseColors.Muted)
            }
        }
    }
}
