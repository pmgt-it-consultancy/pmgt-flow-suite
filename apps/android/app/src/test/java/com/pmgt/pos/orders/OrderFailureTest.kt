package com.pmgt.pos.orders

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.*
import com.pmgt.pos.db.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OrderFailureTest {
    @Test
    fun leavingKnownFirstSendFailureFinishesExistingAggregateBeforeReentry() = runTest {
        val faults =
            OrderFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(faults).use { db ->
            seed(db)
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val session =
                OrderEditorSession(EditorRoute("s", "t", "Table 1"), repo, backgroundScope) {}
            session.add(choice)
            faults.successfulOrderWritesBeforeFailure = 1
            assertTrue(runCatching { session.send(2.0) }.isFailure)
            assertTrue(session.state.value.needsRecalculation)
            session.leave()
            assertEquals(280.0, db.select("orders").single().number("net_sales"), 0.0)
            assertFalse(session.state.value.needsRecalculation)
            assertEquals(1, db.select("order_items").size)
            assertEquals("1", db.select("app_config").single().string("value"))
        }
    }

    @Test
    fun failedCancellationTablePhaseRetainsExactVoidAndDoesNotRemintOnRetryOrReentry() = runTest {
        val faults =
            OrderFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(faults).use { db ->
            seed(db)
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val id = repo.createOrder(NewOrder("s", tableId = "t"))
            val session =
                OrderEditorSession(EditorRoute("s", "t", "Table 1", id), repo, backgroundScope) {}
            session.add(choice)
            session.loaded(repo.cart("s", id).first())
            faults.failNextTableWrite = true
            assertTrue(runCatching { session.discard() }.isFailure)
            val voidId = db.select("order_voids").single().string("id")!!
            faults.failNextTableWrite = true
            assertTrue(runCatching { session.discard() }.isFailure)
            assertEquals(voidId, db.select("order_voids").single().string("id"))
            session.discard()
            assertEquals(voidId, db.select("order_voids").single().string("id"))
            assertEquals("available", db.get("tables", "t")!!.string("status"))
            val reentry =
                OrderEditorSession(EditorRoute("s", "t", "Table 1", id), repo, backgroundScope) {}
            reentry.loaded(repo.cart("s", id).first())
            assertTrue(runCatching { reentry.discard() }.isFailure)
            assertEquals(1, db.select("order_voids").size)
        }
    }

    @Test
    fun cancellationCallbackCancellationRetainsExactCommitAndRepeatedFinishIsSafe() = runTest {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                seed(db)
                val repo =
                    LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
                val id = repo.createOrder(NewOrder("s", tableId = "t"))
                var commit: CancelCommit? = null
                assertTrue(
                    runCatching {
                            repo.cancel(id) {
                                commit = it
                                throw CancellationException("After void committed")
                            }
                        }
                        .exceptionOrNull() is CancellationException
                )
                assertEquals("occupied", db.get("tables", "t")!!.string("status"))
                repo.finishCancellation(commit!!)
                repo.finishCancellation(commit!!)
                assertEquals(1, db.select("order_voids").size)
                assertEquals("available", db.get("tables", "t")!!.string("status"))
                assertTrue(
                    runCatching { repo.finishCancellation(commit!!.copy(orderId = "foreign")) }
                        .isFailure
                )
            }
    }

    private fun seed(db: PosDatabase) {
        db.applyRemote("stores", listOf(row("s", "vat_rate" to 12)), emptyList(), emptyList())
        db.applyRemote(
            "tables",
            listOf(row("t", "store_id" to "s", "status" to "available")),
            emptyList(),
            emptyList(),
        )
        db.applyRemote(
            "products",
            listOf(row("p", "name" to "Meal", "price" to 112, "is_vatable" to true)),
            emptyList(),
            emptyList(),
        )
    }

    private val choice =
        ProductChoice(
            SelectedProduct("p", "Meal", 112.0),
            2,
            "note",
            listOf(ModifierSnapshot("Extra", "Rice", 28.0)),
            null,
        )

    @Test
    fun addCancellationAfterKnownCommitClosesAndReentersWithoutDuplicateItem() = runTest {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                seed(db)
                val real =
                    LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
                val repo =
                    object : OrderEntryRepository by real {
                        override suspend fun addItem(
                            orderId: String,
                            item: ItemInput,
                            committed: (String) -> Unit,
                        ) =
                            real.addItem(orderId, item) { itemId ->
                                committed(itemId)
                                throw CancellationException("Hidden after known commit")
                            }
                    }
                val id = real.createDraft("s")
                val owner = EditorSessions(backgroundScope)
                val route = EditorRoute("s", orderId = id, takeout = true)
                val session = owner.get("u:s", "route", route, repo)
                assertTrue(
                    runCatching { session.add(choice, "one") }.exceptionOrNull()
                        is CancellationException
                )
                assertEquals(1, db.select("order_items").size)
                val resumed = owner.get("u:s", "reentry", route, repo)
                assertSame(session, resumed)
                resumed.finishPendingAdd()
                resumed.finishPendingAdd()
                assertEquals(1, db.select("order_items").size)
                assertEquals(1, db.select("order_item_modifiers").size)
                assertEquals(2.0, db.get("orders", id)!!.number("item_count"), 0.0)
                assertEquals(280.0, db.get("orders", id)!!.number("net_sales"), 0.0)
                assertTrue(db.select("app_config").isEmpty())
            }
    }

    @Test
    fun partialAddRetryCannotDuplicateAndEditedRetryIsRejected() = runTest {
        val driver =
            OrderFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            seed(db)
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val id = repo.createDraft("s")
            val session =
                OrderEditorSession(
                    EditorRoute("s", orderId = id, takeout = true),
                    repo,
                    backgroundScope,
                ) {}
            driver.successfulOrderWritesBeforeFailure = 1
            assertTrue(runCatching { session.add(choice, "one") }.isFailure)
            assertEquals(1, db.select("order_items").size)
            assertEquals(2.0, db.get("orders", id)!!.number("item_count"), 0.0)
            assertTrue(runCatching { session.add(choice.copy(quantity = 9), "one") }.isFailure)
            session.add(choice, "one")
            assertEquals(1, db.select("order_items").size)
            assertEquals(1, db.select("order_item_modifiers").size)
            assertEquals(280.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            session.add(choice, "two")
            assertEquals(2, db.select("order_items").size)
            assertEquals(4.0, db.get("orders", id)!!.number("item_count"), 0.0)
        }
    }

    @Test
    fun firstSendCancellationAfterCommitKeepsOrderDiscoverableAcrossDiskReopen() = runTest {
        val file = File.createTempFile("order-restart-", ".sqlite")
        try {
            var committed: CreatedOrder? = null
            PosDatabase(
                    JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}").also {
                        LegacySqlSchema.create(it)
                    }
                )
                .use { db ->
                    seed(db)
                    val repo =
                        LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
                    val result = runCatching {
                        repo.createAndSend(NewOrder("s", tableId = "t"), listOf(choice.input())) {
                            committed = it
                            throw CancellationException("Caller leaves after commit")
                        }
                    }
                    assertTrue(result.exceptionOrNull() is CancellationException)
                    assertNotNull(committed)
                }
            PosDatabase(JdbcSqliteDriver("jdbc:sqlite:${file.absolutePath}")).use { db ->
                val repo =
                    LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
                val order =
                    db.select("orders", "table_id = ? AND status = 'open'", listOf("t")).single()
                assertEquals(committed!!.orderId, order.string("id"))
                repo.recalculate(committed!!.orderId)
                val cart = repo.cart("s", committed!!.orderId).first()!!
                assertEquals(280.0, cart.totals.netSales, 0.0)
                assertEquals(1, cart.lines.size)
                assertEquals("1", db.select("app_config").single().string("value"))
                assertEquals("occupied", db.get("tables", "t")!!.string("status"))
            }
        } finally {
            file.delete()
        }
    }

    @Test
    fun newTabKeepsMountedCartAndQueueWhileIdentityClearDropsOnlyMemoryDraft() = runTest {
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .use { db ->
                seed(db)
                val repo =
                    LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
                val owner = EditorSessions(backgroundScope)
                val id = repo.createOrder(NewOrder("s", tableId = "t"))
                val route = EditorRoute("s", "t", "Table 1", id)
                val session = owner.get("u:s", "route", route, repo)
                session.add(choice)
                session.loaded(repo.cart("s", id).first())
                val itemId = session.state.value.lines.single().item.id
                session.setQuantity(itemId, 5.0)
                val tab = session.newTab()
                assertNotEquals(id, tab)
                assertEquals(id, session.state.value.orderId)
                assertEquals(5.0, session.edits.pending.value[itemId])
                assertSame(session, owner.get("u:s", "route", route, repo))
                owner.clear()
                assertEquals(5.0, db.get("order_items", itemId)!!.number("quantity"), 0.0)
                val draftRoute = EditorRoute("s", "t", "Table 1")
                val draft = owner.get("u:s", "draft", draftRoute, repo)
                draft.add(choice)
                draft.dialogs.selected = choice.product
                draft.dialogs.modal = "pax"
                draft.dialogs.input = "9"
                owner.clear()
                val reset = owner.get("other:s", "draft", draftRoute, repo)
                assertTrue(reset.state.value.drafts.isEmpty())
                assertNull(reset.dialogs.selected)
                assertNull(reset.dialogs.modal)
                assertEquals("", reset.dialogs.input)
                assertEquals(2, db.select("orders").size)
            }
    }
}
