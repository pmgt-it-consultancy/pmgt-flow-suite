package com.pmgt.pos.telemetry

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.CustomKeysAndValues
import com.google.firebase.crashlytics.FirebaseCrashlytics

class FirebaseTelemetry(context: Context) : TelemetrySink {
    private val analytics = FirebaseAnalytics.getInstance(context)
    private val crashlytics = FirebaseCrashlytics.getInstance()

    override fun event(name: String, params: Map<String, String>) {
        analytics.logEvent(name, Bundle().apply { params.forEach { (key, value) -> putString(key, value) } })
    }

    override fun nonFatal(operation: String, error: Throwable, context: Map<String, String>) {
        crashlytics.recordException(
            error,
            CustomKeysAndValues.Builder()
                .putString("operation", operation)
                .apply { context.forEach { (key, value) -> putString(key, value) } }
                .build(),
        )
    }

    override fun key(name: String, value: String) {
        crashlytics.setCustomKey(name, value)
        // Analytics segments usage by the same tablet context; null clears a user property.
        analytics.setUserProperty(name, value.ifEmpty { null })
    }

    override fun deviceId(id: String) {
        crashlytics.setUserId(id)
        analytics.setUserId(id)
    }
}
