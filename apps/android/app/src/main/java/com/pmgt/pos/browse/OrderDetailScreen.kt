package com.pmgt.pos.browse

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable
internal fun OrderDetailScreen(
    order: OrderDetail?,
    onBack: () -> Unit,
    onAction: (BrowseAction) -> Unit,
) {
    if (order == null) {
        Loading(Modifier.background(BrowseColors.Background))
        return
    }
    val summary = order.summary
    Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
        PageHeader(
            "Order #${summary.orderNumber}",
            orderType(summary.orderType),
            onBack,
            { onAction(BrowseAction.SystemStatus) },
            badges = {
                PaymentBadge(summary.status)
                if (summary.refundedFromOrderId != null) StatusBadge("Refunded", BrowseColors.Amber)
            },
        )
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            DetailSection("Order Info") {
                InfoRow("Date", dateText(summary.createdAt, "MMM d, yyyy, h:mm a"))
                summary.tableName?.takeIf { it.isNotEmpty() }?.let { InfoRow("Table", it) }
                summary.customerName?.takeIf { it.isNotEmpty() }?.let { InfoRow("Customer", it) }
                InfoRow("Cashier", order.createdByName)
                PaymentInfo(order)
                order.paidAt
                    ?.takeIf { it != 0L }
                    ?.let { InfoRow("Paid At", dateText(it, "MMM d, yyyy, h:mm a")) }
            }
            DetailSection("Items") {
                order.items.filterNot { it.isVoided }.forEach { DetailItem(it) }
            }
            if (order.discounts.isNotEmpty())
                DetailSection("Discounts") {
                    order.discounts.forEach {
                        InfoRow(
                            "${if (it.type == "senior_citizen") "SC" else "PWD"}: ${it.customerName}",
                            "-${money(it.amount)}",
                            BrowseColors.Red,
                        )
                    }
                }
            DetailSection("Summary") {
                InfoRow("Gross Sales", money(order.grossSales))
                InfoRow("VATable Sales", money(order.vatableSales))
                InfoRow("VAT (12%)", money(order.vatAmount))
                InfoRow("VAT-Exempt Sales", money(order.vatExemptSales))
                if (order.discountAmount > 0)
                    InfoRow("Discount", "-${money(order.discountAmount)}", BrowseColors.Red)
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = BrowseColors.Border)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Label("Net Sales", 16, weight = FontWeight.Bold)
                    Label(money(summary.netSales), 16, weight = FontWeight.Bold)
                }
            }
        }
        if (summary.status == "paid")
            Row(
                Modifier.fillMaxWidth().background(Color.White).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ActionButton(
                    "Reprint",
                    { onAction(BrowseAction.Reprint(summary.id)) },
                    Modifier.weight(1f),
                    glyph = Glyph.Print,
                )
                ActionButton(
                    "Refund Item",
                    { onAction(BrowseAction.Refund(summary.id)) },
                    Modifier.weight(1f),
                    outline = true,
                    glyph = Glyph.Refund,
                )
                ActionButton(
                    "Void",
                    { onAction(BrowseAction.Void(summary.id)) },
                    Modifier.weight(1f),
                    color = BrowseColors.Red,
                    glyph = Glyph.Void,
                )
            }
    }
}

@Composable
private fun DetailSection(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp)
    ) {
        Label(
            title.uppercase(),
            12,
            BrowseColors.Muted,
            FontWeight.SemiBold,
            Modifier.padding(bottom = 12.dp),
        )
        content()
    }
}

@Composable
internal fun InfoRow(label: String, value: String, valueColor: Color = BrowseColors.Ink) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Label(label, 14, BrowseColors.Muted)
        Label(value, 14, valueColor, FontWeight.Medium)
    }
}

@Composable
private fun DetailItem(item: OrderLine, takeout: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label(
                        if (takeout) item.productName
                        else "${quantity(item.quantity)}x ${item.productName}"
                    )
                    item.serviceType?.let {
                        StatusBadge(
                            if (it == "takeout") "TAKEOUT" else "DINE IN",
                            if (it == "takeout") BrowseColors.Amber else BrowseColors.Muted,
                        )
                    }
                }
                if (takeout)
                    Label(
                        "${quantity(item.quantity)}x ${money(item.productPrice)}",
                        12,
                        Color(0xFF9CA3AF),
                    )
                else
                    item.notes
                        ?.takeIf { it.isNotEmpty() }
                        ?.let { Label(it, 12, BrowseColors.Muted) }
                item.modifiers.forEach {
                    Label(
                        "+ ${it.optionName}" +
                            if (it.priceAdjustment > 0) " (${money(it.priceAdjustment)})" else "",
                        12,
                        BrowseColors.Muted,
                    )
                }
            }
            Label(money(item.lineTotal), 14, weight = FontWeight.Medium)
        }
        if (!takeout) HorizontalDivider(Modifier.padding(top = 8.dp), color = Color(0xFFF9FAFB))
    }
}

@Composable
private fun PaymentInfo(order: OrderDetail, references: Boolean = true) {
    if (order.payments.isNotEmpty()) {
        order.payments.forEach {
            InfoRow(
                if (it.method == "cash") "Cash"
                else it.cardType?.takeIf { c -> c.isNotEmpty() } ?: "Card/E-Wallet",
                money(it.amount),
            )
        }
        val cash = order.payments.filter { it.method == "cash" }
        val tendered = cash.sumOf { it.cashReceived ?: 0.0 }
        val change = cash.sumOf { it.changeGiven ?: 0.0 }
        if (tendered > 0) InfoRow("Cash Tendered", money(tendered))
        if (change > 0) InfoRow("Change", money(change))
        if (references)
            order.payments
                .filter { it.method == "card_ewallet" && !it.cardReference.isNullOrEmpty() }
                .forEach { InfoRow("Ref # (${it.cardType ?: "undefined"})", it.cardReference!!) }
    } else {
        order.summary.paymentMethod?.let {
            InfoRow("Payment", if (it == "cash") "Cash" else "Card / E-Wallet")
        }
        order.cashReceived?.takeIf { it != 0.0 }?.let { InfoRow("Amount Tendered", money(it)) }
        order.changeGiven?.takeIf { it != 0.0 }?.let { InfoRow("Change", money(it)) }
    }
}

@Composable
internal fun TakeoutDetailModal(
    order: OrderDetail?,
    onClose: () -> Unit,
    onAction: (BrowseAction) -> Unit,
) {
    Dialog(onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth(.9f)
                .heightIn(max = 720.dp)
                .testTag("takeout-detail")
                .background(Color.White, RoundedCornerShape(16.dp))
                .padding(20.dp)
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Label("Order Details", 20, weight = FontWeight.Bold)
                IconAction("Close order details", Glyph.Close, onClose)
            }
            if (order == null) {
                Label("Loading order details", 18)
                Label(
                    "Pulling the latest order items, totals, and payment status.",
                    14,
                    BrowseColors.Muted,
                )
            } else {
                val summary = order.summary
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column {
                            Label(summary.orderNumber, 18, weight = FontWeight.Bold)
                            summary.customerName?.let { Label(it, 14, BrowseColors.Muted) }
                            Label(
                                "${dateText(summary.createdAt, "MMM d, hh:mm a")} · ${order.createdByName}",
                                12,
                                BrowseColors.Muted,
                            )
                        }
                        WorkflowBadge(summary.takeoutStatus)
                    }
                    HorizontalDivider(
                        Modifier.padding(vertical = 12.dp),
                        color = BrowseColors.Border,
                    )
                    LazyColumn(Modifier.heightIn(max = 250.dp)) {
                        items(order.items.filterNot { it.isVoided }, key = { it.id }) {
                            DetailItem(it, takeout = true)
                        }
                    }
                    HorizontalDivider(
                        Modifier.padding(vertical = 12.dp),
                        color = BrowseColors.Border,
                    )
                    InfoRow("Subtotal", money(order.grossSales))
                    if (order.discountAmount > 0)
                        InfoRow("Discount", "-${money(order.discountAmount)}", BrowseColors.Red)
                    InfoRow("VAT (12%)", money(order.vatAmount))
                    InfoRow("Total", money(summary.netSales))
                    if (summary.status == "paid") {
                        HorizontalDivider(
                            Modifier.padding(vertical = 12.dp),
                            color = BrowseColors.Border,
                        )
                        PaymentInfo(order, references = false)
                    }
                }
                Column(
                    Modifier.padding(top = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (summary.status == "paid") {
                        ActionButton(
                            "Receipt Preview / Print",
                            { onAction(BrowseAction.ReceiptPreview(summary.id)) },
                            Modifier.fillMaxWidth(),
                            glyph = Glyph.Receipt,
                        )
                        ActionButton(
                            "Refund Item",
                            { onAction(BrowseAction.Refund(summary.id)) },
                            Modifier.fillMaxWidth(),
                            outline = true,
                            glyph = Glyph.Refund,
                        )
                    } else if (summary.status != "voided")
                        ActionButton(
                            "Void Order",
                            { onAction(BrowseAction.Void(summary.id)) },
                            Modifier.fillMaxWidth(),
                            color = BrowseColors.Red,
                            glyph = Glyph.Void,
                        )
                    ActionButton("Close", onClose, Modifier.fillMaxWidth(), outline = true)
                }
            }
        }
    }
}
