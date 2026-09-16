package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class CheckoutDirectRetryTest {
    @Test fun publicApplyRequiresExactUnfinishedPointerOwnership() = runBlocking { broken(false) }

    @Test fun publicRemoveRequiresExactUnfinishedPointerOwnership() = runBlocking { broken(true) }

    @Test
    fun legitimateAndHistoricalDirectRetriesPreserveLaterAction() = runBlocking {
        for (remove in listOf(false, true)) database { db, fault ->
            CheckoutDirectRetryContract.completedHistoryDoesNotConsumeLaterOwnership(
                db,
                fault,
                remove,
            )
        }
    }

    private suspend fun broken(remove: Boolean) {
        val failures = mutableListOf<String>()
        for (pointer in CheckoutDirectRetryContract.brokenPointers) {
            try {
                database { db, fault ->
                    CheckoutDirectRetryContract.rejectsUnownedExecution(db, fault, remove, pointer)
                }
            } catch (failure: AssertionError) {
                failures += "$pointer: ${failure.message}"
            }
        }
        assertEquals(
            "Every public retry must retain inconsistent pointer evidence",
            emptyList<String>(),
            failures,
        )
    }

    private suspend fun database(block: suspend (PosDatabase, CheckoutFaultDriver) -> Unit) {
        val fault =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(fault).use { block(it, fault) }
    }
}
