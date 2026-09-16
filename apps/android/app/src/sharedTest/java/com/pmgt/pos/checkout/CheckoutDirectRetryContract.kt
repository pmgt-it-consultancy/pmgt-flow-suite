package com.pmgt.pos.checkout

import com.pmgt.pos.db.*
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.*
import org.junit.Assert.*

object CheckoutDirectRetryContract {
    val brokenPointers = listOf("coexisting", "settled-only", "redirected", "missing", "wrong-kind")

    suspend fun rejectsUnownedExecution(
        db: PosDatabase,
        fault: CheckoutFaultDriver,
        remove: Boolean,
        broken: String,
    ) {
        val setup = Setup(db, fault)
        setup.start(remove)
        val id = setup.orderId
        val action = setup.action
        when (broken) {
            "coexisting" -> db.setLocalValue(settledKey(id), action)
            "settled-only" -> {
                db.setLocalValue(activeKey(id), "")
                db.setLocalValue(settledKey(id), action)
            }
            "redirected" -> db.setLocalValue(activeKey(id), "different-action")
            "missing" -> db.setLocalValue(activeKey(id), "")
            "wrong-kind" ->
                db.setLocalValue(activeKey(id), if (remove) "seed-apply" else "seed-remove")
        }
        // Include both pointers and all known original/redirected targets; compare exact stored
        // bytes.
        val before = setup.snapshot()
        assertTrue(
            "public ${if (remove) "remove" else "apply"} must reject $broken pointer authority",
            runCatching { setup.retry(remove) }.isFailure,
        )
        assertEquals(before, setup.snapshot())
    }

    suspend fun completedHistoryDoesNotConsumeLaterOwnership(
        db: PosDatabase,
        fault: CheckoutFaultDriver,
        remove: Boolean,
    ) {
        val setup = Setup(db, fault)
        setup.start(remove)
        val allocated = loadJournal(db, setup.orderId, setup.action)!!.allocatedIds
        setup.retry(remove) // Legitimate direct unfinished retry is still authorized.
        assertEquals(allocated, loadJournal(db, setup.orderId, setup.action)!!.allocatedIds)
        assertTrue(loadJournal(db, setup.orderId, setup.action)!!.done)
        val discount =
            db.select("order_discounts", "_status != 'deleted'").singleOrNull()?.string("id")
        fault.failJournalAfter = 1
        assertTrue(
            runCatching {
                    if (remove)
                        setup.repo.apply(
                            setup.owner,
                            setup.orderId,
                            "later",
                            setup.input,
                            setup.approval("later"),
                        )
                    else
                        setup.repo.remove(
                            setup.owner,
                            setup.orderId,
                            "later",
                            discount!!,
                            setup.approval("later"),
                        )
                }
                .isFailure
        )
        assertEquals("later", db.localValue(activeKey(setup.orderId)))
        val before = setup.snapshot()
        setup.retry(remove) // Old completed action is a no-write idempotent success.
        assertEquals(before, setup.snapshot())
        if (remove)
            setup.repo.apply(
                setup.owner,
                setup.orderId,
                "later",
                setup.input,
                setup.approval("later"),
            )
        else
            setup.repo.remove(
                setup.owner,
                setup.orderId,
                "later",
                discount!!,
                setup.approval("later"),
            )
        assertTrue(loadJournal(db, setup.orderId, "later")!!.done)
        assertEquals("", db.localValue(activeKey(setup.orderId)))
    }

    private class Setup(val db: PosDatabase, val fault: CheckoutFaultDriver) {
        val owner = CheckoutDatabaseContract.owner
        val repo = LocalCheckoutRepository(db, Dispatchers.Unconfined, { owner })
        lateinit var orderId: String
        lateinit var input: DiscountInput
        lateinit var removedId: String
        val action = "current"

        fun approval(id: String) = CheckoutApproval(owner, orderId, id, "manager")

        suspend fun start(remove: Boolean) {
            orderId = CheckoutDatabaseContract.seed(db)
            input =
                DiscountInput(
                    "pwd",
                    listOf(db.select("order_items").single().string("id")!!),
                    "Customer",
                    "ID",
                )
            repo.apply(owner, orderId, "seed-apply", input, approval("seed-apply"))
            removedId = db.select("order_discounts").single().string("id")!!
            if (!remove)
                repo.remove(owner, orderId, "seed-remove", removedId, approval("seed-remove"))
            fault.failJournalAfter = 1
            assertTrue(runCatching { retry(remove) }.isFailure)
            assertEquals(0, loadJournal(db, orderId, action)!!.next)
            assertEquals(action, db.localValue(activeKey(orderId)))
        }

        suspend fun retry(remove: Boolean) {
            if (remove) repo.remove(owner, orderId, action, removedId, approval(action))
            else repo.apply(owner, orderId, action, input, approval(action))
        }

        fun snapshot(): Pair<Map<String, List<Row>>, Map<String, String?>> {
            val rows =
                listOf("orders", "order_items", "order_discounts", "order_payments", "tables")
                    .associateWith { db.select(it) }
            val keys =
                listOf(activeKey(orderId), settledKey(orderId)) +
                    listOf(action, "seed-apply", "seed-remove", "different-action", "later").map {
                        "kotlin.checkout.journal:" +
                            JsonArray(listOf(JsonPrimitive(orderId), JsonPrimitive(it)))
                    }
            return rows to keys.associateWith { db.localValue(it) }
        }
    }
}
