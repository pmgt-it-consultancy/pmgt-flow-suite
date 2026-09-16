package com.pmgt.pos.printer

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

/**
 * Encodes the formatter's ordered bridge calls exactly as the installed RN Android module does.
 * Calls remain separate at the formatter seam so every text write retains its own style prefix.
 */
object EscPosEncoder {
    fun encode(call: PrinterCall): ByteArray =
        when (call) {
            is PrinterCall.Align ->
                byteArrayOf(ESC, 'a'.code.toByte(), call.alignment.nativeValue.toByte())
            is PrinterCall.Text -> encodeText(call)
            PrinterCall.FeedAndCut -> FEED_AND_CUT.copyOf()
            PrinterCall.OpenDrawer -> OPEN_DRAWER.copyOf()
        }

    fun encode(calls: List<PrinterCall>): ByteArray =
        ByteArrayOutputStream().use { output ->
            calls.forEach { output.write(encode(it)) }
            output.toByteArray()
        }

    private fun encodeText(call: PrinterCall.Text): ByteArray {
        require(call.text.isNotEmpty()) { "Native printText rejects empty text" }
        require(call.style.codePage in 0..255) { "Code page must be between 0 and 255" }
        require(call.style.widthTimes in 0..3) { "Width multiplier must be between 0 and 3" }
        require(call.style.heightTimes in 0..3) { "Height multiplier must be between 0 and 3" }

        val size =
            WIDTH_BYTES[call.style.widthTimes].toInt() +
                HEIGHT_BYTES[call.style.heightTimes].toInt()
        val text = call.text.toByteArray(Charset.forName(call.style.encoding))
        val output = ByteArrayOutputStream(9 + text.size + if (call.cut) 7 else 0)
        output.write(byteArrayOf(GS, '!'.code.toByte(), size.toByte()))
        output.write(byteArrayOf(ESC, 't'.code.toByte(), call.style.codePage.toByte()))
        output.write(byteArrayOf(ESC, 'M'.code.toByte(), call.style.fontType.toByte()))
        output.write(text)
        if (call.cut) {
            output.write(byteArrayOf(ESC, 'J'.code.toByte(), 30))
            output.write(byteArrayOf(GS, 'V'.code.toByte(), 'B'.code.toByte(), 1))
        }
        return output.toByteArray()
    }

    private const val ESC: Byte = 0x1b
    private const val GS: Byte = 0x1d
    private val WIDTH_BYTES = byteArrayOf(0x00, 0x10, 0x20, 0x30)
    private val HEIGHT_BYTES = byteArrayOf(0x00, 0x01, 0x02, 0x03)
    private val FEED_AND_CUT =
        byteArrayOf(ESC, 'J'.code.toByte(), 30, GS, 'V'.code.toByte(), 'B'.code.toByte(), 1)
    // PrinterCommand.POS_Set_Cashbox(pin, onTime, offTime) with the RN service defaults 0/25/250.
    private val OPEN_DRAWER = byteArrayOf(ESC, 'p'.code.toByte(), 0, 25, 250.toByte())
}
