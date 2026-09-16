package com.pmgt.pos.checkout

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.browse.*
import com.pmgt.pos.orders.*
import com.pmgt.pos.transport.ConvexHttp

@Composable
fun CheckoutScreen(
    owner: CheckoutOwner,
    route: CheckoutRoute,
    repository: CheckoutRepository,
    http: ConvexHttp,
    cashierName: String,
    isCurrent: () -> Boolean,
    onBack: () -> Unit,
    onCompleted: (CompletedCheckout) -> Unit,
    memory: CheckoutSession? = null,
    onStatus: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val session =
        memory
            ?: remember(owner, route, repository) {
                CheckoutSession(owner, route, repository, http, cashierName, scope, isCurrent)
            }
    val state by session.state.collectAsStateWithLifecycle()
    val flow =
        remember(owner, route.orderId, repository) { repository.observe(owner, route.orderId) }
    val view by flow.collectAsStateWithLifecycle(initialValue = session.lastView)
    LaunchedEffect(view) { session.lastView = view }
    LaunchedEffect(session) { session.open() }
    LaunchedEffect(state.completed) { state.completed?.let(onCompleted) }
    BackHandler { onBack() }
    val current = view
    if (current == null)
        Box(
            Modifier.fillMaxSize().background(BrowseColors.Background),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = BrowseColors.Brand)
        }
    else {
        val totals = current.cart.checkoutTotals()
        val coverage = PaymentMath.coverage(state.lines, totals.netSales)
        val editable = !state.busy && !state.needsResume && state.completed == null
        Column(Modifier.fillMaxSize().background(BrowseColors.Background).imePadding()) {
            PageHeader(
                "Checkout",
                "${route.tableName ?: "Order #${current.cart.orderNumber}"} · ${current.cart.lines.size} line${if (current.cart.lines.size == 1) "" else "s"}",
                onBack,
                onStatus,
                titleWeight = FontWeight.SemiBold,
            )
            Column(
                Modifier.weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .testTag("checkout-scroll")
                    .padding(top = 8.dp, bottom = 120.dp)
            ) {
                CheckoutSection {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Label("Order Summary", 16, weight = FontWeight.SemiBold)
                            Label(
                                "Review items before taking payment",
                                12,
                                BrowseColors.Muted,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        val count = current.cart.lines.sumOf { it.quantity }
                        Box(
                            Modifier.background(Color.White, RoundedCornerShape(999.dp))
                                .border(1.dp, BrowseColors.Border, RoundedCornerShape(999.dp))
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Label(
                                "${numberText(count)} ${if (count == 1.0) "item" else "items"}",
                                12,
                                BrowseColors.Muted,
                                FontWeight.Bold,
                            )
                        }
                    }
                    CheckoutCard {
                        current.cart.lines.forEachIndexed { index, item ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Label(item.productName, 16, weight = FontWeight.SemiBold)
                                        if (!item.isVatable)
                                            StatusBadge(
                                                "NON-VAT",
                                                Color(0xFF92400E),
                                                Color(0xFFFEF3C7),
                                            )
                                        val service =
                                            item.serviceType
                                                ?: if (route.orderType == "takeout") "takeout"
                                                else "dine_in"
                                        StatusBadge(
                                            if (service == "takeout") "TAKEOUT" else "DINE IN",
                                            if (service == "takeout") Color(0xFF92400E)
                                            else BrowseColors.Muted,
                                            if (service == "takeout") Color(0xFFFEF3C7)
                                            else BrowseColors.Background,
                                        )
                                    }
                                    Label(
                                        "Qty ${numberText(item.quantity)}",
                                        12,
                                        BrowseColors.Muted,
                                        modifier = Modifier.padding(top = 2.dp),
                                    )
                                    item.modifiers.forEach {
                                        Label(
                                            "+ ${it.optionName}" +
                                                if (it.priceAdjustment > 0)
                                                    " (${money(it.priceAdjustment)})"
                                                else "",
                                            12,
                                            BrowseColors.Muted,
                                            modifier = Modifier.padding(top = 2.dp),
                                        )
                                    }
                                }
                                Label(money(item.lineTotal), 16, weight = FontWeight.SemiBold)
                            }
                            if (index < current.cart.lines.lastIndex)
                                HorizontalDivider(color = Color(0xFFF3F4F6))
                        }
                    }
                }
                CheckoutSection("Discounts") {
                    CheckoutCard {
                        current.discounts.forEach { discount ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                                    Label(
                                        "${if (discount.type == "senior_citizen") "SC" else "PWD"}: ${discount.customerName}",
                                        16,
                                        weight = FontWeight.SemiBold,
                                    )
                                    discount.itemName?.let {
                                        Label("Applied to: $it", 12, BrowseColors.Muted)
                                    }
                                }
                                Label(
                                    "-${money(discount.amount)}",
                                    16,
                                    BrowseColors.Green,
                                    FontWeight.SemiBold,
                                )
                                IconAction(
                                    "Remove discount ${discount.id}",
                                    Glyph.Close,
                                    { session.requestRemoval(discount.id) },
                                    editable,
                                )
                            }
                        }
                        if (current.discounts.isNotEmpty())
                            HorizontalDivider(color = Color(0xFFF3F4F6))
                        CheckoutButton(
                            if (current.discounts.isEmpty()) "Add SC/PWD Discount"
                            else "Add Another Discount",
                            session::openDiscount,
                            Modifier.fillMaxWidth(),
                            editable,
                            Color.White,
                            BrowseColors.Brand,
                            16,
                            12,
                            glyph = if (current.discounts.isEmpty()) Glyph.PriceTag else Glyph.Add,
                        )
                    }
                }
                CheckoutSection("Payment") {
                    state.lines.forEachIndexed { index, line ->
                        key(line.id) {
                            PaymentLineCard(
                                line,
                                index,
                                state.lines.size,
                                coverage.remaining,
                                editable,
                                { session.line(line.id, it) },
                                { session.removeLine(line.id) },
                            )
                        }
                    }
                    CheckoutTotalRow(
                        if (coverage.fullyCovered) "Fully Covered" else "Remaining",
                        money(coverage.remaining),
                        if (coverage.fullyCovered) Color(0xFFDCFCE7) else Color(0xFFFEF3C7),
                        if (coverage.fullyCovered) Color(0xFF16A34A) else Color(0xFF92400E),
                    )
                    if (coverage.totalChange > 0)
                        CheckoutTotalRow(
                            "Change",
                            money(coverage.totalChange),
                            Color(0xFFEFF6FF),
                            Color(0xFF1D4ED8),
                        )
                    CheckoutButton(
                        "Add Payment Method",
                        { session.addLine(totals.netSales) },
                        Modifier.fillMaxWidth().checkoutDashed(),
                        editable,
                        Color.Transparent,
                        BrowseColors.Brand,
                        15,
                        14,
                        glyph = Glyph.AddCircle,
                    )
                }
                CheckoutSection("Totals") {
                    CheckoutCard {
                        MoneyRow("Gross Sales", money(totals.grossSales))
                        MoneyRow("VAT (12%)", money(totals.vatAmount))
                        if (totals.discountAmount > 0)
                            MoneyRow(
                                "Discount",
                                "-${money(totals.discountAmount)}",
                                BrowseColors.Green,
                            )
                        HorizontalDivider(
                            Modifier.padding(vertical = 8.dp),
                            color = BrowseColors.Border,
                        )
                        Row(
                            Modifier.fillMaxWidth()
                                .background(Color(0xFFEFF6FF), RoundedCornerShape(12.dp))
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Label("Total Due", 18, weight = FontWeight.SemiBold)
                            Label(money(totals.netSales), 22, BrowseColors.Brand, FontWeight.Bold)
                        }
                        if (coverage.totalChange > 0)
                            MoneyRow("Change", money(coverage.totalChange), BrowseColors.Green)
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth()
                    .background(Color.White)
                    .border(1.dp, BrowseColors.Border)
                    .padding(16.dp)
                    .testTag("checkout-footer")
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Label("Amount Due", 12, BrowseColors.Muted)
                        Label(money(totals.netSales), 22, Color(0xFF0F172A), FontWeight.Bold)
                    }
                    StatusBadge(
                        if (state.lines.size > 1) "Split Payment"
                        else if (state.lines.first().paymentMethod == "cash") "Cash"
                        else "Card/E-Wallet",
                        BrowseColors.Brand,
                        Color(0xFFEFF6FF),
                    )
                }
                CheckoutButton(
                    "Complete Payment",
                    { session.complete(totals.netSales) },
                    Modifier.fillMaxWidth(),
                    !state.busy &&
                        (coverage.enabled || state.needsResume) &&
                        state.completed == null,
                    BrowseColors.Green,
                    fontSize = 16,
                    glyph = Glyph.CheckFilled,
                    busy = state.busy,
                )
            }
        }
        if (state.discountVisible) DiscountSheet(current, state.discount, session)
        if (state.approvalVisible)
            session.approval?.let {
                ManagerApprovalDialog(
                    it,
                    session.approvalTitle,
                    session::closeApproval,
                    session::approve,
                )
            }
    }
    if (state.removing != null)
        AlertDialog(
            onDismissRequest = session::cancelRemoval,
            title = { Text("Remove Discount") },
            text = { Text("Are you sure you want to remove this discount?") },
            confirmButton = { TextButton(session::confirmRemoval) { Text("Remove") } },
            dismissButton = { TextButton(session::cancelRemoval) { Text("Cancel") } },
        )
    state.alert?.let { alert ->
        key(alert.occurrence) {
            AlertDialog(
                onDismissRequest = session::dismissAlert,
                title = { Text(alert.title) },
                text = { Text(alert.message) },
                confirmButton = { TextButton(session::dismissAlert) { Text("OK") } },
                dismissButton =
                    if (state.needsResume)
                        ({
                            TextButton({
                                session.dismissAlert()
                                session.retry()
                            }) {
                                Text("Retry")
                            }
                        })
                    else null,
            )
        }
    }
}

@Composable
private fun CheckoutSection(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        title?.let {
            Label(it, 16, weight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 12.dp))
        }
        content()
    }
}

@Composable
private fun MoneyRow(label: String, value: String, color: Color = BrowseColors.Muted) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Label(label, 16, color)
        Label(
            value,
            16,
            if (color == BrowseColors.Muted) BrowseColors.Ink else color,
            FontWeight.Medium,
        )
    }
}

@Composable
private fun CheckoutTotalRow(label: String, value: String, background: Color, ink: Color) {
    Row(
        Modifier.fillMaxWidth()
            .padding(bottom = 12.dp)
            .background(background, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Label(label, 15, ink, FontWeight.SemiBold)
        Label(value, 18, ink, FontWeight.Bold)
    }
}
