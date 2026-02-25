/**
 * Helpers for draw-progress time payload normalization.
 */
export class DrawProgressTimeUtils {
    /**
     * Normalizes optional remaining-duration input from transport progress callbacks.
     * @param {unknown} value
     * @returns {number | null}
     */
    static normalizeRemainingMs(value) {
        if (value === null || value === undefined) {
            return null
        }
        if (typeof value === 'string' && value.trim() === '') {
            return null
        }
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
            return null
        }
        return Math.max(0, Math.round(parsed))
    }
}
