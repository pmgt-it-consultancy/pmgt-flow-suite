package com.pmgt.pos.browse

import com.pmgt.pos.db.PosDatabase
import com.pmgt.pos.db.string
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Reads the order's synced server identity locally and appends the reprint audit on the server.
 * Both are required before a history reprint reaches the printer.
 */
class HttpReprintAudit(
    private val db: PosDatabase,
    private val io: CoroutineDispatcher,
    private val http: ConvexHttp,
) : ReprintAudit {
    override suspend fun serverOrderId(orderId: String): String? =
        withContext(io) {
            db.select("orders", "id = ?", listOf(orderId), limit = 1)
                .firstOrNull()
                ?.string("server_id")
                ?.takeIf { it.isNotEmpty() }
        }

    override suspend fun logReceiptReprint(serverOrderId: String) {
        http.mutation(
            "checkout:logReceiptReprint",
            buildJsonObject { put("orderId", serverOrderId) },
        )
    }
}
