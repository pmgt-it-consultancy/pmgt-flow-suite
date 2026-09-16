package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.browse.BrowseDatabaseContract.row
import com.pmgt.pos.catalog.ModifierSnapshot
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class DiscountOracleTest {
    @Test
    fun actualFirstInsertMatchesUnchangedRnServiceBeforeRecalculation() = runBlocking {
        val fixture =
            Json.parseToJsonElement(javaClass.getResource("/discount-reference.json")!!.readText())
                .jsonObject
        for (value in fixture.getValue("cases").jsonArray) {
            val case = value.jsonObject
            val driver =
                CheckoutFaultDriver(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
            PosDatabase(driver).use { db ->
                db.applyRemote(
                    "stores",
                    listOf(
                        row(
                            "s",
                            "name" to "Synthetic",
                            "vat_rate" to case.getValue("vatRate").jsonPrimitive.double,
                        )
                    ),
                    emptyList(),
                    emptyList(),
                )
                db.applyRemote(
                    "products",
                    listOf(
                        row(
                            "p",
                            "store_id" to "s",
                            "name" to "Meal",
                            "price" to case.getValue("price").jsonPrimitive.double,
                            "is_vatable" to case.getValue("isVatable").jsonPrimitive.boolean,
                        )
                    ),
                    emptyList(),
                    emptyList(),
                )
                val entry = LocalOrderRepository(db, Dispatchers.Unconfined, { "d" })
                val id = entry.createOrder(NewOrder("s", orderType = "takeout"))
                entry.addItem(
                    id,
                    ItemInput(
                        "p",
                        2.0,
                        modifiers =
                            case.getValue("modifiers").jsonArray.mapIndexed { i, m ->
                                ModifierSnapshot("Group", "Option $i", m.jsonPrimitive.double)
                            },
                    ),
                )
                val owner = CheckoutDatabaseContract.owner
                // New journal + insert commit succeed; fail the next journal so recalc rolls back.
                driver.failJournalAfter = 2
                val result = runCatching {
                    LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
                        .apply(
                            owner,
                            id,
                            "oracle",
                            DiscountInput(
                                "pwd",
                                listOf(db.select("order_items").single().string("id")!!),
                                "Customer",
                                "ID",
                            ),
                            CheckoutApproval(owner, id, "oracle", "manager"),
                        )
                }
                assertTrue(result.isFailure)
                val inserted = db.select("order_discounts").single()
                for ((key, column) in
                    listOf(
                        "discountAmount" to "discount_amount",
                        "vatExemptAmount" to "vat_exempt_amount",
                    )) assertEquals(
                    case.getValue(key).jsonPrimitive.content,
                    java.lang.Long.toHexString(inserted.number(column).toRawBits())
                        .padStart(16, '0'),
                )
                assertEquals(1.0, inserted.number("quantity_applied"), 0.0)
            }
        }
    }
}
