package com.pmgt.pos.telemetry

import com.pmgt.pos.transport.ConvexException
import java.io.IOException

/** Where crash context, non-fatals and usage events go: Firebase in the app, a recorder in tests. */
interface TelemetrySink {
    fun event(name: String, params: Map<String, String>)

    fun nonFatal(operation: String, error: Throwable, context: Map<String, String>)

    /** Survives into every later crash and non-fatal until overwritten. */
    fun key(name: String, value: String)

    fun deviceId(id: String)
}

/**
 * The app's single telemetry entry point. It is process-wide so services, platform receivers and
 * composition can all report without threading a dependency through every constructor. Nothing is
 * sent until the application installs a sink.
 */
object Telemetry {
    @Volatile private var sink: TelemetrySink? = null
    @Volatile private var lastScreen: String? = null

    fun install(sink: TelemetrySink?) {
        this.sink = sink
        lastScreen = null
    }

    fun event(name: String, vararg params: Pair<String, String?>) {
        sink?.event(name, params.mapNotNull { (key, value) -> value?.let { key to it } }.toMap())
    }

    /**
     * One screen_view per visit. The app is a single activity, so Firebase's automatic tracking never
     * sees Compose routes; a route re-entering composition without navigating is not a new visit.
     */
    fun screen(name: String) {
        if (name == lastScreen) return
        lastScreen = name
        event("screen_view", "screen_name" to name)
    }

    /**
     * A caught failure worth investigating. An unreachable network is expected on a tablet and is not
     * reported: Crashlytics keeps only the latest few non-fatals per session, so connectivity noise
     * would push out real faults. A [ConvexException] is a server answer, not connectivity.
     */
    fun nonFatal(operation: String, error: Throwable, vararg context: Pair<String, String>) {
        if (error is IOException && error !is ConvexException) return
        sink?.nonFatal(operation, error, context.toMap())
    }

    fun key(name: String, value: String?) {
        sink?.key(name, value.orEmpty())
    }

    fun deviceId(id: String) {
        sink?.deviceId(id)
    }
}
