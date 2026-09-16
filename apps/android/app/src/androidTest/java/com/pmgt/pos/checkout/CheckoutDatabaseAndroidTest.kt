package com.pmgt.pos.checkout

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.*
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CheckoutDatabaseAndroidTest {
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
