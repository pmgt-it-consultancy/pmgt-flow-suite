package com.pmgt.pos.db

import android.content.Context

/**
 * Evidence that this replica already passed a full verification for a store. Device-local, never
 * written into the replica: adoption must leave the tablet's data byte-for-byte untouched.
 */
data class AdoptionReceipt(val storeId: String, val deviceId: String)

interface AdoptionReceipts {
    fun read(): AdoptionReceipt?

    fun write(receipt: AdoptionReceipt)
}

class InMemoryAdoptionReceipts : AdoptionReceipts {
    @Volatile private var receipt: AdoptionReceipt? = null

    override fun read(): AdoptionReceipt? = receipt

    override fun write(receipt: AdoptionReceipt) {
        this.receipt = receipt
    }
}

class AndroidAdoptionReceipts(context: Context) : AdoptionReceipts {
    private val preferences = context.getSharedPreferences("KotlinPosAdoption", Context.MODE_PRIVATE)

    override fun read(): AdoptionReceipt? {
        val storeId = preferences.getString("storeId", null) ?: return null
        val deviceId = preferences.getString("deviceId", null) ?: return null
        return AdoptionReceipt(storeId, deviceId)
    }

    override fun write(receipt: AdoptionReceipt) {
        preferences.edit().putString("storeId", receipt.storeId).putString("deviceId", receipt.deviceId).commit()
    }
}
