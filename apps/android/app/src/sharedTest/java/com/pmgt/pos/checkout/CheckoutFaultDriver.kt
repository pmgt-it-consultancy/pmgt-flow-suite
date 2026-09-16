package com.pmgt.pos.checkout

import app.cash.sqldelight.db.*

/** Inject a storage failure before a real adapter write; all other SQL runs normally. */
class CheckoutFaultDriver(private val delegate: SqlDriver) : SqlDriver by delegate {
    var failTable: String? = null
    var successfulWrites = 0
    var afterModelWrite: (() -> Unit)? = null
    var failNextJournal = false
    var failJournalAfter: Int? = null
    var failLocalKey: String? = null
    var successfulLocalWrites = 0

    override fun execute(
        identifier: Int?,
        sql: String,
        parameters: Int,
        binders: (SqlPreparedStatement.() -> Unit)?,
    ): QueryResult<Long> {
        failTable?.let { table ->
            if (sql.startsWith("INSERT INTO \"$table\"") || sql.startsWith("UPDATE \"$table\"")) {
                if (successfulWrites-- == 0) {
                    failTable = null
                    error("Synthetic disk write failure")
                }
            }
        }
        if (failNextJournal && sql.startsWith("INSERT OR REPLACE INTO local_storage")) {
            failNextJournal = false
            error("Synthetic journal write failure")
        }
        val result =
            delegate.execute(
                identifier,
                sql,
                parameters,
                if (binders == null) null
                else {
                    {
                        var key: String? = null
                        val statement = this
                        binders(
                            object : SqlPreparedStatement by this {
                                override fun bindString(index: Int, value: String?) {
                                    if (index == 0) key = value
                                    statement.bindString(index, value)
                                }
                            }
                        )
                        if (
                            sql.startsWith("INSERT OR REPLACE INTO local_storage") &&
                                key == failLocalKey &&
                                failLocalKey != null
                        ) {
                            if (successfulLocalWrites-- == 0) {
                                failLocalKey = null
                                error("Synthetic local pointer write failure")
                            }
                        }
                        if (
                            sql.startsWith("INSERT OR REPLACE INTO local_storage") &&
                                key?.startsWith("kotlin.checkout.journal:") == true
                        ) {
                            failJournalAfter?.let { count ->
                                failJournalAfter = count - 1
                                if (count == 0) {
                                    failJournalAfter = null
                                    error("Synthetic journal commit failure")
                                }
                            }
                        }
                    }
                },
            )
        if (sql.startsWith("INSERT INTO \"order_payments\"")) afterModelWrite?.invoke()
        return result
    }
}
