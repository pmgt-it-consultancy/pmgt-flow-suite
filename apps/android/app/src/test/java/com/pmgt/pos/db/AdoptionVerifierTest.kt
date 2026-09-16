package com.pmgt.pos.db

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AdoptionVerifierTest {
    private val evidence = AdoptionIntegrity(mapOf("orders" to 1), mapOf("orders" to 1), mapOf("__watermelon_last_pulled_at" to "12"), listOf(ServerReference("orders", "local", "server", "updated")))

    @Test fun networkFailureIsPendingAndOnlyExplicitMissingBlocks() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val offline = AdoptionVerifier({ evidence }, { throw IOException("offline") }, dispatcher)
        assertTrue(offline.verify() is AdoptionState.PendingVerification)
        val missing = AdoptionVerifier({ evidence }, { ServerReferenceVerification.Missing }, dispatcher)
        assertTrue(missing.verify() is AdoptionState.Blocked)
        val verified = AdoptionVerifier({ evidence }, { ServerReferenceVerification.Verified }, dispatcher)
        assertEquals(AdoptionState.Ready(evidence), verified.verify())
    }

    @Test fun concurrentLocalChangesInvalidateVerificationAndCancellationPropagates() = runTest {
        var reads = 0
        val dispatcher = StandardTestDispatcher(testScheduler)
        val changing = AdoptionVerifier({ if (reads++ == 0) evidence else evidence.copy(rowCounts = mapOf("orders" to 2)) }, { ServerReferenceVerification.Verified }, dispatcher)
        assertTrue(changing.verify() is AdoptionState.PendingVerification)
        val cancelled = AdoptionVerifier({ evidence }, { throw CancellationException() }, dispatcher)
        try {
            cancelled.verify()
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { }
    }
}
