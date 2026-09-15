package com.pmgt.pos.catalog

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.pmgt.pos.db.LegacySqlSchema
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CatalogQueryPlanAndroidTest {
    @Test
    fun realAndroidSqliteSelectedGraphAndStoreBounds() = runBlocking {
        val driver =
            AndroidSqliteDriver(
                LegacySqlSchema,
                ApplicationProvider.getApplicationContext<Context>(),
                null,
            )
        CatalogDatabaseContract.verify(driver)
    }
}
