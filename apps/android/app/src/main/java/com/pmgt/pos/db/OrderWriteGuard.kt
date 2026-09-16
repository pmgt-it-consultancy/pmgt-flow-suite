package com.pmgt.pos.db

/** Reserved local intent protects only unfinished checkout work; it is never a sync row. */
internal fun PosDatabase.requireOrderWritable(orderId: String) {
    check(localValue("kotlin.checkout.active:$orderId").isNullOrEmpty()) {
        "Finish the saved checkout for this order before making changes"
    }
}
