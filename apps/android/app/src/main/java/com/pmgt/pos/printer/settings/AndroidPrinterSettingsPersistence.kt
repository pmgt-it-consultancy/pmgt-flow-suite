package com.pmgt.pos.printer.settings

import android.content.Context
import com.pmgt.pos.auth.ExpoSecurePreferences
import com.pmgt.pos.auth.SecurePreferenceUnavailable
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class AndroidPrinterSettingsPersistence private constructor(
    private val securePreferences: ExpoSecurePreferences,
    private val io: CoroutineDispatcher,
) : PrinterSettingsPersistence {
    constructor(
        context: Context,
        io: CoroutineDispatcher = Dispatchers.IO,
    ) : this(ExpoSecurePreferences(context.applicationContext), io)

    internal constructor(
        context: Context,
        aliasResolver: (String) -> String,
        io: CoroutineDispatcher,
    ) : this(ExpoSecurePreferences(context, aliasResolver), io)

    override suspend fun read(): PrinterSettings =
        withContext(io) {
            try {
                securePreferences.read(STORAGE_KEY)?.let(PrinterSettingsCodec::decode)
                    ?: PrinterSettings()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: SecurePreferenceUnavailable) {
                throw PrinterSettingsUnavailable(STORAGE_ERROR)
            } catch (_: Exception) {
                throw PrinterSettingsUnavailable(STORAGE_ERROR)
            }
        }

    override suspend fun write(settings: PrinterSettings): Unit =
        withContext(io) {
            try {
                securePreferences.write(STORAGE_KEY, PrinterSettingsCodec.encode(settings))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: SecurePreferenceUnavailable) {
                throw PrinterSettingsUnavailable(STORAGE_ERROR)
            } catch (_: Exception) {
                throw PrinterSettingsUnavailable(STORAGE_ERROR)
            }
        }

    private companion object {
        const val STORAGE_KEY = "printer_settings"
        const val STORAGE_ERROR =
            "Saved printer settings are unavailable. Keep the original tablet data and repair secure storage access before continuing."
    }
}

internal object PrinterSettingsCodec {
    fun decode(raw: String): PrinterSettings {
        val root = Json.parseToJsonElement(raw).jsonObject
        val printers =
            root["printers"]?.takeUnless { it is JsonNull }?.jsonArray?.map { encoded ->
                val printer = encoded.jsonObject
                PrinterConfig(
                    id = printer.getValue("id").jsonPrimitive.content,
                    name = printer.getValue("name").jsonPrimitive.content,
                    deviceName = printer.getValue("deviceName").jsonPrimitive.content,
                    role =
                        when (printer.getValue("role").jsonPrimitive.content) {
                            "receipt" -> PrinterRole.RECEIPT
                            "kitchen" -> PrinterRole.KITCHEN
                            else -> throw IllegalArgumentException("Unknown printer role")
                        },
                    paperWidth =
                        when (printer.getValue("paperWidth").jsonPrimitive.int) {
                            58 -> PrinterPaperWidth.MM58
                            80 -> PrinterPaperWidth.MM80
                            else -> throw IllegalArgumentException("Unknown paper width")
                        },
                    isDefault = printer.getValue("isDefault").jsonPrimitive.boolean,
                )
            } ?: emptyList()
        return PrinterSettings(
            printers = printers,
            kitchenPrintingEnabled = root.booleanOrFalse("kitchenPrintingEnabled"),
            cashDrawerEnabled = root.booleanOrFalse("cashDrawerEnabled"),
            useReceiptPrinterForKitchen = root.booleanOrFalse("useReceiptPrinterForKitchen"),
            minimalReceiptEnabled = root.booleanOrFalse("minimalReceiptEnabled"),
        )
    }

    fun encode(settings: PrinterSettings): String =
        buildJsonObject {
                put(
                    "printers",
                    buildJsonArray {
                        settings.printers.forEach { printer ->
                            add(
                                buildJsonObject {
                                    put("id", printer.id)
                                    put("name", printer.name)
                                    put("deviceName", printer.deviceName)
                                    put("role", printer.role.storedValue)
                                    put("paperWidth", printer.paperWidth.millimeters)
                                    put("isDefault", printer.isDefault)
                                }
                            )
                        }
                    },
                )
                put("kitchenPrintingEnabled", settings.kitchenPrintingEnabled)
                put("cashDrawerEnabled", settings.cashDrawerEnabled)
                put("useReceiptPrinterForKitchen", settings.useReceiptPrinterForKitchen)
                put("minimalReceiptEnabled", settings.minimalReceiptEnabled)
            }
            .toString()

    private fun kotlinx.serialization.json.JsonObject.booleanOrFalse(key: String): Boolean =
        get(key)?.jsonPrimitive?.boolean ?: false
}
