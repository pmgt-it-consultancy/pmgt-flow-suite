package com.pmgt.pos.db

import com.pmgt.pos.telemetry.Telemetry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface AdoptionState {
    data class PendingVerification(val message: String = "Tablet data is preserved. Waiting for authenticated server verification.") : AdoptionState
    data class Ready(val integrity: AdoptionIntegrity) : AdoptionState
    data class Blocked(val message: String) : AdoptionState

    /**
     * The replica belongs to a different store than the signed-in user's. Decided from local
     * evidence before any request, because none of its references could ever resolve.
     */
    data class ForeignStore(
        val localStoreName: String,
        val localStoreId: String,
        val expectedStoreId: String,
        val pendingLocalWork: Int,
    ) : AdoptionState
}

enum class ServerReferenceVerification { Verified, Missing, Unavailable }

/**
 * The controller supplies its existing authenticated transport; this layer creates no client.
 * Return Missing only for an authoritative lookup, never for timeouts, auth failures or offline.
 * Call after AndroidDatabase.open; expose [state] in the shell and gate sync on Ready.
 */
class AdoptionVerifier(
    private val inspectLocal: () -> AdoptionIntegrity,
    private val verifyReferences: suspend (List<ServerReference>) -> ServerReferenceVerification,
    private val io: CoroutineDispatcher,
    private val expectedStoreId: String? = null,
) {
    private val mutex = Mutex()
    private val current = MutableStateFlow<AdoptionState>(AdoptionState.PendingVerification())
    val state: StateFlow<AdoptionState> = current.asStateFlow()

    /** Null when the replica is uncommissioned or already belongs to the expected store. */
    private fun foreignStore(integrity: AdoptionIntegrity): AdoptionState.ForeignStore? {
        val expected = expectedStoreId ?: return null
        val stores = integrity.localStores.ifEmpty { return null }
        if (stores.any { it.serverId == expected || it.localId == expected }) return null
        val owner = stores.first()
        return AdoptionState.ForeignStore(
            owner.name,
            owner.serverId ?: owner.localId,
            expected,
            integrity.pendingCounts.values.sum().toInt(),
        )
    }

    suspend fun verify(): AdoptionState = mutex.withLock {
        current.value = AdoptionState.PendingVerification()
        val result = withContext(io) {
            try {
                val before = inspectLocal()
                foreignStore(before) ?: when (verifyReferences(before.serverReferences)) {
                    ServerReferenceVerification.Missing -> AdoptionState.Blocked("An existing server reference could not be resolved. Tablet data is preserved; repair the reference before continuing.")
                    ServerReferenceVerification.Unavailable -> AdoptionState.PendingVerification()
                    ServerReferenceVerification.Verified -> if (before == inspectLocal()) AdoptionState.Ready(before)
                        else AdoptionState.PendingVerification("Tablet data changed during verification. Verify again before continuing.")
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (blocked: AdoptionBlocked) {
                AdoptionState.Blocked(blocked.message ?: "Local adoption is blocked.")
            } catch (failure: Exception) {
                Telemetry.nonFatal("adoption.verify", failure)
                AdoptionState.PendingVerification()
            }
        }
        current.value = result
        result
    }
}
