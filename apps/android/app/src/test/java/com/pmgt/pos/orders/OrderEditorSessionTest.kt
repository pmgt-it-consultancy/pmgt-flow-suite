package com.pmgt.pos.orders

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.*
import com.pmgt.pos.db.*
import com.pmgt.pos.telemetry.RecordingTelemetry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OrderEditorSessionTest {
    @get:Rule val telemetry = RecordingTelemetry()

    @Test
    fun removingASentItemAndCancellingTheOrderAreLoggedButDraftEditsAreNot() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val session =
                OrderEditorSession(EditorRoute("s", "t", "Table 1"), repo, backgroundScope) {}
            session.add(choice)
            session.add(choice)
            session.remove(session.state.value.lines.first().item.id)
            assertTrue(telemetry.events.isEmpty())

            session.send(1.0)
            session.loaded(repo.cart("s", session.state.value.orderId!!).first())
            session.remove(db.select("order_items").single().string("id")!!, "Wrong item")
            session.discard()

            assertEquals(
                listOf(
                    RecordingTelemetry.Event("item_voided", emptyMap()),
                    RecordingTelemetry.Event("order_voided", mapOf("source" to "cancel")),
                ),
                telemetry.events,
            )
            assertEquals("voided", db.select("orders").single().string("status"))
        }
    }

    private fun database() =
        PosDatabase(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
            .also { db ->
                db.applyRemote(
                    "stores",
                    listOf(row("s", "vat_rate" to 12)),
                    emptyList(),
                    emptyList(),
                )
                db.applyRemote(
                    "tables",
                    listOf(row("t", "store_id" to "s", "name" to "Table 1")),
                    emptyList(),
                    emptyList(),
                )
                db.applyRemote(
                    "products",
                    listOf(
                        row("p", "name" to "Current meal", "price" to 112, "is_vatable" to true)
                    ),
                    emptyList(),
                    emptyList(),
                )
            }

    private val choice =
        ProductChoice(
            SelectedProduct("p", "Draft meal", 100.0),
            1,
            "Note",
            listOf(ModifierSnapshot("Extra", "Rice", 12.0)),
            null,
        )

    @Test
    fun customerHydratesOnlyOnActualFieldChangesIncludingNullAndEmpty() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val id = "adopted-order"
            db.applyRemote(
                "orders",
                listOf(
                    row(
                        id,
                        "store_id" to "s",
                        "order_type" to "takeout",
                        "status" to "draft",
                        "customer_name" to "Alice",
                    )
                ),
                emptyList(),
                emptyList(),
            )
            val owners = EditorSessions(backgroundScope)
            val route = EditorRoute("s", orderId = id, takeout = true)
            val session = owners.get("u:s", "takeout", route, repo)
            session.loaded(repo.cart("s", id).first())
            assertEquals("Alice", session.state.value.customer)
            session.customerText("Alicia")
            session.loaded(repo.cart("s", id).first())
            assertEquals("Alicia", session.state.value.customer)
            // A real changed value still wins; this is not dirty-field protection.
            db.applyRemote(
                "orders",
                emptyList(),
                listOf(row(id, "customer_name" to "Bob")),
                emptyList(),
            )
            session.loaded(repo.cart("s", id).first())
            assertEquals("Bob", session.state.value.customer)
            db.applyRemote(
                "orders",
                emptyList(),
                listOf(row(id, "customer_name" to "")),
                emptyList(),
            )
            session.loaded(repo.cart("s", id).first())
            assertEquals("", session.state.value.customer)
            session.customerText("Unsaved")
            db.applyRemote(
                "orders",
                emptyList(),
                listOf(row(id, "customer_name" to null)),
                emptyList(),
            )
            session.loaded(repo.cart("s", id).first())
            assertEquals("", session.state.value.customer)
            session.customerText("Keep while missing")
            session.loaded(null) // Actual missing order is undefined customer, not a clear.
            assertEquals("Keep while missing", session.state.value.customer)
            session.loaded(repo.cart("s", id).first())
            assertEquals("", session.state.value.customer)
            session.customerText("Owner draft")
            owners.clear()
            val reset = owners.get("other:s", "takeout", route, repo)
            reset.loaded(repo.cart("s", id).first())
            assertEquals("", reset.state.value.customer)
            val next = repo.createDraft("s")
            val newOrder = owners.get("other:s", "next", route.copy(orderId = next), repo)
            assertEquals("", newOrder.state.value.customer)
        }
    }

    @Test
    fun prepareBillPersistsOnlyMetadataEditedInTheCurrentSession() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val id = repo.createDraft("s")
            repo.customer(id, name = "Alice", marker = "old")
            val session =
                OrderEditorSession(
                    EditorRoute("s", orderId = id, takeout = true),
                    repo,
                    backgroundScope,
                ) {}
            session.loaded(repo.cart("s", id).first())

            session.prepareBill()
            assertEquals("Alice", db.get("orders", id)!!.string("customer_name"))
            assertEquals("old", db.get("orders", id)!!.string("table_marker"))

            session.customerText("")
            session.markerText("")
            session.prepareBill()
            assertNull(db.get("orders", id)!!.string("customer_name"))
            assertNull(db.get("orders", id)!!.string("table_marker"))
        }
    }

    @Test
    fun rapidIncrementReadsLatestQueueQuantityWithoutWaitingForAComposeFrame() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val session =
                OrderEditorSession(EditorRoute("s", "t", "Table 1"), repo, backgroundScope) {}
            session.add(choice)
            val id = session.state.value.lines.single().item.id
            repeat(10) { assertTrue(session.changeQuantity(id, 1.0)) }
            assertEquals(11.0, session.edits.pending.value[id])
            session.edits.flush()
            assertEquals(11.0, session.state.value.lines.single().item.quantity, 0.0)
            repeat(10) { assertTrue(session.changeQuantity(id, -1.0)) }
            assertFalse(session.changeQuantity(id, -1.0))
            assertEquals(1.0, session.edits.pending.value[id])
        }
    }

    @Test
    fun dineInDraftStaysInMemoryAndFirstSendUsesLatestQuantityAndCurrentCatalog() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val session =
                OrderEditorSession(EditorRoute("s", "t", "Table 1"), repo, backgroundScope) {}
            session.add(choice)
            assertEquals(1, session.state.value.lines.size)
            assertTrue(db.select("orders").isEmpty())
            assertEquals(112.0, session.state.value.subtotal, 0.0)
            val lineId = session.state.value.lines.single().item.id
            session.setQuantity(lineId, 4.0)
            assertEquals(112.0, session.state.value.subtotal, 0.0)
            val print = session.send(3.0)!!
            val parent = db.select("orders").single()
            assertEquals(4.0, parent.number("item_count"), 0.0)
            assertEquals(496.0, parent.number("net_sales"), 0.0)
            assertEquals("Current meal", db.select("order_items").single().string("product_name"))
            assertEquals("Draft meal", print.lines.single().productName)
            assertEquals(4.0, print.lines.single().quantity, 0.0)
            assertEquals(parent.string("id"), session.state.value.orderId)
            assertTrue(session.state.value.drafts.isEmpty())
        }
    }

    @Test
    fun takeoutCheckoutFlushesSubmitsDraftAndPreservesCounterCategoryAndMarkerRoute() = runTest {
        database().use { db ->
            val repo = LocalOrderRepository(db, UnconfinedTestDispatcher(testScheduler), { "d" })
            val id = repo.createDraft("s")
            val session =
                OrderEditorSession(
                    EditorRoute("s", orderId = id, takeout = true),
                    repo,
                    backgroundScope,
                ) {}
            session.loaded(repo.cart("s", id).first())
            session.add(choice)
            assertEquals(1, db.select("order_items").size)
            session.loaded(repo.cart("s", id).first())
            session.setQuantity(db.select("order_items").single().string("id")!!, 5.0)
            val route = session.checkout()!!
            assertEquals(id, route.orderId)
            assertEquals("takeout", route.orderType)
            assertEquals("open", db.get("orders", id)!!.string("status"))
            assertEquals(5.0, db.get("orders", id)!!.number("item_count"), 0.0)
            assertEquals(620.0, db.get("orders", id)!!.number("net_sales"), 0.0)
            assertNull(db.get("orders", id)!!.string("order_number"))
        }
    }
}
