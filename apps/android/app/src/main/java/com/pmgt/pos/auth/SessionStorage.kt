package com.pmgt.pos.auth

import kotlinx.serialization.Serializable

@Serializable data class SessionTokens(val token: String, val refreshToken: String)

/** Stores credentials only. User identity and permissions always come from a live server query. */
interface SessionStorage {
    suspend fun read(): SessionTokens?
    suspend fun write(tokens: SessionTokens?)
}

class MemorySessionStorage : SessionStorage {
    private var tokens: SessionTokens? = null
    override suspend fun read() = tokens
    override suspend fun write(tokens: SessionTokens?) { this.tokens = tokens }
}
