package com.pmgt.pos.printer.settings

import android.content.Context
import android.content.ContextWrapper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real AndroidKeyStore compatibility fixture in an isolated preferences namespace. Canonical Expo
 * aliases are recorded before being mapped to UUID-owned aliases, so this never touches live
 * `.kotlin.dev` SecureStore values or canonical `key_v1` keys.
 */
@RunWith(AndroidJUnit4::class)
class PrinterSecurePreferencesAndroidTest {
    private lateinit var base: Context
    private lateinit var isolated: Context
    private lateinit var prefsName: String
    private val ownedAliases = linkedSetOf<String>()
    private val canonicalRequests = mutableListOf<String>()
    private val aliases = linkedMapOf<String, String>()

    @Before
    fun setUp() {
        base = ApplicationProvider.getApplicationContext()
        prefsName = "printer-settings-fixture-${UUID.randomUUID()}"
        isolated =
            object : ContextWrapper(base) {
                override fun getSharedPreferences(name: String, mode: Int) =
                    base.getSharedPreferences(prefsName, mode)
            }
    }

    @After
    fun cleanOwnedFixtureOnly() {
        check(base.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit().clear().commit())
        val store = keyStore()
        ownedAliases.forEach { alias ->
            if (store.containsAlias(alias)) store.deleteEntry(alias)
        }
    }

    @Test
    fun currentAndLegacyAesValuesReadWithExactExpoAliasRules() = runBlocking {
        val expected = settings("current")
        putAes("key_v1-printer_settings", expected, usesSuffix = true, includeAlias = true)

        assertEquals(expected, persistence().read())
        assertEquals(listOf(AES_SUFFIXED), canonicalRequests)

        clearFixtureValuesAndRequests()
        val legacy = settings("legacy")
        putAes("printer_settings", legacy, usesSuffix = false, includeAlias = false)

        assertEquals(legacy, persistence().read())
        assertEquals(listOf(AES_BASE), canonicalRequests)
    }

    @Test
    fun legacyHybridValueReadsWithoutKeystoreAliasMetadata() = runBlocking {
        val expected = settings("hybrid")
        putHybrid("printer_settings", expected)

        assertEquals(expected, persistence().read())
        assertEquals(listOf(RSA_BASE), canonicalRequests)
    }

    @Test
    fun preferredUnreadableNeverFallsBackAndBothRetainedEntriesRemainUntouched() {
        val legacy = settings("legacy")
        putAes("printer_settings", legacy, usesSuffix = false, includeAlias = false)
        val preferences = fixturePreferences()
        check(preferences.edit().putString("key_v1-printer_settings", "malformed").commit())

        assertThrows(PrinterSettingsUnavailable::class.java) {
            runBlocking { persistence().read() }
        }

        assertEquals("malformed", preferences.getString("key_v1-printer_settings", null))
        assertTrue(preferences.contains("printer_settings"))
    }

    @Test
    fun authRequiredMissingAliasAndCorruptionFailClosedWithoutMutation() {
        val preferences = fixturePreferences()
        val cases =
            listOf(
                JSONObject()
                    .put("scheme", "aes")
                    .put("ct", "AA==")
                    .put("iv", "AA==")
                    .put("tlen", 128)
                    .put("usesKeystoreSuffix", true)
                    .put("keystoreAlias", "key_v1")
                    .put("requireAuthentication", true)
                    .toString(),
                JSONObject()
                    .put("scheme", "aes")
                    .put("ct", "AA==")
                    .put("iv", Base64.encodeToString(ByteArray(12), Base64.NO_WRAP))
                    .put("tlen", 128)
                    .put("usesKeystoreSuffix", true)
                    .put("keystoreAlias", "key_v1")
                    .put("requireAuthentication", false)
                    .toString(),
                "{broken",
            )
        cases.forEach { retained ->
            check(preferences.edit().clear().putString("key_v1-printer_settings", retained).commit())
            canonicalRequests.clear()

            assertThrows(PrinterSettingsUnavailable::class.java) {
                runBlocking { persistence().read() }
            }

            assertEquals(retained, preferences.getString("key_v1-printer_settings", null))
        }
    }

    @Test
    fun writeUsesExpoReadableCurrentAesAndPreservesLegacyEntry() = runBlocking {
        val preferences = fixturePreferences()
        putAes("printer_settings", settings("legacy"), usesSuffix = false, includeAlias = false)
        val legacy = preferences.getString("printer_settings", null)
        val expected = settings("written")

        persistence().write(expected)

        assertEquals(listOf(AES_BASE, AES_SUFFIXED), canonicalRequests)
        assertEquals(legacy, preferences.getString("printer_settings", null))
        val encoded = JSONObject(preferences.getString("key_v1-printer_settings", null)!!)
        assertEquals("aes", encoded.getString("scheme"))
        assertEquals("key_v1", encoded.getString("keystoreAlias"))
        assertTrue(encoded.getBoolean("usesKeystoreSuffix"))
        assertFalse(encoded.getBoolean("requireAuthentication"))
        val plaintext = decryptExpoAes(encoded, mappedAlias(AES_SUFFIXED))
        assertEquals(expected, PrinterSettingsCodec.decode(plaintext))
    }

    @Test
    fun writeWillNotRecreateMissingAliasReferencedByRetainedCiphertext() {
        val retained =
            JSONObject()
                .put("scheme", "aes")
                .put("ct", "AA==")
                .put("iv", Base64.encodeToString(ByteArray(12), Base64.NO_WRAP))
                .put("tlen", 128)
                .put("usesKeystoreSuffix", true)
                .put("keystoreAlias", "key_v1")
                .put("requireAuthentication", false)
                .toString()
        check(fixturePreferences().edit().putString("another-retained-key", retained).commit())

        assertThrows(PrinterSettingsUnavailable::class.java) {
            runBlocking { persistence().write(settings("blocked")) }
        }

        assertFalse(keyStore().containsAlias(mappedAlias(AES_SUFFIXED)))
        assertEquals(retained, fixturePreferences().getString("another-retained-key", null))
    }

    private fun persistence() =
        AndroidPrinterSettingsPersistence(isolated, ::resolveAlias, Dispatchers.IO)

    private fun resolveAlias(canonical: String): String {
        canonicalRequests += canonical
        return mappedAlias(canonical)
    }

    private fun mappedAlias(canonical: String): String =
        aliases.getOrPut(canonical) {
            "pmgt-printer-fixture-${UUID.randomUUID()}-${canonical.hashCode()}".also(ownedAliases::add)
        }

    private fun putAes(
        storedKey: String,
        settings: PrinterSettings,
        usesSuffix: Boolean,
        includeAlias: Boolean,
    ) {
        val canonical = if (usesSuffix) AES_SUFFIXED else AES_BASE
        val key = createAes(mappedAlias(canonical))
        val cipher = Cipher.getInstance(AES).apply { init(Cipher.ENCRYPT_MODE, key) }
        val spec = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
        val item =
            JSONObject()
                .put("scheme", "aes")
                .put(
                    "ct",
                    Base64.encodeToString(
                        cipher.doFinal(PrinterSettingsCodec.encode(settings).toByteArray()),
                        Base64.NO_WRAP,
                    ),
                )
                .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP))
                .put("tlen", spec.tLen)
                .put("usesKeystoreSuffix", usesSuffix)
                .put("requireAuthentication", false)
        if (includeAlias) item.put("keystoreAlias", "key_v1")
        check(fixturePreferences().edit().putString(storedKey, item.toString()).commit())
    }

    private fun putHybrid(storedKey: String, settings: PrinterSettings) {
        val actualAlias = mappedAlias(RSA_BASE)
        val generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore")
        generator.initialize(
            KeyGenParameterSpec.Builder(actualAlias, KeyProperties.PURPOSE_DECRYPT)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
                .build()
        )
        val pair = generator.generateKeyPair()
        val rawAes = ByteArray(32).also(SecureRandom()::nextBytes)
        val dataCipher =
            Cipher.getInstance(AES).apply {
                init(Cipher.ENCRYPT_MODE, SecretKeySpec(rawAes, "AES"))
            }
        val spec = dataCipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
        val wrapped =
            Cipher.getInstance(RSA).run {
                init(Cipher.ENCRYPT_MODE, pair.public)
                doFinal(rawAes)
            }
        val item =
            JSONObject()
                .put("scheme", "hybrid")
                .put(
                    "ct",
                    Base64.encodeToString(
                        dataCipher.doFinal(PrinterSettingsCodec.encode(settings).toByteArray()),
                        Base64.NO_WRAP,
                    ),
                )
                .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP))
                .put("tlen", spec.tLen)
                .put("esk", Base64.encodeToString(wrapped, Base64.NO_WRAP))
                .put("usesKeystoreSuffix", false)
                .put("requireAuthentication", false)
        check(fixturePreferences().edit().putString(storedKey, item.toString()).commit())
    }

    private fun decryptExpoAes(item: JSONObject, alias: String): String {
        val key = (keyStore().getEntry(alias, null) as KeyStore.SecretKeyEntry).secretKey
        val cipher =
            Cipher.getInstance(AES).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    key,
                    GCMParameterSpec(
                        item.getInt("tlen"),
                        Base64.decode(item.getString("iv"), Base64.DEFAULT),
                    ),
                )
            }
        return String(cipher.doFinal(Base64.decode(item.getString("ct"), Base64.DEFAULT)))
    }

    private fun createAes(alias: String): SecretKey =
        KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false)
                    .build()
            )
            generateKey()
        }

    private fun settings(name: String) =
        PrinterSettings(
            printers =
                listOf(
                    PrinterConfig(
                        id = "AA:BB",
                        name = name,
                        deviceName = "Raw $name",
                        role = PrinterRole.RECEIPT,
                        paperWidth = PrinterPaperWidth.MM80,
                        isDefault = true,
                    )
                ),
            kitchenPrintingEnabled = true,
            cashDrawerEnabled = true,
            useReceiptPrinterForKitchen = true,
            minimalReceiptEnabled = true,
        )

    private fun clearFixtureValuesAndRequests() {
        check(fixturePreferences().edit().clear().commit())
        canonicalRequests.clear()
    }

    private fun fixturePreferences() =
        base.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private companion object {
        const val AES = "AES/GCM/NoPadding"
        const val RSA = "RSA/None/PKCS1Padding"
        const val AES_BASE = "$AES:key_v1"
        const val AES_SUFFIXED = "$AES_BASE:keystoreUnauthenticated"
        const val RSA_BASE = "$RSA:key_v1"
    }
}
