package com.pmgt.pos

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DialogPolicyTest {
    @Test
    fun `outside taps never dismiss but back remains configurable`() {
        val standard = posDialogProperties()
        val blocking = posDialogProperties(dismissOnBackPress = false)

        assertFalse(standard.dismissOnClickOutside)
        assertTrue(standard.dismissOnBackPress)
        assertFalse(blocking.dismissOnClickOutside)
        assertFalse(blocking.dismissOnBackPress)
    }

    @Test
    fun `layout flags are preserved`() {
        val edgeToEdge =
            posDialogProperties(
                usePlatformDefaultWidth = false,
                decorFitsSystemWindows = false,
            )

        assertFalse(edgeToEdge.usePlatformDefaultWidth)
        assertFalse(edgeToEdge.decorFitsSystemWindows)
    }

    @Test
    fun `every Compose dialog uses the POS dismissal policy`() {
        val sourceRoot = File("src/main/java/com/pmgt/pos")
        val dialogStart = Regex("""\b(?:AlertDialog|Dialog)\s*\(""")
        val violations = mutableListOf<String>()
        var dialogs = 0

        sourceRoot.walkTopDown().filter { it.extension == "kt" }.forEach { file ->
            val lines = file.readLines()
            lines.forEachIndexed { index, line ->
                if (!dialogStart.containsMatchIn(line)) return@forEachIndexed
                dialogs++
                val declaration = lines.subList(index, minOf(index + 8, lines.size)).joinToString("\n")
                if (!Regex("""properties\s*=\s*posDialogProperties""").containsMatchIn(declaration)) {
                    violations += "${file.relativeTo(sourceRoot)}:${index + 1}"
                }
            }
        }

        assertTrue("Dialogs without the POS dismissal policy: $violations", violations.isEmpty())
        assertEquals("Update this expectation when adding an intentional dialog", 38, dialogs)
    }
}
