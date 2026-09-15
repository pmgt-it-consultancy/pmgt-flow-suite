package com.pmgt.pos.db

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class LegacyAdoptionTest {
    private fun fixture(path: String = JdbcSqliteDriver.IN_MEMORY): JdbcSqliteDriver =
        JdbcSqliteDriver(path).also { driver ->
            javaClass.getResource("/legacy-v3.sql")!!.readText().split(';')
                .filter { it.isNotBlank() }.forEach { driver.execute(null, it, 0) }
        }

    private fun row(id: String, vararg values: Pair<String, JsonElement>) =
        JsonObject(mapOf("id" to JsonPrimitive(id)) + values)

    @Test fun legacyV3ReopensWithoutChangingPendingWorkOrMetadata() {
        val path = "jdbc:sqlite:${Files.createTempFile("legacy-adoption", ".db")}"
        val driver = fixture(path)
        driver.execute(null, "INSERT INTO orders(id, _status, _changed, customer_name, server_id) VALUES ('local','updated','customer_name','Guest','server-order')", 0)
        driver.execute(null, "INSERT INTO orders(id, _status, _changed) VALUES ('gone','deleted','')", 0)
        driver.execute(null, "INSERT INTO local_storage VALUES ('__watermelon_last_pulled_at','12345')", 0)
        driver.execute(null, "INSERT INTO app_config(id,_status,_changed,key,value) VALUES ('counter','synced','','orderCounter.dine_in.2026-09-15','41')", 0)
        driver.execute(null, "INSERT INTO sync_v2_aggregates(id,_status,_changed,payload) VALUES ('v2','created','','preserved')", 0)
        val before = LegacyIntegrity.inspect(driver)
        val db = PosDatabase(driver)
        assertEquals(2, db.pendingCount())
        assertFalse(db.pendingChanges().changes.containsKey("sync_v2_aggregates"))
        db.close()
        val reopened = JdbcSqliteDriver(path)
        assertEquals(before, LegacyIntegrity.inspect(reopened))
        val adopted = PosDatabase(reopened)
        assertEquals("12345", adopted.localValue("__watermelon_last_pulled_at"))
        assertEquals("41", adopted.get("app_config", "counter")!!.string("value"))
        assertEquals("server-order", adopted.get("orders", "local")!!.string("server_id"))
        adopted.close()
    }

    @Test fun invalidVersionSchemaAndMarkersBlockWithoutMutation() {
        for (damage in listOf("PRAGMA user_version = 1", "PRAGMA user_version = 2", "PRAGMA user_version = 4", "ALTER TABLE orders ADD COLUMN unknown", "INSERT INTO orders(id,_status,_changed) VALUES ('bad','mystery','')", "INSERT INTO orders(id,_status,_changed) VALUES ('bad','updated','missing_field')", "INSERT INTO orders(id,_status,_changed,gross_sales) VALUES ('bad','created','','not-a-number')")) {
            val driver = fixture()
            driver.execute(null, damage, 0)
            assertThrows(AdoptionBlocked::class.java) { LegacyIntegrity.inspect(driver) }
            assertEquals(20, LegacyTables.tables.size)
            driver.close()
        }
    }

    @Test fun generatedFreshSchemaMatchesRealLegacyAffinitiesIndexesAndVersion() {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        LegacySqlSchema.create(driver)
        driver.execute(null, "PRAGMA user_version = ${LegacySqlSchema.version}", 0)
        fixture().use { source -> assertEquals(LegacyIntegrity.inspect(source), LegacyIntegrity.inspect(driver)) }
        val expectedIndexes = fixture().use { source ->
            source.executeQuery(null, "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name", { cursor ->
                val names = mutableListOf<String>()
                while (cursor.next().value) names += cursor.getString(0)!!
                app.cash.sqldelight.db.QueryResult.Value(names)
            }, 0).value
        }
        val actualIndexes = driver.executeQuery(null, "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name", { cursor ->
            val names = mutableListOf<String>()
            while (cursor.next().value) names += cursor.getString(0)!!
            app.cash.sqldelight.db.QueryResult.Value(names)
        }, 0).value
        assertEquals(expectedIndexes, actualIndexes)
        driver.close()
    }

    @Test fun oldPushAcknowledgementPreservesConcurrentEditAndRejectedRows() {
        val db = PosDatabase(fixture())
        db.insertLocal("orders", row("a", "customer_name" to JsonPrimitive("First")))
        db.insertLocal("orders", row("b"))
        val snapshot = db.pendingChanges()
        db.updateLocal("orders", "a", buildJsonObject { put("customer_name", "Second") })
        db.acknowledge(snapshot, setOf("orders" to "b"))
        assertEquals(2, db.pendingCount())
        assertEquals("Second", db.get("orders", "a")!!.string("customer_name"))
        db.acknowledge(db.pendingChanges(), emptySet())
        assertEquals(0, db.pendingCount())
        db.close()
    }

    @Test fun serializedTombstoneSnapshotSurvivesRestartAndNeverPurgesRecreatedRow() {
        val path = "jdbc:sqlite:${Files.createTempFile("legacy-ack", ".db")}"
        var db = PosDatabase(fixture(path))
        db.insertLocal("orders", row("a"))
        db.deleteLocal("orders", "a")
        val encoded = Json.encodeToString(db.pendingChanges())
        db.close()
        db = PosDatabase(JdbcSqliteDriver(path))
        val snapshot = Json.decodeFromString<ChangeSnapshot>(encoded)
        db.insertLocal("orders", row("a"))
        db.deleteLocal("orders", "a") // Even an identical re-deletion is newer work.
        db.acknowledge(snapshot, emptySet())
        assertNotNull(db.get("orders", "a"))
        db.acknowledge(db.pendingChanges(), emptySet())
        assertNull(db.get("orders", "a"))
        db.close()
    }

    @Test fun transactionRollsBackDataAndEmitsOnlyAfterCommit() {
        val db = PosDatabase(fixture())
        val initial = db.changes.value
        assertThrows(IllegalStateException::class.java) {
            db.transaction {
                db.insertLocal("orders", row("a"))
                assertEquals(initial, db.changes.value)
                error("rollback")
            }
        }
        assertNull(db.get("orders", "a"))
        assertEquals(initial, db.changes.value)
        db.transaction {
            db.insertLocal("orders", row("a"))
            db.insertLocal("orders", row("b"))
        }
        assertEquals(initial + 1, db.changes.value)
        db.close()
    }

    @Test fun remoteMergeProtectsLocalFieldsAndTombstonesAndDemotesExistingCreate() {
        val db = PosDatabase(fixture())
        db.applyRemote("orders", listOf(row("a", "customer_name" to JsonPrimitive("Remote"), "status" to JsonPrimitive("open"))), emptyList(), emptyList())
        db.updateLocal("orders", "a", buildJsonObject { put("customer_name", "Local") })
        db.applyRemote("orders", emptyList(), listOf(row("a", "customer_name" to JsonPrimitive("Other"), "status" to JsonPrimitive("paid"), "server_id" to JsonPrimitive("server"))), emptyList())
        assertEquals("Local", db.get("orders", "a")!!.string("customer_name"))
        assertEquals("paid", db.get("orders", "a")!!.string("status"))
        db.applyRemote("orders", emptyList(), emptyList(), listOf("a"))
        assertNotNull(db.get("orders", "a"))
        db.insertLocal("orders", row("b", "customer_name" to JsonPrimitive("Draft")))
        db.applyRemote("orders", listOf(row("b", "server_id" to JsonPrimitive("accepted"))), emptyList(), emptyList())
        assertEquals("updated", db.get("orders", "b")!!.string("_status"))
        db.deleteLocal("orders", "b")
        db.applyRemote("orders", listOf(row("b")), emptyList(), emptyList())
        assertEquals("deleted", db.get("orders", "b")!!.string("_status"))
        db.close()
    }

    @Test fun disposableIsPreservedButNeverPushedAndIdentifiersAreRestricted() {
        val driver = fixture()
        driver.execute(null, "INSERT INTO orders(id,_status,_changed) VALUES ('temp','disposable','')", 0)
        LegacyIntegrity.inspect(driver)
        val db = PosDatabase(driver)
        assertEquals(0, db.pendingCount())
        assertThrows(IllegalArgumentException::class.java) { db.select("orders; DROP TABLE orders") }
        assertThrows(IllegalArgumentException::class.java) { db.select("orders", "id IN (SELECT id FROM users)") }
        assertThrows(IllegalArgumentException::class.java) { db.select("orders", orderBy = "random()") }
        assertEquals(1, db.select("orders", "id = ?", listOf("temp"), "created_at DESC", 10).size)
        db.close()
    }
}
