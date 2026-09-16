package com.pmgt.pos

import org.junit.Assert.*
import org.junit.Test

class BackToExitTest {
    @Test fun `a single back press does not exit`() {
        val gate = BackToExit { 1_000 }
        assertFalse(gate.press())
    }

    @Test fun `a second press within two seconds exits`() {
        var now = 1_000L
        val gate = BackToExit { now }
        gate.press()
        now += 1_999
        assertTrue(gate.press())
    }

    @Test fun `a press after the window lapses re-arms instead of exiting`() {
        var now = 1_000L
        val gate = BackToExit { now }
        gate.press()
        now += 2_000
        assertFalse(gate.press())
        now += 500
        assertTrue(gate.press())
    }

    @Test fun `the press after an exit starts over`() {
        var now = 1_000L
        val gate = BackToExit { now }
        gate.press()
        now += 300
        assertTrue(gate.press())
        now += 300
        assertFalse(gate.press())
    }
}
