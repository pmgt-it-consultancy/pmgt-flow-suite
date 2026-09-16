package com.pmgt.pos.browse

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.auth.SignedInUser
import com.pmgt.pos.sync.SyncStatus
import java.util.Locale
import kotlinx.coroutines.delay

@Composable
internal fun HomeScreen(
    user: SignedInUser,
    orders: List<OrderSummary>?,
    summary: DashboardSummary?,
    syncLabel: String,
    hasPin: Boolean,
    onTables: () -> Unit,
    onTakeout: () -> Unit,
    onHistory: () -> Unit,
    onLock: () -> Unit,
    onLogout: () -> Unit,
    onAction: (BrowseAction) -> Unit,
    syncStatus: SyncStatus,
    onRetrySync: () -> Unit,
) {
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            clock = System.currentTimeMillis()
        }
    }
    var confirmLogout by remember { mutableStateOf(false) }
    val dineIn = orders.orEmpty().count { it.orderType == "dine_in" }
    val takeout = orders.orEmpty().count { it.orderType == "takeout" }
    val total = orders.orEmpty().size
    Column(Modifier.fillMaxSize().background(Color(0xFFEDF3F7))) {
        Row(
            Modifier.fillMaxWidth()
                .background(Color.White)
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val name = user.name.replace(Regex("\\s*\\([^)]*\\)\\s*"), "").trim()
            Box(
                Modifier.size(42.dp).background(BrowseColors.Brand, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                HomeLabel(name.take(1).uppercase(), 17, Color.White, FontWeight.SemiBold)
            }
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                HomeLabel(name, 17, Color(0xFF0F172A), FontWeight.SemiBold, letterSpacing = -.2f)
                if (!user.name.contains('('))
                    user.role?.name?.let {
                        HomeLabel(it, 13, Color(0xFF94A3B8), modifier = Modifier.padding(top = 1.dp))
                    }
            }
            val syncTint =
                when (syncStatus) {
                    SyncStatus.Idle -> Color(0xFFDCFCE7)
                    SyncStatus.Syncing -> Color(0xFFFEF3C7)
                    else -> Color(0xFFFEE2E2)
                }
            val syncInk =
                when (syncStatus) {
                    SyncStatus.Idle -> Color(0xFF15803D)
                    SyncStatus.Syncing -> Color(0xFF92400E)
                    else -> Color(0xFF991B1B)
                }
            Surface(
                onClick = {
                    if (syncStatus == SyncStatus.Error || syncStatus == SyncStatus.Offline)
                        onRetrySync()
                },
                color = syncTint,
                shape = RoundedCornerShape(12.dp),
            ) {
                HomeLabel(
                    syncLabel,
                    12,
                    syncInk,
                    FontWeight.Medium,
                    Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
            SystemIndicator { onAction(BrowseAction.SystemStatus) }
            HeaderButton("Past Orders", onHistory)
            HeaderButton("Settings", { onAction(BrowseAction.Settings) })
            if (user.role?.permissions?.contains("reports.print_eod") == true)
                HeaderButton("Day Closing", { onAction(BrowseAction.DayClosing) })
            if (hasPin) HeaderButton("Lock", onLock)
            HeaderButton("Logout", { confirmLogout = true }, destructive = true)
        }
        HorizontalDivider(color = Color(0xFFE2E8F0))
        Column(
            Modifier.weight(1f).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                Modifier.fillMaxWidth()
                    .height(IntrinsicSize.Min)
                    .shadow(3.dp, RoundedCornerShape(20.dp))
                    .background(Color.White, RoundedCornerShape(20.dp))
                    .border(1.dp, Color(0xFFDCE7EF), RoundedCornerShape(20.dp))
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(
                    Modifier.width(230.dp)
                        .heightIn(min = 132.dp)
                        .fillMaxHeight()
                        .background(Color(0xFF0F172A), RoundedCornerShape(18.dp))
                        .padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
                ) {
                    Text(
                        "CURRENT TIME",
                        color = Color.White.copy(alpha = .72f),
                        fontSize = 12.sp,
                        lineHeight = 21.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.2.sp,
                    )
                    Text(
                        dateText(clock, "hh:mm a", Locale.getDefault()),
                        color = Color.White,
                        fontSize = 52.sp,
                        lineHeight = 58.sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = (-1.8).sp,
                        maxLines = 1,
                    )
                    HomeLabel(
                        dateText(clock, "EEEE, MMMM d", Locale.getDefault()),
                        15,
                        Color.White.copy(alpha = .72f),
                        FontWeight.Medium,
                        lineHeight = 20,
                        letterSpacing = .2f,
                    )
                }
                if (summary == null)
                    Box(
                        Modifier.weight(1f)
                            .fillMaxHeight()
                            .background(Color(0xFFF8FBFD), RoundedCornerShape(18.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = BrowseColors.Brand)
                    }
                else
                    Row(
                        Modifier.weight(1f).fillMaxHeight(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        ScoreCard(
                            summary.totalOrdersToday.toString(),
                            "Orders",
                            "$total active now",
                            Glyph.Receipt,
                            Color(0xFFE8F3FE),
                            BrowseColors.Brand,
                            Modifier.weight(1f),
                        )
                        ScoreCard(
                            dineIn.toString(),
                            "Dine-In",
                            if (dineIn > 0) "$dineIn tables busy" else "Ready for seating",
                            Glyph.Dining,
                            Color(0xFFECFDF5),
                            Color(0xFF059669),
                            Modifier.weight(1f),
                        )
                        ScoreCard(
                            takeout.toString(),
                            "Takeout",
                            if (takeout > 0) "$takeout waiting" else "No pending pickup",
                            Glyph.Bag,
                            Color(0xFFFFF2E8),
                            Color(0xFFEA580C),
                            Modifier.weight(1f),
                        )
                        Column(
                            Modifier.weight(1.2f)
                                .heightIn(min = 132.dp)
                                .fillMaxHeight()
                                .background(Color(0xFFF8FBFD), RoundedCornerShape(18.dp))
                                .border(
                                    1.dp,
                                    Color(0xFFE2E8F0),
                                    RoundedCornerShape(18.dp),
                                )
                                .padding(16.dp),
                            verticalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    HomeLabel(
                                        "REVENUE",
                                        12,
                                        Color(0xFF64748B),
                                        FontWeight.SemiBold,
                                        letterSpacing = 1.1f,
                                    )
                                    HomeLabel(
                                        "Net sales today",
                                        13,
                                        Color(0xFF64748B),
                                        FontWeight.Normal,
                                    )
                                }
                                HomeIcon(Glyph.Cash, 20, 42, 14, Color(0xFF0F172A), Color.White)
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                HomeLabel(
                                    money(summary.todayRevenue),
                                    34,
                                    Color(0xFF0F172A),
                                    FontWeight.Bold,
                                    lineHeight = 38,
                                    letterSpacing = -1.1f,
                                )
                                HomeLabel(
                                    "Avg ticket: " +
                                        if (
                                            summary.totalOrdersToday > 0 &&
                                                summary.todayRevenue != 0.0
                                        )
                                            money(summary.todayRevenue / summary.totalOrdersToday)
                                        else "--",
                                    13,
                                    Color(0xFF516274),
                                    FontWeight.Medium,
                                )
                            }
                        }
                    }
            }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(
                    Modifier.width(320.dp).fillMaxHeight().testTag("home-actions"),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    HomePanel(
                        "Dine-In",
                        "Open tables and manage dine-in orders",
                        if (dineIn > 0) "$dineIn active" else "Ready",
                        if (dineIn > 0) "View active tables" else "Open tables",
                        true,
                        onTables,
                        Modifier.weight(1f),
                    )
                    HomePanel(
                        "Takeout",
                        "Create and manage takeout orders",
                        if (takeout > 0) "$takeout active" else "Open lane",
                        if (takeout > 0) "View takeout orders" else "Create takeout order",
                        false,
                        onTakeout,
                        Modifier.weight(1f),
                    )
                }
                Column(
                    Modifier.weight(1f)
                        .fillMaxHeight()
                        .shadow(2.dp, RoundedCornerShape(20.dp))
                        .background(Color.White, RoundedCornerShape(20.dp))
                        .border(1.dp, Color(0xFFDCE7EF), RoundedCornerShape(20.dp))
                ) {
                    Column(
                        Modifier.fillMaxWidth()
                            .background(
                                Color(0xFFF8FBFD),
                                RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
                            )
                            .padding(start = 18.dp, end = 18.dp, top = 18.dp, bottom = 14.dp)
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            HomeIcon(
                                Glyph.Receipt,
                                20,
                                40,
                                12,
                                Color(0xFFE8F3FE),
                                BrowseColors.Brand,
                            )
                            Column(Modifier.weight(1f)) {
                                HomeLabel(
                                    "Active Orders",
                                    22,
                                    Color(0xFF0F172A),
                                    FontWeight.Bold,
                                    letterSpacing = -.5f,
                                )
                                HomeLabel(
                                    "Open dine-in and takeout orders.",
                                    13,
                                    Color(0xFF64748B),
                                    FontWeight.Normal,
                                )
                            }
                            Box(
                                Modifier.background(Color(0xFFEEF5FA), RoundedCornerShape(999.dp))
                                    .padding(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                HomeLabel(
                                    "$total total",
                                    13,
                                    Color(0xFF476174),
                                    FontWeight.SemiBold,
                                )
                            }
                        }
                        Row(
                            Modifier.padding(top = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(18.dp),
                        ) {
                            listOf(
                                    "Dine-In" to dineIn,
                                    "Takeout" to takeout,
                                    "Open Orders" to total,
                                )
                                .forEachIndexed { index, (label, value) ->
                                    Column {
                                        HomeLabel(
                                            label.uppercase(),
                                            11,
                                            Color(0xFF94A3B8),
                                            FontWeight.SemiBold,
                                        )
                                        HomeLabel(
                                            value.toString(),
                                            16,
                                            when (index) {
                                                0 -> Color(0xFF1D4ED8)
                                                1 -> Color(0xFFC2410C)
                                                else -> Color(0xFF334155)
                                            },
                                            FontWeight.Bold,
                                        )
                                    }
                                }
                        }
                    }
                    HorizontalDivider(color = Color(0xFFE2E8F0))
                    if (orders == null) Loading(Modifier.weight(1f))
                    else if (orders.isEmpty())
                        EmptyOrders(
                            "No active orders",
                            "New tickets will appear here as soon as service starts moving.",
                            modifier = Modifier.weight(1f),
                        )
                    else
                        LazyColumn(
                            Modifier.weight(1f),
                            contentPadding = PaddingValues(14.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            items(orders, key = { it.id }) { ActiveRow(it) }
                        }
                }
            }
        }
    }
    if (confirmLogout)
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Logout") },
            text = { Text("Are you sure you want to logout?") },
            confirmButton = {
                TextButton({
                    confirmLogout = false
                    onLogout()
                }) {
                    Text("Logout", color = BrowseColors.Red)
                }
            },
            dismissButton = { TextButton({ confirmLogout = false }) { Text("Cancel") } },
        )
}

@Composable
private fun HeaderButton(label: String, onClick: () -> Unit, destructive: Boolean = false) {
    Surface(
        onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (destructive) Color(0xFFFEF2F2) else Color(0xFFF8FAFC),
        border = BorderStroke(1.dp, if (destructive) Color(0xFFFECACA) else Color(0xFFE2E8F0)),
    ) {
        Box(
            Modifier.widthIn(min = 74.dp).padding(horizontal = 12.dp, vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            HomeLabel(
                label,
                12,
                if (destructive) Color(0xFFDC2626) else Color(0xFF334155),
                FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun ScoreCard(
    value: String,
    label: String,
    detail: String,
    glyph: Glyph,
    tint: Color,
    ink: Color,
    modifier: Modifier,
) {
    Column(
        modifier
            .heightIn(min = 132.dp)
            .fillMaxHeight()
            .background(tint, RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeIcon(glyph, 20, 42, 14, Color.White.copy(alpha = .78f), ink)
            HomeLabel(
                label.uppercase(),
                12,
                Color(0xFF64748B),
                FontWeight.SemiBold,
                letterSpacing = 1.1f,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            HomeLabel(
                value,
                34,
                ink,
                FontWeight.Bold,
                lineHeight = 38,
                letterSpacing = -1f,
            )
            HomeLabel(detail, 13, Color(0xFF516274), FontWeight.Medium)
        }
    }
}

@Composable
private fun HomePanel(
    title: String,
    subtitle: String,
    badge: String,
    footer: String,
    filled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    val ink = if (filled) Color.White else Color(0xFF9A3412)
    Surface(
        onClick,
        modifier.fillMaxWidth().shadow(
            if (filled) 4.dp else 2.dp,
            RoundedCornerShape(20.dp),
        ),
        shape = RoundedCornerShape(20.dp),
        color = if (filled) BrowseColors.Brand else Color(0xFFFFF7ED),
        border = if (filled) null else BorderStroke(1.5.dp, Color(0xFFFDBA74)),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                HomeIcon(
                    if (filled) Glyph.Dining else Glyph.Bag,
                    28,
                    58,
                    16,
                    if (filled) Color.White.copy(alpha = .16f) else Color(0xFFFFE2CC),
                    ink,
                )
                Box(
                    Modifier.background(
                            if (filled) Color.White.copy(alpha = .16f)
                            else Color(0xFFFFE7D6),
                            RoundedCornerShape(999.dp),
                        )
                        .padding(horizontal = 14.dp, vertical = 7.dp)
                ) {
                    HomeLabel(badge, 14, ink, FontWeight.Bold)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    HomeLabel(
                        title,
                        28,
                        ink,
                        FontWeight.Bold,
                        lineHeight = 32,
                        letterSpacing = -.6f,
                    )
                    HomeLabel(
                        subtitle,
                        15,
                        if (filled) Color.White.copy(alpha = .74f) else Color(0xFFC2410C),
                        FontWeight.Medium,
                        lineHeight = 20,
                        maxLines = 2,
                    )
                }
                Row(
                    Modifier.fillMaxWidth()
                        .background(
                            if (filled) Color.White.copy(alpha = .1f) else Color(0xFFFFF1E7),
                            RoundedCornerShape(14.dp),
                        )
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HomeLabel(
                        footer,
                        13,
                        if (filled) Color.White.copy(alpha = .82f) else ink,
                        FontWeight.SemiBold,
                        Modifier.weight(1f),
                    )
                    Ion(Glyph.Forward, 18, ink)
                }
            }
        }
    }
}

@Composable
private fun HomeIcon(
    glyph: Glyph,
    size: Int,
    boxSize: Int,
    radius: Int,
    background: Color,
    ink: Color,
) {
    Box(
        Modifier.size(boxSize.dp).background(background, RoundedCornerShape(radius.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Ion(glyph, size, ink)
    }
}

@Composable
private fun ActiveRow(order: OrderSummary) {
    val dining = order.orderType == "dine_in"
    val accent = if (dining) BrowseColors.Brand else Color(0xFFEA580C)
    val age = remember(order) { ago(order.createdAt) }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        border = BorderStroke(
            1.dp,
            if (dining) Color(0xFFBFDBFE) else Color(0xFFFED7AA),
        ),
    ) {
        Row(
            Modifier.height(IntrinsicSize.Min),
        ) {
            Box(Modifier.width(6.dp).fillMaxHeight().background(accent))
            Row(
                Modifier.weight(1f)
                    .padding(start = 14.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(46.dp)
                        .background(
                            if (dining) Color(0xFFE8F3FE) else Color(0xFFFFF1E7),
                            RoundedCornerShape(14.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Ion(if (dining) Glyph.Dining else Glyph.Bag, 20, accent)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        HomeLabel(
                            order.orderNumber,
                            17,
                            weight = FontWeight.Bold,
                            letterSpacing = -.3f,
                        )
                        Box(
                            Modifier.background(
                                    if (dining) Color(0xFFDBEAFE) else Color(0xFFFFEDD5),
                                    RoundedCornerShape(999.dp),
                                )
                                .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            HomeLabel(
                                if (dining) "Dine-In" else "Takeout",
                                11,
                                if (dining) Color(0xFF1D4ED8) else Color(0xFFC2410C),
                                FontWeight.SemiBold,
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        HomeLabel(
                            money(order.netSales),
                            17,
                            weight = FontWeight.Bold,
                            letterSpacing = -.3f,
                        )
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            HomeLabel(
                                (if (dining) order.tableName else order.customerName)?.takeIf {
                                    it.isNotEmpty()
                                } ?: if (dining) "Dining floor" else "Takeout queue",
                                13,
                                Color(0xFF475569),
                                FontWeight.SemiBold,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                                OrderMetricPill(
                                    Glyph.Cube,
                                    "${quantity(order.itemCount)} ${if (order.itemCount == 1.0) "item" else "items"}",
                                )
                                OrderMetricPill(Glyph.Time, age)
                            }
                        }
                        Column(
                            Modifier.background(
                                    Color(0xFFF8FBFD),
                                    RoundedCornerShape(12.dp),
                                )
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            HomeLabel("STATUS", 10, Color(0xFF94A3B8), FontWeight.SemiBold)
                            Spacer(Modifier.height(2.dp))
                            HomeLabel("Open", 13, Color(0xFF334155), FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderMetricPill(glyph: Glyph, text: String) {
    Row(
        Modifier.background(Color(0xFFF8FBFD), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Ion(glyph, 12, Color(0xFF64748B))
        HomeLabel(text, 12, Color(0xFF64748B), FontWeight.Medium)
    }
}

@Composable
private fun HomeLabel(
    text: String,
    size: Int = 14,
    color: Color = BrowseColors.Ink,
    weight: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
    lineHeight: Int = 21,
    letterSpacing: Float = 0f,
    maxLines: Int = 1,
) {
    Text(
        text,
        modifier,
        color = color,
        fontSize = size.sp,
        lineHeight = lineHeight.sp,
        fontWeight = weight,
        letterSpacing = letterSpacing.sp,
        maxLines = maxLines,
    )
}
