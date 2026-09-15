package com.pmgt.pos.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Atomic credential file excluded from backup. A lost Keystore key returns to online login. */
class AndroidSessionStorage(context: Context) : SessionStorage {
    private val file = AtomicFile(File(context.noBackupFilesDir, "pos-session.enc"))
    private val alias = "pmgt.pos.session.v1"
    private val associatedData = "pmgt.pos.session.v1".toByteArray()

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    override suspend fun read(): SessionTokens? = withContext(Dispatchers.IO) {
        if (!file.baseFile.exists()) return@withContext null
        try {
            val bytes = file.readFully()
            require(bytes.size > 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(associatedData)
            Json.decodeFromString<SessionTokens>(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
        } catch (_: Exception) { file.delete(); null }
    }

    override suspend fun write(tokens: SessionTokens?): Unit = withContext(Dispatchers.IO) {
        if (tokens == null) { file.delete(); return@withContext }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(associatedData)
        val bytes = cipher.iv + cipher.doFinal(Json.encodeToString(tokens).toByteArray())
        val stream = file.startWrite()
        try { stream.write(bytes); file.finishWrite(stream) }
        catch (e: Exception) { file.failWrite(stream); throw e }
    }
}
