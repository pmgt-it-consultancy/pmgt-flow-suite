package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.orders.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CorrectionOracleTest {
    @Test
    fun unchangedTypeScriptCorrectionOutputsMatchEveryModelField() = runBlocking {
        val fixture =
            Json.parseToJsonElement(
                    javaClass.getResource("/correction-reference.json")!!.readText()
                )
                .jsonObject
        for (scenario in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
            PosDatabase(
                    JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
                )
                .use { db ->
                    val name = scenario.getValue("name").jsonPrimitive.content
                    val inputRows = scenario.getValue("input").jsonObject
                    inputRows.forEach { (table, rows) ->
                        db.applyRemote(
                            table,
                            rows.jsonArray.map { it.jsonObject },
                            emptyList(),
                            emptyList(),
                        )
                    }
                    val owner = CheckoutOwner("cashier", "store")
                    var tick = 1000L
                    val repo =
                        LocalCorrectionRepository(
                            db,
                            Dispatchers.Unconfined,
                            LocalOrderRepository(
                                db,
                                Dispatchers.Unconfined,
                                { "device" },
                                { "01" },
                            ),
                            { owner },
                            clock = { tick++ },
                        )
                    val params = scenario.getValue("params").jsonObject
                    val input =
                        CorrectionInput(
                            if (
                                scenario
                                    .getValue("options")
                                    .jsonObject["fullVoid"]
                                    ?.jsonPrimitive
                                    ?.booleanOrNull == true
                            )
                                "void"
                            else "refund",
                            params.getValue("reason").jsonPrimitive.content,
                            params["refundedItemIds"]
                                ?.jsonArray
                                ?.map { it.jsonPrimitive.content }
                                .orEmpty(),
                            params["refundMethod"]?.jsonPrimitive?.contentOrNull,
                        )
                    var result = runCatching {
                        repo.correct(
                            owner,
                            "original",
                            "action",
                            input,
                            CheckoutApproval(owner, "original", "action", "manager"),
                        )
                    }
                    if (
                        scenario
                            .getValue("options")
                            .jsonObject["chain"]
                            ?.jsonPrimitive
                            ?.booleanOrNull == true && result.isSuccess
                    ) {
                        val replacement = result.getOrThrow().replacementOrderId!!
                        result = runCatching {
                            repo.correct(
                                owner,
                                replacement,
                                "chain",
                                input.copy(
                                    itemIds =
                                        db.select(
                                                "order_items",
                                                "order_id = ?",
                                                listOf(replacement),
                                            )
                                            .map { it.string("id")!! }
                                ),
                                CheckoutApproval(owner, replacement, "chain", "manager"),
                            )
                        }
                    }
                    if (scenario["error"] != null) {
                        if (name == "missing-store") {
                            assertEquals("Store is unavailable", result.exceptionOrNull()?.message)
                            assertEquals("paid", db.get("orders", "original")!!.string("status"))
                            assertTrue(db.select("order_voids").isEmpty())
                        } else
                            assertEquals(
                                name,
                                scenario.getValue("error").jsonPrimitive.content,
                                result.exceptionOrNull()?.message,
                            )
                        continue
                    }
                    assertTrue("$name: ${result.exceptionOrNull()}", result.isSuccess)
                    val expected = scenario.getValue("expected").jsonObject
                    val ids = mutableMapOf<String, String>()
                    expected.forEach { (table, rows) ->
                        val originals =
                            inputRows
                                .getValue(table)
                                .jsonArray
                                .map { it.jsonObject.getValue("id").jsonPrimitive.content }
                                .toSet()
                        val expectedNew =
                            rows.jsonArray
                                .map { it.jsonObject }
                                .filter { it.getValue("id").jsonPrimitive.content !in originals }
                        val actualNew = db.select(table).filter { it.string("id") !in originals }
                        assertEquals("$name $table count", expectedNew.size, actualNew.size)
                        expectedNew.zip(actualNew).forEach { (e, a) ->
                            ids[e.getValue("id").jsonPrimitive.content] = a.string("id")!!
                            if (table == "orders")
                                ids[e.getValue("order_number").jsonPrimitive.content] =
                                    a.string("order_number")!!
                        }
                    }
                    fun translate(element: JsonElement): JsonElement =
                        when (element) {
                            is JsonObject -> JsonObject(element.mapValues { translate(it.value) })
                            is JsonArray -> JsonArray(element.map { translate(it) })
                            is JsonPrimitive ->
                                if (element.isString && element.content in ids)
                                    JsonPrimitive(ids.getValue(element.content))
                                else if (!element.isString && element.doubleOrNull != null)
                                    JsonPrimitive(element.double)
                                else element
                        }
                    expected.forEach { (table, rows) ->
                        val actual = db.select(table).associateBy { it.string("id")!! }
                        for (row in rows.jsonArray.map { translate(it).jsonObject }) {
                            val a = actual.getValue(row.getValue("id").jsonPrimitive.content)
                            row.forEach { (field, value) ->
                                when {
                                    field == "order_number" &&
                                        a.string("id") != "original" &&
                                        a.string("id") != "other-tab" ->
                                        assertTrue(
                                            a.string(field)!!.startsWith("D-01") ||
                                                a.string(field)!!.startsWith("T-01")
                                        )
                                    field == "details" -> {
                                        val expectedDetails =
                                            translate(
                                                    Json.parseToJsonElement(
                                                        value.jsonPrimitive.content
                                                    )
                                                )
                                                .jsonObject
                                        val actualDetails =
                                            translate(Json.parseToJsonElement(a.string(field)!!))
                                                .jsonObject
                                        assertEquals(
                                            "$name $table details",
                                            expectedDetails,
                                            actualDetails,
                                        )
                                    }
                                    value is JsonPrimitive &&
                                        !value.isString &&
                                        value.doubleOrNull != null ->
                                        assertEquals(
                                            "$name $table ${a.string("id")} $field",
                                            value.double.toRawBits(),
                                            a.getValue(field).jsonPrimitive.double.toRawBits(),
                                        )
                                    else ->
                                        assertEquals(
                                            "$name $table ${a.string("id")} $field",
                                            value,
                                            a[field],
                                        )
                                }
                            }
                        }
                    }
                }
        }
    }
}
