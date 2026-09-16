package com.pmgt.pos.updater

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Ports RN `UpdateDialog.tsx`. The forced modal has no dismissal in the source and keeps none
 * here; only the approved Software Update route suppresses it, which is not a bypass.
 */
@Composable
fun OptionalUpdateDialog(info: UpdateInfo, onGoToUpdates: () -> Unit, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier.fillMaxWidth(0.8f).widthIn(max = 400.dp)
                .background(Color.White, RoundedCornerShape(16.dp))
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            DialogTitle("Update Available")
            DialogSubtitle("Version ${info.latestVersion} is available.")
            DialogNotes(info.releaseNotes)
            Spacer(Modifier.height(16.dp))
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier.border(1.dp, Color(0xFFCCCCCC), RoundedCornerShape(12.dp))
                        .clickable(onClick = onDismiss)
                        .padding(vertical = 14.dp, horizontal = 32.dp)
                ) {
                    Text(
                        "Later",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF666666),
                    )
                }
                DialogPrimaryButton("Update Now", onGoToUpdates)
            }
        }
    }
}

@Composable
fun ForceUpdateModal(info: UpdateInfo, onGoToUpdates: () -> Unit) {
    Dialog(
        onDismissRequest = {},
        properties =
            DialogProperties(
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
                usePlatformDefaultWidth = false,
            ),
    ) {
        Column(
            Modifier.fillMaxSize().background(Color.White).padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            DialogTitle("Update Required")
            DialogSubtitle(
                "Version ${info.latestVersion} is required to continue using this app."
            )
            DialogNotes(info.releaseNotes)
            DialogPrimaryButton("Go to Updates", onGoToUpdates)
        }
    }
}

@Composable
private fun DialogTitle(text: String) {
    Text(
        text,
        fontSize = 24.sp,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
        color = Ink,
    )
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun DialogSubtitle(text: String) {
    Text(text, fontSize = 16.sp, textAlign = TextAlign.Center, color = Color(0xFF333333))
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun DialogNotes(notes: String) {
    if (notes.isEmpty()) return
    Text(notes, fontSize = 14.sp, textAlign = TextAlign.Center, color = Color(0xFF666666))
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun DialogPrimaryButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier.background(Brand, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 32.dp)
    ) {
        Text(label, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}
