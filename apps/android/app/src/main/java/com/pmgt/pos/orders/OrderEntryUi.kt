package com.pmgt.pos.orders

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.catalogPress

internal val Orange = Color(0xFFF97316)
internal val OrangeInk = Color(0xFFEA580C)

@Composable
internal fun EntryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = BrowseColors.Brand,
    ink: Color = Color.White,
    enabled: Boolean = true,
    glyph: Glyph? = null,
    small: Boolean = false,
    outline: Boolean = false,
    fontSize: Int = if (small) 14 else 16,
    radius: Int = if (small) 6 else 12,
    vertical: Int = if (small) 8 else 16,
    borderColor: Color = Color(0xFFD1D5DB),
    fontWeight: FontWeight = if (small) FontWeight.Medium else FontWeight.Bold,
) {
    val shape = RoundedCornerShape(radius.dp)
    Row(
        modifier
            .clip(shape)
            .background(color)
            .then(if (outline) Modifier.border(1.dp, borderColor, shape) else Modifier)
            .graphicsLayer { alpha = if (enabled) 1f else .4f }
            .catalogPress(enabled, onClick)
            .semantics { role = Role.Button }
            .padding(horizontal = if (small) 12.dp else 20.dp, vertical = vertical.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        glyph?.let {
            Ion(it, if (fontSize == 17) 22 else 20, ink)
            Spacer(Modifier.width(8.dp))
        }
        Label(text, fontSize, ink, fontWeight)
    }
}

@Composable
internal fun EntryField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    fontSize: Int = 16,
    centered: Boolean = false,
    orange: Boolean = false,
    onBlur: () -> Unit = {},
    keyboard: KeyboardOptions = KeyboardOptions.Default,
) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(
        value,
        onChange,
        modifier
            .onFocusChanged {
                if (focused && !it.isFocused) onBlur()
                focused = it.isFocused
            }
            .background(
                if (orange) Color(0xFFFFF7ED) else Color.White,
                RoundedCornerShape(if (orange) 12.dp else 8.dp),
            )
            .border(
                if (orange) 2.dp else 1.dp,
                if (orange) Orange else Color(0xFFD1D5DB),
                RoundedCornerShape(if (orange) 12.dp else 8.dp),
            )
            .heightIn(min = 48.dp)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        textStyle =
            TextStyle(
                fontSize = fontSize.sp,
                color = if (orange) Color(0xFF9A3412) else BrowseColors.Ink,
                fontWeight = if (orange) FontWeight.SemiBold else FontWeight.Normal,
                textAlign = if (centered) TextAlign.Center else TextAlign.Start,
            ),
        singleLine = true,
        keyboardOptions = keyboard,
        decorationBox = { field ->
            Box(contentAlignment = if (centered) Alignment.Center else Alignment.CenterStart) {
                if (value.isEmpty())
                    Label(
                        placeholder,
                        fontSize,
                        if (orange) Color(0xFFC2956B) else Color(0xFF9CA3AF),
                    )
                field()
            }
        },
    )
}

@Composable
internal fun TakeoutMetadata(
    state: EditorState,
    customer: (String) -> Unit,
    marker: (String) -> Unit,
    saveCustomer: () -> Unit,
    saveMarker: () -> Unit,
    category: (String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth()
            .background(Color.White)
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("dine_in" to "Dine-in", "takeout" to "Takeout").forEach { (value, title) ->
                val selected = state.category == value
                EntryButton(
                    title,
                    { category(value) },
                    Modifier.weight(1f).semantics { this.selected = selected },
                    if (selected) Orange else BrowseColors.Background,
                    if (selected) Color.White else BrowseColors.Muted,
                    glyph = if (value == "dine_in") Glyph.Dining else Glyph.Bag,
                    outline = !selected,
                    vertical = 14,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.width(120.dp)) {
                Label("Table Marker", 13, OrangeInk, FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                EntryField(
                    state.marker,
                    marker,
                    "e.g. 15",
                    Modifier.fillMaxWidth().height(52.dp).testTag("table-marker"),
                    20,
                    true,
                    true,
                    saveMarker,
                )
            }
            Column(Modifier.weight(1f)) {
                Label("Customer Name", 13, OrangeInk, FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                EntryField(
                    state.customer,
                    customer,
                    "Enter customer name (optional)",
                    Modifier.fillMaxWidth().height(52.dp).testTag("customer-name"),
                    orange = true,
                    onBlur = saveCustomer,
                )
            }
        }
    }
    HorizontalDivider(color = Color(0xFFE2E8F0))
}

@Composable
internal fun EntryCart(
    state: EditorState,
    takeout: Boolean,
    pending: Map<String, Double>,
    onQuantity: (String, Double) -> Unit,
    onRemove: (CartDisplayLine) -> Unit,
    onService: (String, String) -> Unit,
    onSend: () -> Unit,
    onCheckout: () -> Unit,
    onCancel: () -> Unit,
    onBill: () -> Unit,
    onReprint: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sending = "send" in state.busy
    val unsent = state.lines.any { !it.item.isSentToKitchen }
    val sent = state.lines.any { it.item.isSentToKitchen }
    val openTakeout = takeout && state.cart?.status in setOf("open", "draft")
    Column(modifier.background(Color.White).testTag("order-cart")) {
        Row(
            Modifier.fillMaxWidth()
                .background(Color(0xFFF9FAFB))
                .padding(
                    horizontal = if (takeout) 16.dp else 12.dp,
                    vertical = if (takeout) 14.dp else 10.dp,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (takeout) {
                    Box(
                        Modifier.background(Color(0xFFFFF7ED), RoundedCornerShape(8.dp))
                            .padding(8.dp)
                    ) {
                        Ion(Glyph.FilledCart, 18, OrangeInk)
                    }
                    Spacer(Modifier.width(10.dp))
                }
                Column {
                    Label("Order Items", if (takeout) 16 else 14, weight = FontWeight.Bold)
                    if (takeout)
                        Label(
                            "${numberText(state.count)} ${if (state.count == 1.0) "item" else "items"}",
                            12,
                            BrowseColors.Muted,
                        )
                }
            }
            Box(
                Modifier.background(
                        if (takeout) Orange else BrowseColors.Brand,
                        RoundedCornerShape(999.dp),
                    )
                    .padding(
                        horizontal = if (takeout) 14.dp else 10.dp,
                        vertical = if (takeout) 6.dp else 2.dp,
                    )
            ) {
                Label(
                    if (takeout) money(state.subtotal) else numberText(state.count),
                    if (takeout) 14 else 12,
                    Color.White,
                    FontWeight.Bold,
                )
            }
        }
        HorizontalDivider(color = BrowseColors.Border)
        if (state.lines.isEmpty()) {
            Column(
                Modifier.weight(1f)
                    .fillMaxWidth()
                    .padding(vertical = if (takeout) 48.dp else 64.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = if (takeout) Arrangement.Center else Arrangement.Top,
            ) {
                if (takeout)
                    Box(
                        Modifier.background(Color(0xFFFFF7ED), RoundedCornerShape(24.dp))
                            .drawBehind {
                                drawRoundRect(
                                    Color(0xFFFDBA74),
                                    cornerRadius = CornerRadius(24.dp.toPx()),
                                    style =
                                        Stroke(
                                            2.dp.toPx(),
                                            pathEffect =
                                                PathEffect.dashPathEffect(
                                                    floatArrayOf(6.dp.toPx(), 4.dp.toPx())
                                                ),
                                        ),
                                )
                            }
                            .padding(24.dp)
                    ) {
                        Ion(Glyph.BagAdd, 48, Orange)
                    }
                else Ion(Glyph.Cart, 48, Color(0xFFD1D5DB))
                Spacer(Modifier.height(if (takeout) 16.dp else 8.dp))
                Label(
                    if (takeout) "No items yet" else "No items in order",
                    16,
                    if (takeout) BrowseColors.Ink else BrowseColors.Muted,
                    if (takeout) FontWeight.SemiBold else FontWeight.Normal,
                )
                if (takeout)
                    Text(
                        "Tap products from the menu to add them to this takeout order",
                        Modifier.padding(horizontal = 24.dp),
                        color = BrowseColors.Muted,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
            }
        } else
            LazyColumn(Modifier.weight(1f).testTag("cart-list")) {
                items(state.lines, key = { it.item.id }) { line ->
                    EntryCartLine(
                        line,
                        pending[line.item.id] ?: line.item.quantity,
                        sending || (!takeout && "checkout" in state.busy),
                        if (takeout) state.category else "dine_in",
                        "service:${line.item.id}" in state.busy,
                        { delta -> onQuantity(line.item.id, delta) },
                        { onRemove(line) },
                        { onService(line.item.id, it) },
                    )
                }
            }
        HorizontalDivider(color = BrowseColors.Border)
        Column(
            Modifier.fillMaxWidth()
                .background(if (takeout) Color(0xFFFAFAFA) else Color.White)
                .padding(if (takeout) 16.dp else 12.dp)
                .testTag("cart-footer")
        ) {
            Column(
                Modifier.fillMaxWidth()
                    .then(
                        if (takeout)
                            Modifier.background(Color.White, RoundedCornerShape(12.dp))
                                .border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(12.dp))
                                .padding(14.dp)
                        else Modifier
                    )
            ) {
                if (takeout) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Label("Items", 14, BrowseColors.Muted)
                        Label(numberText(state.count), 14)
                    }
                    Spacer(Modifier.height(8.dp))
                }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Label("Subtotal", 14, BrowseColors.Muted)
                    Label(money(state.subtotal), if (takeout) 22 else 20, weight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(if (takeout) 14.dp else 12.dp))
            if (!takeout || (openTakeout && unsent) || state.needsRecalculation) {
                EntryButton(
                    if (state.needsRecalculation) "Retry Send to Kitchen" else "Send to Kitchen",
                    onSend,
                    Modifier.fillMaxWidth(),
                    if (takeout) Orange else BrowseColors.Green,
                    enabled = (unsent || state.needsRecalculation) && !sending,
                    glyph = Glyph.Dining,
                    fontSize = if (takeout) 17 else 16,
                )
                if (takeout) Spacer(Modifier.height(10.dp))
            }
            if (
                takeout &&
                    openTakeout &&
                    !unsent &&
                    state.cart?.takeoutStatus in setOf("preparing", "ready_for_pickup")
            ) {
                EntryButton(
                    if (sending) "Printing..." else "Reprint Kitchen Receipt",
                    onReprint,
                    Modifier.fillMaxWidth(),
                    Color(0xFFFFF7ED),
                    OrangeInk,
                    !sending,
                    Glyph.Print,
                    outline = true,
                    fontSize = 15,
                    vertical = 14,
                )
                Spacer(Modifier.height(10.dp))
            }
            if (takeout || (!state.draftMode && state.count > 0)) {
                if (takeout && state.lines.isNotEmpty()) {
                    EntryButton(
                        "View Bill",
                        onBill,
                        Modifier.fillMaxWidth(),
                        Color.White,
                        BrowseColors.Brand,
                        glyph = Glyph.Receipt,
                        enabled = !sending && "checkout" !in state.busy,
                        outline = true,
                        borderColor = BrowseColors.Brand,
                        fontSize = 16,
                        vertical = 14,
                    )
                    Spacer(Modifier.height(10.dp))
                } else Spacer(Modifier.height(8.dp))
                EntryButton(
                    if (takeout) "Proceed to Payment" else "Close Table",
                    onCheckout,
                    Modifier.fillMaxWidth(),
                    if (takeout && !(openTakeout && unsent)) Orange else BrowseColors.Brand,
                    enabled = state.lines.isNotEmpty() && !sending && "checkout" !in state.busy,
                    glyph = Glyph.Card,
                    fontSize = if (takeout) 17 else 16,
                )
                if (!takeout) {
                    Spacer(Modifier.height(8.dp))
                    EntryButton(
                        "View Bill",
                        onBill,
                        Modifier.fillMaxWidth(),
                        Color.White,
                        Color(0xFF374151),
                        glyph = Glyph.Receipt,
                        outline = true,
                    )
                }
            }
            if (takeout || !sent) {
                Spacer(Modifier.height(if (takeout) 12.dp else 10.dp))
                EntryButton(
                    if ("cancel" in state.busy) "Cancelling..." else "Cancel Order",
                    onCancel,
                    Modifier.fillMaxWidth(),
                    Color(0xFFFEF2F2),
                    Color(0xFFDC2626),
                    "cancel" !in state.busy,
                    Glyph.Void,
                    outline = true,
                    fontSize = 15,
                    radius = 10,
                    vertical = 14,
                    borderColor = Color(0xFFFECACA),
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun EntryCartLine(
    line: CartDisplayLine,
    quantity: Double,
    disabled: Boolean,
    defaultService: String,
    serviceBusy: Boolean,
    onQuantity: (Double) -> Unit,
    onRemove: () -> Unit,
    onService: (String) -> Unit,
) {
    val item = line.item
    Column(Modifier.fillMaxWidth().padding(12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.productName,
                        color = BrowseColors.Ink,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, false),
                    )
                    if (item.isSentToKitchen) {
                        Spacer(Modifier.width(4.dp))
                        Ion(Glyph.Check, 14, BrowseColors.Green)
                    }
                }
                Label(
                    "${money(item.productPrice)} each",
                    12,
                    Color(0xFF9CA3AF),
                    modifier = Modifier.padding(top = 2.dp),
                )
                item.modifiers.forEach {
                    Label(
                        it.optionName +
                            if (it.priceAdjustment > 0) " (+${money(it.priceAdjustment)})" else "",
                        12,
                        BrowseColors.Muted,
                    )
                }
                if (!item.notes.isNullOrEmpty())
                    Text(
                        item.notes,
                        color = Color(0xFFD97706),
                        fontSize = 12.sp,
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
            }
            Label(money(line.total), 14, weight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (item.isSentToKitchen) {
                    Box(
                        Modifier.background(BrowseColors.Background, RoundedCornerShape(8.dp))
                            .padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        Label(
                            "Qty: ${numberText(item.quantity)}",
                            14,
                            Color(0xFF374151),
                            FontWeight.SemiBold,
                        )
                    }
                    EntryButton(
                        "Void",
                        onRemove,
                        color = Color(0xFFFEF2F2),
                        ink = Color(0xFFDC2626),
                        small = true,
                        outline = true,
                        fontSize = 13,
                        radius = 8,
                    )
                } else {
                    QuantityKey(
                        Glyph.Remove,
                        "Decrease ${item.productName} quantity",
                        Color(0xFFFEE2E2),
                        BrowseColors.Red,
                        !disabled,
                    ) {
                        onQuantity(-1.0)
                    }
                    Box(
                        Modifier.widthIn(min = 48.dp)
                            .background(BrowseColors.Background, RoundedCornerShape(10.dp))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Label(
                            numberText(quantity),
                            18,
                            weight = FontWeight.Bold,
                            modifier = Modifier.testTag("cart-quantity-${item.id}"),
                        )
                    }
                    QuantityKey(
                        Glyph.Add,
                        "Increase ${item.productName} quantity",
                        Color(0xFFDCFCE7),
                        BrowseColors.Green,
                        !disabled,
                    ) {
                        onQuantity(1.0)
                    }
                }
            }
            Row(
                Modifier.clip(RoundedCornerShape(8.dp))
                    .border(1.dp, BrowseColors.Border, RoundedCornerShape(8.dp))
                    .alpha(if (item.isSentToKitchen) .5f else if (serviceBusy) .6f else 1f)
            ) {
                listOf("dine_in" to "DINE IN", "takeout" to "TAKEOUT").forEach { (value, title) ->
                    val selected = (item.serviceType ?: defaultService) == value
                    Box(
                        Modifier.background(if (selected) Color(0xFFDBEAFE) else Color.White)
                            .catalogPress(!item.isSentToKitchen && !serviceBusy) {
                                if (!selected) onService(value)
                            }
                            .semantics {
                                this.selected = selected
                                contentDescription = "$title ${item.productName}"
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Label(
                            title,
                            10,
                            if (selected) BrowseColors.Brand else Color(0xFF9CA3AF),
                            FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
    HorizontalDivider(color = BrowseColors.Background)
}

@Composable
private fun QuantityKey(
    glyph: Glyph,
    label: String,
    background: Color,
    ink: Color,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(44.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .catalogPress(enabled, onClick)
            .semantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Ion(glyph, 22, ink)
    }
}
