package com.pmgt.pos.sync

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.db.AdoptionState
import com.pmgt.pos.telemetry.Telemetry

private val Brand = Color(0xFF0D87E1)
private val Ink = Color(0xFF111827)
private val Body = Color(0xFF374151)
private val Muted = Color(0xFF6B7280)
private val Hairline = Color(0xFFE5E7EB)
// Matches the auth screens' page wash rather than the palette's neutral fill.
private val Slip = Color(0xFFF9FAFB)
private val Danger = Color(0xFFDC2626)
private val DangerWash = Color(0xFFFEF2F2)
private val DangerEdge = Color(0xFFFECACA)
// Darker than the palette's #22C55E fill: this is text on white and needs the contrast.
private val Good = Color(0xFF15803D)

private fun secondsUntil(at: Long?): Long =
    at?.let { ((it - System.currentTimeMillis() + 999) / 1_000).coerceAtLeast(0) } ?: 0

private class GateCopy(
    val heading: String,
    val accent: Color,
    val explanation: String,
    val slipTitle: String,
    val slipLines: List<Pair<String, String>>,
    val note: String?,
    val support: String?,
)

private fun copyFor(state: AdoptionState, busy: Boolean): GateCopy = when (state) {
    is AdoptionState.ForeignStore ->
        GateCopy(
            heading = "Different store",
            accent = Danger,
            explanation =
                "This tablet is set up for ${state.localStoreName}. Your account belongs to a " +
                    "different store, so it cannot open the till here. Sign in with a " +
                    "${state.localStoreName} account, or ask a manager to move this tablet.",
            slipTitle = "THIS TABLET",
            slipLines =
                listOf(
                    "Set up for" to state.localStoreName,
                    "Waiting to sync" to
                        if (state.pendingLocalWork == 0) "none" else "${state.pendingLocalWork} records",
                ),
            note =
                if (state.pendingLocalWork == 0) "Nothing is waiting to sync, so no sales are at risk."
                else "${state.pendingLocalWork} records have not reached the server yet.",
            support = "${state.localStoreId} → ${state.expectedStoreId}",
        )
    is AdoptionState.Blocked ->
        GateCopy(
            heading = "Setup blocked",
            accent = Danger,
            explanation = state.message,
            slipTitle = "THIS TABLET",
            slipLines = listOf("Tablet data" to "preserved"),
            note = "Nothing has been changed or deleted on this tablet.",
            support = null,
        )
    is AdoptionState.Ready ->
        GateCopy(
            heading = "Ready",
            accent = Good,
            explanation = "Tablet data verified. Opening the till.",
            slipTitle = "THIS TABLET",
            slipLines = listOf("Tablet data" to "verified"),
            note = null,
            support = null,
        )
    is AdoptionState.PendingVerification ->
        GateCopy(
            heading = if (busy) "Checking this tablet" else "Not verified yet",
            accent = Ink,
            explanation =
                if (busy) "Matching this tablet's records against the server. This can take a few minutes on a busy store."
                else state.message,
            slipTitle = "THIS TABLET",
            slipLines = listOf("Tablet data" to "preserved"),
            note = if (busy) null else "Nothing has been changed or deleted on this tablet.",
            support = null,
        )
}

@Composable
fun AdoptionGate(
    state: AdoptionState,
    busy: Boolean,
    signOut: (() -> Unit)? = null,
    nextRetryAt: Long? = null,
    retry: () -> Unit,
) {
    LaunchedEffect(Unit) { Telemetry.screen("AdoptionGate") }
    val copy = copyFor(state, busy)
    val refused = state is AdoptionState.ForeignStore
    // A silent retry loop reads the same as a stall, so say that one is coming and when.
    var secondsLeft by remember(nextRetryAt) { mutableLongStateOf(secondsUntil(nextRetryAt)) }
    LaunchedEffect(nextRetryAt) {
        while (nextRetryAt != null && secondsLeft > 0) {
            delay(1_000)
            secondsLeft = secondsUntil(nextRetryAt)
        }
    }
    Row(
        Modifier.fillMaxSize().background(Color.White).padding(32.dp).testTag("adoption-gate"),
        horizontalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        Column(
            Modifier.weight(1.4f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "TABLET SETUP",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp,
                color = Muted,
            )
            Text(copy.heading, fontSize = 40.sp, fontWeight = FontWeight.Bold, color = copy.accent)
            Text(copy.explanation, fontSize = 19.sp, lineHeight = 28.sp, color = Body)
            copy.note?.let {
                Text(it, fontSize = 16.sp, color = Muted, modifier = Modifier.padding(top = 4.dp))
            }
            if (!refused && !busy && nextRetryAt != null && secondsLeft > 0) {
                Text(
                    "Trying again in ${secondsLeft}s.",
                    fontSize = 16.sp,
                    color = Brand,
                    modifier = Modifier.testTag("adoption-retry-countdown"),
                )
            }
            Spacer(Modifier.height(8.dp))
            Actions(refused, busy, signOut, retry)
        }
        Slip(copy, busy)
    }
}

@Composable
private fun Actions(refused: Boolean, busy: Boolean, signOut: (() -> Unit)?, retry: () -> Unit) {
    // A refusal is never resolved by trying again, so it offers the way out instead.
    if (refused) {
        signOut?.let {
            Button(
                onClick = it,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("adoption-sign-out"),
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, DangerEdge),
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = DangerWash,
                        contentColor = Danger,
                    ),
            ) { Text("Sign out", fontSize = 19.sp, fontWeight = FontWeight.SemiBold) }
        }
        return
    }
    Button(
        onClick = retry,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("adoption-retry"),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Brand),
    ) {
        if (busy) {
            CircularProgressIndicator(
                Modifier.size(20.dp),
                color = Color.White,
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(12.dp))
        }
        Text(
            if (busy) "Checking…" else "Check now",
            fontSize = 19.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
    signOut?.let {
        TextButton(
            onClick = it,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("adoption-sign-out"),
        ) { Text("Sign out", fontSize = 17.sp, color = Muted) }
    }
}

/** A till reconciling two ledgers should read like a till slip; the figures are the point. */
@Composable
private fun RowScope.Slip(copy: GateCopy, busy: Boolean) {
    Column(
        Modifier.weight(1f)
            .fillMaxHeight()
            .background(Slip, RoundedCornerShape(12.dp))
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            copy.slipTitle,
            fontFamily = FontFamily.Monospace,
            fontSize = 13.sp,
            letterSpacing = 2.sp,
            color = Muted,
        )
        HorizontalDivider(color = Hairline)
        copy.slipLines.forEach { (label, value) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Text(
                    label,
                    Modifier.weight(1f),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 15.sp,
                    color = Muted,
                )
                Text(
                    value,
                    Modifier.weight(1.2f),
                    fontFamily = FontFamily.Monospace,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = Ink,
                    textAlign = TextAlign.End,
                )
            }
        }
        if (busy) {
            HorizontalDivider(color = Hairline)
            Text(
                "checking…",
                fontFamily = FontFamily.Monospace,
                fontSize = 15.sp,
                color = Brand,
            )
        }
        copy.support?.let {
            Spacer(Modifier.weight(1f))
            HorizontalDivider(color = DangerEdge)
            Text(
                it,
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                color = Muted,
                modifier = Modifier.testTag("adoption-support-detail"),
            )
        }
    }
}
