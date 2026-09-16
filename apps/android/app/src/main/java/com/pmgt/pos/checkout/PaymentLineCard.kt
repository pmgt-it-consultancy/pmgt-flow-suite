package com.pmgt.pos.checkout

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.catalogPress

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PaymentLineCard(
    line: PaymentLine,
    index: Int,
    count: Int,
    remaining: Double,
    enabled: Boolean,
    update: ((PaymentLine) -> PaymentLine) -> Unit,
    remove: () -> Unit,
) {
    val cash = PaymentMath.number(line.cashReceived)
    val amount = PaymentMath.number(line.amount)
    CheckoutCard(Modifier.padding(bottom = 12.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Label(
                if (count > 1) "Payment ${index + 1}" else "Payment Method",
                15,
                Color(0xFF374151),
                FontWeight.Bold,
                Modifier.weight(1f),
            )
            if (count > 1)
                Box(
                    Modifier.background(Color(0xFFFEE2E2), RoundedCornerShape(8.dp))
                        .catalogPress(enabled, remove)
                        .semantics { contentDescription = "Remove payment ${index + 1}" }
                        .padding(6.dp)
                ) {
                    Ion(Glyph.Close, 18, Color(0xFFDC2626))
                }
        }
        Label(
            "Choose how the customer will settle this portion",
            12,
            BrowseColors.Muted,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Row(
            Modifier.fillMaxWidth().padding(bottom = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            listOf("cash" to "Cash", "card_ewallet" to "Card/E-Wallet").forEach { (method, title) ->
                val selected = line.paymentMethod == method
                Column(
                    Modifier.weight(1f)
                        .heightIn(min = 68.dp)
                        .background(
                            if (selected) Color(0xFFEFF6FF) else Color.White,
                            RoundedCornerShape(12.dp),
                        )
                        .border(
                            1.5.dp,
                            if (selected) BrowseColors.Brand else BrowseColors.Border,
                            RoundedCornerShape(12.dp),
                        )
                        .catalogPress(enabled) { update { it.copy(paymentMethod = method) } }
                        .semantics { role = Role.Button }
                        .padding(horizontal = 12.dp, vertical = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Ion(
                        if (method == "cash") Glyph.Cash else Glyph.Card,
                        20,
                        if (selected) BrowseColors.Brand else BrowseColors.Muted,
                    )
                    Label(
                        title,
                        13,
                        if (selected) BrowseColors.Brand else Color(0xFF374151),
                        FontWeight.SemiBold,
                        Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
        if (line.paymentMethod == "cash") {
            Label("Cash Amount", 14, BrowseColors.Muted, modifier = Modifier.padding(bottom = 8.dp))
            Row(
                Modifier.fillMaxWidth()
                    .padding(bottom = 10.dp)
                    .background(Color(0xFFF9FAFB), RoundedCornerShape(12.dp))
                    .border(
                        1.dp,
                        if (cash >= amount && cash > 0) BrowseColors.Green else BrowseColors.Border,
                        RoundedCornerShape(12.dp),
                    )
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Label("₱", 20, BrowseColors.Muted, FontWeight.SemiBold)
                CheckoutField(
                    line.cashReceived,
                    { value -> update { it.copy(cashReceived = value) } },
                    "0.00",
                    Modifier.weight(1f).testTag("cash-${line.id}"),
                    enabled,
                    20,
                    FontWeight.Bold,
                    if (cash >= amount && cash > 0) Color(0xFF16A34A) else BrowseColors.Ink,
                    border = Color.Transparent,
                    radius = 12,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                if (line.cashReceived.isNotEmpty())
                    Box(
                        Modifier.catalogPress(enabled) { update { it.copy(cashReceived = "") } }
                            .semantics { contentDescription = "Clear cash ${index + 1}" }
                    ) {
                        Ion(Glyph.Clear, 20, Color(0xFF9CA3AF))
                    }
            }
            CheckoutButton(
                "Exact Amount",
                { update { it.copy(cashReceived = PaymentMath.exact(it, remaining)) } },
                Modifier.fillMaxWidth().padding(bottom = 10.dp).heightIn(min = 44.dp),
                enabled,
                if (cash == amount && amount > 0) Color(0xFFDCFCE7) else Color(0xFFF0FDF4),
                Color(0xFF16A34A),
                13,
                12,
                10,
                if (cash == amount && amount > 0) BrowseColors.Green else Color(0xFFBBF7D0),
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(50, 100, 200, 500, 1000, 2000).forEach { value ->
                    CheckoutButton(
                        "+₱${if (value >= 1000) "${value / 1000},000" else value}",
                        {
                            update {
                                it.copy(cashReceived = PaymentMath.quick(it, value.toDouble()))
                            }
                        },
                        Modifier.heightIn(min = 44.dp),
                        enabled,
                        Color.White,
                        Color(0xFF374151),
                        14,
                        12,
                        10,
                        BrowseColors.Border,
                    )
                }
            }
        } else {
            Label("Amount", 14, BrowseColors.Muted, modifier = Modifier.padding(bottom = 8.dp))
            Row(
                Modifier.fillMaxWidth()
                    .padding(bottom = 14.dp)
                    .background(Color(0xFFF9FAFB), RoundedCornerShape(12.dp))
                    .border(
                        1.dp,
                        if (amount > 0) BrowseColors.Brand else BrowseColors.Border,
                        RoundedCornerShape(12.dp),
                    )
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Label("₱", 20, BrowseColors.Muted, FontWeight.SemiBold)
                CheckoutField(
                    line.amount,
                    { value -> update { it.copy(amount = value) } },
                    "0.00",
                    Modifier.weight(1f).testTag("card-${line.id}"),
                    enabled,
                    20,
                    FontWeight.Bold,
                    border = Color.Transparent,
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }
            Label(
                "Payment Type",
                14,
                BrowseColors.Muted,
                modifier = Modifier.padding(bottom = 10.dp),
            )
            FlowRow(
                Modifier.padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PaymentMath.types.forEach { type ->
                    val active =
                        type == line.cardPaymentType ||
                            type == "Other" &&
                                line.cardPaymentType.isNotEmpty() &&
                                line.cardPaymentType !in PaymentMath.types.dropLast(1)
                    CheckoutButton(
                        type,
                        {
                            update {
                                it.copy(
                                    cardPaymentType =
                                        if (type == "Other")
                                            it.customPaymentType.ifEmpty { "Other" }
                                        else type
                                )
                            }
                        },
                        Modifier.heightIn(min = 44.dp),
                        enabled,
                        if (active) Color(0xFFEFF6FF) else Color.White,
                        if (active) BrowseColors.Brand else Color(0xFF374151),
                        14,
                        10,
                        999,
                        if (active) BrowseColors.Brand else Color(0xFFD1D5DB),
                    )
                }
            }
            if (line.cardPaymentType !in PaymentMath.types.dropLast(1))
                CheckoutField(
                    line.customPaymentType,
                    { value ->
                        update {
                            it.copy(
                                customPaymentType = value,
                                cardPaymentType = value.ifEmpty { "Other" },
                            )
                        }
                    },
                    "Enter payment type...",
                    Modifier.padding(bottom = 12.dp)
                        .heightIn(min = 48.dp)
                        .testTag("custom-${line.id}"),
                    enabled,
                    keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                )
            Label(
                "Reference Number",
                14,
                BrowseColors.Muted,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            CheckoutField(
                line.cardReferenceNumber,
                { value -> update { it.copy(cardReferenceNumber = value) } },
                "Enter reference number...",
                Modifier.heightIn(min = 48.dp).testTag("reference-${line.id}"),
                enabled,
                keyboard = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            )
        }
    }
}
