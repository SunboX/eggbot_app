/**
 * Stateful low-pass smoothing for draw remaining-time estimates.
 */
export class DrawProgressSmoother {
    #lastRemainingMs
    #lastUpdatedAtMs

    constructor() {
        this.#lastRemainingMs = null
        this.#lastUpdatedAtMs = 0
    }

    /**
     * Clears smoothing state for a new draw run.
     */
    reset() {
        this.#lastRemainingMs = null
        this.#lastUpdatedAtMs = 0
    }

    /**
     * Smooths one raw remaining-duration sample.
     * @param {number | null | undefined} remainingMs
     * @param {number} [nowMs=Date.now()]
     * @returns {number | null}
     */
    update(remainingMs, nowMs = Date.now()) {
        const normalizedNowMs = DrawProgressSmoother.#normalizeTimestamp(nowMs)
        const normalizedRemainingMs = DrawProgressSmoother.#normalizeRemainingMs(remainingMs)
        if (normalizedRemainingMs === null) {
            this.#lastUpdatedAtMs = normalizedNowMs
            return null
        }

        if (normalizedRemainingMs <= 0) {
            this.#lastRemainingMs = 0
            this.#lastUpdatedAtMs = normalizedNowMs
            return 0
        }

        if (!Number.isFinite(this.#lastRemainingMs) || this.#lastUpdatedAtMs <= 0) {
            this.#lastRemainingMs = normalizedRemainingMs
            this.#lastUpdatedAtMs = normalizedNowMs
            return normalizedRemainingMs
        }

        const elapsedMs = Math.max(0, normalizedNowMs - this.#lastUpdatedAtMs)
        const projectedCountdownMs = Math.max(0, Number(this.#lastRemainingMs) - elapsedMs)
        const maxUpwardCorrectionMs = Math.max(1200, elapsedMs)
        const limitedTargetMs = Math.min(normalizedRemainingMs, projectedCountdownMs + maxUpwardCorrectionMs)
        const deltaMs = limitedTargetMs - projectedCountdownMs
        const correctionAlpha = deltaMs <= 0 ? 0.45 : 0.18
        const smoothedRemainingMs = Math.max(0, Math.round(projectedCountdownMs + deltaMs * correctionAlpha))

        this.#lastRemainingMs = smoothedRemainingMs
        this.#lastUpdatedAtMs = normalizedNowMs
        return smoothedRemainingMs
    }

    /**
     * Normalizes one optional remaining-time sample to integer milliseconds.
     * @param {number | null | undefined} value
     * @returns {number | null}
     */
    static #normalizeRemainingMs(value) {
        if (value === null || value === undefined) return null
        const parsed = Math.round(Number(value))
        if (!Number.isFinite(parsed)) return null
        return Math.max(0, parsed)
    }

    /**
     * Normalizes one timestamp value to a non-negative integer.
     * @param {number} value
     * @returns {number}
     */
    static #normalizeTimestamp(value) {
        const parsed = Math.round(Number(value))
        if (!Number.isFinite(parsed)) return 0
        return Math.max(0, parsed)
    }
}
