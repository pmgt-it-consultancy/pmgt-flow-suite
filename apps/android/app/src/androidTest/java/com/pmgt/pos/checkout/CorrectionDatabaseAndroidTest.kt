package com.pmgt.pos.checkout

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.*
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CorrectionDatabaseAndroidTest {
    @Test
    fun originalParentTableAndCompletionPointerFailuresReopenAtomically() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        for (stage in listOf("original", "table", "active", "corrected")) {
            val name = "correction-final-${UUID.randomUUID()}.db"
            try {
                CorrectionDatabaseContract.failureAndReopen(
                    {
                        val driver =
                            CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, name))
                        PosDatabase(driver) to driver
                    },
                    { PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, name)) },
                    if (stage == "original") "orders" else if (stage == "table") "tables" else null,
                    successfulWrites = if (stage == "original") 1 else 0,
                    wholeVoid = stage == "table",
                    pointer = stage,
                )
            } finally {
                context.deleteDatabase(name)
            }
        }
    }

    @Test
    fun concurrentSyncCannotSnapshotPartiallyConstructedCorrection() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val driver = CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, null))
        PosDatabase(driver).use { CorrectionSyncContract.concurrentFirstPush(it, driver) }
    }

    @Test
    fun everyCorrectionModelAndNumberJournalFailureReopensWithoutPartialModels() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        for ((table, phase) in
            listOf(
                    "orders",
                    "order_items",
                    "order_item_modifiers",
                    "order_discounts",
                    "order_voids",
                    "order_payments",
                    "audit_logs",
                )
                .map { it to null } + listOf(null to 1, null to 2)) {
            val name = "correction-${UUID.randomUUID()}.db"
            try {
                CorrectionDatabaseContract.failureAndReopen(
                    {
                        val driver =
                            CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, name))
                        PosDatabase(driver) to driver
                    },
                    { PosDatabase(AndroidSqliteDriver(LegacySqlSchema, context, name)) },
                    table,
                    phase,
                )
            } finally {
                context.deleteDatabase(name)
            }
        }
    }

    @Test
    fun selectedCorrectionSqlPlansExcludeUnrelatedHistory() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val driver =
            com.pmgt.pos.browse.BrowseRecordingDriver(
                AndroidSqliteDriver(LegacySqlSchema, context, null)
            )
        PosDatabase(driver).use { CorrectionDatabaseContract.selectedPlans(it, driver) }
    }

    @Test
    fun acknowledgementAndCorruptionRetainPendingSafetyEvidence() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val driver = CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, null))
        PosDatabase(driver).use { CorrectionDatabaseContract.pendingAndCorruption(it, driver) }
    }
}
