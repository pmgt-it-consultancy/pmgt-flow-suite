package com.pmgt.pos.browse

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn

/**
 * Compose test-only delivery handoff.
 *
 * `ComposeTestRule` drives recomposition with `TestMonotonicFrameClock`, which performs a frame on
 * whichever thread resumes it. The real repository emits from `Dispatchers.IO`, so a recomposition
 * triggered directly by one of its emissions composes off the main thread. Anything that then needs
 * a Looper or the main thread fails, which is what the two full-run Android failures were:
 *
 * - `LazyColumn` → `AndroidPrefetchScheduler` → `Choreographer.getInstance()`
 *   → `IllegalStateException: The current thread must have a looper!`
 * - `BackHandler` → `OnBackPressedDispatcher.addCallback` → `LifecycleRegistry.addObserver`
 *   → `IllegalStateException: Method addObserver must be called on the main thread`
 *
 * Production is unaffected: there the frame clock is the Choreographer and always runs on Main.
 *
 * Only the delivery context moves. The wrapped repository still runs its queries and projection on
 * IO, no rows are faked or replaced, and no assertion or timeout is relaxed.
 */
internal class MainDeliveryBrowseRepository(private val real: BrowseRepository) :
    BrowseRepository by real {
    override fun activeOrders(storeId: String) = real.activeOrders(storeId).deliverOnMain()

    override fun tables(storeId: String) = real.tables(storeId).deliverOnMain()

    override fun takeout(storeId: String, range: DayRange) =
        real.takeout(storeId, range).deliverOnMain()

    override fun history(storeId: String, filter: HistoryFilter) =
        real.history(storeId, filter).deliverOnMain()

    override fun detail(storeId: String, orderId: String) =
        real.detail(storeId, orderId).deliverOnMain()
}

private fun <T> Flow<T>.deliverOnMain(): Flow<T> =
    flow { collect { emit(it) } }.flowOn(Dispatchers.Main.immediate)
