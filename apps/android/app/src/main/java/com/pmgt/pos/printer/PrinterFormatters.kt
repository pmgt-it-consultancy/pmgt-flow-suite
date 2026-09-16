package com.pmgt.pos.printer

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDateTime
import java.util.Locale

/** Pure formatter boundary matching the invoked React Native thermal formatter call-for-call. */
object ReceiptFormatter {
    fun format(
        document: ReceiptDocument,
        charsPerLine: Int,
        minimalReceipt: Boolean = false,
    ): List<PrinterCall> = buildList {
        if (minimalReceipt) {
            align(PrinterAlignment.LEFT)
            text("Product Name Quantity Price\n")
            document.items.forEach { item ->
                text("${item.name} ${jsNumber(item.quantity)} ${currency(item.total)}\n")
            }
            text(if (charsPerLine >= 48) "\n\n\n\n\n\n" else "\n\n\n", cut = true)
            return@buildList
        }

        align(PrinterAlignment.CENTER)
        text("${document.storeName}\n", BOLD)
        document.storeAddress.ifTruthy { text("$it\n") }
        document.storeTin.ifTruthy { text("TIN: $it\n") }
        document.storeContactNumber.ifTruthy { text("Tel: $it\n") }
        document.storeTelephone.ifTruthy { text("Phone: $it\n") }
        document.storeEmail.ifTruthy { text("$it\n") }
        document.storeWebsite.ifTruthy { text("$it\n") }
        document.storeSocials.forEach { text("${it.platform}: ${it.url}\n") }
        text("${line('-', charsPerLine)}\n")

        align(PrinterAlignment.LEFT)
        val receiptNumber =
            if (document.tableMarker.isTruthy()) {
                "${document.receiptNumber ?: document.orderNumber} | ${document.tableMarker}"
            } else {
                document.receiptNumber
            }
        receiptNumber.ifTruthy { text("Receipt #: $it\n") }
        text("Date: ${dateTime(document.transactionDate)}\n")
        val typeLabel =
            when (document.orderCategory) {
                OrderCategory.DINE_IN -> "Dine-In"
                OrderCategory.TAKEOUT -> "Takeout"
                null -> orderTypeLabel(document.orderType)
            }
        text("Type: $typeLabel\n")
        document.tableName.ifTruthy { text("Table: $it\n") }
        document.pax?.takeIf { it != 0.0 && !it.isNaN() }?.let { text("Pax: ${jsNumber(it)}\n") }
        text("Cashier: ${document.cashierName}\n")

        if (
            document.customerName.isTruthy() ||
                document.customerId.isTruthy() ||
                document.customerTin.isTruthy()
        ) {
            text("\n")
            document.customerName.ifTruthy { text("Customer: $it\n") }
            document.customerId.ifTruthy { text("ID No.: $it\n") }
            document.customerAddress.ifTruthy { text("Address: $it\n") }
            document.customerTin.ifTruthy { text("TIN: $it\n") }
        }

        text("${line('-', charsPerLine)}\n")
        align(PrinterAlignment.CENTER)
        text("ORDER ITEMS\n", BOLD)
        align(PrinterAlignment.LEFT)

        val orderDefault =
            document.orderDefaultServiceType
                ?: when (document.orderCategory) {
                    OrderCategory.DINE_IN -> ServiceType.DINE_IN
                    OrderCategory.TAKEOUT -> ServiceType.TAKEOUT
                    null -> if (document.orderType == OrderType.DINE_IN) ServiceType.DINE_IN else ServiceType.TAKEOUT
                }
        document.items.forEach { item ->
            val serviceType = item.serviceType ?: orderDefault
            text("${item.name}\n")
            text("  ${if (serviceType == ServiceType.TAKEOUT) "Takeout" else "Dine-In"}\n")
            item.modifiers.forEach { modifier ->
                val suffix =
                    if (modifier.priceAdjustment > 0) " (${currency(modifier.priceAdjustment)})" else ""
                text("  + ${modifier.optionName}$suffix\n")
            }
            val detail = "  ${jsNumber(item.quantity)}x ${currency(item.price)}"
            text("${row(detail, currency(item.total), charsPerLine)}\n")
        }

        text("${line('-', charsPerLine)}\n")
        text("${row("Subtotal", currency(document.subtotal), charsPerLine)}\n")
        text("${row("Vatable Sales", currency(document.vatableSales), charsPerLine)}\n")
        text("${row("VAT 12%", currency(document.vatAmount), charsPerLine)}\n")
        text("${row("VAT-Exempt", currency(document.vatExemptSales), charsPerLine)}\n")

        if (document.discounts.isNotEmpty()) {
            text("\n")
            text("${line('-', charsPerLine)}\n")
            align(PrinterAlignment.CENTER)
            text("DISCOUNTS\n", BOLD)
            align(PrinterAlignment.LEFT)
            document.discounts.forEach { discount ->
                val prefix =
                    when (discount.type) {
                        DiscountType.SC -> "SC"
                        DiscountType.PWD -> "PWD"
                        DiscountType.CUSTOM -> "Discount"
                    }
                text("$prefix: ${discount.customerName}\n")
                text("ID: ${discount.customerId}\n")
                text("${row(discount.itemName, "-${currency(discount.amount)}", charsPerLine)}\n")
                text("\n")
            }
            val totalDiscount = document.discounts.fold(0.0) { sum, discount -> sum + discount.amount }
            text("${row("Total Discount", "-${currency(totalDiscount)}", charsPerLine)}\n")
        }

        text("${row("TOTAL", currency(document.total), charsPerLine)}\n", BOLD)
        text("${line('-', charsPerLine)}\n")

        val payments = document.payments
        if (payments != null && payments.isNotEmpty()) {
            var totalCashReceived = 0.0
            var totalChangeGiven = 0.0
            payments.forEach { payment ->
                if (payment.paymentMethod == PaymentMethod.CASH) {
                    text("${row("Cash", currency(payment.amount), charsPerLine)}\n")
                    payment.cashReceived?.let { totalCashReceived += it }
                    payment.changeGiven?.let { totalChangeGiven += it }
                } else {
                    val label = payment.cardPaymentType.takeIf { it.isTruthy() } ?: "Card/E-Wallet"
                    text("${row(label, currency(payment.amount), charsPerLine)}\n")
                    payment.cardReferenceNumber.ifTruthy { text("Ref: $it\n") }
                }
            }
            if (totalCashReceived > 0) {
                text("${row("Amount Tendered", currency(totalCashReceived), charsPerLine)}\n")
                text("${row("Change", currency(totalChangeGiven), charsPerLine)}\n")
            }
        } else {
            val paymentLabel =
                if (document.paymentMethod == PaymentMethod.CASH) {
                    "Cash"
                } else {
                    document.cardPaymentType.takeIf { it.isTruthy() } ?: "Card/E-Wallet"
                }
            text("${row("Payment Method", paymentLabel, charsPerLine)}\n")
            if (document.paymentMethod == PaymentMethod.CASH) {
                text("${row("Amount Tendered", currency(document.amountTendered ?: 0.0), charsPerLine)}\n")
                text("${row("Change", currency(document.change ?: 0.0), charsPerLine)}\n")
            } else {
                document.cardReferenceNumber.ifTruthy {
                    text("${row("Ref #", it, charsPerLine)}\n")
                }
            }
        }

        text("${line('-', charsPerLine)}\n")
        align(PrinterAlignment.CENTER)
        text("${document.storeFooter.takeIf { it.isTruthy() } ?: "Thank you for your patronage!"}\n")
        text("This does not serve as an official receipt\n")
        val feed = if (charsPerLine >= 48) "\n\n\n\n\n\n" else "\n\n\n"
        text("Powered by PMGT Flow Suite$feed", cut = true)
    }
}

/** Pure pre-settlement bill formatter. Payment and official receipt fields cannot be represented. */
object BillFormatter {
    fun format(document: BillDocument, charsPerLine: Int): List<PrinterCall> = buildList {
        align(PrinterAlignment.CENTER)
        text("${document.storeName}\n", BOLD)
        document.storeAddress.ifTruthy { text("$it\n") }
        document.storeTin.ifTruthy { text("TIN: $it\n") }
        document.storeContactNumber.ifTruthy { text("Tel: $it\n") }
        document.storeTelephone.ifTruthy { text("Phone: $it\n") }
        document.storeEmail.ifTruthy { text("$it\n") }
        document.storeWebsite.ifTruthy { text("$it\n") }
        text("${line('-', charsPerLine)}\n")
        text("BILL\n", LARGE)
        text("${line('-', charsPerLine)}\n")

        align(PrinterAlignment.LEFT)
        text("Order #: ${document.orderNumber}\n")
        text("Date: ${dateTime(document.printedAt)}\n")
        val typeLabel =
            when (document.orderCategory) {
                OrderCategory.DINE_IN -> "Dine-In"
                OrderCategory.TAKEOUT -> "Takeout"
                null -> orderTypeLabel(document.orderType)
            }
        text("Type: $typeLabel\n")
        document.tableName.ifTruthy { text("Table: $it\n") }
        document.tableMarker.ifTruthy { text("Table Marker: $it\n") }
        document.pax?.takeIf { it != 0.0 && !it.isNaN() }?.let { text("Pax: ${jsNumber(it)}\n") }
        text("Cashier: ${document.cashierName}\n")
        document.customerName.ifTruthy { text("Customer: $it\n") }

        text("${line('-', charsPerLine)}\n")
        align(PrinterAlignment.CENTER)
        text("ORDER ITEMS\n", BOLD)
        align(PrinterAlignment.LEFT)

        val orderDefault =
            document.orderDefaultServiceType
                ?: when (document.orderCategory) {
                    OrderCategory.DINE_IN -> ServiceType.DINE_IN
                    OrderCategory.TAKEOUT -> ServiceType.TAKEOUT
                    null ->
                        if (document.orderType == OrderType.DINE_IN) ServiceType.DINE_IN
                        else ServiceType.TAKEOUT
                }
        document.items.forEach { item ->
            val serviceType = item.serviceType ?: orderDefault
            text("${item.name}\n")
            text("  ${if (serviceType == ServiceType.TAKEOUT) "Takeout" else "Dine-In"}\n")
            item.modifiers.forEach { modifier ->
                val suffix =
                    if (modifier.priceAdjustment > 0) " (${currency(modifier.priceAdjustment)})"
                    else ""
                text("  + ${modifier.optionName}$suffix\n")
            }
            val detail = "  ${jsNumber(item.quantity)}x ${currency(item.price)}"
            text("${row(detail, currency(item.total), charsPerLine)}\n")
        }

        text("${line('-', charsPerLine)}\n")
        text("${row("Subtotal", currency(document.subtotal), charsPerLine)}\n")
        text("${row("Vatable Sales", currency(document.vatableSales), charsPerLine)}\n")
        text("${row("VAT 12%", currency(document.vatAmount), charsPerLine)}\n")
        text("${row("VAT-Exempt", currency(document.vatExemptSales), charsPerLine)}\n")

        if (document.discounts.isNotEmpty()) {
            text("\n")
            text("${line('-', charsPerLine)}\n")
            align(PrinterAlignment.CENTER)
            text("DISCOUNTS\n", BOLD)
            align(PrinterAlignment.LEFT)
            document.discounts.forEach { discount ->
                val prefix =
                    when (discount.type) {
                        DiscountType.SC -> "SC"
                        DiscountType.PWD -> "PWD"
                        DiscountType.CUSTOM -> "Discount"
                    }
                text("$prefix: ${discount.customerName}\n")
                text("ID: ${discount.customerId}\n")
                text("${row(discount.itemName, "-${currency(discount.amount)}", charsPerLine)}\n")
                text("\n")
            }
            val totalDiscount = document.discounts.sumOf { it.amount }
            text("${row("Total Discount", "-${currency(totalDiscount)}", charsPerLine)}\n")
        }

        text("${row("TOTAL", currency(document.total), charsPerLine)}\n", BOLD)
        text("${line('-', charsPerLine)}\n")
        align(PrinterAlignment.CENTER)
        text("${document.storeFooter.takeIf { it.isTruthy() } ?: "Thank you for your patronage!"}\n")
        text("This does not serve as an official receipt\n")
        val feed = if (charsPerLine >= 48) "\n\n\n\n\n\n" else "\n\n\n"
        text("Powered by PMGT Flow Suite$feed", cut = true)
    }
}

object KitchenTicketFormatter {
    fun format(document: KitchenTicketDocument, charsPerLine: Int): List<PrinterCall> =
        buildList {
            align(PrinterAlignment.CENTER)
            text("#${document.orderNumber}\n", LARGE)
            text("\n")

            document.tableMarker.ifTruthy {
                text("==================\n")
                text("$it\n", LARGE)
                text("==================\n")
            }

            val categoryLabel =
                when (document.orderCategory) {
                    OrderCategory.DINE_IN -> "DINE-IN"
                    OrderCategory.TAKEOUT -> "TAKEOUT"
                    null -> orderTypeLabel(document.orderType).uppercase(Locale.US)
                }
            text("$categoryLabel\n", BOLD)
            document.customerName.ifTruthy { text("Customer: $it\n") }
            text("\n")

            align(PrinterAlignment.LEFT)
            text("${dateTime(document.timestamp)}\n")
            text("${line('-', charsPerLine)}\n")

            val resolved =
                document.items.map { item ->
                    item to
                        (item.serviceType
                            ?: document.orderDefaultServiceType
                            ?: if (document.orderType == OrderType.DINE_IN) ServiceType.DINE_IN else ServiceType.TAKEOUT)
                }
            val mixed = resolved.map { it.second }.toSet().size > 1
            if (mixed) {
                listOf(ServiceType.DINE_IN, ServiceType.TAKEOUT).forEach { group ->
                    val groupItems = resolved.filter { it.second == group }.map { it.first }
                    if (groupItems.isNotEmpty()) {
                        text("---- ${if (group == ServiceType.DINE_IN) "DINE IN" else "TAKEOUT"} ----\n", BOLD)
                        groupItems.forEach(::kitchenItem)
                        text("\n")
                    }
                }
            } else {
                document.items.forEach(::kitchenItem)
            }

            val feed = if (charsPerLine >= 48) "\n\n\n\n\n" else "\n\n"
            text("${line('-', charsPerLine)}$feed", cut = true)
        }
}

private val NORMAL = PrinterTextStyle()
private val BOLD = PrinterTextStyle(heightTimes = 1)
private val LARGE = PrinterTextStyle(widthTimes = 1, heightTimes = 1)

private fun MutableList<PrinterCall>.align(alignment: PrinterAlignment) {
    add(PrinterCall.Align(alignment))
}

private fun MutableList<PrinterCall>.text(
    value: String,
    style: PrinterTextStyle = NORMAL,
    cut: Boolean = false,
) {
    add(PrinterCall.Text(value, style, cut))
}

private fun MutableList<PrinterCall>.kitchenItem(item: KitchenTicketItem) {
    text("  ${jsNumber(item.quantity)}x ${item.name}\n", BOLD)
    item.modifiers.forEach { text("     > ${it.optionName}\n") }
    item.notes.ifTruthy { text("     * $it\n") }
}

private fun line(character: Char, width: Int): String = character.toString().repeat(width)

private fun row(left: String, right: String, width: Int): String {
    val gap = width - left.length - right.length
    if (gap >= 1) return left + " ".repeat(gap) + right

    // Kotlin String indices and JS String.length/slice both operate on UTF-16 code units.
    val end = width - right.length - 1
    val normalizedEnd = if (end < 0) (left.length + end).coerceAtLeast(0) else end.coerceAtMost(left.length)
    return left.substring(0, normalizedEnd) + " " + right
}

private fun currency(amount: Double): String {
    val fixed = jsToFixed2(amount)
    val sign = if (fixed.startsWith('-')) "-" else ""
    val unsigned = fixed.removePrefix("-")
    val decimalAt = unsigned.indexOf('.')
    val integer = if (decimalAt >= 0) unsigned.substring(0, decimalAt) else unsigned
    val fraction = if (decimalAt >= 0) unsigned.substring(decimalAt) else ""
    val grouped = integer.reversed().chunked(3).joinToString(",").reversed()
    return "P $sign$grouped$fraction"
}

private fun jsToFixed2(value: Double): String =
    when {
        value.isNaN() -> "NaN"
        value == Double.POSITIVE_INFINITY -> "Infinity"
        value == Double.NEGATIVE_INFINITY -> "-Infinity"
        kotlin.math.abs(value) >= 1e21 -> jsNumber(value)
        else ->
            // BigDecimal is used only to reproduce ECMAScript Number.toFixed rendering of the
            // existing binary64 value. It is not used for POS money arithmetic (ADR-0002).
            BigDecimal(value).setScale(2, RoundingMode.HALF_UP).toPlainString()
    }

private fun jsNumber(value: Double): String {
    if (value == 0.0) return "0"
    if (value.isNaN()) return "NaN"
    if (value == Double.POSITIVE_INFINITY) return "Infinity"
    if (value == Double.NEGATIVE_INFINITY) return "-Infinity"
    val absolute = kotlin.math.abs(value)
    val decimal = BigDecimal.valueOf(value).stripTrailingZeros()
    if (absolute >= 1e-6 && absolute < 1e21) return decimal.toPlainString()
    val exponent = decimal.precision() - decimal.scale() - 1
    val coefficient = decimal.movePointLeft(exponent).stripTrailingZeros().toPlainString()
    return "$coefficient" + "e" + if (exponent >= 0) "+$exponent" else exponent.toString()
}

private fun dateTime(value: LocalDateTime): String {
    val hour = (value.hour % 12).takeUnless { it == 0 } ?: 12
    val meridiem = if (value.hour >= 12) "PM" else "AM"
    return "%02d/%02d/%04d, %d:%02d:%02d %s".format(
        Locale.US,
        value.monthValue,
        value.dayOfMonth,
        value.year,
        hour,
        value.minute,
        value.second,
        meridiem,
    )
}

private fun orderTypeLabel(type: OrderType): String =
    when (type) {
        OrderType.DINE_IN -> "Dine-In"
        OrderType.TAKE_OUT -> "Take-Out"
        OrderType.DELIVERY -> "Delivery"
    }

private fun String?.isTruthy(): Boolean = !isNullOrEmpty()

private inline fun String?.ifTruthy(block: (String) -> Unit) {
    if (!isNullOrEmpty()) block(this)
}
