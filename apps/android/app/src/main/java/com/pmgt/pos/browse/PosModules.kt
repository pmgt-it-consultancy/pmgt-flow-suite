package com.pmgt.pos.browse

import com.pmgt.pos.closing.ClosingController
import com.pmgt.pos.printer.settings.PrinterSettingsController
import com.pmgt.pos.settings.SettingsController
import com.pmgt.pos.updater.UpdateCoordinator

/**
 * Settings, printer, closing and updater controllers owned by the activity and handed to the one
 * route owner. Absent modules keep the existing Unavailable fallthrough rather than a partial UI.
 */
class PosModules(
    val settings: SettingsController,
    val printers: PrinterSettingsController,
    val closing: ClosingController,
    val updates: UpdateCoordinator,
    val currentVersion: String,
)
