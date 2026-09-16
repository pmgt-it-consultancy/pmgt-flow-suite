package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import java.io.File
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CorrectionRecoveryTest {
    @Test
    fun originalParentTableAndCompletionPointerFailuresAreAtomicAcrossReopen() = runBlocking {
        for (stage in listOf("original", "table", "active", "corrected")) {
            val file = File.createTempFile("correction-final-", ".sqlite")
            try {
                CorrectionDatabaseContract.failureAndReopen(
                    {
                        val driver =
                            CheckoutFaultDriver(
                                JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                    LegacySqlSchema.create(it)
                                }
                            )
                        PosDatabase(driver) to driver
                    },
                    { PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")) },
                    if (stage == "original") "orders" else if (stage == "table") "tables" else null,
                    successfulWrites = if (stage == "original") 1 else 0,
                    wholeVoid = stage == "table",
                    pointer = stage,
                )
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun actualSelectedSqlPlansExcludeUnrelatedHistory() = runBlocking {
        val driver =
            com.pmgt.pos.browse.BrowseRecordingDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { CorrectionDatabaseContract.selectedPlans(it, driver) }
    }

    @Test
    fun everyInternalModelFailureRollsBackAndReopensWithSameNumberIdsAndTime() = runBlocking {
        for (table in
            listOf(
                "orders",
                "order_items",
                "order_item_modifiers",
                "order_discounts",
                "order_voids",
                "order_payments",
                "audit_logs",
            )) {
            val file = File.createTempFile("correction-model-", ".sqlite")
            try {
                CorrectionDatabaseContract.failureAndReopen(
                    {
                        val driver =
                            CheckoutFaultDriver(
                                JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                    LegacySqlSchema.create(it)
                                }
                            )
                        PosDatabase(driver) to driver
                    },
                    { PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")) },
                    table,
                )
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun numberAttachmentAndFinalJournalFailuresKeepOriginalModelsAndStableIntent() = runBlocking {
        for (phase in 1..2) {
            val file = File.createTempFile("correction-journal-", ".sqlite")
            try {
                CorrectionDatabaseContract.failureAndReopen(
                    {
                        val driver =
                            CheckoutFaultDriver(
                                JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                                    LegacySqlSchema.create(it)
                                }
                            )
                        PosDatabase(driver) to driver
                    },
                    { PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")) },
                    null,
                    phase,
                )
            } finally {
                file.delete()
            }
        }
    }

    @Test
    fun ackDoesNotHidePendingCorrectionAndCorruptionNeverClearsEvidence() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { CorrectionDatabaseContract.pendingAndCorruption(it, driver) }
    }

    @Test
    fun schedulerLostReturnRetriesCommittedResultAndForeignOwnerCannotResume() = runBlocking {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                val order = CorrectionDatabaseContract.seed(db)
                val owner = CorrectionDatabaseContract.owner
                val selected = CorrectionDatabaseContract.input(db, order)
                val badPush =
                    CorrectionDatabaseContract.repo(db, { error("Lost return after commit") })
                val local =
                    badPush.correct(
                        owner,
                        order,
                        "c",
                        selected,
                        CheckoutApproval(owner, order, "c", "manager"),
                    )
                assertTrue(db.pendingCount() > 0)
                val ids = db.select("order_voids").map { it.string("id") }
                val result =
                    CorrectionDatabaseContract.repo(db)
                        .correct(
                            owner,
                            order,
                            "c",
                            selected,
                            CheckoutApproval(owner, order, "c", "manager"),
                        )
                assertEquals(ids.single(), result.voidId)
                assertEquals(local, result)
                assertEquals(ids, db.select("order_voids").map { it.string("id") })
                assertTrue(
                    runCatching {
                            CorrectionDatabaseContract.repo(db)
                                .resume(owner.copy(userId = "foreign"), order)
                        }
                        .isFailure
                )
            }
    }
}
