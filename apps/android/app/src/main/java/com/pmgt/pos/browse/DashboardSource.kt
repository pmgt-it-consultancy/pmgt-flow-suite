package com.pmgt.pos.browse

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

/**
 * Shared authenticated transport; no local revenue/summary fallback. Collected only while Home is
 * visible.
 */
class DashboardSource(private val http: ConvexHttp) {
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observe(
        storeId: String,
        syncCompletions: Flow<Long?> = emptyFlow(),
    ): Flow<DashboardSummary?> =
        merge(
                flow {
                    while (true) {
                        emit(Unit)
                        delay(60_000)
                    }
                },
                syncCompletions.map { Unit },
            )
            .transformLatest {
                try {
                    val result =
                        http
                            .query(
                                "orders:getDashboardSummary",
                                buildJsonObject { put("storeId", storeId) },
                            )
                            .jsonObject
                    emit(
                        DashboardSummary(
                            result.getValue("totalOrdersToday").jsonPrimitive.integralCount(),
                            result.getValue("todayRevenue").jsonPrimitive.double,
                        )
                    )
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (_: Exception) {
                    /* Retain the last server value, or initial loading if none. */
                }
            }
            .distinctUntilChanged()
}

private fun JsonPrimitive.integralCount(): Int {
    val number = doubleOrNull
    require(
        !isString &&
            number != null &&
            number.isFinite() &&
            number >= Int.MIN_VALUE &&
            number <= Int.MAX_VALUE &&
            number % 1.0 == 0.0
    ) { "Dashboard count must be an integral JSON number" }
    return number.toInt()
}
