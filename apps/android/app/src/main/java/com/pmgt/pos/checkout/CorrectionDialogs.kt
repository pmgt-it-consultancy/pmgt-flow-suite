package com.pmgt.pos.checkout

import com.pmgt.pos.posDialogProperties

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.catalogPress
import com.pmgt.pos.orders.numberText

@Composable
internal fun CorrectionDialogs(
    session: CorrectionSession,
    detail: OrderDetail?,
    completed: () -> Unit,
) {
    val state by session.state.collectAsStateWithLifecycle()
    state.saved?.let { saved ->
        val kind = saved.input.kind
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = session::later,
            title = { Text("Saved $kind") },
            text = {
                Column(
                    Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("A saved $kind for this order is unfinished.")
                    Text("Reason: ${saved.input.reason}")
                    if (kind == "void") Text("Entire order")
                    else saved.items.forEach { Text("${numberText(it.quantity)}x ${it.name}") }
                }
            },
            confirmButton = {
                TextButton(session::resumeSaved, enabled = !state.busy) {
                    Text("Resume saved $kind")
                }
            },
            dismissButton = { TextButton(session::later, enabled = !state.busy) { Text("Later") } },
        )
    }
    state.input?.let { input ->
        if (input.kind == "void")
            CheckoutModal("Void Order", session::closeInput, center = true) {
                Label(
                    "Please provide a reason for voiding this order.",
                    16,
                    BrowseColors.Muted,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                CorrectionReason(
                    input.reason,
                    { value -> session.change { it.copy(reason = value) } },
                    80,
                    16,
                    8,
                )
                CheckoutButton(
                    "Continue",
                    session::requestApproval,
                    Modifier.fillMaxWidth().padding(top = 16.dp),
                    enabled = input.reason.trim().isNotEmpty(),
                    color = BrowseColors.Red,
                    fontSize = 18,
                )
            }
        else
            CheckoutModal("Refund Items", session::closeInput) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column {
                        Heading("SELECT ITEMS TO REFUND")
                        Column(
                            Modifier.heightIn(max = 250.dp).verticalScroll(rememberScrollState())
                        ) {
                            detail
                                ?.items
                                ?.filterNot { it.isVoided }
                                ?.forEach { item ->
                                    val selected = item.id in input.itemIds
                                    val shape = RoundedCornerShape(10.dp)
                                    Row(
                                        Modifier.fillMaxWidth()
                                            .padding(bottom = 8.dp)
                                            .heightIn(min = 52.dp)
                                            .background(
                                                if (selected) Color(0xFFDBEAFE)
                                                else Color(0xFFF9FAFB),
                                                shape,
                                            )
                                            .border(
                                                1.dp,
                                                if (selected) BrowseColors.Brand
                                                else BrowseColors.Border,
                                                shape,
                                            )
                                            .catalogPress(true) {
                                                session.change {
                                                    it.copy(
                                                        itemIds =
                                                            if (selected) it.itemIds - item.id
                                                            else it.itemIds + item.id
                                                    )
                                                }
                                            }
                                            .semantics {
                                                this.selected = selected
                                                role = Role.Checkbox
                                            }
                                            .padding(12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(
                                            Modifier.size(24.dp)
                                                .background(
                                                    if (selected) BrowseColors.Brand
                                                    else Color.Transparent,
                                                    RoundedCornerShape(6.dp),
                                                )
                                                .border(
                                                    2.dp,
                                                    if (selected) BrowseColors.Brand
                                                    else Color(0xFFD1D5DB),
                                                    RoundedCornerShape(6.dp),
                                                ),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            if (selected) Ion(Glyph.Checkmark, 16, Color.White)
                                        }
                                        Label(
                                            "${numberText(item.quantity)}x ${item.productName}",
                                            15,
                                            weight = FontWeight.Medium,
                                            modifier = Modifier.weight(1f),
                                        )
                                        Label(
                                            money(item.lineTotal),
                                            14,
                                            weight = FontWeight.SemiBold,
                                        )
                                    }
                                }
                        }
                    }
                    Column {
                        Heading("REASON FOR REFUND")
                        CorrectionReason(
                            input.reason,
                            { value -> session.change { it.copy(reason = value) } },
                            70,
                            15,
                            10,
                        )
                    }
                    Column {
                        Heading("REFUND METHOD")
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            listOf("cash" to "Cash", "card_ewallet" to "Card / E-Wallet").forEach {
                                (method, title) ->
                                val selected = method == input.refundMethod
                                CheckoutButton(
                                    title,
                                    { session.change { it.copy(refundMethod = method) } },
                                    Modifier.weight(1f).heightIn(min = 48.dp).semantics {
                                        this.selected = selected
                                    },
                                    color = if (selected) Color(0xFFDBEAFE) else Color(0xFFF9FAFB),
                                    ink = if (selected) BrowseColors.Brand else Color(0xFF374151),
                                    fontSize = 14,
                                    vertical = 12,
                                    radius = 10,
                                    border =
                                        if (selected) BrowseColors.Brand else BrowseColors.Border,
                                    glyph = if (method == "cash") Glyph.Cash else Glyph.Card,
                                    glyphSize = 20,
                                    glyphInk =
                                        if (selected) BrowseColors.Brand else BrowseColors.Muted,
                                )
                            }
                        }
                    }
                    if (input.itemIds.isNotEmpty())
                        Row(
                            Modifier.fillMaxWidth()
                                .background(Color(0xFFFEF2F2), RoundedCornerShape(10.dp))
                                .padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Label(
                                "Refund Amount (${input.itemIds.size} item${if (input.itemIds.size > 1) "s" else ""})",
                                14,
                                Color(0xFFDC2626),
                                FontWeight.Medium,
                            )
                            Label(
                                money(
                                    detail
                                        ?.items
                                        .orEmpty()
                                        .filter { it.id in input.itemIds }
                                        .fold(0.0) { total, item -> total + item.lineTotal }
                                ),
                                18,
                                Color(0xFFDC2626),
                                FontWeight.Bold,
                            )
                        }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CheckoutButton(
                            "Cancel",
                            session::closeInput,
                            Modifier.weight(1f),
                            color = Color.White,
                            ink = Color(0xFF374151),
                            border = Color(0xFFD1D5DB),
                            borderWidth = 1f,
                            fontSize = 16,
                            fontWeight = FontWeight.Medium,
                        )
                        CheckoutButton(
                            "Continue",
                            session::requestApproval,
                            Modifier.weight(1f),
                            enabled =
                                input.itemIds.isNotEmpty() && input.reason.trim().isNotEmpty(),
                            color = BrowseColors.Red,
                            fontSize = 16,
                            disabledAlpha = .4f,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }
    }
    if (state.approvalVisible)
        session.approval?.let { approval ->
            ManagerApprovalDialog(
                approval,
                if (session.lastKind == "void") "Approve Void" else "Approve Refund",
                session::closeApproval,
                session::approve,
                if (session.lastKind == "void") "Manager PIN required to void this order"
                else "Manager PIN required to process this refund",
            )
        }
    state.alert?.let { alert ->
        val dismiss = {
            session.dismissAlert()
            if (state.completed != null) completed()
        }
        AlertDialog(
            properties = posDialogProperties(),
            onDismissRequest = dismiss,
            title = { Text(alert.title) },
            text = { Text(alert.message) },
            confirmButton = { TextButton(dismiss) { Text("OK") } },
        )
    }
}

@Composable
private fun Heading(text: String) {
    Text(
        text,
        Modifier.padding(bottom = 8.dp),
        color = BrowseColors.Muted,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.sp,
    )
}

@Composable
private fun CorrectionReason(
    value: String,
    changed: (String) -> Unit,
    height: Int,
    size: Int,
    radius: Int,
) {
    BasicTextField(
        value,
        changed,
        Modifier.fillMaxWidth()
            .heightIn(min = height.dp)
            .border(1.dp, BrowseColors.Border, RoundedCornerShape(radius.dp))
            .padding(12.dp)
            .testTag("correction-reason"),
        textStyle = TextStyle(fontSize = size.sp, color = BrowseColors.Ink),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) Label("Enter reason...", size, Color(0xFF9CA3AF))
                inner()
            }
        },
    )
}
