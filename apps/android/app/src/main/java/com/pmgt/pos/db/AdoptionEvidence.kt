package com.pmgt.pos.db

import android.content.Context

/**
 * Evidence that this replica has already passed a full verification sweep for a store. Device-local
 * and never written into the replica: adoption must leave the tablet's data byte-for-byte untouched.
 *
 * "Receipt" would collide with the printed-receipt vocabulary this app already uses.
 */
data class AdoptionEvidence(val storeId: String, val deviceId: String)

interface AdoptionEvidenceStore {
    fun read(): AdoptionEvidence?

    fun write(evidence: AdoptionEvidence)
}

class InMemoryAdoptionEvidence : AdoptionEvidenceStore {
    @Volatile private var current: AdoptionEvidence? = null

    override fun read(): AdoptionEvidence? = current

    override fun write(evidence: AdoptionEvidence) {
        current = evidence
    }
}

class AndroidAdoptionEvidence(context: Context) : AdoptionEvidenceStore {
    private val preferences = context.getSharedPreferences("KotlinPosAdoption", Context.MODE_PRIVATE)

    override fun read(): AdoptionEvidence? {
        val storeId = preferences.getString("storeId", null) ?: return null
        val deviceId = preferences.getString("deviceId", null) ?: return null
        return AdoptionEvidence(storeId, deviceId)
    }

    override fun write(evidence: AdoptionEvidence) {
        preferences
            .edit()
            .putString("storeId", evidence.storeId)
            .putString("deviceId", evidence.deviceId)
            .commit()
    }
}
