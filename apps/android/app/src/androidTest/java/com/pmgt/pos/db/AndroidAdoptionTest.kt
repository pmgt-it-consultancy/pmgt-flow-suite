package com.pmgt.pos.db

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import java.security.KeyPairGenerator
import javax.crypto.spec.SecretKeySpec

@RunWith(AndroidJUnit4::class)
class AndroidAdoptionTest {
    private fun context(): Context {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val name = "adoption-test-${UUID.randomUUID()}"
        val root = File(base.cacheDir, name).apply { mkdirs() }
        return object : ContextWrapper(base) {
            override fun getDatabasePath(name: String): File = if (File(name).isAbsolute) File(name) else File(root, "databases/$name")
            override fun getSharedPreferences(prefName: String, mode: Int) = base.getSharedPreferences("$name-$prefName", mode)
        }
    }

    private fun seedIdentity(context: Context, suffix: Boolean = true, legacyKey: Boolean = false): String {
        val expected = UUID.randomUUID().toString()
        val alias = "AES/GCM/NoPadding:key_v1" + if (suffix) ":keystoreUnauthenticated" else ""
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            generateKey()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        val item = JSONObject().put("scheme", "aes")
            .put("ct", Base64.encodeToString(cipher.doFinal(expected.toByteArray(Charsets.UTF_8)), Base64.DEFAULT))
            .put("iv", Base64.encodeToString(cipher.iv, Base64.DEFAULT)).put("tlen", 128)
            .put("keystoreAlias", "key_v1").put("requireAuthentication", false)
        if (suffix) item.put("usesKeystoreSuffix", true)
        check(context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE).edit()
            .putString(if (legacyKey) "pmgt.deviceId" else "key_v1-pmgt.deviceId", item.toString()).commit())
        return expected
    }

    private fun seedDatabase(context: Context): SQLiteDatabase {
        val path = AndroidDatabase.legacyPath(context)
        path.parentFile!!.mkdirs()
        return SQLiteDatabase.openOrCreateDatabase(path, null).apply {
            enableWriteAheadLogging()
            beginTransaction()
            try {
                LegacyDdl.statements.forEach(::execSQL)
                version = 3
                execSQL("INSERT INTO orders(id,_status,_changed,customer_name) VALUES ('pending','updated','customer_name','Legacy guest')")
                execSQL("INSERT INTO local_storage VALUES ('__watermelon_last_pulled_at','999')")
                setTransactionSuccessful()
            } finally { endTransaction() }
        }
    }

    @Test fun readsRealKeystoreExpoCurrentAndUnsuffixedLegacyEntries() {
        for ((suffix, legacy) in listOf(true to false, false to true)) {
            val context = context()
            val expected = seedIdentity(context, suffix, legacy)
            assertTrue("Recovered identity must be identical", expected == DeviceIdentity.readOrCreate(context, adopting = true))
        }
    }

    @Test fun preferredMalformedEntryBlocksAndPreservesCiphertextEvenWhenLegacyFallbackExists() {
        val context = context()
        seedIdentity(context, suffix = false, legacyKey = true)
        val prefs = context.getSharedPreferences("SecureStore", 0)
        check(prefs.edit().putString("key_v1-pmgt.deviceId", "malformed").commit())
        assertThrows(AdoptionBlocked::class.java) { DeviceIdentity.readOrCreate(context, adopting = false) }
        assertTrue(prefs.getString("key_v1-pmgt.deviceId", null) == "malformed")
        assertTrue(prefs.contains("pmgt.deviceId"))
    }

    @Test fun corruptedCiphertextAndUnsupportedHybridBlockWithoutRemovingOriginal() {
        for (damage in listOf("tag", "hybrid", "authentication")) {
            val context = context()
            seedIdentity(context)
            val prefs = context.getSharedPreferences("SecureStore", 0)
            val original = JSONObject(prefs.getString("key_v1-pmgt.deviceId", null)!!)
            when (damage) {
                "tag" -> original.put("ct", Base64.encodeToString(ByteArray(32), Base64.NO_WRAP))
                "hybrid" -> original.put("scheme", "hybrid").put("esk", "bad")
                else -> original.put("requireAuthentication", true)
            }
            val encoded = original.toString()
            check(prefs.edit().putString("key_v1-pmgt.deviceId", encoded).commit())
            assertThrows(AdoptionBlocked::class.java) { DeviceIdentity.readOrCreate(context, adopting = true) }
            assertTrue(prefs.getString("key_v1-pmgt.deviceId", null) == encoded)
        }
    }

    @Test fun readsExpoHybridUsingExistingAndroidRsaKeystoreKey() {
        val context = context()
        val alias = "RSA/None/PKCS1Padding:key_v1"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val entry = (store.getEntry(alias, null) as? KeyStore.PrivateKeyEntry) ?: run {
            KeyPairGenerator.getInstance("RSA", "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1).setKeySize(2048).build())
            }.generateKeyPair()
            store.getEntry(alias, null) as KeyStore.PrivateKeyEntry
        }
        val expected = UUID.randomUUID().toString()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val wrap = Cipher.getInstance("RSA/None/PKCS1Padding").apply { init(Cipher.ENCRYPT_MODE, entry.certificate.publicKey) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key.encoded, "AES")) }
        val item = JSONObject().put("scheme", "hybrid").put("tlen", 128)
            .put("esk", Base64.encodeToString(wrap.doFinal(key.encoded), Base64.DEFAULT))
            .put("ct", Base64.encodeToString(cipher.doFinal(expected.toByteArray()), Base64.DEFAULT))
            .put("iv", Base64.encodeToString(cipher.iv, Base64.DEFAULT))
        check(context.getSharedPreferences("SecureStore", 0).edit().putString("pmgt.deviceId", item.toString()).commit())
        assertTrue(expected == DeviceIdentity.readOrCreate(context, adopting = true))
    }

    @Test fun corruptDatabaseBlocksWithoutDefaultAndroidDeletion() {
        val context = context()
        seedIdentity(context)
        val path = AndroidDatabase.legacyPath(context)
        seedDatabase(context).close()
        val corrupt = path.readBytes().apply { this[100] = 0 } // Invalid SQLite b-tree page type.
        path.writeBytes(corrupt)
        assertThrows(AdoptionBlocked::class.java) { AndroidDatabase.open(context) }
        assertTrue(path.exists())
        assertArrayEquals(corrupt, path.readBytes())
    }

    @Test fun adoptsRootDatabaseWithCommittedWalAndPreservesSchemaThroughReopen() {
        val context = context()
        val expected = seedIdentity(context)
        seedDatabase(context).use { legacyWriter ->
            legacyWriter.execSQL("INSERT INTO orders(id,_status,_changed) VALUES ('wal-only','deleted','')")
            val path = AndroidDatabase.legacyPath(context)
            assertFalse(path.path.contains("/databases/"))
            assertTrue(File(path.path + "-wal").length() > 0)
            AndroidDatabase.open(context).use { db ->
                assertEquals(2, db.pendingCount())
                assertEquals("999", db.localValue("__watermelon_last_pulled_at"))
                assertTrue(expected == DeviceIdentity.readOrCreate(context, adopting = true))
            }
        }
        AndroidDatabase.open(context).use { db -> assertEquals(2, db.pendingCount()) }
        SQLiteDatabase.openDatabase(AndroidDatabase.legacyPath(context).path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            assertEquals(3, db.version)
            db.rawQuery("PRAGMA table_info(orders)", null).use { c -> while (c.moveToNext()) assertEquals("", c.getString(2)) }
            db.rawQuery("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'orders__status'", null).use { c -> c.moveToFirst(); assertEquals(1, c.getInt(0)) }
            db.rawQuery("PRAGMA table_info(local_storage)", null).use { c -> c.moveToFirst(); assertEquals("VARCHAR(16)", c.getString(2).uppercase()) }
        }
    }

    @Test fun missingIdentityAndMissingDatabaseBlockBeforeAnyCreation() {
        val withoutId = context()
        seedDatabase(withoutId).close()
        val bytes = AndroidDatabase.legacyPath(withoutId).readBytes()
        assertThrows(AdoptionBlocked::class.java) { AndroidDatabase.open(withoutId) }
        assertArrayEquals(bytes, AndroidDatabase.legacyPath(withoutId).readBytes())
        assertFalse(withoutId.getSharedPreferences("SecureStore", 0).contains("key_v1-pmgt.deviceId"))
        val withoutDb = context()
        seedIdentity(withoutDb)
        assertThrows(AdoptionBlocked::class.java) { AndroidDatabase.open(withoutDb) }
        assertFalse(AndroidDatabase.legacyPath(withoutDb).exists())
    }

    @Test fun invalidSchemaBlocksBeforeDriverCanDowngradeOrRecreate() {
        val context = context()
        seedIdentity(context)
        seedDatabase(context).use { it.version = 2 }
        val bytes = AndroidDatabase.legacyPath(context).readBytes()
        assertThrows(AdoptionBlocked::class.java) { AndroidDatabase.open(context) }
        assertArrayEquals(bytes, AndroidDatabase.legacyPath(context).readBytes())
    }

    @Test fun freshInstallAndInterruptedInitializationReuseOneEncryptedIdentity() {
        val context = context()
        AndroidDatabase.open(context).close()
        val first = DeviceIdentity.readOrCreate(context, adopting = true)
        AndroidDatabase.open(context).close()
        assertTrue(first == DeviceIdentity.readOrCreate(context, adopting = true))

        val interrupted = context()
        check(interrupted.getSharedPreferences("KotlinPosInitialization", 0).edit().putString("state", "initializing").commit())
        val saved = DeviceIdentity.readOrCreate(interrupted, adopting = false)
        SQLiteDatabase.openOrCreateDatabase(AndroidDatabase.legacyPath(interrupted), null).close() // Crash before schema transaction.
        AndroidDatabase.open(interrupted).use { assertEquals(0, it.pendingCount()) }
        assertTrue(saved == DeviceIdentity.readOrCreate(interrupted, adopting = true))
    }
}
