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

    @Test fun aBlockedResultKeepsTheThrowableThatCausedIt() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val underlying = IllegalStateException("Pending parent cannot be resolved")
        val local = AdoptionBlocked("Pending work has invalid data", underlying)
        val verifier = AdoptionVerifier({ throw local }, { ServerReferenceVerification.Verified }, dispatcher)

        val result = verifier.verify()

        // Reducing this to its message is what left support with a synthetic stack pointing at
        // whoever re-wrapped it rather than at the check that actually failed.
        assertEquals(AdoptionState.Blocked("Pending work has invalid data", local), result)
        assertEquals(underlying, (result as AdoptionState.Blocked).cause?.cause)
    }

    @Test fun aVerdictBlockedWithoutAThrowableStillHasNone() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val missing = AdoptionVerifier({ evidence }, { ServerReferenceVerification.Missing }, dispatcher)
        assertNull((missing.verify() as AdoptionState.Blocked).cause)
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
