package com.pmgt.pos.orders

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.LegacySqlSchema
import kotlinx.coroutines.runBlocking
import org.junit.Test

class OrderQueryPlanTest {
    @Test
    fun existingRowsRetainPhysicalIdentityAndQueryOrderThroughAllWritePaths() = runBlocking {
        OrderRowIdentityContract.verify(
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
        )
    }

    @Test
    fun actualSqliteWritesPlansAndFailurePhases() = runBlocking {
        OrderDatabaseContract.verify(
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
        )
    }
}
