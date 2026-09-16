package com.pmgt.pos.telemetry

import java.util.concurrent.CopyOnWriteArrayList
import org.junit.rules.ExternalResource

/** Installs itself as the process sink for one test, recording what production would send. */
class RecordingTelemetry : ExternalResource(), TelemetrySink {
    data class Event(val name: String, val params: Map<String, String>)

    data class NonFatal(val operation: String, val error: Throwable, val context: Map<String, String>)

    val events = CopyOnWriteArrayList<Event>()
    val nonFatals = CopyOnWriteArrayList<NonFatal>()
    val keys = java.util.concurrent.ConcurrentHashMap<String, String>()
    @Volatile var deviceId: String? = null

    override fun before() = Telemetry.install(this)

    override fun after() = Telemetry.install(null)

    override fun event(name: String, params: Map<String, String>) {
        events += Event(name, params)
    }

    override fun nonFatal(operation: String, error: Throwable, context: Map<String, String>) {
        nonFatals += NonFatal(operation, error, context)
    }

    override fun key(name: String, value: String) {
        keys[name] = value
    }

    override fun deviceId(id: String) {
        deviceId = id
    }

    fun operations() = nonFatals.map { it.operation }

    fun eventNames() = events.map { it.name }
}
