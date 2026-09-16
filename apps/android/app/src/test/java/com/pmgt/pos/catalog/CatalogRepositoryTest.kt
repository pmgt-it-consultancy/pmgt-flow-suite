package com.pmgt.pos.catalog

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.*
import org.junit.Test

class CatalogRepositoryTest {
    private fun driver() =
        JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }

    @Test
    fun realSqliteSelectedGraphAndStoreBounds() = runBlocking {
        CatalogDatabaseContract.verify(driver())
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun metadataRefreshDoesNotEmitAndCancellationStopsObservation() = runTest {
        val db = PosDatabase(driver())
        CatalogDatabaseContract.seed(db)
        val repo = LocalCatalogRepository(db, StandardTestDispatcher(testScheduler))
        val menus = mutableListOf<Catalog>()
        val groups = mutableListOf<List<ModifierGroup>?>()
        val menuJob = launch { repo.catalog("s").toList(menus) }
        val groupJob = launch { repo.modifiers("s", "p").toList(groups) }
        runCurrent()
        assertEquals(1, menus.size)
        assertEquals(1, groups.size)
        db.applyRemote(
            "products",
            emptyList(),
            listOf(
                JsonObject(
                    db.get("products", "p")!! +
                        row("p", "updated_at" to 777, "server_id" to "remote")
                )
            ),
            emptyList(),
        )
        db.updateLocal(
            "modifier_options",
            "large",
            JsonObject(row("large", "updated_at" to 777) - "id"),
        )
        runCurrent()
        assertEquals(1, menus.size)
        assertEquals(1, groups.size)
        db.updateLocal(
            "modifier_options",
            "large",
            JsonObject(row("large", "price_adjustment" to 30) - "id"),
        )
        runCurrent()
        assertEquals(3, groups.size)
        assertNull(groups[1])
        assertEquals(30.0, groups[2]!!.last().options.last().priceAdjustment, 0.0)
        assertEquals(1, menus.size)
        groupJob.cancelAndJoin()
        menuJob.cancelAndJoin()
        db.updateLocal("products", "p", JsonObject(row("p", "name" to "Changed") - "id"))
        runCurrent()
        assertEquals(1, menus.size)
        assertEquals("Changed", repo.catalog("s").first().products.first().name)
        db.close()
    }
}
