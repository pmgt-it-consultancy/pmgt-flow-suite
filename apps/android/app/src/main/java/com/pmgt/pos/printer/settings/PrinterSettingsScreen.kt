package com.pmgt.pos.printer.settings

import com.pmgt.pos.browse.HideSystemBarsInDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.pmgt.pos.browse.BrowseColors
import com.pmgt.pos.browse.Glyph
import com.pmgt.pos.browse.Ion
import com.pmgt.pos.browse.Label
import com.pmgt.pos.browse.SystemIndicator
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun PrinterSettingsScreen(
    controller: PrinterSettingsController,
    onBack: () -> Unit,
    onSystemStatus: () -> Unit,
) {
    val state by controller.state.collectAsState()
    val scope = rememberCoroutineScope()
    var scanVisible by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<PrinterConfig?>(null) }
    var removeCandidate by remember { mutableStateOf<PrinterConfig?>(null) }
    var reconnectCandidate by remember { mutableStateOf<PrinterConfig?>(null) }
    var message by remember { mutableStateOf<Pair<String, String>?>(null) }

    LaunchedEffect(controller) {
        if (state.isLoading) controller.initialize()
    }
    BackHandler(onBack = onBack)

    Column(Modifier.fillMaxSize().background(BrowseColors.Background)) {
        PrinterHeader(onBack, onSystemStatus)
        when {
            state.isLoading ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = BrowseColors.Brand)
                }
            state.storageError != null ->
                SecureStorageError(state.storageError!!)
            else ->
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                ) {
                    PrinterToggleCard(
                        "Kitchen Printing",
                        "Print kitchen tickets at checkout",
                        state.kitchenPrintingEnabled,
                    ) { enabled ->
                        scope.launch { persistOrAlert({ controller.setKitchenPrintingEnabled(enabled) }, { message = it }) }
                    }
                    if (
                        state.kitchenPrintingEnabled &&
                            state.printers.none { it.role == PrinterRole.KITCHEN }
                    ) {
                        PrinterToggleCard(
                            "Use Receipt Printer for Kitchen",
                            "Print kitchen tickets on the receipt printer",
                            state.useReceiptPrinterForKitchen,
                            top = 12,
                        ) { enabled ->
                            scope.launch { persistOrAlert({ controller.setUseReceiptPrinterForKitchen(enabled) }, { message = it }) }
                        }
                    }
                    PrinterToggleCard(
                        "Minimal Customer Receipt",
                        "Print only product name, quantity, and price",
                        state.minimalReceiptEnabled,
                        top = 12,
                    ) { enabled ->
                        scope.launch { persistOrAlert({ controller.setMinimalReceiptEnabled(enabled) }, { message = it }) }
                    }
                    PrinterToggleCard(
                        "Cash Drawer",
                        "Auto-open cash drawer after payment",
                        state.cashDrawerEnabled,
                        top = 12,
                    ) { enabled ->
                        scope.launch { persistOrAlert({ controller.setCashDrawerEnabled(enabled) }, { message = it }) }
                    }
                    if (state.cashDrawerEnabled) {
                        OutlinedPrinterAction(
                            "Open Cash Drawer",
                            Modifier.padding(horizontal = 16.dp).padding(top = 12.dp),
                        ) {
                            scope.launch {
                                try {
                                    controller.openCashDrawer()
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (_: Exception) {
                                    message =
                                        "Error" to
                                            "Failed to open cash drawer. Make sure a receipt printer is connected."
                                }
                            }
                        }
                    }

                    Label(
                        "PAIRED PRINTERS",
                        12,
                        BrowseColors.Muted,
                        modifier =
                            Modifier.padding(horizontal = 16.dp)
                                .padding(top = 24.dp, bottom = 8.dp),
                    )
                    if (state.printers.isEmpty()) {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                                .background(Color.White, RoundedCornerShape(12.dp))
                                .padding(vertical = 32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Ion(Glyph.Print, 40, Color(0xFF9CA3AF))
                            Spacer(Modifier.height(8.dp))
                            Label("No printers configured", 16, BrowseColors.Muted)
                        }
                    } else {
                        state.printers.forEach { printer ->
                            PrinterCard(
                                printer,
                                state.connectionStatus[printer.id]
                                    ?: PrinterConnectionStatus.DISCONNECTED,
                                reconnect = {
                                    scope.launch {
                                        if (!controller.reconnect(printer.id)) {
                                            reconnectCandidate = printer
                                        }
                                    }
                                },
                                testPrint = {
                                    scope.launch {
                                        val displayTime = DateFormat.getDateTimeInstance().format(Date())
                                        try {
                                            controller.testPrint(printer.id, displayTime)
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (_: Exception) {
                                            message = "Test Print Failed" to "Could not send the test print."
                                        }
                                    }
                                },
                                edit = { editing = printer },
                                remove = { removeCandidate = printer },
                            )
                        }
                    }
                    PrimaryPrinterAction(
                        "Scan for Printers",
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                            .padding(top = 16.dp, bottom = 32.dp),
                    ) { scanVisible = true }
                }
        }
    }

    if (scanVisible) {
        ScanPrintersDialog(controller) {
            scanVisible = false
            controller.dismissAddFeedback()
        }
    }
    editing?.let { printer ->
        EditPrinterDialog(
            printer,
            close = { editing = null },
            save = { name, role, width ->
                scope.launch {
                    try {
                        controller.updatePrinter(printer.id, name, role, width)
                        editing = null
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        message = "Error" to "Could not save printer changes."
                    }
                }
            },
        )
    }
    removeCandidate?.let { printer ->
        AlertDialog(
            onDismissRequest = { removeCandidate = null },
            title = { Text("Remove Printer") },
            text = { Text("Remove \"${printer.name}\" from the app and unpair it from this device?") },
            dismissButton = {
                TextButton(onClick = { removeCandidate = null }) { Text("Cancel") }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        removeCandidate = null
                        scope.launch {
                            try {
                                controller.removePrinter(printer.id)
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                message = "Error" to "Printer was removed locally, but settings could not be saved."
                            }
                        }
                    }
                ) { Text("Remove & Unpair", color = Color(0xFFDC2626)) }
            },
        )
    }
    reconnectCandidate?.let { printer ->
        AlertDialog(
            onDismissRequest = { reconnectCandidate = null },
            title = { Text("Reconnect Failed") },
            text = {
                Text(
                    "Could not connect to \"${printer.name}\". Make sure the printer is turned on and in range."
                )
            },
            dismissButton = {
                TextButton(onClick = { reconnectCandidate = null }) { Text("Dismiss") }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        reconnectCandidate = null
                        scope.launch {
                            if (!controller.reconnect(printer.id)) reconnectCandidate = printer
                        }
                    }
                ) { Text("Retry") }
            },
        )
    }
    message?.let { (title, text) ->
        AlertDialog(
            onDismissRequest = { message = null },
            title = { Text(title) },
            text = { Text(text) },
            confirmButton = { TextButton(onClick = { message = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun PrinterHeader(onBack: () -> Unit, onSystemStatus: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color.White)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(48.dp).clickable(onClick = onBack).semantics {
                contentDescription = "Back"
            },
            contentAlignment = Alignment.Center,
        ) { Ion(Glyph.Back, 24, Color(0xFF374151)) }
        Spacer(Modifier.width(8.dp))
        Label("Printers", 18, BrowseColors.Ink, FontWeight.Bold, Modifier.weight(1f))
        SystemIndicator(onSystemStatus)
    }
    HorizontalDivider(color = BrowseColors.Border)
}

@Composable
private fun PrinterToggleCard(
    title: String,
    subtitle: String,
    checked: Boolean,
    top: Int = 16,
    onChecked: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = top.dp)
            .background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp)
            .heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Label(title, 16, BrowseColors.Ink, FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Label(subtitle, 14, BrowseColors.Muted)
        }
        Switch(
            checked,
            onChecked,
            colors =
                SwitchDefaults.colors(
                    checkedTrackColor = Color(0xFF3B82F6),
                    checkedThumbColor = Color.White,
                    uncheckedTrackColor = Color(0xFFD1D5DB),
                    uncheckedThumbColor = Color.White,
                    uncheckedBorderColor = Color.Transparent,
                ),
        )
    }
}

@Composable
private fun PrinterCard(
    printer: PrinterConfig,
    status: PrinterConnectionStatus,
    reconnect: () -> Unit,
    testPrint: () -> Unit,
    edit: () -> Unit,
    remove: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp)
            .background(Color.White, RoundedCornerShape(12.dp)).padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Ion(Glyph.Print, 20, Color(0xFF374151))
            Spacer(Modifier.width(8.dp))
            Label(printer.name, 16, BrowseColors.Ink, FontWeight.SemiBold)
        }
        Spacer(Modifier.height(8.dp))
        Label(
            "Role: ${if (printer.role == PrinterRole.RECEIPT) "Receipt" else "Kitchen"} | Paper: ${printer.paperWidth.millimeters}mm",
            14,
            BrowseColors.Muted,
        )
        Spacer(Modifier.height(8.dp))
        val (statusLabel, statusColor) =
            when (status) {
                PrinterConnectionStatus.CONNECTED -> "Connected" to Color(0xFF16A34A)
                PrinterConnectionStatus.RECONNECTING -> "Reconnecting..." to Color(0xFFD97706)
                PrinterConnectionStatus.FAILED -> "Connection Failed" to Color(0xFFDC2626)
                PrinterConnectionStatus.DISCONNECTED -> "Disconnected" to BrowseColors.Muted
            }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(statusColor, RoundedCornerShape(4.dp)))
            Spacer(Modifier.width(8.dp))
            Label(statusLabel, 14, statusColor)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (status != PrinterConnectionStatus.CONNECTED) {
                SmallPrinterAction(
                    if (status == PrinterConnectionStatus.RECONNECTING) "Reconnecting..." else "Reconnect",
                    status != PrinterConnectionStatus.RECONNECTING,
                    reconnect,
                )
            }
            SmallPrinterAction("Test Print", true, testPrint)
            SmallPrinterAction("Edit", true, edit)
            SmallPrinterAction("Remove", true, remove, Color(0xFFEF4444), Color(0xFFFCA5A5))
        }
    }
}

@Composable
private fun ScanPrintersDialog(controller: PrinterSettingsController, close: () -> Unit) {
    val state by controller.state.collectAsState()
    val scope = rememberCoroutineScope()
    var paperDevice by remember { mutableStateOf<Pair<PrinterDevice, PrinterRole>?>(null) }
    val busy = state.addFeedback?.stage in setOf(PrinterAddStage.SAVING, PrinterAddStage.CONNECTING)
    val adding = state.addFeedback != null
    LaunchedEffect(Unit) { controller.startScan() }
    LaunchedEffect(state.addFeedback?.stage) {
        if (state.addFeedback?.stage == PrinterAddStage.SUCCESS) {
            delay(1_200)
            close()
        }
    }
    Dialog(onDismissRequest = { if (!busy) close() }) {
        HideSystemBarsInDialog()
        Surface(
            Modifier.fillMaxWidth().heightIn(max = 680.dp).testTag("printer-scan-dialog"),
            shape = RoundedCornerShape(16.dp),
            color = Color.White,
        ) {
            Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("Scan for Printers", 20, BrowseColors.Ink, FontWeight.Bold, Modifier.weight(1f))
                    TextButton(onClick = close, enabled = !busy) { Text("Close") }
                }
                state.addFeedback?.let { feedback ->
                    val error = feedback.stage in setOf(PrinterAddStage.SAVED_CONNECTION_FAILED, PrinterAddStage.NOT_SAVED)
                    val success = feedback.stage == PrinterAddStage.SUCCESS
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 12.dp)
                            .background(
                                when {
                                    error -> Color(0xFFFEF2F2)
                                    success -> Color(0xFFDCFCE7)
                                    else -> Color(0xFFDBEAFE)
                                },
                                RoundedCornerShape(12.dp),
                            ).padding(16.dp)
                    ) {
                        Label(
                            when (feedback.stage) {
                                PrinterAddStage.SAVING -> "Adding printer"
                                PrinterAddStage.CONNECTING -> "Connecting printer"
                                PrinterAddStage.SUCCESS -> "Printer ready"
                                else -> "Connection failed"
                            },
                            14,
                            when {
                                error -> Color(0xFF991B1B)
                                success -> Color(0xFF166534)
                                else -> Color(0xFF1D4ED8)
                            },
                            FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(4.dp))
                        Label(
                            addFeedbackMessage(feedback),
                            14,
                            when {
                                error -> Color(0xFF991B1B)
                                success -> Color(0xFF166534)
                                else -> Color(0xFF1D4ED8)
                            },
                        )
                        if (error) {
                            Spacer(Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PrimaryPrinterAction("Retry", Modifier.weight(1f)) {
                                    scope.launch { controller.addPrinter(feedback.device, feedback.role, feedback.paperWidth) }
                                }
                                OutlinedPrinterAction("Dismiss", Modifier.weight(1f)) {
                                    controller.dismissAddFeedback()
                                }
                            }
                        }
                    }
                }
                state.discoveredDevices.forEach { device ->
                    Column(
                        Modifier.fillMaxWidth().padding(bottom = 8.dp)
                            .background(Color(0xFFF9FAFB), RoundedCornerShape(8.dp)).padding(12.dp)
                    ) {
                        Label(device.name.ifEmpty { "Unknown Device" }, 15, BrowseColors.Ink, FontWeight.SemiBold)
                        Label(device.address, 12, BrowseColors.Muted)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SmallPrinterAction("Add as Receipt", !adding, { paperDevice = device to PrinterRole.RECEIPT })
                            SmallPrinterAction("Add as Kitchen", !adding, { paperDevice = device to PrinterRole.KITCHEN })
                        }
                    }
                }
                if (state.isScanning) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        CircularProgressIndicator(Modifier.size(24.dp))
                        Spacer(Modifier.height(8.dp))
                        Label(
                            if (state.discoveredDevices.isEmpty()) "Scanning..." else "Scanning for more devices...",
                            14,
                            BrowseColors.Muted,
                        )
                    }
                } else if (state.discoveredDevices.isEmpty()) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Label("No devices found", 15, BrowseColors.Muted)
                    }
                }
                OutlinedPrinterAction(
                    "Scan Again",
                    Modifier.fillMaxWidth().padding(top = 16.dp),
                    enabled = !state.isScanning && !adding,
                ) { scope.launch { controller.startScan() } }
            }
        }
    }
    paperDevice?.let { (device, role) ->
        AlertDialog(
            onDismissRequest = { paperDevice = null },
            title = { Text("Paper Width") },
            text = { Text("Select the paper width for this printer") },
            confirmButton = {
                TextButton(onClick = {
                    paperDevice = null
                    scope.launch { controller.addPrinter(device, role, PrinterPaperWidth.MM80) }
                }) { Text("80mm") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        paperDevice = null
                        scope.launch { controller.addPrinter(device, role, PrinterPaperWidth.MM58) }
                    }) { Text("58mm") }
                    TextButton(onClick = { paperDevice = null }) { Text("Cancel") }
                }
            },
        )
    }
}

@Composable
private fun EditPrinterDialog(
    printer: PrinterConfig,
    close: () -> Unit,
    save: (String, PrinterRole, PrinterPaperWidth) -> Unit,
) {
    var name by remember(printer.id) { mutableStateOf(printer.name) }
    var role by remember(printer.id) { mutableStateOf(printer.role) }
    var width by remember(printer.id) { mutableStateOf(printer.paperWidth) }
    Dialog(onDismissRequest = close) {
        HideSystemBarsInDialog()
        Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
            Column(Modifier.widthIn(max = 480.dp).padding(20.dp)) {
                Label("Edit Printer", 20, BrowseColors.Ink, FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                Label("Name", 14, Color(0xFF374151), FontWeight.Medium)
                Spacer(Modifier.height(4.dp))
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), singleLine = true)
                Spacer(Modifier.height(16.dp))
                Label("Role", 14, Color(0xFF374151), FontWeight.Medium)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SelectChip("Receipt", role == PrinterRole.RECEIPT) { role = PrinterRole.RECEIPT }
                    SelectChip("Kitchen", role == PrinterRole.KITCHEN) { role = PrinterRole.KITCHEN }
                }
                Spacer(Modifier.height(16.dp))
                Label("Paper Width", 14, Color(0xFF374151), FontWeight.Medium)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SelectChip("58mm", width == PrinterPaperWidth.MM58) { width = PrinterPaperWidth.MM58 }
                    SelectChip("80mm", width == PrinterPaperWidth.MM80) { width = PrinterPaperWidth.MM80 }
                }
                Spacer(Modifier.height(20.dp))
                PrimaryPrinterAction("Save Changes", Modifier.fillMaxWidth()) { save(name, role, width) }
            }
        }
    }
}

@Composable
private fun SelectChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) Color(0xFFDBEAFE) else Color(0xFFF3F4F6),
        border = BorderStroke(1.dp, if (selected) BrowseColors.Brand else BrowseColors.Border),
    ) { Label(text, 14, if (selected) BrowseColors.Brand else Color(0xFF374151), modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) }
}

@Composable
private fun SmallPrinterAction(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit,
    color: Color = BrowseColors.Brand,
    border: Color = Color(0xFFD1D5DB),
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(6.dp),
        color = Color.White,
        border = BorderStroke(1.dp, border),
        modifier = Modifier.heightIn(min = 44.dp),
    ) {
        Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
            Label(text, 14, if (enabled) color else Color(0xFF9CA3AF), FontWeight.Medium)
        }
    }
}

@Composable
private fun PrimaryPrinterAction(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 56.dp),
        shape = RoundedCornerShape(10.dp),
        color = BrowseColors.Brand,
    ) { Box(Modifier.padding(14.dp), contentAlignment = Alignment.Center) { Label(text, 16, Color.White, FontWeight.SemiBold) } }
}

@Composable
private fun OutlinedPrinterAction(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(10.dp),
        color = Color.White,
        border = BorderStroke(1.dp, BrowseColors.Border),
    ) { Box(Modifier.padding(12.dp), contentAlignment = Alignment.Center) { Label(text, 15, if (enabled) BrowseColors.Brand else Color(0xFF9CA3AF), FontWeight.SemiBold) } }
}

@Composable
private fun SecureStorageError(message: String) {
    Column(
        Modifier.fillMaxWidth().padding(16.dp)
            .background(Color(0xFFFEF2F2), RoundedCornerShape(12.dp))
            .border(1.dp, Color(0xFFFECACA), RoundedCornerShape(12.dp)).padding(20.dp)
    ) {
        Label("Printer settings unavailable", 17, Color(0xFF991B1B), FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Label(message, 14, Color(0xFF991B1B))
    }
}

private suspend fun persistOrAlert(
    operation: suspend () -> Unit,
    alert: (Pair<String, String>) -> Unit,
) {
    try {
        operation()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        alert("Error" to "Could not save printer settings. The previous value was retained.")
    }
}

private fun addFeedbackMessage(feedback: PrinterAddFeedback): String {
    val name = feedback.device.name.ifEmpty { "printer" }
    val role = feedback.role.storedValue
    return when (feedback.stage) {
        PrinterAddStage.SAVING -> "Saving $name as the $role printer..."
        PrinterAddStage.CONNECTING -> "Connecting to $name..."
        PrinterAddStage.SUCCESS -> "${feedback.device.name.ifEmpty { "Printer" }} connected successfully."
        PrinterAddStage.SAVED_CONNECTION_FAILED ->
            "Saved \"$name\", but the connection failed. Make sure it is turned on and in range."
        PrinterAddStage.NOT_SAVED -> "Could not add \"$name\". Please try again."
    }
}
