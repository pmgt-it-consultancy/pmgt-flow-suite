package com.pmgt.pos

/** Absorbs a lone back press at the app root so a stray tap cannot close the till. */
internal class BackToExit(private val now: () -> Long) {
    private var armedAt: Long? = null

    /** True when this press confirms the exit armed by the previous one. */
    fun press(): Boolean {
        val at = now()
        val confirmed = armedAt?.let { at - it < WINDOW_MS } == true
        armedAt = if (confirmed) null else at
        return confirmed
    }

    companion object {
        /** Matches `Toast.LENGTH_SHORT`, so the hint is on screen for the whole window. */
        const val WINDOW_MS = 2_000L
    }
}
