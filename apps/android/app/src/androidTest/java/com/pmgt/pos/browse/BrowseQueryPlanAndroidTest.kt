package com.pmgt.pos.browse

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.LegacySqlSchema
import kotlinx.coroutines.runBlocking
import org.junit.Test

class BrowseQueryPlanAndroidTest {
    @Test
    fun realAndroidSqlitePlansAndRowBounds() = runBlocking {
        val driver =
            AndroidSqliteDriver(
                LegacySqlSchema,
                ApplicationProvider.getApplicationContext<Context>(),
                null,
            )
        BrowseDatabaseContract.verify(driver)
    }
}
