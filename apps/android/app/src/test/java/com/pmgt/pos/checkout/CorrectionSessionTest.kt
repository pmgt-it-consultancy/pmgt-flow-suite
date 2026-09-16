package com.pmgt.pos.checkout

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.pmgt.pos.db.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CorrectionSessionTest {
    @Test
    fun schedulerFailureAfterFinalCommitStillPresentsDurableLocalSuccess() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CorrectionDatabaseContract.seed(db)
            val owner = CorrectionDatabaseContract.owner
            driver.failTable = "audit_logs"
            val repo = CorrectionDatabaseContract.repo(db, { error("Scheduler unavailable") })
            runCatching {
                repo.correct(
                    owner,
                    id,
                    "saved",
                    CorrectionDatabaseContract.input(db, id),
                    CheckoutApproval(owner, id, "saved", "manager"),
                )
            }
            val session =
                CorrectionSession(owner, id, repo, ConvexHttp("http://127.0.0.1"), this) { true }
            session.open("void")
            withTimeout(5000) { while (session.state.value.busy) delay(10) }
            session.resumeSaved()
            withTimeout(5000) { while (session.state.value.busy) delay(10) }
            assertEquals("Refund Processed", session.state.value.alert!!.title)
            assertNotNull(session.state.value.completed)
            assertTrue(db.pendingCount() > 0)
            assertEquals("voided", db.get("orders", id)!!.string("status"))
            session.dispose()
        }
    }

    @Test
    fun openingOppositeActionNeverExecutesSavedRefund() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CorrectionDatabaseContract.seed(db)
            val owner = CorrectionDatabaseContract.owner
            driver.failTable = "audit_logs"
            val repo = CorrectionDatabaseContract.repo(db)
            assertTrue(
                runCatching {
                        repo.correct(
                            owner,
                            id,
                            "saved",
                            CorrectionDatabaseContract.input(db, id),
                            CheckoutApproval(owner, id, "saved", "manager"),
                        )
                    }
                    .isFailure
            )
            val session =
                CorrectionSession(owner, id, repo, ConvexHttp("http://127.0.0.1"), this) { true }
            session.open("void")
            withTimeout(5000) { while (session.state.value.busy) delay(10) }
            assertEquals(
                "Open must not execute the different saved refund",
                "paid",
                db.get("orders", id)!!.string("status"),
            )
            assertTrue(db.select("order_voids").isEmpty())
            assertEquals("refund", session.state.value.saved!!.input.kind)
            assertEquals("saved", session.state.value.saved!!.actionId)
            session.later()
            assertNull(session.state.value.saved)
            assertEquals("saved", db.localValue(activeKey(id)))
            session.dispose()
        }
    }

    @Test
    fun stalePromptIdentityAndChangedEpochCannotResumeDifferentSavedAction() = runBlocking {
        val driver =
            CheckoutFaultDriver(
                JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { LegacySqlSchema.create(it) }
            )
        PosDatabase(driver).use { db ->
            val id = CorrectionDatabaseContract.seed(db)
            val owner = CorrectionDatabaseContract.owner
            driver.failTable = "audit_logs"
            val repo = CorrectionDatabaseContract.repo(db)
            runCatching {
                repo.correct(
                    owner,
                    id,
                    "saved",
                    CorrectionDatabaseContract.input(db, id),
                    CheckoutApproval(owner, id, "saved", "manager"),
                )
            }
            val before = activeJournal(db, id)!!
            val prompt = repo.saved(owner, id)!!
            val different = before.copy(id = "other-action")
            db.transaction {
                saveJournal(db, different)
                db.setLocalValue(activeKey(id), different.id)
            }
            assertTrue(runCatching { repo.resume(owner, id, prompt.actionId) }.isFailure)
            assertEquals("paid", db.get("orders", id)!!.string("status"))
            assertEquals("other-action", db.localValue(activeKey(id)))
            var current = true
            val session =
                CorrectionSession(owner, id, repo, ConvexHttp("http://127.0.0.1"), this) { current }
            session.open("void")
            withTimeout(5000) { while (session.state.value.busy) delay(10) }
            current = false
            session.resumeSaved()
            yield()
            assertEquals("paid", db.get("orders", id)!!.string("status"))
            session.dispose()
        }
    }
}
