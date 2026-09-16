package com.pmgt.pos.orders

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CartQuantityEditsTest {
    @Test
    fun debounceCoalescesAcrossRowsAndStaleSaveCannotEraseNewerEdit() = runTest {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val saved = mutableListOf<Pair<String, Double>>()
        val edits = CartQuantityEdits(backgroundScope) { fail("Unexpected save failure") }
        val save: suspend (Double) -> Unit = { quantity ->
            if (quantity == 3.0) {
                entered.complete(Unit)
                release.await()
            }
            saved += "a" to quantity
        }
        edits.enqueue("a", 2.0, save)
        advanceTimeBy(100)
        edits.enqueue("a", 3.0, save)
        edits.enqueue("b", 4.0) { saved += "b" to it }
        advanceTimeBy(299)
        assertTrue(saved.isEmpty())
        advanceTimeBy(1)
        runCurrent()
        assertTrue("300ms debounce starts the latest absolute save", entered.isCompleted)
        val firstFlush = async { edits.flush() }
        val secondFlush = async { edits.flush() }
        edits.enqueue("a", 5.0, save)
        release.complete(Unit)
        runCurrent()
        assertEquals(listOf("a" to 3.0, "a" to 5.0, "b" to 4.0), saved)
        assertEquals(mapOf("a" to 5.0, "b" to 4.0), firstFlush.await())
        assertEquals(firstFlush.await(), secondFlush.await())
        assertTrue(edits.pending.value.isEmpty())
    }

    @Test
    fun failedSaveStaysPendingLatestSaverRetriesAndDiscardDoesNotCancelIo() = runTest {
        var errors = 0
        var persisted = 1.0
        val edits = CartQuantityEdits(backgroundScope) { errors++ }
        edits.enqueue("a", 7.0) { throw IllegalStateException("Disk unavailable") }
        advanceTimeBy(300)
        runCurrent()
        assertEquals(1, errors)
        assertEquals(7.0, edits.pending.value["a"])
        edits.updateSaver("a") { persisted = it }
        assertEquals(mapOf("a" to 7.0), edits.flush())
        assertEquals(7.0, persisted, 0.0)
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        edits.enqueue("a", 9.0) {
            started.complete(Unit)
            finish.await()
            persisted = it
        }
        val flush = async { edits.flush() }
        runCurrent()
        assertTrue(started.isCompleted)
        edits.discard("a")
        finish.complete(Unit)
        flush.await()
        assertEquals(9.0, persisted, 0.0)
        assertTrue(edits.pending.value.isEmpty())
    }
}
