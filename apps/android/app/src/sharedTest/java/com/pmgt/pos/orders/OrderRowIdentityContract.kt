package com.pmgt.pos.orders

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.db.*
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*

object OrderRowIdentityContract {
    suspend fun verify(driver: SqlDriver) {
        PosDatabase(driver).use { db ->
            db.applyRemote(
                "order_items",
                listOf("a", "b", "c").map { row(it, "order_id" to "order", "quantity" to 1) },
                emptyList(),
                emptyList(),
            )
            fun identities() =
                driver
                    .executeQuery(
                        null,
                        "SELECT id,rowid FROM order_items ORDER BY rowid",
                        { cursor ->
                            val rows = linkedMapOf<String, Long>()
                            while (cursor.next().value) rows[cursor.getString(0)!!] =
                                cursor.getLong(1)!!
                            QueryResult.Value(rows)
                        },
                        0,
                    )
                    .value
            val before = identities()
            val differences = mutableListOf<String>()
            fun verifyOrder(phase: String) {
                val actual = identities()
                if (before != actual || before.keys.toList() != actual.keys.toList())
                    differences += "$phase: $actual expected $before"
            }
            db.updateLocal("order_items", "a", fields("quantity" to 2))
            verifyOrder("local update")
            val captured = db.pendingChanges()
            db.applyRemote(
                "order_items",
                emptyList(),
                listOf(row("b", "notes" to "remote")),
                emptyList(),
            )
            verifyOrder("remote update")
            db.acknowledge(captured, emptySet())
            verifyOrder("acknowledgement")
            assertEquals("synced", db.get("order_items", "a")!!.string("_status"))
            assertEquals("", db.get("order_items", "a")!!.string("_changed"))
            db.deleteLocal("order_items", "c")
            verifyOrder("tombstone")
            assertEquals("deleted", db.get("order_items", "c")!!.string("_status"))
            db.applyRemote("stores", listOf(row("s", "vat_rate" to 0)), emptyList(), emptyList())
            db.applyRemote(
                "products",
                listOf(row("p", "price" to 1, "is_vatable" to false)),
                emptyList(),
                emptyList(),
            )
            val repo = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
            val order = repo.createDraft("s")
            listOf(1e16, 1.0, -1e16).forEach {
                repo.addItem(order, ItemInput("p", 1.0, customPrice = it))
            }
            val itemIds =
                db.select("order_items", "order_id = ?", listOf(order)).map { it.string("id")!! }
            repo.serviceType(itemIds[1], "takeout")
            repo.recalculate(order)
            val net = db.get("orders", order)!!.number("net_sales")
            if (net.toRawBits() != 0.0.toRawBits())
                differences += "source-order fold expected0, actual$net"
            assertTrue(differences.joinToString("\n"), differences.isEmpty())
        }
    }
}
