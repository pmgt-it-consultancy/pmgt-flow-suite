package com.pmgt.pos.updater

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pmgt.pos.R
import com.pmgt.pos.browse.SystemIndicator
import kotlin.math.roundToInt

/** Ports RN `UpdatesScreen.tsx`. Check on entry matches the source's mount effect. */
@Composable
fun SoftwareUpdateScreen(
    state: UpdateState,
    currentVersion: String,
    onBack: () -> Unit,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onSystemStatus: () -> Unit,
) {
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().background(Background)) {
        UpdateHeader(onBack, onSystemStatus)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Card {
                Text("Current Version", fontSize = 14.sp, color = Muted)
                Spacer(Modifier.height(4.dp))
                Text(currentVersion, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Ink)
            }
            Spacer(Modifier.height(16.dp))
            val info = state.updateInfo
            when {
                state.isChecking -> CheckingCard()
                info != null -> AvailableCard(info, state, onDownload, onInstall)
                else -> UpToDateCard()
            }
            Spacer(Modifier.height(16.dp))
            if (state.error != null && info == null) {
                Column(
                    Modifier.fillMaxWidth()
                        .background(Color(0xFFFEF2F2), RoundedCornerShape(12.dp))
                        .padding(16.dp)
                ) {
                    Text(state.error, fontSize = 14.sp, color = Color(0xFFDC2626))
                }
                Spacer(Modifier.height(16.dp))
            }
            if (!state.isChecking) {
                Box(
                    Modifier.fillMaxWidth()
                        .background(Color.White, RoundedCornerShape(12.dp))
                        .clickable(onClick = onCheck)
                        .padding(vertical = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Check for Updates", fontWeight = FontWeight.SemiBold, color = Brand)
                }
            }
        }
    }
}

@Composable
private fun CheckingCard() {
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Brand)
        Spacer(Modifier.height(12.dp))
        Text("Checking for updates...", color = Muted, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun UpToDateCard() {
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        UpdateIcon(UpdateGlyph.CheckmarkCircle, 48, Green)
        Spacer(Modifier.height(8.dp))
        Text("Your app is up to date", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(4.dp))
        Text("You're running the latest version", fontSize = 14.sp, color = Muted)
    }
}

@Composable
private fun AvailableCard(
    info: UpdateInfo,
    state: UpdateState,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            UpdateIcon(UpdateGlyph.ArrowUpCircle, 24, Brand)
            Spacer(Modifier.width(8.dp))
            Text(
                "Version ${info.latestVersion} Available",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
            )
        }
        Spacer(Modifier.height(8.dp))
        if (info.releaseNotes.isNotEmpty()) {
            Text(info.releaseNotes, fontSize = 14.sp, color = Color(0xFF4B5563))
            Spacer(Modifier.height(16.dp))
        }
        when (state.downloadStatus) {
            DownloadStatus.IDLE -> ActionButton("Download Update", Brand, onDownload)
            DownloadStatus.DOWNLOADING -> DownloadProgress(state.downloadProgress)
            DownloadStatus.COMPLETED -> ActionButton("Install Update", Green, onInstall)
            DownloadStatus.FAILED -> {
                Text(
                    state.error ?: "Download failed",
                    fontSize = 14.sp,
                    color = Color(0xFFEF4444),
                )
                Spacer(Modifier.height(8.dp))
                ActionButton("Retry Download", Color(0xFFEF4444), onDownload)
            }
        }
    }
}

@Composable
private fun DownloadProgress(progress: Double) {
    val percent = (progress * 100).roundToInt()
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Downloading...", fontSize = 14.sp, color = Color(0xFF4B5563))
            Text("$percent%", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Brand)
        }
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.fillMaxWidth().height(12.dp)
                .background(Border, RoundedCornerShape(9999.dp))
        ) {
            if (percent > 0) {
                Box(
                    Modifier.fillMaxWidth(percent / 100f).height(12.dp)
                        .background(Brand, RoundedCornerShape(9999.dp))
                )
            }
        }
    }
}

@Composable
private fun ActionButton(label: String, color: Color, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth()
            .background(color, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp)
            .semantics { role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp),
        content = content,
    )
}

@Composable
private fun UpdateHeader(onBack: () -> Unit, onSystemStatus: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(48.dp).clickable(onClick = onBack).semantics {
                contentDescription = "Back"
                role = Role.Button
            },
            contentAlignment = Alignment.Center,
        ) {
            UpdateIcon(UpdateGlyph.Back, 24, Muted)
        }
        Text(
            "Software Update",
            Modifier.weight(1f),
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Ink,
        )
        SystemIndicator(onSystemStatus)
    }
    HorizontalDivider(color = Border)
}

private val UpdateIcons = FontFamily(Font(R.font.ionicons))

@Composable
internal fun UpdateIcon(code: Int, size: Int, color: Color) {
    Text(code.toChar().toString(), fontFamily = UpdateIcons, fontSize = size.sp, color = color)
}

internal object UpdateGlyph {
    const val Back = 0xf127
    const val ArrowUpCircle = 0xf146
    const val CheckmarkCircle = 0xf21e
}

internal val Brand = Color(0xFF0D87E1)
internal val Background = Color(0xFFF3F4F6)
internal val Ink = Color(0xFF111827)
internal val Muted = Color(0xFF6B7280)
internal val Border = Color(0xFFE5E7EB)
internal val Green = Color(0xFF22C55E)
