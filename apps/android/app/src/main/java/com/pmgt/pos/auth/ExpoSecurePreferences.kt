package com.pmgt.pos.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

internal class SecurePreferenceUnavailable : Exception()

/**
 * Narrow Expo SecureStore compatibility for adopted preferences. It never deletes entries or
 * aliases and never replaces a missing alias while retained ciphertext still references it.
 */
internal class ExpoSecurePreferences(
    context: Context,
    private val aliasResolver: (canonicalAlias: String) -> String = { it },
) {
    private val preferences =
        context.getSharedPreferences(SHARED_PREFERENCES_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun read(logicalKey: String): String? {
        try {
            val preferred = "$DEFAULT_KEYCHAIN_SERVICE-$logicalKey"
            val storedKey =
                when {
                    preferences.contains(preferred) -> preferred
                    preferences.contains(logicalKey) -> logicalKey
                    else -> return null
                }
            val encoded = preferences.getString(storedKey, null) ?: throw SecurePreferenceUnavailable()
            return decrypt(JSONObject(encoded))
        } catch (failure: SecurePreferenceUnavailable) {
            throw failure
        } catch (_: Exception) {
            throw SecurePreferenceUnavailable()
        }
    }

    @Synchronized
    fun write(logicalKey: String, value: String) {
        try {
            // Refuse to overwrite evidence that cannot first be read with its recorded metadata.
            val preferred = "$DEFAULT_KEYCHAIN_SERVICE-$logicalKey"
            if (preferences.contains(preferred) || preferences.contains(logicalKey)) read(logicalKey)

            val canonicalAlias = "$AES:$DEFAULT_KEYCHAIN_SERVICE:$UNAUTHENTICATED_SUFFIX"
            val actualAlias = aliasResolver(canonicalAlias)
            val store = keyStore()
            val existing = store.getEntry(actualAlias, null)
            val key =
                if (existing == null) {
                    if (hasCiphertextReference(canonicalAlias)) throw SecurePreferenceUnavailable()
                    KeyGenerator.getInstance("AES", store.provider).run {
                        init(
                            KeyGenParameterSpec.Builder(
                                    actualAlias,
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
                } else {
                    (existing as? KeyStore.SecretKeyEntry)?.secretKey
                        ?: throw SecurePreferenceUnavailable()
                }
            val cipher = Cipher.getInstance(AES).apply { init(Cipher.ENCRYPT_MODE, key) }
            val spec = cipher.parameters.getParameterSpec(GCMParameterSpec::class.java)
            val item =
                JSONObject()
                    .put("scheme", "aes")
                    .put(
                        "ct",
                        Base64.encodeToString(
                            cipher.doFinal(value.toByteArray(Charsets.UTF_8)),
                            Base64.NO_WRAP,
                        ),
                    )
                    .put("iv", Base64.encodeToString(spec.iv, Base64.NO_WRAP))
                    .put("tlen", spec.tLen)
                    .put("usesKeystoreSuffix", true)
                    .put("keystoreAlias", DEFAULT_KEYCHAIN_SERVICE)
                    .put("requireAuthentication", false)
            if (!preferences.edit().putString(preferred, item.toString()).commit()) {
                throw SecurePreferenceUnavailable()
            }
        } catch (failure: SecurePreferenceUnavailable) {
            throw failure
        } catch (_: Exception) {
            throw SecurePreferenceUnavailable()
        }
    }

    private fun decrypt(item: JSONObject): String {
        if (item.optBoolean("requireAuthentication", false)) throw SecurePreferenceUnavailable()
        val keychainService =
            if (item.has("keystoreAlias")) item.getString("keystoreAlias")
            else DEFAULT_KEYCHAIN_SERVICE
        if (keychainService != DEFAULT_KEYCHAIN_SERVICE) throw SecurePreferenceUnavailable()
        val scheme = item.getString("scheme")
        val algorithm =
            when (scheme) {
                "aes" -> AES
                "hybrid" -> RSA
                else -> throw SecurePreferenceUnavailable()
            }
        val suffix =
            if (item.optBoolean("usesKeystoreSuffix", false)) ":$UNAUTHENTICATED_SUFFIX" else ""
        val actualAlias = aliasResolver("$algorithm:$keychainService$suffix")
        val entry = keyStore().getEntry(actualAlias, null) ?: throw SecurePreferenceUnavailable()
        val key: SecretKey =
            if (scheme == "aes") {
                (entry as? KeyStore.SecretKeyEntry)?.secretKey
                    ?: throw SecurePreferenceUnavailable()
            } else {
                val privateKey =
                    (entry as? KeyStore.PrivateKeyEntry)?.privateKey
                        ?: throw SecurePreferenceUnavailable()
                val unwrap = Cipher.getInstance(RSA).apply { init(Cipher.DECRYPT_MODE, privateKey) }
                SecretKeySpec(
                    unwrap.doFinal(Base64.decode(item.getString("esk"), Base64.DEFAULT)),
                    "AES",
                )
            }
        val tagBits = item.getInt("tlen")
        if (tagBits !in 96..128 || tagBits % 8 != 0) throw SecurePreferenceUnavailable()
        val cipher =
            Cipher.getInstance(AES).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    key,
                    GCMParameterSpec(
                        tagBits,
                        Base64.decode(item.getString("iv"), Base64.DEFAULT),
                    ),
                )
            }
        return String(
            cipher.doFinal(Base64.decode(item.getString("ct"), Base64.DEFAULT)),
            Charsets.UTF_8,
        )
    }

    private fun hasCiphertextReference(canonicalAlias: String): Boolean =
        preferences.all.values.any { stored ->
            val item = runCatching { JSONObject(stored as? String ?: return@any false) }.getOrNull()
                ?: return@any false
            canonicalAlias(item) == canonicalAlias
        }

    private fun canonicalAlias(item: JSONObject): String? {
        val algorithm =
            when (item.optString("scheme")) {
                "aes" -> AES
                "hybrid" -> RSA
                else -> return null
            }
        val keychainService = item.optString("keystoreAlias", DEFAULT_KEYCHAIN_SERVICE)
        val suffix =
            if (item.optBoolean("usesKeystoreSuffix", false)) {
                if (item.optBoolean("requireAuthentication", false)) AUTHENTICATED_SUFFIX
                else UNAUTHENTICATED_SUFFIX
            } else null
        return buildString {
            append(algorithm)
            append(':')
            append(keychainService)
            if (suffix != null) {
                append(':')
                append(suffix)
            }
        }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private companion object {
        const val SHARED_PREFERENCES_NAME = "SecureStore"
        const val DEFAULT_KEYCHAIN_SERVICE = "key_v1"
        const val AES = "AES/GCM/NoPadding"
        const val RSA = "RSA/None/PKCS1Padding"
        const val AUTHENTICATED_SUFFIX = "keystoreAuthenticated"
        const val UNAUTHENTICATED_SUFFIX = "keystoreUnauthenticated"
    }
}
