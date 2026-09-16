package com.pmgt.pos.checkout

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.focus.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.catalogPress
import com.pmgt.pos.orders.numberText
import kotlinx.coroutines.delay

@Composable
internal fun DiscountSheet(view: CheckoutView, input: DiscountInput, session: CheckoutSession) {
    val available =
        view.cart.lines.filter { item ->
            view.cart.discounts
                .filter { it.itemId == item.id }
                .fold(0.0) { sum, d -> sum + d.quantity } == 0.0
        }
    val allSelected = available.isNotEmpty() && available.all { it.id in input.itemIds }
    val nameFocus = remember { FocusRequester() }
    CheckoutModal("Apply SC/PWD Discount", session::closeDiscount) {
        Label(
            "Discount Type",
            16,
            Color(0xFF374151),
            FontWeight.Medium,
            Modifier.padding(top = 12.dp, bottom = 10.dp),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf("senior_citizen" to "Senior Citizen", "pwd" to "PWD").forEach { (type, title) ->
                val selected = input.type == type
                CheckoutButton(
                    title,
                    { session.discount { it.copy(type = type) } },
                    Modifier.weight(1f).heightIn(min = 48.dp),
                    color = if (selected) BrowseColors.Brand else Color(0xFFF3F4F6),
                    ink = if (selected) Color.White else Color(0xFF374151),
                    fontSize = 14,
                    vertical = 12,
                    radius = 999,
                )
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Label("Select Items", 16, Color(0xFF374151), FontWeight.Medium)
            if (available.size > 1)
                CheckoutButton(
                    if (allSelected) "Deselect All" else "Select All",
                    {
                        session.discount {
                            it.copy(
                                itemIds = if (allSelected) emptyList() else available.map { it.id }
                            )
                        }
                    },
                    Modifier.heightIn(min = 40.dp),
                    color = if (allSelected) Color(0xFFDBEAFE) else Color(0xFFF3F4F6),
                    ink = if (allSelected) BrowseColors.Brand else Color(0xFF374151),
                    fontSize = 14,
                    vertical = 10,
                    radius = 8,
                )
        }
        Column(
            Modifier.heightIn(max = 280.dp)
                .verticalScroll(rememberScrollState())
                .testTag("discount-items")
        ) {
            available.forEach { item ->
                val selected = item.id in input.itemIds
                Row(
                    Modifier.fillMaxWidth()
                        .padding(bottom = 8.dp)
                        .heightIn(min = 56.dp)
                        .background(
                            if (selected) Color(0xFFEFF6FF) else Color.White,
                            RoundedCornerShape(10.dp),
                        )
                        .border(
                            1.5.dp,
                            if (selected) BrowseColors.Brand else BrowseColors.Border,
                            RoundedCornerShape(10.dp),
                        )
                        .catalogPress(true) {
                            session.discount {
                                it.copy(
                                    itemIds =
                                        if (selected) it.itemIds - item.id else it.itemIds + item.id
                                )
                            }
                        }
                        .semantics {
                            role = Role.Checkbox
                            this.selected = selected
                        }
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Ion(
                        if (selected) Glyph.Checkbox else Glyph.Square,
                        26,
                        if (selected) BrowseColors.Brand else Color(0xFF9CA3AF),
                    )
                    Row(
                        Modifier.weight(1f).padding(start = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Label(
                            "${numberText(item.quantity)}x ${item.productName}",
                            15,
                            Color(0xFF374151),
                        )
                        if (!item.isVatable)
                            StatusBadge("NON-VAT", Color(0xFF92400E), Color(0xFFFEF3C7))
                    }
                    Label(money(item.lineTotal), 15, weight = FontWeight.SemiBold)
                }
            }
            if (available.isEmpty())
                Label(
                    "All items already have discounts",
                    16,
                    BrowseColors.Muted,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
                )
        }
        Label(
            "ID Number",
            16,
            Color(0xFF374151),
            FontWeight.Medium,
            Modifier.padding(top = 16.dp, bottom = 8.dp),
        )
        CheckoutField(
            input.customerId,
            { value -> session.discount { it.copy(customerId = value) } },
            "Enter SC/PWD ID number",
            Modifier.heightIn(min = 52.dp).testTag("discount-id"),
            background = Color.White,
            border = BrowseColors.Border,
            keyboard = KeyboardOptions(imeAction = ImeAction.Next),
            actions = KeyboardActions(onNext = { nameFocus.requestFocus() }),
        )
        Label(
            "Customer Name",
            16,
            Color(0xFF374151),
            FontWeight.Medium,
            Modifier.padding(top = 16.dp, bottom = 8.dp),
        )
        CheckoutField(
            input.customerName,
            { value -> session.discount { it.copy(customerName = value) } },
            "Enter customer name",
            Modifier.heightIn(min = 52.dp).focusRequester(nameFocus).testTag("discount-name"),
            background = Color.White,
            border = BrowseColors.Border,
            keyboard = KeyboardOptions(imeAction = ImeAction.Done),
            actions = KeyboardActions(onDone = { session.requestApply() }),
        )
        Label(
            "BIR rule: 20% discount applies only to items consumed by SC/PWD",
            12,
            BrowseColors.Muted,
            modifier = Modifier.padding(top = 12.dp),
        )
        CheckoutButton(
            "Apply Discount${if (input.itemIds.size > 1) " to ${input.itemIds.size} Items" else ""}",
            session::requestApply,
            Modifier.fillMaxWidth().padding(top = 20.dp),
            session.validDiscount(),
            if (session.validDiscount()) BrowseColors.Brand else Color(0xFF9CA3AF),
            vertical = 18,
            disabledAlpha = 1f,
        )
    }
}

@Composable
internal fun ManagerApprovalDialog(
    session: ManagerApprovalSession,
    title: String,
    close: () -> Unit,
    approve: () -> Unit,
    description: String = "Manager PIN required to proceed",
) {
    val state by session.state.collectAsStateWithLifecycle()
    val pinFocus = remember { FocusRequester() }
    LaunchedEffect(session) { session.load() }
    LaunchedEffect(state.selectedId) {
        if (state.selectedId != null) {
            delay(100)
            pinFocus.requestFocus()
        }
    }
    CheckoutModal(title, close, center = true) {
        Label(description, 16, BrowseColors.Muted, modifier = Modifier.padding(bottom = 16.dp))
        Label(
            "Select Manager",
            16,
            Color(0xFF374151),
            FontWeight.Medium,
            Modifier.padding(bottom = 8.dp),
        )
        Column(Modifier.padding(bottom = 16.dp)) {
            if (state.managers == null)
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator(color = BrowseColors.Brand)
                    Label("Loading managers", 16, modifier = Modifier.padding(top = 8.dp))
                    Label("Fetching manager accounts for approval.", 14, BrowseColors.Muted)
                }
            else if (state.managers!!.isEmpty())
                Label(
                    "No managers found",
                    16,
                    BrowseColors.Muted,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            else
                state.managers!!.forEach { manager ->
                    val selected = state.selectedId == manager.id
                    Row(
                        Modifier.fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .background(
                                if (selected) Color(0xFFEFF6FF) else Color.White,
                                RoundedCornerShape(8.dp),
                            )
                            .border(
                                1.dp,
                                if (selected) BrowseColors.Brand else BrowseColors.Border,
                                RoundedCornerShape(8.dp),
                            )
                            .catalogPress(true) { session.select(manager.id) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(40.dp)
                                .background(Color(0xFFE5E7EB), RoundedCornerShape(20.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Label(
                                manager.name.take(1).uppercase(),
                                16,
                                Color(0xFF4B5563),
                                FontWeight.SemiBold,
                            )
                        }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Label(manager.name, 16, weight = FontWeight.Medium)
                            Label(manager.roleName, 12, BrowseColors.Muted)
                        }
                    }
                }
        }
        Label(
            "Enter PIN",
            16,
            Color(0xFF374151),
            FontWeight.Medium,
            Modifier.padding(bottom = 8.dp),
        )
        CheckoutField(
            state.pin,
            session::pin,
            "••••",
            Modifier.focusRequester(pinFocus).testTag("approval-pin"),
            size = 20,
            background = Color.White,
            border = BrowseColors.Border,
            radius = 8,
            padding = 12,
            keyboard =
                KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Go,
                ),
            actions = KeyboardActions(onGo = { approve() }),
            transformation = PasswordVisualTransformation(),
            center = true,
            letterSpacing = 8,
        )
        CheckoutButton(
            "Verify & Approve",
            approve,
            Modifier.fillMaxWidth().padding(top = 20.dp),
            state.selectedId != null && state.pin.isNotEmpty() && !state.verifying,
            busy = state.verifying,
        )
    }
    state.error?.let { alert ->
        key(alert.occurrence) {
            AlertDialog(
                onDismissRequest = session::dismissError,
                title = { Text(alert.title) },
                text = { Text(alert.message) },
                confirmButton = { TextButton(session::dismissError) { Text("OK") } },
            )
        }
    }
}
