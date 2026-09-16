package com.pmgt.pos.checkout

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CheckoutDatabaseAndroidTest {
    @Test
    fun v2JournalExecutionTimesAndDeletionPurgeSurviveAndroidDatabaseReopen() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        for (discount in listOf(false, true)) {
            val name = "synthetic-checkout-v2-${java.util.UUID.randomUUID()}.sqlite"
            try {
                val open = {
                    val fault =
                        CheckoutFaultDriver(AndroidSqliteDriver(LegacySqlSchema, context, name))
                    PosDatabase(fault) to fault
                }
                if (discount) CheckoutJournalReviewContract.discountInsertAndPurgedRemoval(open)
                else CheckoutJournalReviewContract.firstExecutionAcrossCloseReopen(open)
            } finally {
                context.deleteDatabase(name)
            }
        }
    }

    @Test
    fun v2MalformedCanonicalPlanCannotSettleAndroidOrder() = runBlocking {
        val fault =
            CheckoutFaultDriver(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
        PosDatabase(fault).use {
            CheckoutJournalReviewContract.corruptedPlanRetainsAllEvidence(it, fault)
        }
    }

    @Test
    fun actualAndroidCheckoutSelectedQueryPlansWithForeignVolume() = runBlocking {
        val recording =
            com.pmgt.pos.browse.BrowseRecordingDriver(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
        PosDatabase(recording).use { CheckoutDatabaseContract.selectedQueryPlans(it, recording) }
    }

    @Test
    fun actualAndroidDiscountAndSettlementContract() = runBlocking {
        PosDatabase(
                AndroidSqliteDriver(
                    LegacySqlSchema,
                    ApplicationProvider.getApplicationContext<Context>(),
                    null,
                )
            )
            .use { CheckoutDatabaseContract.run(it) }
    }
}
