package com.pmgt.pos.orders

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.LegacySqlSchema
import kotlinx.coroutines.runBlocking
import org.junit.Test

class OrderQueryPlanAndroidTest {
    @Test
    fun existingRowsRetainPhysicalIdentityAndQueryOrderThroughAllWritePaths() = runBlocking {
        OrderRowIdentityContract.verify(
            AndroidSqliteDriver(
                LegacySqlSchema,
                ApplicationProvider.getApplicationContext<Context>(),
                null,
            )
        )
    }

    @Test
    fun actualAndroidSqliteWritesPlansAndFailurePhases() = runBlocking {
        OrderDatabaseContract.verify(
            AndroidSqliteDriver(
                LegacySqlSchema,
                ApplicationProvider.getApplicationContext<Context>(),
                null,
            )
        )
    }
}
