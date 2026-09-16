package com.pmgt.pos.db

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Reads Expo's entry in place. Failure never deletes ciphertext or replaces a Keystore key. */
object DeviceIdentity {
    private const val preferredKey = "key_v1-pmgt.deviceId"
    private const val legacyKey = "pmgt.deviceId"
    private const val aes = "AES/GCM/NoPadding"
    private const val rsa = "RSA/None/PKCS1Padding"

    internal fun hasEntry(context: Context): Boolean = preferences(context).let { it.contains(preferredKey) || it.contains(legacyKey) }
    internal fun hasSecureStoreEvidence(context: Context): Boolean = preferences(context).all.isNotEmpty()
    private fun preferences(context: Context) = context.getSharedPreferences("SecureStore", Context.MODE_PRIVATE)

    @Synchronized
    fun readOrCreate(context: Context, adopting: Boolean): String {
        try {
            if (hasEntry(context)) {
                val prefs = preferences(context)
                // An unreadable preferred entry must not silently fall back to a different identity.
                val encoded = prefs.getString(if (prefs.contains(preferredKey)) preferredKey else legacyKey, null)
                    ?: throw AdoptionBlocked("The existing device identity is unreadable. Adoption is blocked.")
                return decrypt(JSONObject(encoded))
            }
            if (adopting || AndroidDatabase.legacyPath(context).exists()) {
                throw AdoptionBlocked("The existing tablet has no readable device identity. Adoption is blocked.")
            }
            Initialization.beginOrResume(context)
            val identity = UUID.randomUUID().toString()
            val alias = "$aes:key_v1:keystoreUnauthenticated"
            val store = keyStore()
            val existing = store.getEntry(alias, null)
            val key = if (existing == null) {
                KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
                    init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(false).build())
                    generateKey()
                }
            } else (existing as? KeyStore.SecretKeyEntry)?.secretKey
                ?: throw AdoptionBlocked("The device encryption key is incompatible. Initialization is blocked.")
            val cipher = Cipher.getInstance(aes).apply { init(Cipher.ENCRYPT_MODE, key) }
            val spec = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
            val item = JSONObject().put("scheme", "aes")
                .put("ct", Base64.encodeToString(cipher.doFinal(identity.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
                .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP)).put("tlen", spec.tLen)
                .put("usesKeystoreSuffix", true).put("keystoreAlias", "key_v1").put("requireAuthentication", false)
            if (!preferences(context).edit().putString(preferredKey, item.toString()).commit()) {
                throw AdoptionBlocked("Could not persist the new device identity. Initialization is blocked.")
            }
            return identity
        } catch (error: AdoptionBlocked) {
            throw error
        } catch (_: Exception) {
            // Do not include exception messages: JSON/crypto exceptions can expose stored content.
            throw AdoptionBlocked("The existing device identity cannot be decrypted. Keep the original tablet data and repair identity access before continuing.")
        }
    }

    private fun decrypt(item: JSONObject): String {
        if (item.optBoolean("requireAuthentication", false)) {
            throw AdoptionBlocked("This device identity requires Android authentication. Unlock it in the compatible app before adoption.")
        }
        if (item.has("keystoreAlias") && item.getString("keystoreAlias") != "key_v1") {
            throw AdoptionBlocked("The device identity uses an unsupported keychain service. Adoption is blocked.")
        }
        val scheme = item.getString("scheme")
        val algorithm = when (scheme) {
            "aes" -> aes
            "hybrid" -> rsa
            else -> throw AdoptionBlocked("The device identity uses an unknown encryption scheme. Adoption is blocked.")
        }
        val suffix = if (item.optBoolean("usesKeystoreSuffix", false)) ":keystoreUnauthenticated" else ""
        val entry = keyStore().getEntry("$algorithm:key_v1$suffix", null)
            ?: throw AdoptionBlocked("The existing device encryption key is missing. Adoption is blocked.")
        val key: SecretKey = if (scheme == "aes") {
            (entry as? KeyStore.SecretKeyEntry)?.secretKey
                ?: throw AdoptionBlocked("The device encryption key is incompatible. Adoption is blocked.")
        } else {
            val privateKey = (entry as? KeyStore.PrivateKeyEntry)?.privateKey
                ?: throw AdoptionBlocked("The legacy device encryption key is incompatible. Adoption is blocked.")
            val unwrap = Cipher.getInstance(rsa).apply { init(Cipher.DECRYPT_MODE, privateKey) }
            SecretKeySpec(unwrap.doFinal(Base64.decode(item.getString("esk"), Base64.DEFAULT)), "AES")
        }
        val tagBits = item.getInt("tlen")
        if (tagBits !in 96..128 || tagBits % 8 != 0) throw AdoptionBlocked("The device identity has invalid authentication metadata.")
        val cipher = Cipher.getInstance(aes).apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(tagBits, Base64.decode(item.getString("iv"), Base64.DEFAULT)))
        }
        val value = String(cipher.doFinal(Base64.decode(item.getString("ct"), Base64.DEFAULT)), Charsets.UTF_8)
        if (value.isBlank()) throw AdoptionBlocked("The existing device identity is empty. Adoption is blocked.")
        return value
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}

/** Write intent before either resource exists; resume only an initialization this app began. */
internal object Initialization {
    private fun preferences(context: Context) = context.getSharedPreferences("KotlinPosInitialization", Context.MODE_PRIVATE)
    fun state(context: Context): String? = preferences(context).getString("state", null)

    fun beginOrResume(context: Context) {
        val expectedPath = AndroidDatabase.legacyPath(context)
        if (!expectedPath.exists() && (java.io.File(expectedPath.path + "-wal").exists() || java.io.File(expectedPath.path + "-shm").exists())) {
            throw AdoptionBlocked("Local database sidecar files exist without their database. Initialization is blocked.")
        }
        when (state(context)) {
            "initializing" -> return
            null -> {
                val path = AndroidDatabase.legacyPath(context)
                val alternate = context.getDatabasePath("watermelon.db")
                if (path.exists() || java.io.File(path.path + "-wal").exists() || java.io.File(path.path + "-shm").exists() || alternate.exists() || DeviceIdentity.hasSecureStoreEvidence(context)) {
                    throw AdoptionBlocked("Existing tablet storage is incomplete. Initialization is blocked to preserve its identity and sales.")
                }
                save(context, "initializing")
            }
            else -> throw AdoptionBlocked("Previously initialized tablet storage is missing or inconsistent. Initialization is blocked.")
        }
    }

    fun complete(context: Context) = save(context, "complete")
    private fun save(context: Context, state: String) {
        if (!preferences(context).edit().putString("state", state).commit()) throw AdoptionBlocked("Could not persist tablet initialization state.")
    }
}
