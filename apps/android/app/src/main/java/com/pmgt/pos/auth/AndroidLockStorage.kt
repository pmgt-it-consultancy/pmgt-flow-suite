package com.pmgt.pos.auth

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class AndroidLockStorage(context: Context) : LockStorage {
    private val prefs = context.getSharedPreferences("kotlin-lock-store", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    override fun read(): LockSnapshot = runCatching { json.decodeFromString<LockSnapshot>(prefs.getString("snapshot", null) ?: return LockSnapshot()) }.getOrDefault(LockSnapshot())
    override fun write(snapshot: LockSnapshot) { check(prefs.edit().putString("snapshot", json.encodeToString(snapshot)).commit()) { "Could not save screen lock" } }
}
