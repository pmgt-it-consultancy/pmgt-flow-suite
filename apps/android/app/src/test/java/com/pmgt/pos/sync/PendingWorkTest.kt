package com.pmgt.pos.sync

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.AdoptionBlocked
import com.pmgt.pos.db.PosDatabase
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Every pending-work failure is reported to the operator as one sentence, because the seven checks
 * behind it are not something a cashier can act on. Support needs the opposite, so the real check
 * has to survive as the cause: without it a blocked till is one generic string in Crashlytics.
 */
class PendingWorkTest {
    private fun database(): PosDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        javaClass.getResource("/legacy-v3.sql")!!.readText().split(';')
            .filter { it.isNotBlank() }.forEach { driver.execute(null, it, 0) }
        return PosDatabase(driver)
    }

    @Test fun anUnresolvedParentIsNamedAsTheCauseBehindTheOperatorMessage() {
        database().use { db ->
            db.insertLocal(
                "order_items",
                // order_items carries no store_id, so ownership resolves only through its parent.
                buildJsonObject {
                    put("id", "orphan")
                    put("order_id", "missing-order")
                    put("product_id", "product")
                },
            )

            val blocked = assertThrows(AdoptionBlocked::class.java) {
                pendingWork(db, "store", "device")
            }

            assertEquals(
                "Pending work has invalid data or unresolved store ownership. Tablet data is preserved; repair is required before continuing.",
                blocked.message,
            )
            assertEquals("Pending parent cannot be resolved", blocked.cause?.message)
        }
    }

    @Test fun anotherStoresPendingRowIsNamedAsItsOwnCause() {
        database().use { db ->
            db.insertLocal(
                "orders",
                buildJsonObject {
                    put("id", "elsewhere")
                    put("store_id", "some-other-store")
                },
            )

            val blocked = assertThrows(AdoptionBlocked::class.java) {
                pendingWork(db, "store", "device")
            }

            assertEquals(
                "Pending work belongs to another or unresolved store",
                blocked.cause?.message,
            )
        }
    }
}
