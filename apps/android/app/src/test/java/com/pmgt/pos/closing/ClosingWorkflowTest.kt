package com.pmgt.pos.closing

import com.pmgt.pos.checkout.*
import com.pmgt.pos.orders.*
import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.sync.SyncOutcome
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ClosingWorkflowTest {
    @Test
    fun `server business date initializes an after-midnight session and schedule supplies custom defaults`() =
        runTest {
            val repository = FakeClosingRepository().apply {
                businessDate = "2026-09-15"
                store = closingStore(tuesday = ScheduleSlot("18:00", "03:00"))
            }
            val controller = controller(repository = repository)

            controller.bind("store")
            controller.awaitIdle()
            assertEquals("2026-09-15", controller.state.value.todayBusinessDate)
            assertEquals("2026-09-15", controller.state.value.selectedDate)

            controller.useCustomRange()
            assertEquals("18:00", controller.state.value.startTime)
            assertEquals("03:00", controller.state.value.endTime)
            assertTrue(controller.state.value.crossesMidnight)
        }

    @Test
    fun `date change cancels stale report publication while preserving selected custom times`() = runTest {
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val repository = FakeClosingRepository().apply {
            businessDate = "2026-09-16"
            reportLoader = { _, date ->
                if (date == "2026-09-16") {
                    firstStarted.complete(Unit)
                    releaseFirst.await()
                    report(id = "old", date = date)
                } else report(id = "new", date = date)
            }
        }
        val controller = controller(repository = repository)

        controller.bind("store")
        firstStarted.await()
        controller.setRange("18:00", "03:00")
        controller.selectDate("2026-09-15")
        releaseFirst.complete(Unit)
        controller.awaitIdle()

        assertEquals("2026-09-15", controller.state.value.selectedDate)
        assertEquals("18:00", controller.state.value.startTime)
        assertEquals("03:00", controller.state.value.endTime)
        assertEquals("new", controller.state.value.report?.id)
    }

    @Test
    fun `store rebind cancels the prior store load and cannot publish its report`() = runTest {
        val oldStarted = CompletableDeferred<Unit>()
        val releaseOld = CompletableDeferred<Unit>()
        val repository = FakeClosingRepository().apply {
            reportLoader = { storeId, date ->
                if (storeId == "old-store") {
                    oldStarted.complete(Unit)
                    releaseOld.await()
                    report(id = "old", date = date)
                } else report(id = "new", date = date)
            }
        }
        val controller = controller(repository = repository)
        controller.bind("old-store")
        oldStarted.await()
        controller.bind("new-store")
        releaseOld.complete(Unit)
        controller.awaitIdle()

        assertEquals("new-store", controller.state.value.storeId)
        assertEquals("new", controller.state.value.report?.id)
    }

    @Test
    fun `post-delivery local financial action blocks generation even with an empty sync queue`() = runTest {
        val pending = MutableStateFlow<List<PendingFinancialAction>>(emptyList())
        val checkout = FakeCheckoutRepository(pending)
        val repository = FakeClosingRepository()
        var delivered = 0
        val controller =
            controller(repository, checkout, delivery = {
                delivered++
                pending.value =
                    listOf(PendingFinancialAction("order", "payment", FinancialActionState.Recoverable))
                SyncOutcome.Delivered(1)
            })

        controller.bind("store")
        controller.awaitIdle()
        controller.generate()
        controller.awaitIdle()

        assertEquals(1, delivered)
        assertEquals(0, repository.generateCalls)
        assertEquals("Closing blocked", controller.state.value.notice?.title)
        assertTrue(controller.state.value.notice?.message.orEmpty().contains("financial action"))
    }

    @Test
    fun `offline closing is blocked before delivery or server generation`() = runTest {
        var deliveries = 0
        val repository = FakeClosingRepository()
        val controller = controller(
            repository = repository,
            online = MutableStateFlow(false),
            delivery = { deliveries++; SyncOutcome.Delivered(1) },
        )
        controller.bind("store")
        controller.awaitIdle()
        val initialLoads = repository.printSnapshotLoads

        controller.generate()
        controller.awaitIdle()

        assertEquals(0, deliveries)
        assertEquals(0, repository.generateCalls)
        assertEquals(initialLoads, repository.printSnapshotLoads)
        assertTrue(controller.state.value.notice?.message.orEmpty().contains("WiFi"))
    }

    @Test
    fun `pending failed and divergent reconciliation evidence blocks close and retry stays attributable`() =
        runTest {
            val repository = FakeClosingRepository().apply {
                attention =
                    ClosingAttention(
                        jobs =
                            listOf(
                                ReconciliationJob("job-p", "order-p", "mutation-p", ReconciliationStatus.Pending),
                                ReconciliationJob("job-f", "order-f", "mutation-f", ReconciliationStatus.Failed, "scheduler failed"),
                            ),
                        divergences =
                            listOf(
                                TotalsDivergence(
                                    "order-d",
                                    mapOf("netSales" to 100.0),
                                    mapOf("netSales" to 90.0),
                                    listOf("netSales"),
                                )
                            ),
                    )
            }
            val controller = controller(repository)
            controller.bind("store")
            controller.awaitIdle()

            controller.generate()
            controller.awaitIdle()
            assertEquals(0, repository.generateCalls)
            assertFalse(controller.state.value.canFinalize)

            controller.retry("job-f")
            controller.awaitIdle()
            assertEquals(listOf("job-f"), repository.retriedJobs)
        }

    @Test
    fun `generation followed by closing rejection never reports finalized success and refreshes server report`() =
        runTest {
            val repository = FakeClosingRepository().apply {
                reportLoader = { _, _ -> report(id = if (generateCalls == 0) "before" else "generated") }
                closeFailure = IllegalStateException("Totals Reconciliation pending")
            }
            val controller = controller(repository)
            controller.bind("store")
            controller.awaitIdle()

            controller.generate()
            controller.awaitIdle()

            assertEquals(1, repository.generateCalls)
            assertEquals(1, repository.closeCalls)
            assertEquals("generated", controller.state.value.report?.id)
            assertEquals("Report not finalized", controller.state.value.notice?.title)
            assertFalse(controller.state.value.finalized)
        }

    @Test
    fun `print refetches after delivery and rejects a mismatched range without printer output`() = runTest {
        val repository = FakeClosingRepository().apply {
            reportLoader = { _, _ -> report(id = "report", startTime = null, endTime = null) }
        }
        val printed = mutableListOf<List<PrinterCall>>()
        val controller = controller(repository = repository, printer = { printed += it })
        controller.bind("store")
        controller.awaitIdle()
        controller.setRange("18:00", "03:00")

        controller.print()
        controller.awaitIdle()

        assertTrue(printed.isEmpty())
        assertEquals("Generate report for this time range first", controller.state.value.notice?.message)
    }

    @Test
    fun `print rejects a torn three-query snapshot when report metadata changes`() = runTest {
        var reportRead = 0
        val repository = FakeClosingRepository().apply {
            reportLoader = { _, _ ->
                reportRead++
                report(id = "report", generatedAt = if (reportRead < 3) 10 else 11)
            }
        }
        val printed = mutableListOf<List<PrinterCall>>()
        val controller = controller(repository = repository, printer = { printed += it })
        controller.bind("store")
        controller.awaitIdle()

        controller.print()
        controller.awaitIdle()

        assertTrue(printed.isEmpty())
        assertEquals("Report changed while preparing the print. Refresh and try again.", controller.state.value.notice?.message)
    }

    @Test
    fun `printer failure preserves authoritative report and reports no success`() = runTest {
        val immutable = report(id = "immutable", grossSales = 1234.56)
        val repository = FakeClosingRepository().apply { reportLoader = { _, _ -> immutable } }
        val controller =
            controller(repository = repository, printer = { throw IllegalStateException("transport") })
        controller.bind("store")
        controller.awaitIdle()

        controller.print()
        controller.awaitIdle()

        assertSame(immutable, controller.state.value.report)
        assertEquals(1234.56, controller.state.value.report?.grossSales ?: 0.0, 0.0)
        assertEquals("Failed to print Z-Report. Check printer connection.", controller.state.value.notice?.message)
    }

    @Test
    fun `generate and print are one serialized flight`() = runTest {
        val deliveryEntered = CompletableDeferred<Unit>()
        val releaseDelivery = CompletableDeferred<Unit>()
        var deliveries = 0
        val repository = FakeClosingRepository()
        val controller =
            controller(repository = repository, delivery = {
                deliveries++
                deliveryEntered.complete(Unit)
                releaseDelivery.await()
                SyncOutcome.Delivered(1)
            })
        controller.bind("store")
        controller.awaitIdle()
        val initialSelectionLoads = repository.printSnapshotLoads

        controller.generate()
        deliveryEntered.await()
        controller.print()
        releaseDelivery.complete(Unit)
        controller.awaitIdle()

        assertEquals(1, deliveries)
        assertEquals(1, repository.generateCalls)
        assertEquals(initialSelectionLoads + 1, repository.printSnapshotLoads)
    }

    @Test
    fun `cancellation during the local readiness read is never a blocked closing`() = runTest {
        // Every other suspend catch in the controller rethrows cancellation; this read must too,
        // or disposing the screen mid-check reports a spurious closing block to the next session.
        val readinessRead = CompletableDeferred<Unit>()
        var collections = 0
        val checkout =
            FakeCheckoutRepository(
                pending =
                    flow {
                        collections++
                        // The first collection is bind's continuous subscription. The second is the
                        // readiness check, which is cancelled mid-read as dispose or a rebind does.
                        if (collections > 1) {
                            readinessRead.complete(Unit)
                            throw CancellationException("closing disposed")
                        }
                        emit(emptyList())
                        awaitCancellation()
                    }
            )
        val controller = controller(checkout = checkout)
        controller.bind("store")
        controller.awaitIdle()

        controller.generate()
        withTimeout(5_000) { readinessRead.await() }
        withTimeout(5_000) { controller.state.filter { it.operation == null }.first() }

        // A converted cancellation surfaces as a Closing blocked notice; a rethrown one does not.
        assertNull(controller.state.value.notice)
    }

    private fun TestScope.controller(
        repository: FakeClosingRepository = FakeClosingRepository(),
        checkout: CheckoutRepository = FakeCheckoutRepository(),
        delivery: suspend () -> SyncOutcome = { SyncOutcome.Delivered(1) },
        printer: suspend (List<PrinterCall>) -> Unit = {},
        online: MutableStateFlow<Boolean> = MutableStateFlow(true),
    ) =
        ClosingController(
            repository = repository,
            checkoutRepository = checkout,
            syncForDelivery = delivery,
            printCalls = printer,
            charsPerLine = { 32 },
            online = online,
            scope = backgroundScope,
            sessionIsCurrent = { true },
            printedAt = { java.time.LocalDateTime.of(2026, 9, 16, 16, 4, 5) },
        )
}

private class FakeClosingRepository : ClosingRepository {
    var businessDate = "2026-09-16"
    var store = closingStore()
    var attention = ClosingAttention()
    var reportLoader: suspend (String, String) -> DailyClosingReport? = { _, date -> report(date = date) }
    var closeFailure: Throwable? = null
    var generateCalls = 0
    var closeCalls = 0
    var printSnapshotLoads = 0
    val retriedJobs = mutableListOf<String>()

    override suspend fun currentBusinessDate(storeId: String) = businessDate
    override suspend fun getStore(storeId: String) = store
    override suspend fun getReport(storeId: String, reportDate: String) = reportLoader(storeId, reportDate)
    override suspend fun getProductSales(storeId: String, reportDate: String): List<ProductSale> {
        printSnapshotLoads++
        return emptyList()
    }
    override suspend fun getPaymentTransactions(storeId: String, reportDate: String) = emptyList<PaymentTransactionGroup>()
    override suspend fun getAttention(storeId: String, reportDate: String) = attention
    override suspend fun generate(storeId: String, reportDate: String, startTime: String?, endTime: String?) { generateCalls++ }
    override suspend fun close(storeId: String, reportDate: String) { closeCalls++; closeFailure?.let { throw it } }
    override suspend fun retry(jobId: String) { retriedJobs += jobId }
}

private class FakeCheckoutRepository(
    private val pending: Flow<List<PendingFinancialAction>> = flowOf(emptyList()),
) : CheckoutRepository {
    override fun pendingActions(storeId: String) = pending
    override suspend fun recoverablePayment(owner: CheckoutOwner, orderId: String): CheckoutRoute? = null
    override fun observe(owner: CheckoutOwner, orderId: String): Flow<CheckoutView?> = flowOf(null)
    override suspend fun settle(owner: CheckoutOwner, route: CheckoutRoute, lines: List<PaymentLine>, cashierName: String): CompletedCheckout = error("unused")
    override suspend fun resume(owner: CheckoutOwner, orderId: String): CompletedCheckout? = null
    override suspend fun refreshTotals(owner: CheckoutOwner, orderId: String) = Unit
    override suspend fun apply(owner: CheckoutOwner, orderId: String, actionId: String, input: DiscountInput, approval: CheckoutApproval) = Unit
    override suspend fun remove(owner: CheckoutOwner, orderId: String, actionId: String, discountId: String, approval: CheckoutApproval) = Unit
}

private fun closingStore(tuesday: ScheduleSlot = ScheduleSlot("06:00", "22:00")) =
    ClosingStore(
        id = "store",
        name = "Synthetic Eatery",
        address1 = "123 Fixture Road",
        address2 = null,
        tin = "000-000-000-000",
        schedule = StoreSchedule(tuesday = tuesday),
    )

private fun report(
    id: String = "report",
    date: String = "2026-09-16",
    startTime: String? = null,
    endTime: String? = null,
    generatedAt: Long = 10,
    grossSales: Double = 100.0,
) =
    DailyClosingReport(
        id = id,
        reportDate = date,
        startTime = startTime,
        endTime = endTime,
        grossSales = grossSales,
        vatableSales = 80.0,
        vatAmount = 9.6,
        vatExemptSales = 10.0,
        nonVatSales = 0.0,
        netSales = 90.0,
        seniorDiscounts = 5.0,
        pwdDiscounts = 0.0,
        promoDiscounts = 5.0,
        manualDiscounts = 0.0,
        totalDiscounts = 10.0,
        voidCount = 0,
        voidAmount = 0.0,
        cashTotal = 50.0,
        cardEwalletTotal = 40.0,
        transactionCount = 2,
        averageTicket = 45.0,
        generatedAt = generatedAt,
        generatedByName = "Manager",
        isPrinted = false,
        printedAt = null,
    )

private suspend fun ClosingController.awaitIdle() =
    withTimeout(5_000) {
        state.filter {
            !it.loading && it.operation == null && it.selectedDate != null && it.pendingReadError == null
        }.first()
    }
