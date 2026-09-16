package com.pmgt.pos.sync

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.db.AdoptionState
import com.pmgt.pos.telemetry.Telemetry

@Composable
fun AdoptionGate(state: AdoptionState, busy: Boolean, retry: () -> Unit) {
    LaunchedEffect(Unit) { Telemetry.screen("AdoptionGate") }
    Column(
        Modifier.fillMaxSize().background(Color.White).padding(24.dp).testTag("adoption-gate"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            if (state is AdoptionState.Blocked) "Tablet setup blocked" else "Verifying tablet data",
            fontSize = 28.sp, fontWeight = FontWeight.Bold,
            color = if (state is AdoptionState.Blocked) Color(0xFFDC2626) else Color(0xFF111827),
        )
        Text(
            when (state) {
                is AdoptionState.Blocked -> state.message
                is AdoptionState.PendingVerification -> state.message
                is AdoptionState.Ready -> "Tablet data verified."
            },
            fontSize = 18.sp, color = Color(0xFF374151),
        )
        Button(
            onClick = retry, enabled = !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D87E1)),
        ) { Text(if (busy) "Verifying…" else "Retry verification", fontSize = 18.sp) }
    }
}
