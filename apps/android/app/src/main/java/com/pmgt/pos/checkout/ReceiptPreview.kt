package com.pmgt.pos.checkout

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.browse.BrowseColors
import com.pmgt.pos.printer.DiscountType
import com.pmgt.pos.printer.OrderCategory
import com.pmgt.pos.printer.OrderType
import com.pmgt.pos.printer.PaymentMethod
import com.pmgt.pos.printer.ReceiptDocument
import com.pmgt.pos.printer.ServiceType
import com.pmgt.pos.printer.settings.PrinterConnectionStatus
import com.pmgt.pos.printer.settings.PrinterPaperWidth
import com.pmgt.pos.printer.settings.PrinterSettingsState
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Outcome of one preview print attempt; the source shows success and failure banners. */
enum class PreviewPrintResult { NONE, SUCCESS, ERROR }

/**
 * Ports RN `ReceiptPreviewModal.tsx`. Two deliberate source behaviors are preserved: the kitchen
 * button is gated on the *receipt* printer being connected, and its handler bypasses the
 * `kitchenPrintingEnabled` toggle. Printing again never writes another audit entry.
 */
@Composable
fun ReceiptPreview(
    receipt: ReceiptDocument,
    printers: PrinterSettingsState,
    hasKitchenTicket: Boolean,
    receiptResult: PreviewPrintResult,
    kitchenResult: PreviewPrintResult,
    isPrinting: Boolean,
    isKitchenPrinting: Boolean,
    onPrint: () -> Unit,
    onPrintKitchen: () -> Unit,
    onSkip: () -> Unit,
) {
    val receiptPrinter = printers.receiptPrinter
    val connected =
        receiptPrinter != null &&
            printers.connectionStatus[receiptPrinter.id] == PrinterConnectionStatus.CONNECTED
    val canPrint = receiptPrinter != null && connected
    val canPrintKitchen = printers.previewKitchenPrinter != null
    val previewWidth =
        if (receiptPrinter?.paperWidth == PrinterPaperWidth.MM58) 220.dp else 300.dp

    Row(
        Modifier.fillMaxSize().background(BrowseColors.Background).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            Modifier.weight(1f)
                .fillMaxHeight()
                .background(Color.White, RoundedCornerShape(12.dp))
                .border(1.dp, BrowseColors.Border, RoundedCornerShape(12.dp))
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ReceiptPaper(receipt, Modifier.width(previewWidth))
        }
        Column(Modifier.weight(1f).fillMaxHeight(), Arrangement.SpaceBetween) {
            Column {
                PrinterCard(receiptPrinter?.name, receiptPrinter?.paperWidth, connected)
                Divider()
                ChangeDue(receipt)
            }
            Column {
                if (receiptResult == PreviewPrintResult.SUCCESS)
                    Banner("Receipt sent to printer", success = true)
                if (receiptResult == PreviewPrintResult.ERROR)
                    Banner("Print failed. Check printer connection.", success = false)
                if (kitchenResult == PreviewPrintResult.SUCCESS)
                    Banner("Kitchen receipt sent to printer", success = true)
                if (kitchenResult == PreviewPrintResult.ERROR)
                    Banner("Kitchen print failed. Check printer connection.", success = false)
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PreviewButton(
                    label =
                        when {
                            isPrinting -> "Printing..."
                            receiptResult == PreviewPrintResult.SUCCESS -> "Print Again"
                            else -> "Print Receipt"
                        },
                    enabled = canPrint && !isPrinting,
                    primary = true,
                    onClick = onPrint,
                )
                if (hasKitchenTicket && canPrintKitchen) {
                    if (receiptResult == PreviewPrintResult.SUCCESS) {
                        Text(
                            "Tear the customer receipt first, then print the kitchen receipt below.",
                            Modifier.fillMaxWidth(),
                            fontSize = 12.sp,
                            color = BrowseColors.Muted,
                            textAlign = TextAlign.Center,
                        )
                    }
                    PreviewButton(
                        label =
                            when {
                                isKitchenPrinting -> "Printing Kitchen Receipt..."
                                kitchenResult == PreviewPrintResult.SUCCESS ->
                                    "Print Kitchen Again"
                                else -> "Print Kitchen Receipt"
                            },
                        // Source gates the kitchen button on the receipt printer's connection.
                        enabled = canPrint && !isKitchenPrinting,
                        primary = false,
                        onClick = onPrintKitchen,
                    )
                }
                PreviewButton(
                    label = if (receiptResult == PreviewPrintResult.SUCCESS) "Done" else "Skip",
                    enabled = true,
                    primary = false,
                    onClick = onSkip,
                )
            }
        }
    }
}

@Composable
private fun ReceiptPaper(receipt: ReceiptDocument, modifier: Modifier) {
    Column(modifier) {
        Centered(receipt.storeName, 16, FontWeight.Bold)
        receipt.storeAddress?.takeIf { it.isNotEmpty() }?.let { Centered(it, 12, muted = true) }
        receipt.storeTin?.takeIf { it.isNotEmpty() }?.let { Centered("TIN: $it", 12, muted = true) }
        Dashes()
        InfoRow("Receipt #", receipt.receiptNumber ?: receipt.orderNumber)
        InfoRow("Date", previewDate(receipt.transactionDate))
        InfoRow("Order Type", receipt.orderType.previewLabel)
        receipt.tableName?.takeIf { it.isNotEmpty() }?.let { InfoRow("Table", it) }
        InfoRow("Cashier", receipt.cashierName)
        val customer =
            listOfNotNull(
                receipt.customerName?.let { "Customer" to it },
                receipt.customerId?.let { "ID No." to it },
                receipt.customerAddress?.let { "Address" to it },
                receipt.customerTin?.let { "TIN" to it },
            )
        if (customer.isNotEmpty()) {
            Dashes()
            customer.forEach { (label, value) -> InfoRow(label, value) }
        }
        Dashes()
        Centered("ORDER ITEMS", 12, FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
            Small("Item", Modifier.weight(1f), muted = true)
            Small("Qty", Modifier.width(24.dp), muted = true, align = TextAlign.Center)
            Small("Price", Modifier.width(56.dp), muted = true, align = TextAlign.End)
            Small("Total", Modifier.width(56.dp), muted = true, align = TextAlign.End)
        }
        val orderDefault =
            receipt.orderDefaultServiceType
                ?: when {
                    receipt.orderCategory != null ->
                        if (receipt.orderCategory == OrderCategory.DINE_IN) ServiceType.DINE_IN
                        else ServiceType.TAKEOUT
                    receipt.orderType == OrderType.DINE_IN -> ServiceType.DINE_IN
                    else -> ServiceType.TAKEOUT
                }
        receipt.items.forEach { item ->
            Row(Modifier.fillMaxWidth()) {
                Small(item.name, Modifier.weight(1f), maxLines = 1)
                Small(previewQuantity(item.quantity), Modifier.width(24.dp), align = TextAlign.Center)
                Small(previewMoney(item.price), Modifier.width(56.dp), align = TextAlign.End)
                Small(previewMoney(item.total), Modifier.width(56.dp), align = TextAlign.End)
            }
            Text(
                if ((item.serviceType ?: orderDefault) == ServiceType.TAKEOUT) "Takeout"
                else "Dine-In",
                Modifier.padding(start = 2.dp, bottom = 4.dp),
                fontSize = 9.sp,
                color = Color(0xFF9CA3AF),
                fontStyle = FontStyle.Italic,
            )
            item.modifiers.forEach { modifier ->
                Row(Modifier.fillMaxWidth().padding(start = 12.dp, bottom = 2.dp)) {
                    Small("+ ${modifier.optionName}", Modifier.weight(1f), muted = true)
                    if (modifier.priceAdjustment > 0) {
                        Small(
                            "+${previewMoney(modifier.priceAdjustment)}",
                            Modifier.width(56.dp),
                            muted = true,
                            align = TextAlign.End,
                        )
                    }
                }
            }
        }
        Dashes()
        InfoRow("Subtotal", previewMoney(receipt.subtotal))
        InfoRow("Vatable Sales", previewMoney(receipt.vatableSales))
        InfoRow("VAT (12%)", previewMoney(receipt.vatAmount))
        InfoRow("VAT-Exempt", previewMoney(receipt.vatExemptSales))
        if (receipt.discounts.isNotEmpty()) {
            receipt.discounts.forEach { discount ->
                Column(Modifier.padding(bottom = 8.dp)) {
                    Small(
                        "${if (discount.type == DiscountType.SC) "SC" else "PWD"}: ${discount.customerName}",
                        color = Red,
                        weight = FontWeight.Medium,
                    )
                    Small("ID: ${discount.customerId}", color = Red)
                    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
                        Small(discount.itemName, color = Red)
                        Small("-${previewMoney(discount.amount)}", color = Red)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), Arrangement.SpaceBetween) {
                Small("Total Discount", color = Red, weight = FontWeight.Medium)
                Small(
                    "-${previewMoney(receipt.discounts.sumOf { it.amount })}",
                    color = Red,
                    weight = FontWeight.Medium,
                )
            }
        }
        Equals()
        Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), Arrangement.SpaceBetween) {
            Text("TOTAL", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = BrowseColors.Ink)
            Text(
                previewMoney(receipt.total),
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = BrowseColors.Ink,
            )
        }
        Equals()
        PaymentLines(receipt)
        Dashes()
        Centered(
            receipt.storeFooter?.takeIf { it.isNotEmpty() } ?: "Thank you for your patronage!",
            12,
            FontWeight.Bold,
        )
        Text(
            "This does not serve as an official receipt",
            Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp),
            fontSize = 9.sp,
            color = BrowseColors.Muted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun PaymentLines(receipt: ReceiptDocument) {
    val payments = receipt.payments
    if (!payments.isNullOrEmpty()) {
        var cashReceived = 0.0
        var changeGiven = 0.0
        payments.forEach { payment ->
            if (payment.paymentMethod == PaymentMethod.CASH) {
                cashReceived += payment.cashReceived ?: 0.0
                changeGiven += payment.changeGiven ?: 0.0
                InfoRow("Cash", previewMoney(payment.amount))
            } else {
                InfoRow(payment.cardPaymentType ?: "Card/E-Wallet", previewMoney(payment.amount))
                payment.cardReferenceNumber?.let { InfoRow("Ref #", it) }
            }
        }
        if (cashReceived > 0) {
            InfoRow("Amount Tendered", previewMoney(cashReceived))
            InfoRow("Change", previewMoney(changeGiven))
        }
        return
    }
    InfoRow(
        "Method",
        if (receipt.paymentMethod == PaymentMethod.CASH) "Cash"
        else receipt.cardPaymentType ?: "Card/E-Wallet",
    )
    if (receipt.paymentMethod == PaymentMethod.CASH) {
        InfoRow("Amount Tendered", previewMoney(receipt.amountTendered ?: 0.0))
        InfoRow("Change", previewMoney(receipt.change ?: 0.0))
    } else {
        receipt.cardReferenceNumber?.let { InfoRow("Ref #", it) }
    }
}

@Composable
private fun ChangeDue(receipt: ReceiptDocument) {
    val payments = receipt.payments
    val changeDue =
        when {
            !payments.isNullOrEmpty() ->
                if (payments.any { it.paymentMethod == PaymentMethod.CASH })
                    payments.sumOf { it.changeGiven ?: 0.0 }
                else null
            receipt.paymentMethod == PaymentMethod.CASH -> receipt.change ?: 0.0
            else -> null
        }
    if (changeDue == null || changeDue <= 0) return
    Column(Modifier.padding(vertical = 12.dp)) {
        Text("Change Due", fontSize = 12.sp, color = BrowseColors.Muted)
        Text(
            previewMoney(changeDue),
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF16A34A),
        )
    }
    Divider()
}

@Composable
private fun PrinterCard(name: String?, width: PrinterPaperWidth?, connected: Boolean) {
    Column(
        Modifier.fillMaxWidth()
            .background(Color(0xFFF9FAFB), RoundedCornerShape(8.dp))
            .padding(12.dp)
    ) {
        Text("Print to:", fontSize = 12.sp, color = BrowseColors.Muted)
        Spacer(Modifier.height(4.dp))
        if (name == null) {
            Text("No printer configured", fontSize = 14.sp, color = BrowseColors.Muted)
            Text(
                "Go to Settings",
                Modifier.padding(top = 4.dp),
                fontSize = 12.sp,
                color = BrowseColors.Brand,
            )
            return@Column
        }
        Text(name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = BrowseColors.Ink)
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(8.dp)
                    .background(if (connected) BrowseColors.Green else Red, CircleShape)
            )
            Spacer(Modifier.width(6.dp))
            Text(
                if (connected) "Connected" else "Disconnected",
                fontSize = 12.sp,
                color = BrowseColors.Muted,
            )
            Spacer(Modifier.width(8.dp))
            Text("${width?.millimeters ?: 80}mm", fontSize = 12.sp, color = BrowseColors.Muted)
        }
    }
}

@Composable
private fun Banner(message: String, success: Boolean) {
    Row(
        Modifier.fillMaxWidth()
            .padding(bottom = 8.dp)
            .background(
                if (success) Color(0xFFF0FDF4) else Color(0xFFFEF2F2),
                RoundedCornerShape(8.dp),
            )
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            message,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            color = if (success) Color(0xFF15803D) else Color(0xFFB91C1C),
        )
    }
}

@Composable
private fun PreviewButton(
    label: String,
    enabled: Boolean,
    primary: Boolean,
    onClick: () -> Unit,
) {
    val background =
        when {
            !primary -> Color.White
            enabled -> BrowseColors.Brand
            else -> Color(0xFF9CA3AF)
        }
    Box(
        Modifier.fillMaxWidth()
            .background(background, RoundedCornerShape(10.dp))
            .then(
                if (primary) Modifier
                else Modifier.border(1.dp, BrowseColors.Border, RoundedCornerShape(10.dp))
            )
            .then(
                if (enabled) Modifier.clickable(onClick = onClick)
                else Modifier
            )
            .padding(vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color =
                when {
                    primary -> Color.White
                    enabled -> BrowseColors.Brand
                    else -> Color(0xFF9CA3AF)
                },
        )
    }
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp).height(1.dp).background(BrowseColors.Border))
}

@Composable
private fun Dashes() {
    Text(
        "- - - - - - - - - - - - - - - - - - - -",
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        fontSize = 12.sp,
        color = BrowseColors.Muted,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Equals() {
    Text(
        "= = = = = = = = = = = = = = = = = = = =",
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        fontSize = 12.sp,
        color = BrowseColors.Muted,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Centered(text: String, size: Int, weight: FontWeight = FontWeight.Normal, muted: Boolean = false) {
    Text(
        text,
        Modifier.fillMaxWidth().padding(bottom = 4.dp),
        fontSize = size.sp,
        fontWeight = weight,
        color = if (muted) BrowseColors.Muted else BrowseColors.Ink,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), Arrangement.SpaceBetween) {
        Small(label, muted = true)
        Small(value)
    }
}

@Composable
private fun Small(
    text: String,
    modifier: Modifier = Modifier,
    muted: Boolean = false,
    align: TextAlign = TextAlign.Start,
    color: Color? = null,
    weight: FontWeight = FontWeight.Normal,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text,
        modifier,
        fontSize = 12.sp,
        color = color ?: if (muted) BrowseColors.Muted else BrowseColors.Ink,
        textAlign = align,
        fontWeight = weight,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

private val Red = Color(0xFFEF4444)

private val OrderType.previewLabel: String
    get() =
        when (this) {
            OrderType.DINE_IN -> "Dine-In"
            OrderType.TAKE_OUT -> "Take-Out"
            OrderType.DELIVERY -> "Delivery"
        }

/** Source preview uses a plain `P` prefix with grouping, not the peso sign used elsewhere. */
internal fun previewMoney(amount: Double): String = "P %,.2f".format(Locale.US, amount)

/** Source preview date is en-PH 2-digit numeric with a 12-hour clock. */
internal fun previewDate(value: LocalDateTime): String =
    value.format(DateTimeFormatter.ofPattern("MM/dd/yyyy, hh:mm:ss a", Locale.US))

private fun previewQuantity(quantity: Double): String =
    if (quantity == quantity.toLong().toDouble()) quantity.toLong().toString()
    else quantity.toString()
