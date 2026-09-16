package com.pmgt.pos.checkout

import android.os.Looper
import app.cash.sqldelight.db.*
import com.pmgt.pos.browse.*
import com.pmgt.pos.browse.MainDeliveryBrowseRepository
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import org.junit.Assert.*

/** Compose 1.9 test-only handoff: its unconfined frame must not resume on a SQL producer thread. */
internal class CorrectionCompose19Delivery(private val real: BrowseRepository) :
    // Every other flow hands off on Main too: the same unconfined frame otherwise composes on the
    // repository's IO thread and fails on Choreographer or OnBackPressedDispatcher.
    BrowseRepository by MainDeliveryBrowseRepository(real) {
    private val deliveryThreads = CopyOnWriteArrayList<Boolean>()

    override fun takeout(storeId: String, range: DayRange): Flow<TakeoutLane> =
        flow {
                real.takeout(storeId, range).collect { lane ->
                    deliveryThreads += Looper.myLooper() == Looper.getMainLooper()
                    emit(lane)
                }
            }
            .flowOn(Dispatchers.Main.immediate)

    fun assertMainDelivery() {
        assertTrue("Real takeout flow must emit", deliveryThreads.isNotEmpty())
        assertTrue("Only test delivery runs on Main", deliveryThreads.all { it })
        println("Compose 1.9 test takeout delivery: ${deliveryThreads.size} real emissions on Main")
    }
}

/** Observe the actual selected takeout projection's SQL thread; do not replace queries or rows. */
internal class CorrectionQueryThreads(private val real: SqlDriver) : SqlDriver by real {
    private val queryThreads = CopyOnWriteArrayList<Boolean>()

    override fun <R> executeQuery(
        identifier: Int?,
        sql: String,
        mapper: (SqlCursor) -> QueryResult<R>,
        parameters: Int,
        binders: (SqlPreparedStatement.() -> Unit)?,
    ): QueryResult<R> {
        if (sql.contains("order_type = 'takeout' AND status IN"))
            queryThreads += Looper.myLooper() == Looper.getMainLooper()
        return real.executeQuery(identifier, sql, mapper, parameters, binders)
    }

    fun assertIoProjection() {
        assertTrue("Actual selected takeout SQL must execute", queryThreads.isNotEmpty())
        assertTrue("Actual takeout SQL/projection remains on IO", queryThreads.none { it })
        println("Compose 1.9 test takeout projection: ${queryThreads.size} actual queries off Main")
    }
}
