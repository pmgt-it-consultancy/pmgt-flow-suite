package com.pmgt.pos.db

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

typealias Row = JsonObject

fun Row.string(name: String): String? = (get(name) as? JsonPrimitive)?.contentOrNull
fun Row.number(name: String): Double = (get(name) as? JsonPrimitive)?.doubleOrNull ?: 0.0
fun Row.boolean(name: String): Boolean = (get(name) as? JsonPrimitive)?.let {
    it.booleanOrNull ?: (it.doubleOrNull == 1.0)
} ?: false

/** Persist this entire value for retry; only [changes] belongs in the sync request. */
@Serializable
data class ChangeSnapshot(
    val changes: JsonObject,
    val deletedRows: Map<String, Map<String, DeletedRowSnapshot>> = emptyMap(),
)

@Serializable
data class DeletedRowSnapshot(val row: JsonObject, val revision: Long)

internal data class LegacyColumn(val name: String, val type: String, val optional: Boolean)

/**
 * Messages deliberately contain no identity, ciphertext, row IDs or row contents.
 *
 * The cause is what support reads. Several throw sites collapse a family of distinct checks into one
 * sentence a cashier can be shown, so without the cause a blocked till reports a generic string and
 * a stack that points at whoever re-wrapped it rather than at what actually failed.
 */
class AdoptionBlocked(message: String, cause: Throwable? = null) :
    IllegalStateException(message, cause)
