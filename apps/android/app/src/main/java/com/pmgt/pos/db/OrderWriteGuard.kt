package com.pmgt.pos.db

import com.pmgt.pos.checkout.correctedKey
import com.pmgt.pos.checkout.loadJournal
import com.pmgt.pos.checkout.settledJournal
import com.pmgt.pos.checkout.validateJournal

/** Reserved local intent protects only unfinished checkout work; it is never a sync row. */
internal fun PosDatabase.requireOrderWritable(orderId: String) {
    check(localValue("kotlin.checkout.active:$orderId").isNullOrEmpty()) {
        "Finish the saved checkout for this order before making changes"
    }
    settledJournal(this, orderId)?.let {
        validateJournal(this, it, orderId, it.id)
        check(it.done && it.kind == "payment") { "Saved payment completion needs review" }
    }
    localValue(correctedKey(orderId))
        ?.takeIf { it.isNotEmpty() }
        ?.let { id ->
            val journal =
                requireNotNull(loadJournal(this, orderId, id)) { "Saved correction is unavailable" }
            validateJournal(this, journal, orderId, id)
            check(journal.version == 3 && journal.done) { "Saved correction needs review" }
        }
}
