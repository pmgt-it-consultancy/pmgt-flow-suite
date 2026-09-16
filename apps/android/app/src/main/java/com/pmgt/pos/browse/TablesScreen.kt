package com.pmgt.pos.browse

import com.pmgt.pos.posDialogProperties

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TablesScreen(
    storeId: String,
    userName: String,
    tables: List<DiningTable>?,
    onBack: () -> Unit,
    onAction: (BrowseAction) -> Unit,
) {
    var selected by remember { mutableStateOf<DiningTable?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
        TablesHeader("Dine-In Tables", userName, onBack) {
            onAction(BrowseAction.SystemStatus)
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
            if (tables == null) Loading()
            else if (tables.isEmpty())
                EmptyOrders("No tables found", "Add tables in the admin panel first", Glyph.Dining)
            else
                LazyVerticalGrid(
                    GridCells.Fixed(2),
                    contentPadding = PaddingValues(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(44.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(tables, key = { it.id }) { table ->
                        TableCard(table) {
                            if (table.orders.size > 1) selected = table
                            else
                                onAction(
                                    BrowseAction.OpenDineIn(
                                        storeId,
                                        table.id,
                                        table.name,
                                        table.orders.singleOrNull()?.id,
                                    )
                                )
                        }
                    }
                }
        }
    }
    selected?.let { table ->
        Dialog(
            onDismissRequest = { selected = null },
            properties =
                posDialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            HideSystemBarsInDialog()
            BoxWithConstraints(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize())
                Column(
                    Modifier.align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .heightIn(max = maxHeight * .92f)
                        .background(
                            Color.White,
                            RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                        )
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Label("Table ${table.name}", 20, weight = FontWeight.Bold)
                            Label("${table.orders.size} tabs active", 14, BrowseColors.Muted)
                        }
                        IconAction("Close table tabs", Glyph.Close, { selected = null })
                    }
                    HorizontalDivider(color = BrowseColors.Border)
                    LazyColumn(
                        Modifier.weight(1f, fill = false),
                        contentPadding = PaddingValues(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(table.orders, key = { it.id }) { order ->
                            Surface(
                                onClick = {
                                    selected = null
                                    onAction(
                                        BrowseAction.OpenDineIn(
                                            storeId,
                                            table.id,
                                            table.name,
                                            order.id,
                                        )
                                    )
                                },
                                color = Color(0xFFF9FAFB),
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, BrowseColors.Border),
                            ) {
                                Row(
                                    Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(
                                        Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Label(order.tabName, 18, weight = FontWeight.Bold)
                                            order.pax
                                                ?.takeIf { it > 0 }
                                                ?.let {
                                                    StatusBadge(
                                                        quantity(it),
                                                        BrowseColors.Brand,
                                                        Color(0xFFDBEAFE),
                                                    )
                                                }
                                        }
                                        Label(
                                            "${quantity(order.itemCount)} ${if (order.itemCount == 1.0) "item" else "items"} · ${money(order.netSales)}",
                                            14,
                                            BrowseColors.Muted,
                                        )
                                    }
                                    Ion(Glyph.Next)
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = BrowseColors.Border)
                    Box(Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp)) {
                        ActionButton(
                            "Add New Tab",
                            {
                                selected = null
                                onAction(BrowseAction.NewTableTab(storeId, table.id, table.name))
                            },
                            Modifier.fillMaxWidth().heightIn(min = 56.dp),
                            glyph = Glyph.AddCircle,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TableCard(table: DiningTable, onClick: () -> Unit) {
    Surface(
        onClick,
        modifier = Modifier.padding(8.dp),
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        shadowElevation = 1.dp,
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TablesText(table.name, 18, weight = FontWeight.Medium)
                if (table.orders.size > 1) {
                    Row(
                        Modifier.background(Color(0xFFDBEAFE), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Ion(Glyph.Layers, 14, BrowseColors.Brand)
                        TablesText(
                            table.orders.size.toString(),
                            12,
                            BrowseColors.Brand,
                            FontWeight.Medium,
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                Ion(
                    if (table.occupied) Glyph.Occupied else Glyph.Available,
                    24,
                    if (table.occupied) BrowseColors.Amber else BrowseColors.Green,
                )
            }
            TablesText(
                "Capacity: ${table.capacity} ${if (table.capacity == 1) "person" else "people"}",
                14,
                BrowseColors.Muted,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            if (table.occupied) {
                val order = table.orders.first()
                Column(
                    Modifier.padding(bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    TablesText(
                        if (table.orders.size > 1)
                            "${table.orders.size} tabs · ${quantity(table.totalItems)} items"
                        else
                            "${order.tabName} · ${quantity(order.itemCount)} ${if (order.itemCount == 1.0) "item" else "items"}" +
                                (order.pax?.takeIf { it > 0 }?.let { " · ${quantity(it)} pax" }
                                    ?: ""),
                        14,
                        Color(0xFF4B5563),
                    )
                    TablesText(
                        tableMoney(table.totalNetSales),
                        14,
                        BrowseColors.Brand,
                        FontWeight.Medium,
                    )
                }
            }
            TableStatusBadge(table.occupied)
        }
    }
}

@Composable
private fun TablesHeader(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    onStatus: () -> Unit,
) {
    Column(Modifier.background(Color.White)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(38.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFF3F4F6))
                    .clickable(onClick = onBack)
                    .semantics { contentDescription = "Back" },
                contentAlignment = Alignment.Center,
            ) {
                Ion(Glyph.Back, 22, Color(0xFF374151))
            }
            Column(Modifier.weight(1f)) {
                TablesText(title, 20, weight = FontWeight.Medium)
                TablesText(
                    subtitle,
                    14,
                    BrowseColors.Muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            SystemIndicator(onStatus)
        }
        HorizontalDivider(color = BrowseColors.Border)
    }
}

@Composable
private fun TableStatusBadge(occupied: Boolean) {
    Box(
        Modifier.background(
                if (occupied) Color(0xFFFEF3C7) else Color(0xFFDCFCE7),
                RoundedCornerShape(4.dp),
            )
            .padding(horizontal = 8.dp, vertical = 2.dp)
    ) {
        TablesText(
            if (occupied) "OCCUPIED" else "AVAILABLE",
            12,
            if (occupied) Color(0xFFA16207) else Color(0xFF15803D),
            FontWeight.Medium,
        )
    }
}

@Composable
private fun TablesText(
    text: String,
    size: Int = 14,
    color: Color = BrowseColors.Ink,
    weight: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        modifier,
        color = color,
        fontSize = size.sp,
        lineHeight = 21.sp,
        fontWeight = weight,
        letterSpacing = 0.sp,
        maxLines = 1,
    )
}
