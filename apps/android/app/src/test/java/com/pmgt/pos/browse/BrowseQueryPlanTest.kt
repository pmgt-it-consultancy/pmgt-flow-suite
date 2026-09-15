package com.pmgt.pos.browse

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.LegacySqlSchema
import kotlinx.coroutines.runBlocking
import org.junit.Test

class BrowseQueryPlanTest {
    @Test
    fun realHostSqlitePlansAndRowBounds() = runBlocking {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        LegacySqlSchema.create(driver)
        driver.execute(null, "PRAGMA user_version = 3", 0)
        BrowseDatabaseContract.verify(driver)
    }
}
