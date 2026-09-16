package com.pmgt.pos.closing

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.R
import com.pmgt.pos.browse.SystemIndicator
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val Brand = Color(0xFF0D87E1)
private val Gray50 = Color(0xFFF9FAFB)
private val Gray100 = Color(0xFFF3F4F6)
private val Gray200 = Color(0xFFE5E7EB)
private val Gray500 = Color(0xFF6B7280)
private val Gray700 = Color(0xFF374151)
private val Gray900 = Color(0xFF111827)

/** Task 12 screen seam. Store/session binding remains explicit at the root owner. */
@Composable
fun DayClosingScreen(
    storeId: String,
    controller: ClosingController,
    onBack: () -> Unit,
    onSystemStatus: () -> Unit = {},
) {
    LaunchedEffect(storeId, controller) { controller.bind(storeId) }
    DisposableEffect(controller) { onDispose(controller::dispose) }
    val state by controller.state.collectAsState()
    val notice = state.notice
    if (notice != null) {
        AlertDialog(
            onDismissRequest = controller::consumeNotice,
            confirmButton = { TextButton(onClick = controller::consumeNotice) { Text("OK") } },
            title = { ClosingText(notice.title, 18, Gray900, FontWeight.SemiBold) },
            text = { ClosingText(notice.message, 14, Gray700) },
        )
    }

    Column(Modifier.fillMaxSize().background(Gray100)) {
        ClosingHeader(state, onBack, controller::generate, onSystemStatus)
        state.selectedDate?.let { selected ->
            state.todayBusinessDate?.let { today ->
                DateNavigation(selected, today, controller::selectDate)
            }
        }
        TimeRangeSelector(state, controller)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ReconciliationAttention(state, controller::retry)
            ZReportSummary(state.report, state.loading)
            ItemBreakdownCard(state.productSales, state.loading)
            PaymentTransactionsCard(state.paymentTransactions)
        }
        PrintFooter(state, controller::print)
    }
}

@Composable
private fun ClosingHeader(
    state: ClosingState,
    onBack: () -> Unit,
    onGenerate: () -> Unit,
    onSystemStatus: () -> Unit,
) {
    Box(
        Modifier.fillMaxWidth().height(76.dp).background(Color.White)
            .border(width = 0.dp, color = Color.Transparent)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Box(
            Modifier.align(Alignment.CenterStart).size(48.dp).clickable(onClick = onBack)
                .semantics { contentDescription = "Back" },
            contentAlignment = Alignment.Center,
        ) { ClosingIcon(ClosingGlyph.Back, 24, Gray700) }
        ClosingText(
            "Day Closing",
            20,
            Gray900,
            FontWeight.SemiBold,
            Modifier.align(Alignment.Center),
            lineHeight = 24,
        )
        Row(
            Modifier.align(Alignment.CenterEnd),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.operation == ClosingOperation.Generating) {
                CircularProgressIndicator(Modifier.size(22.dp), color = Brand, strokeWidth = 2.dp)
            } else {
                OutlinedButton(
                    onClick = onGenerate,
                    enabled = state.operation == null && state.selectedDate != null,
                    modifier = Modifier.height(40.dp),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Brand),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) { ClosingText("Refresh Report", 14, Brand, FontWeight.SemiBold, lineHeight = 18) }
            }
            SystemIndicator(onSystemStatus)
        }
    }
    HorizontalDivider(color = Gray200)
}

@Composable
private fun DateNavigation(selected: String, today: String, onSelect: (String) -> Unit) {
    val context = LocalContext.current
    val date = LocalDate.parse(selected)
    val max = LocalDate.parse(today)
    Row(
        Modifier.fillMaxWidth().height(72.dp).background(Color(0xFFEFF6FF))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        SquareControl("‹", "Previous business date") { onSelect(date.minusDays(1).toString()) }
        Row(
            Modifier.clickable {
                DatePickerDialog(
                    context,
                    { _, year, month, day -> onSelect(LocalDate.of(year, month + 1, day).toString()) },
                    date.year,
                    date.monthValue - 1,
                    date.dayOfMonth,
                ).apply { datePicker.maxDate = max.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
                    .show()
            }.padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ClosingIcon(ClosingGlyph.Calendar, 18, Brand)
            ClosingText(
                date.format(DateTimeFormatter.ofPattern("EEE, MMM d, yyyy", Locale.forLanguageTag("en-PH"))),
                16,
                Brand,
                FontWeight.Bold,
                lineHeight = 20,
            )
        }
        SquareControl(
            "›",
            "Next business date",
            enabled = selected != today,
        ) { if (date < max) onSelect(date.plusDays(1).toString()) }
    }
}

@Composable
private fun SquareControl(label: String, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { ClosingText(label, 30, Brand.copy(alpha = if (enabled) 1f else .3f), lineHeight = 30) }
}

@Composable
private fun TimeRangeSelector(state: ClosingState, controller: ClosingController) {
    Column(
        Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RangeModeButton("Full Day", state.startTime == null, Modifier.weight(1f), controller::useFullDay)
            RangeModeButton("Custom Range", state.startTime != null, Modifier.weight(1f), controller::useCustomRange)
        }
        val start = state.startTime
        val end = state.endTime
        if (start != null && end != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TimeButton(start, Modifier.weight(1f)) { picked -> controller.setRange(picked, end) }
                ClosingText("to", 14, Gray500, lineHeight = 18)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    TimeButton(end, Modifier.fillMaxWidth()) { picked -> controller.setRange(start, picked) }
                    if (state.crossesMidnight) ClosingText("(next day)", 12, Gray500, lineHeight = 16)
                }
            }
        }
    }
}

@Composable
private fun RangeModeButton(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(48.dp)
            .background(if (selected) Color(0xFFDBEAFE) else Gray100, RoundedCornerShape(10.dp))
            .border(1.dp, if (selected) Brand else Gray200, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { ClosingText(label, 14, if (selected) Brand else Gray700, FontWeight.SemiBold, lineHeight = 18) }
}

@Composable
private fun TimeButton(value: String, modifier: Modifier, onChange: (String) -> Unit) {
    val context = LocalContext.current
    val (hour, minute) = value.split(':').map(String::toInt)
    Box(
        modifier.height(48.dp).background(Gray50, RoundedCornerShape(10.dp))
            .border(1.dp, Gray200, RoundedCornerShape(10.dp))
            .clickable {
                TimePickerDialog(context, { _, h, m -> onChange("%02d:%02d".format(h, m)) }, hour, minute, false).show()
            },
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ClosingText("◷", 16, Gray500, lineHeight = 16)
            ClosingText(displayTime(value), 14, Gray700, FontWeight.SemiBold, lineHeight = 18)
        }
    }
}

@Composable
private fun ReconciliationAttention(state: ClosingState, onRetry: (String) -> Unit) {
    val hasAttention = state.attention.jobs.isNotEmpty() || state.attention.divergences.isNotEmpty() || state.pendingFinancialActions.isNotEmpty() || state.readinessError != null || state.pendingReadError != null
    if (!hasAttention) return
    Column(
        Modifier.fillMaxWidth().background(Color(0xFFFFFBEB), RoundedCornerShape(12.dp))
            .border(1.dp, Color(0xFFFDE68A), RoundedCornerShape(12.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ClosingText("Closing requires attention", 16, Color(0xFF92400E), FontWeight.Bold, lineHeight = 20)
        state.pendingFinancialActions.takeIf { it.isNotEmpty() }?.let {
            ClosingText("${it.size} local financial action(s) still require delivery or recovery.", 13, Color(0xFF92400E), lineHeight = 18)
        }
        state.readinessError?.let { ClosingText(it, 13, Color(0xFF92400E), lineHeight = 18) }
        state.pendingReadError?.let { ClosingText(it, 13, Color(0xFF92400E), lineHeight = 18) }
        state.attention.jobs.forEach { job ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    ClosingText(
                        "${if (job.status == ReconciliationStatus.Pending) "Pending" else "Failed"} reconciliation · Order ${job.orderId}",
                        13,
                        Color(0xFF92400E),
                        FontWeight.SemiBold,
                        lineHeight = 18,
                    )
                    job.blockedReason?.let { ClosingText(it, 12, Color(0xFF92400E), lineHeight = 16) }
                }
                OutlinedButton(
                    onClick = { onRetry(job.jobId) },
                    enabled = state.operation == null,
                    shape = RoundedCornerShape(8.dp),
                    contentPadding = PaddingValues(horizontal = 10.dp),
                    // No source counterpart to match, so the documented 44dp floor applies.
                    modifier = Modifier.heightIn(min = 44.dp),
                ) { ClosingText("Retry", 13, Color(0xFF92400E), FontWeight.SemiBold, lineHeight = 16) }
            }
        }
        state.attention.divergences.forEach { divergence ->
            ClosingText(
                "Order ${divergence.orderId}: ${divergence.fields.joinToString()} totals differ.",
                13,
                Color(0xFF991B1B),
                FontWeight.SemiBold,
                lineHeight = 18,
            )
        }
    }
}

@Composable
private fun ZReportSummary(report: DailyClosingReport?, loading: Boolean) {
    if (loading && report == null) return EmptyCard("Loading report...")
    if (report == null) return EmptyCard("No report data for this date. Tap refresh to generate.")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatBox("Gross Sales", money(report.grossSales), Gray900, Modifier.weight(1f))
            StatBox("Net Sales", money(report.netSales), Color(0xFF16A34A), Modifier.weight(1f))
            StatBox("Transactions", report.transactionCount.toString(), Brand, Modifier.weight(1f))
        }
        Column(
            Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp))
                .border(1.dp, Gray200, RoundedCornerShape(12.dp)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DetailRow("Cash", money(report.cashTotal))
            DetailRow("Card/E-Wallet", money(report.cardEwalletTotal))
            HorizontalDivider(color = Gray200)
            DetailRow("Total Collected", money(report.cashTotal + report.cardEwalletTotal), bold = true)
            DetailRow("Discounts", "-${money(report.totalDiscounts)}", Color(0xFFDC2626))
            DetailRow("Voids (${report.voidCount})", "-${money(report.voidAmount)}", Color(0xFFDC2626))
            DetailRow("VAT (12%)", money(report.vatAmount))
            DetailRow("Avg. Ticket", money(report.averageTicket))
        }
    }
}

@Composable
private fun StatBox(label: String, value: String, color: Color, modifier: Modifier) {
    Column(
        modifier.background(Gray50, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ClosingText(value, 22, color, FontWeight.Bold, lineHeight = 27, maxLines = 1)
        ClosingText(label, 11, Gray500, modifier = Modifier.padding(top = 2.dp), lineHeight = 14)
    }
}

@Composable
private fun DetailRow(label: String, value: String, color: Color = Gray900, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        ClosingText(label, 14, if (bold) Gray900 else Gray500, if (bold) FontWeight.Bold else FontWeight.Normal, lineHeight = 18)
        ClosingText(value, 14, color, if (bold) FontWeight.Bold else FontWeight.SemiBold, lineHeight = 18)
    }
}

@Composable
private fun ItemBreakdownCard(items: List<ProductSale>, loading: Boolean) {
    if (loading && items.isEmpty()) return EmptyCard("Loading item breakdown...")
    if (items.isEmpty()) return EmptyCard("No items sold for this date.")
    val groups = items.groupBy { it.categoryName }.toSortedMap()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeading("Items Sold", "${items.size} product(s)")
        Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).border(1.dp, Gray200, RoundedCornerShape(12.dp))) {
            TableRow("Product", "Qty", "Amount", background = Gray50, muted = true)
            groups.forEach { (category, products) ->
                TableRow(category, "", "", background = Color(0xFFEFF6FF), color = Color(0xFF1E40AF), bold = true, vertical = 8)
                products.sortedByDescending { it.quantitySold }.forEach { item ->
                    TableRow(item.productName, quantity(item.quantitySold), money(item.grossAmount), bold = true)
                    if (item.voidedQuantity > 0) TableRow("Voided", quantity(item.voidedQuantity), "-${money(item.voidedAmount)}", background = Color(0xFFFEF2F2), color = Color(0xFFDC2626), vertical = 6)
                }
                TableRow(
                    "$category Subtotal",
                    quantity(products.sumOf { it.quantitySold }),
                    money(products.sumOf { it.grossAmount }),
                    background = Color(0xFFF0F9FF),
                    color = Color(0xFF0369A1),
                    bold = true,
                    vertical = 8,
                )
            }
            TableRow("Total", quantity(items.sumOf { it.quantitySold }), money(items.sumOf { it.grossAmount }), background = Gray50, bold = true, vertical = 12)
        }
    }
}

@Composable
private fun PaymentTransactionsCard(groups: List<PaymentTransactionGroup>) {
    if (groups.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeading("Payment Transactions", "${groups.sumOf { it.transactions.size }} transaction(s)")
        Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).border(1.dp, Gray200, RoundedCornerShape(12.dp))) {
            TableRow("Order / Ref #", "", "Amount", background = Gray50, muted = true)
            groups.forEach { group ->
                TableRow(group.paymentType, "", "${group.transactions.size} transaction(s)", background = Color(0xFFF0FDF4), color = Color(0xFF166534), bold = true, vertical = 8)
                group.transactions.forEach { transaction ->
                    TableRow("#${transaction.orderNumber}\n${transaction.referenceNumber}", "", money(transaction.amount), bold = true)
                }
                TableRow("Subtotal", "", money(group.subtotal), background = Color(0xFFF0FDF4), color = Color(0xFF166534), bold = true)
            }
            TableRow("Total", "", money(groups.sumOf { it.subtotal }), background = Gray50, bold = true, vertical = 12)
        }
    }
}

@Composable
private fun SectionHeading(title: String, count: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        ClosingText(title, 16, Gray900, FontWeight.Bold, lineHeight = 20)
        ClosingText(count, 14, Gray500, lineHeight = 18)
    }
}

@Composable
private fun TableRow(
    first: String,
    second: String,
    third: String,
    background: Color = Color.White,
    color: Color = Gray900,
    bold: Boolean = false,
    muted: Boolean = false,
    vertical: Int = 10,
) {
    Row(
        Modifier.fillMaxWidth().background(background).border(0.5.dp, Gray100)
            .padding(horizontal = 14.dp, vertical = vertical.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ClosingText(first, 14, if (muted) Gray500 else color, if (bold) FontWeight.SemiBold else FontWeight.Normal, Modifier.weight(1f), lineHeight = 18)
        ClosingText(second, 14, if (muted) Gray500 else color, if (bold) FontWeight.SemiBold else FontWeight.Normal, Modifier.width(50.dp), TextAlign.End, lineHeight = 18)
        ClosingText(third, 14, if (muted) Gray500 else color, if (bold) FontWeight.SemiBold else FontWeight.Normal, Modifier.width(90.dp), TextAlign.End, lineHeight = 18)
    }
}

@Composable
private fun EmptyCard(label: String) {
    Box(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp))
            .border(1.dp, Gray200, RoundedCornerShape(12.dp)).padding(20.dp),
    ) { ClosingText(label, 14, Gray500, lineHeight = 18) }
}

@Composable
private fun PrintFooter(state: ClosingState, onPrint: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Color.White).border(0.5.dp, Gray200)
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        val enabled = state.report != null && state.operation == null
        val label = when (state.operation) {
            ClosingOperation.Syncing -> "Syncing..."
            ClosingOperation.Printing -> "Printing..."
            else -> "Sync & Print Z-Report"
        }
        Row(
            Modifier.fillMaxWidth().height(54.dp).background(Brand.copy(alpha = if (enabled) 1f else .5f), RoundedCornerShape(12.dp))
                .clickable(enabled = enabled, onClick = onPrint),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            ClosingIcon(ClosingGlyph.Print, 22, Color.White)
            Spacer(Modifier.width(10.dp))
            ClosingText(label, 16, Color.White, FontWeight.Bold, lineHeight = 20)
        }
    }
}

private val ClosingIcons = FontFamily(Font(R.font.ionicons))

/** Source uses Ionicons here; literal box characters were placeholders. */
@Composable
private fun ClosingIcon(code: Int, size: Int, color: Color) {
    Text(code.toChar().toString(), fontFamily = ClosingIcons, fontSize = size.sp, color = color)
}

private object ClosingGlyph {
    const val Back = 0xf127        // arrow-back
    const val Calendar = 0xf1d6    // calendar-outline
    const val Print = 0xf4f1       // print-outline
}

@Composable
private fun ClosingText(
    text: String,
    size: Int,
    color: Color,
    weight: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
    align: TextAlign? = null,
    lineHeight: Int = size + 4,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text,
        modifier,
        color = color,
        fontSize = size.sp,
        lineHeight = lineHeight.sp,
        fontWeight = weight,
        textAlign = align,
        maxLines = maxLines,
        overflow = if (maxLines == 1) TextOverflow.Ellipsis else TextOverflow.Clip,
    )
}

private val peso = NumberFormat.getNumberInstance(Locale.US).apply {
    minimumFractionDigits = 2
    maximumFractionDigits = 2
}
private fun money(value: Double) = "₱${peso.format(value)}"
private fun quantity(value: Double) = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
private fun displayTime(value: String): String {
    val (hour, minute) = value.split(':').map(String::toInt)
    return "${(hour % 12).takeUnless { it == 0 } ?: 12}:${minute.toString().padStart(2, '0')} ${if (hour >= 12) "PM" else "AM"}"
}
