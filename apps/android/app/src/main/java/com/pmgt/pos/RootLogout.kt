package com.pmgt.pos

import com.pmgt.pos.auth.AuthRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/** The Home logout launch boundary, shared by Main and its integration regression. */
internal class RootLogout(private val auth: AuthRepository, private val scope: CoroutineScope) {
    private val inFlight = Mutex()

    operator fun invoke(clearBrowseState: () -> Unit) =
        scope.launch {
            if (!inFlight.tryLock()) return@launch
            try {
                clearBrowseState()
                try {
                    auth.signOut()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // AuthRepository clears local credentials before propagating failed revocation.
                    // Its state drives the Login transition even when the server is unreachable.
                }
            } finally {
                inFlight.unlock()
            }
        }
}
