package com.pmgt.pos.closing

import com.pmgt.pos.checkout.CheckoutRepository
import com.pmgt.pos.checkout.PendingFinancialAction
import com.pmgt.pos.printer.PrinterCall
import com.pmgt.pos.sync.SyncOutcome
import com.pmgt.pos.telemetry.Telemetry
import java.time.LocalDateTime
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class ClosingController(
    private val repository: ClosingRepository,
    private val checkoutRepository: CheckoutRepository,
    private val syncForDelivery: suspend () -> SyncOutcome,
    private val printCalls: suspend (List<PrinterCall>) -> Unit,
    private val charsPerLine: () -> Int,
    private val online: StateFlow<Boolean>,
    private val scope: CoroutineScope,
    private val sessionIsCurrent: () -> Boolean,
    private val printedAt: () -> LocalDateTime = LocalDateTime::now,
) {
    private val mutableState = MutableStateFlow(ClosingState())
    val state: StateFlow<ClosingState> = mutableState.asStateFlow()
    private var epoch = 0L
    private var operationJob: Job? = null
    private var pendingJob: Job? = null

    fun bind(storeId: String) {
        require(storeId.isNotBlank())
        epoch++
        operationJob?.cancel()
        pendingJob?.cancel()
        val session = epoch
        mutableState.value =
            ClosingState(storeId = storeId, loading = true, operation = ClosingOperation.Refreshing)
        pendingJob =
            scope.launch {
                checkoutRepository.pendingActions(storeId)
                    .catch { error ->
                        if (storeCurrent(storeId)) update {
                            it.copy(pendingReadError = error.message ?: "Local financial readiness failed")
                        }
                    }
                    .collect { actions ->
                        if (storeCurrent(storeId)) update {
                            it.copy(pendingFinancialActions = actions, pendingReadError = null)
                        }
                    }
            }
        operationJob =
            scope.launch {
                try {
                    val date = repository.currentBusinessDate(storeId)
                    val store = repository.getStore(storeId)
                    if (!current(session, storeId)) return@launch
                    update { it.copy(todayBusinessDate = date, selectedDate = date, store = store) }
                    loadSelection(Key(session, storeId, date, null, null))
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    if (current(session, storeId)) {
                        finish(
                            ClosingNotice("Error", error.message ?: "Failed to load closing data."),
                            error.message ?: "Closing readiness failed",
                        )
                    }
                } finally {
                    if (current(session, storeId) && state.value.operation != null) finish()
                }
            }
    }

    fun selectDate(date: String) {
        runCatching { java.time.LocalDate.parse(date) }
            .getOrElse { throw IllegalArgumentException("Invalid report date", it) }
        val storeId = state.value.storeId ?: return
        epoch++
        operationJob?.cancel()
        val session = epoch
        update {
            it.copy(
                selectedDate = date,
                report = null,
                productSales = emptyList(),
                paymentTransactions = emptyList(),
                attention = ClosingAttention(),
                readinessError = "Closing readiness has not loaded",
                notice = null,
                finalized = false,
                loading = true,
                operation = ClosingOperation.Refreshing,
            )
        }
        val key = Key(session, storeId, date, state.value.startTime, state.value.endTime)
        operationJob = scope.launchOperation(key) { loadSelection(it) }
    }

    fun setRange(startTime: String?, endTime: String?) {
        require((startTime == null) == (endTime == null))
        startTime?.let(::requireTime)
        endTime?.let(::requireTime)
        epoch++
        operationJob?.cancel()
        update {
            it.copy(
                startTime = startTime,
                endTime = endTime,
                operation = null,
                loading = false,
                notice = null,
                finalized = false,
            )
        }
    }

    fun useCustomRange() {
        val snapshot = state.value
        val slot = snapshot.selectedDate?.let { snapshot.store?.schedule?.slot(it) }
        setRange(slot?.open ?: "06:00", slot?.close ?: "22:00")
    }

    fun useFullDay() = setRange(null, null)

    fun consumeNotice() {
        update { it.copy(notice = null) }
    }

    fun refresh() {
        val key = key() ?: return
        launch(ClosingOperation.Refreshing, key) { loadSelection(it) }
    }

    fun generate() {
        val key = key() ?: return
        if (state.value.operation != null) return
        update { it.copy(finalized = false) }
        launch(ClosingOperation.Generating, key) { operationKey ->
            var generated = false
            try {
                readyAfterDelivery(operationKey)
                repository.generate(operationKey.storeId, operationKey.date, operationKey.start, operationKey.end)
                generated = true
                checkCurrent(operationKey)
                readinessEvidence(operationKey)
                repository.close(operationKey.storeId, operationKey.date)
                checkCurrent(operationKey)
                update { it.copy(finalized = true, notice = null) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (blocked: ClosingBlocked) {
                notice("Closing blocked", blocked.message ?: "Closing is not ready.")
            } catch (error: Exception) {
                notice(
                    if (generated) "Report not finalized" else "Error",
                    if (generated) error.message ?: "Failed to finalize closing." else "Failed to generate report.",
                )
            } finally {
                if (generated && isCurrent(operationKey)) {
                    try {
                        loadSelection(operationKey)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        update { it.copy(readinessError = error.message ?: "Closing readiness failed") }
                    }
                }
            }
        }
    }

    fun retry(jobId: String) {
        val key = key() ?: return
        if (state.value.attention.jobs.none { it.jobId == jobId }) {
            notice("Retry unavailable", "This reconciliation job is no longer in the selected closing state.")
            return
        }
        launch(ClosingOperation.Retrying, key) { operationKey ->
            try {
                repository.retry(jobId)
                checkCurrent(operationKey)
                val attention = repository.getAttention(operationKey.storeId, operationKey.date)
                checkCurrent(operationKey)
                update { it.copy(attention = attention, readinessError = null, notice = null) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                notice("Retry failed", error.message ?: "Failed to retry reconciliation.")
            }
        }
    }

    fun print() {
        val key = key() ?: return
        launch(ClosingOperation.Syncing, key) { operationKey ->
            try {
                readyAfterDelivery(operationKey)
                val before =
                    repository.getReport(operationKey.storeId, operationKey.date)
                        ?: throw ClosingBlocked("No report data for this date. Tap refresh to generate.")
                if (before.startTime != operationKey.start || before.endTime != operationKey.end) {
                    throw RangeMismatch()
                }
                val products = repository.getProductSales(operationKey.storeId, operationKey.date)
                val payments = repository.getPaymentTransactions(operationKey.storeId, operationKey.date)
                val after = repository.getReport(operationKey.storeId, operationKey.date) ?: throw SnapshotChanged()
                if (
                    before.id != after.id || before.generatedAt != after.generatedAt ||
                        before.startTime != after.startTime || before.endTime != after.endTime
                ) throw SnapshotChanged()
                checkCurrent(operationKey)
                update { it.copy(operation = ClosingOperation.Printing) }
                val store = state.value.store ?: throw ClosingBlocked("Store is unavailable.")
                val address =
                    listOfNotNull(
                        store.address1.takeIf(String::isNotBlank),
                        store.address2?.takeIf(String::isNotBlank),
                    ).joinToString(", ").ifBlank { null }
                printCalls(
                    ZReportFormatter.format(
                        ZReportDocument(
                            store.name,
                            address,
                            store.tin.takeIf(String::isNotBlank),
                            after,
                            products,
                            payments,
                            printedAt(),
                        ),
                        charsPerLine(),
                    )
                )
                checkCurrent(operationKey)
                Telemetry.event("z_report_printed")
                update {
                    it.copy(
                        report = after,
                        productSales = products,
                        paymentTransactions = payments,
                        notice = ClosingNotice("Success", "Z-Report printed successfully."),
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: RangeMismatch) {
                notice("Print unavailable", "Generate report for this time range first")
            } catch (_: SnapshotChanged) {
                notice("Print unavailable", "Report changed while preparing the print. Refresh and try again.")
            } catch (blocked: ClosingBlocked) {
                notice("Closing blocked", blocked.message ?: "Closing is not ready.")
            } catch (_: Exception) {
                notice("Error", "Failed to print Z-Report. Check printer connection.")
            }
        }
    }

    fun dispose() {
        epoch++
        operationJob?.cancel()
        pendingJob?.cancel()
    }

    private suspend fun readyAfterDelivery(key: Key) {
        checkCurrent(key)
        if (!online.value) throw ClosingBlocked("Connect to WiFi to close the day.")
        when (val outcome = syncForDelivery()) {
            is SyncOutcome.Delivered -> Unit
            is SyncOutcome.Pending -> throw ClosingBlocked("${outcome.count} local change(s) are still pending")
            is SyncOutcome.Offline -> throw ClosingBlocked("Sync did not reach the server")
            is SyncOutcome.Backoff -> throw ClosingBlocked("Sync did not reach the server")
            is SyncOutcome.Failed -> throw ClosingBlocked(outcome.message)
        }
        checkCurrent(key)
        readinessEvidence(key)
    }

    private suspend fun readinessEvidence(key: Key) {
        val local: List<PendingFinancialAction> =
            try {
                checkoutRepository.pendingActions(key.storeId).first()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                throw ClosingBlocked(error.message ?: "Local financial readiness failed")
            }
        checkCurrent(key)
        update { it.copy(pendingFinancialActions = local, pendingReadError = null) }
        if (local.isNotEmpty()) {
            throw ClosingBlocked("${local.size} local financial action(s) still require attention")
        }
        val attention = repository.getAttention(key.storeId, key.date)
        checkCurrent(key)
        update { it.copy(attention = attention, readinessError = null) }
        if (attention.jobs.isNotEmpty()) throw ClosingBlocked("Totals reconciliation requires attention")
        if (attention.divergences.isNotEmpty()) {
            throw ClosingBlocked("Unresolved totals divergence requires attention")
        }
    }

    private suspend fun loadSelection(key: Key) {
        val report = repository.getReport(key.storeId, key.date)
        val products = repository.getProductSales(key.storeId, key.date)
        val payments = repository.getPaymentTransactions(key.storeId, key.date)
        val attention = repository.getAttention(key.storeId, key.date)
        checkCurrent(key)
        update {
            it.copy(
                report = report,
                productSales = products,
                paymentTransactions = payments,
                attention = attention,
                readinessError = null,
            )
        }
    }

    private fun launch(operation: ClosingOperation, key: Key, block: suspend (Key) -> Unit) {
        if (state.value.operation != null) return
        update { it.copy(operation = operation, loading = operation == ClosingOperation.Refreshing, notice = null) }
        operationJob = scope.launchOperation(key, block)
    }

    private fun CoroutineScope.launchOperation(key: Key, block: suspend (Key) -> Unit): Job =
        launch {
            try {
                block(key)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (isCurrent(key)) notice("Error", error.message ?: "Closing operation failed.")
            } finally {
                if (isCurrent(key)) finish()
            }
        }

    private fun key(): Key? {
        val snapshot = state.value
        return Key(
            epoch,
            snapshot.storeId ?: return null,
            snapshot.selectedDate ?: return null,
            snapshot.startTime,
            snapshot.endTime,
        )
    }

    private fun current(session: Long, storeId: String) =
        sessionIsCurrent() && epoch == session && state.value.storeId == storeId

    private fun storeCurrent(storeId: String) = sessionIsCurrent() && state.value.storeId == storeId
    private fun isCurrent(key: Key) =
        current(key.epoch, key.storeId) && state.value.selectedDate == key.date &&
            state.value.startTime == key.start && state.value.endTime == key.end

    private fun checkCurrent(key: Key) {
        if (!isCurrent(key)) throw CancellationException("Closing selection changed")
    }

    private fun finish(
        notice: ClosingNotice? = state.value.notice,
        readinessError: String? = state.value.readinessError,
    ) {
        update { it.copy(operation = null, loading = false, notice = notice, readinessError = readinessError) }
    }

    private fun notice(title: String, message: String) {
        update { it.copy(notice = ClosingNotice(title, message)) }
    }

    private inline fun update(transform: (ClosingState) -> ClosingState) {
        mutableState.value = transform(mutableState.value)
    }

    private data class Key(
        val epoch: Long,
        val storeId: String,
        val date: String,
        val start: String?,
        val end: String?,
    )

    private class ClosingBlocked(message: String) : IllegalStateException(message)
    private class RangeMismatch : IllegalStateException()
    private class SnapshotChanged : IllegalStateException()
}

private fun requireTime(value: String) {
    require(Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(value)) { "Invalid closing time" }
}
