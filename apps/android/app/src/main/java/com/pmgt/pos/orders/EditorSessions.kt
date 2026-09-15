package com.pmgt.pos.orders

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope

/** Above the lock gate, below the signed-in owner. No draft serialization or extra DB owner. */
class EditorSessions(private val scope: CoroutineScope) {
    private val sessions = mutableMapOf<String, OrderEditorSession>()

    fun get(
        owner: String,
        key: String,
        route: EditorRoute,
        repository: OrderEntryRepository,
    ): OrderEditorSession =
        sessions.getOrPut("$owner:$key") {
            sessions.entries
                .firstOrNull { (oldKey, session) ->
                    oldKey.startsWith("$owner:") &&
                        route.orderId != null &&
                        session.state.value.orderId == route.orderId
                }
                ?.value ?: OrderEditorSession(route, repository, scope) {}
        }

    fun remove(owner: String, key: String) {
        sessions.remove("$owner:$key")
    }

    suspend fun clear() {
        for ((key, session) in sessions.toMap()) {
            if (session.state.value.draftMode) {
                session.edits.discard()
                sessions.remove(key)
                continue
            }
            try {
                session.leave()
                sessions.remove(key)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                /* Keep failed saves under the original owner for same-order retry. */
            }
        }
    }
}
