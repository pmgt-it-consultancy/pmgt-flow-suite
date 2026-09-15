package com.pmgt.pos.orders

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class CartQuantityEdits(private val scope: CoroutineScope, private val onError: () -> Unit) {
    private val mutablePending = MutableStateFlow<Map<String, Double>>(emptyMap())
    val pending = mutablePending.asStateFlow()

    private class Edit(val quantity: Double, var save: suspend (Double) -> Unit)

    private val monitor = Any()
    private val edits = linkedMapOf<String, Edit>()
    private val quantities = linkedMapOf<String, Double>()
    private var timer: Job? = null
    private var running: Deferred<Result<Map<String, Double>>>? = null

    fun enqueue(id: String, quantity: Double, save: suspend (Double) -> Unit) =
        synchronized(monitor) {
            edits[id] = Edit(quantity, save)
            quantities[id] = quantity
            publish()
            timer?.cancel()
            timer =
                scope.launch {
                    delay(300)
                    // Detach timer before flush, which otherwise cancels its own caller.
                    synchronized(monitor) { timer = null }
                    try {
                        flush()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        onError()
                    }
                }
        }

    fun updateSaver(id: String, save: suspend (Double) -> Unit) =
        synchronized(monitor) { edits[id]?.save = save }

    fun currentQuantity(id: String, fallback: Double): Double =
        synchronized(monitor) { quantities[id] ?: fallback }

    fun acknowledge(id: String) =
        synchronized(monitor) {
            if (!edits.containsKey(id)) quantities.remove(id)
            Unit
        }

    fun discard(id: String? = null) =
        synchronized(monitor) {
            if (id == null) {
                edits.clear()
                quantities.clear()
            } else {
                edits.remove(id)
                quantities.remove(id)
            }
            publish()
        }

    suspend fun flush(): Map<String, Double> {
        val flight =
            synchronized(monitor) {
                timer?.cancel()
                timer = null
                running
                    ?: scope
                        .async(start = CoroutineStart.LAZY) {
                            val snapshot = synchronized(monitor) { LinkedHashMap(quantities) }
                            try {
                                while (true) {
                                    val next =
                                        synchronized(monitor) {
                                            edits.entries.firstOrNull()?.let { it.key to it.value }
                                        } ?: break
                                    val (id, edit) = next
                                    edit.save(edit.quantity)
                                    synchronized(monitor) {
                                        snapshot[id] = edit.quantity
                                        if (edits[id] === edit) edits.remove(id)
                                        publish()
                                    }
                                }
                                Result.success<Map<String, Double>>(snapshot)
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (error: Exception) {
                                Result.failure(error)
                            } finally {
                                synchronized(monitor) { running = null }
                            }
                        }
                        .also { running = it }
            }
        flight.start()
        return flight.await().getOrThrow()
    }

    private fun publish() {
        mutablePending.value = edits.mapValues { it.value.quantity }
    }
}
