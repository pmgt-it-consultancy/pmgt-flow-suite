package com.pmgt.pos.catalog

import android.view.WindowManager
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.R
import com.pmgt.pos.browse.*

/** Selection snapshots stay owned by the editor; this observer never replaces their name/price. */
@Composable
fun ProductSelectionSheet(
    storeId: String,
    product: SelectedProduct?,
    repository: CatalogRepository,
    entryPoint: CatalogEntryPoint,
    sending: Boolean,
    onClose: () -> Unit,
    onConfirm: (ProductChoice) -> Unit,
    stateOwner: ProductOptionsMemory? = null,
) {
    if (product == null) return
    key(storeId, product.id, repository) {
        val memory = stateOwner ?: remember(storeId, product.id) { ProductOptionsMemory(product) }
        val flow =
            remember(storeId, product.id, repository) { repository.modifiers(storeId, product.id) }
        val groups by flow.collectAsStateWithLifecycle(initialValue = memory.lastGroups)
        LaunchedEffect(groups) { memory.lastGroups = groups }
        ProductOptionsSheet(product, groups, entryPoint, sending, onClose, onConfirm, memory)
    }
}

@Composable
fun ProductOptionsSheet(
    product: SelectedProduct,
    groups: List<ModifierGroup>?,
    entryPoint: CatalogEntryPoint,
    sending: Boolean,
    onClose: () -> Unit,
    onConfirm: (ProductChoice) -> Unit,
    stateOwner: ProductOptionsMemory? = null,
) {
    val custom = usesModifierSheet(entryPoint, product, groups)
    // RN's order screen owns AddItem quantity/notes above both modal visibility branches.
    // Keep them across modifier availability changes, but not across product selection sessions.
    val memory = stateOwner ?: remember(product.id) { ProductOptionsMemory(product) }
    var simpleQuantity by memory.simpleQuantity
    var simpleNotes by memory.simpleNotes
    // Only the product identifies the sheet. `custom` flips true -> false when a counter product's
    // groups resolve to empty, and keying the Dialog on it would tear the window down and build a
    // new one, so the sheet visibly dismissed and reopened with a different title. `session` is
    // keyed on `custom` below, which is what actually has to reset.
    key(product.id) {
        var session by remember(memory, custom) { memory.selection(custom) }
        val shownGroups = if (custom) groups.orEmpty() else emptyList()
        LaunchedEffect(shownGroups) { session = session.refreshed(shownGroups) }
        val busy = sending || custom && groups == null
        val enabled = !busy && session.valid(product, shownGroups)
        val confirm = { if (enabled) onConfirm(session.choice(product, shownGroups)) }
        Dialog(
            onDismissRequest = onClose,
            properties =
                DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            HideSystemBarsInDialog()
            val window = (LocalView.current.parent as? DialogWindowProvider)?.window
            SideEffect {
                // RN's transparent modal has only its explicit 50% backdrop, not an extra dim
                // layer.
                window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                window?.setWindowAnimations(R.style.CatalogDialogAnimation)
            }
            BoxWithConstraints(
                Modifier.fillMaxSize().imePadding().testTag("product-modal-viewport"),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Box(
                    Modifier.fillMaxSize()
                        .background(Color.Black.copy(alpha = .5f))
                        .clickable(onClick = onClose)
                        .semantics { contentDescription = "Close product backdrop" }
                )
                Column(
                    Modifier.fillMaxWidth()
                        .heightIn(max = maxHeight * (if (custom) .92f else .8f))
                        .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                        .background(Color.White)
                        .testTag("product-sheet")
                ) {
                    SheetHeader(
                        product,
                        custom,
                        session,
                        { session = session.copy(customPriceText = it) },
                        onClose,
                    )
                    Column(
                        Modifier.weight(1f, fill = false)
                            .verticalScroll(rememberScrollState())
                            .testTag("product-options-scroll")
                            .padding(
                                start = 20.dp,
                                end = 20.dp,
                                top = 20.dp,
                                bottom = if (custom) 8.dp else 20.dp,
                            )
                    ) {
                        shownGroups.forEachIndexed { index, group ->
                            key(index, group.id) {
                                ModifierGroupChoices(group, session) {
                                    session = session.toggle(group, it)
                                }
                            }
                        }
                        NotesField(
                            session.notes,
                            {
                                session = session.copy(notes = it)
                                if (!custom) simpleNotes = it
                            },
                            custom,
                            confirm,
                        )
                        if (custom) Spacer(Modifier.height(8.dp))
                    }
                    HorizontalDivider(color = BrowseColors.Border)
                    Column(
                        Modifier.fillMaxWidth()
                            .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp)
                            .testTag("product-sheet-footer"),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            QuantityAction(
                                "Decrease quantity",
                                0xf520,
                                Color(0xFFFEE2E2),
                                Color(0xFFEF4444),
                            ) {
                                session = session.copy(quantity = maxOf(1, session.quantity - 1))
                                if (!custom) simpleQuantity = session.quantity
                            }
                            Label(
                                session.quantity.toString(),
                                28,
                                weight = FontWeight.Bold,
                                modifier =
                                    Modifier.widthIn(min = 80.dp)
                                        .background(
                                            BrowseColors.Background,
                                            RoundedCornerShape(12.dp),
                                        )
                                        .padding(horizontal = 24.dp, vertical = 12.dp)
                                        .testTag("product-quantity"),
                            )
                            QuantityAction(
                                "Increase quantity",
                                0xf103,
                                Color(0xFFDCFCE7),
                                Color(0xFF22C55E),
                            ) {
                                session = session.copy(quantity = session.quantity + 1)
                                if (!custom) simpleQuantity = session.quantity
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Label(
                            money(session.total(product, shownGroups)),
                            20,
                            weight = FontWeight.Bold,
                            modifier = Modifier.testTag("product-total"),
                        )
                        Spacer(Modifier.height(16.dp))
                        Box(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (enabled) BrowseColors.Brand else Color(0xFF9CA3AF))
                                .catalogPress(enabled = enabled, onClick = confirm)
                                .testTag("product-confirm")
                                .semantics { role = Role.Button }
                                .padding(vertical = 18.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Label(
                                if (busy) "Adding..." else "Add ${session.quantity} to Order",
                                18,
                                Color.White,
                                FontWeight.Bold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetHeader(
    product: SelectedProduct,
    custom: Boolean,
    session: ModifierSelection,
    onPrice: (String) -> Unit,
    onClose: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Label(
                if (custom) "Customize Order" else "Add to Order",
                18,
                weight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Label(product.name, 18)
            if (product.isOpenPrice) {
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { focus.requestFocus() }
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("₱", 18, BrowseColors.Muted, FontWeight.SemiBold)
                    Spacer(Modifier.width(4.dp))
                    Column(
                        Modifier.width(IntrinsicSize.Min)
                            .widthIn(min = 120.dp)
                            .testTag("product-price-container")
                    ) {
                        BasicTextField(
                            session.customPriceText,
                            onPrice,
                            Modifier.widthIn(min = 120.dp)
                                .width(IntrinsicSize.Min)
                                .focusRequester(focus)
                                .testTag("product-price")
                                .semantics { contentDescription = "Custom price" }
                                .padding(horizontal = 4.dp, vertical = 2.dp),
                            singleLine = true,
                            textStyle =
                                TextStyle(
                                    fontSize = 24.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = BrowseColors.Brand,
                                ),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            decorationBox = { inner ->
                                Box {
                                    if (session.customPriceText.isEmpty())
                                        Label("0.00", 24, Color(0xFF9CA3AF), FontWeight.Bold)
                                    inner()
                                }
                            },
                        )
                        HorizontalDivider(
                            thickness = 2.dp,
                            color =
                                if (
                                    session.customPriceText.isNotEmpty() &&
                                        !session.priceValid(product)
                                )
                                    BrowseColors.Red
                                else BrowseColors.Brand,
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Label(
                    if (product.maxPrice != null)
                        "Range: ${money(product.minPrice ?: 0.0)} – ${money(product.maxPrice)}"
                    else "Min: ${money(product.minPrice ?: 0.0)}",
                    12,
                    BrowseColors.Muted,
                )
            } else {
                Spacer(Modifier.height(2.dp))
                Label(money(product.price), 18, BrowseColors.Brand, FontWeight.SemiBold)
            }
        }
        Box(
            Modifier.offset(x = 8.dp, y = (-4).dp)
                .catalogPress(onClick = onClose)
                .padding(8.dp)
                .semantics { contentDescription = "Close product" }
        ) {
            Ion(Glyph.Close, 24)
        }
    }
    HorizontalDivider(color = BrowseColors.Border)
}

@Composable
private fun ModifierGroupChoices(
    group: ModifierGroup,
    session: ModifierSelection,
    onOption: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
        Row(Modifier.padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(group.name, 16, weight = FontWeight.SemiBold)
            Spacer(Modifier.width(10.dp))
            val required = group.minSelections > 0
            CatalogChip(
                if (required) "Required" else "Optional",
                12,
                if (required) Color(0xFFDC2626) else BrowseColors.Muted,
                if (required) Color(0xFFFEE2E2) else BrowseColors.Background,
                10,
                4,
                6,
                if (required) FontWeight.SemiBold else FontWeight.Medium,
            )
            if (
                group.selectionType == "multi" &&
                    group.maxSelections != null &&
                    group.maxSelections != 0.0
            ) {
                Spacer(Modifier.width(8.dp))
                Label("(max ${quantity(group.maxSelections)})", 12, Color(0xFF9CA3AF))
            }
        }
        group.options.forEach { option ->
            val selected = option.id in session.selections[group.id].orEmpty()
            Row(
                Modifier.padding(bottom = 6.dp)
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (selected) Color(0xFFEFF6FF) else Color(0xFFF9FAFB))
                    .border(
                        1.5.dp,
                        if (selected) Color(0xFFBFDBFE) else BrowseColors.Background,
                        RoundedCornerShape(10.dp),
                    )
                    .catalogPress { onOption(option.id) }
                    .testTag("option-${group.id}-${option.id}")
                    .semantics {
                        this.selected = selected
                        role =
                            if (group.selectionType == "single") Role.RadioButton else Role.Checkbox
                    }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CatalogIcon(
                    if (group.selectionType == "single") {
                        if (selected) 0xf503 else 0xf500
                    } else {
                        if (selected) 0xf21a else 0xf593
                    },
                    24,
                    if (selected) Color(0xFF3B82F6) else Color(0xFF9CA3AF),
                )
                Spacer(Modifier.width(12.dp))
                Label(
                    option.name,
                    16,
                    if (selected) BrowseColors.Ink else Color(0xFF374151),
                    if (selected) FontWeight.Medium else FontWeight.Normal,
                    Modifier.weight(1f),
                )
                if (option.priceAdjustment != 0.0)
                    Label(
                        "+${money(option.priceAdjustment)}",
                        15,
                        if (selected) Color(0xFF2563EB) else BrowseColors.Muted,
                        if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    )
            }
        }
    }
}

@Composable
private fun NotesField(
    notes: String,
    onNotes: (String) -> Unit,
    custom: Boolean,
    confirm: () -> Unit,
) {
    val focus = LocalFocusManager.current
    Label("Notes (optional)", 16, Color(0xFF374151), FontWeight.Medium)
    Spacer(Modifier.height(8.dp))
    BasicTextField(
        notes,
        onNotes,
        Modifier.fillMaxWidth()
            .heightIn(min = 72.dp)
            .border(1.dp, BrowseColors.Border, RoundedCornerShape(10.dp))
            .testTag("product-notes")
            .semantics { contentDescription = "Notes (optional)" }
            .padding(14.dp),
        textStyle = TextStyle(fontSize = 16.sp, color = BrowseColors.Ink),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions =
            KeyboardActions(
                onDone = {
                    focus.clearFocus()
                    if (!custom) confirm()
                }
            ),
        decorationBox = { inner ->
            Box {
                if (notes.isEmpty()) Label("E.g., no ice, extra spicy...", 16, Color(0xFF9CA3AF))
                inner()
            }
        },
    )
}

@Composable
private fun QuantityAction(label: String, code: Int, bg: Color, ink: Color, onClick: () -> Unit) {
    Box(
        Modifier.size(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .catalogPress(onClick = onClick)
            .semantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        CatalogIcon(code, 28, ink)
    }
}
