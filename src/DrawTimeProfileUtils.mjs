const DEFAULT_UPDATED_AT = new Date(0).toISOString()
const MIN_DURATION_SCALE = 0.25
const MAX_DURATION_SCALE = 4
const MAX_STROKE_SAMPLE_COUNT = 100000

/**
 * Helpers for one persisted draw-time calibration profile.
 */
export class DrawTimeProfileUtils {
    /**
     * Returns the default persisted draw-time profile.
     * @returns {{ schemaVersion: number, updatedAt: string, strokeSampleCount: number, durationScale: number }}
     */
    static createDefaultProfile() {
        return {
            schemaVersion: 1,
            updatedAt: DEFAULT_UPDATED_AT,
            strokeSampleCount: 0,
            durationScale: 1
        }
    }

    /**
     * Returns true when the provided value is one plain object.
     * @param {unknown} value
     * @returns {boolean}
     */
    static #isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    }

    /**
     * Coerces one number with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #toNumber(value, fallback) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Clamps one duration scale into the supported range.
     * @param {unknown} value
     * @returns {number}
     */
    static #clampDurationScale(value) {
        const numeric = DrawTimeProfileUtils.#toNumber(value, 1)
        return Math.max(MIN_DURATION_SCALE, Math.min(MAX_DURATION_SCALE, numeric))
    }

    /**
     * Returns one valid ISO timestamp with fallback.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeUpdatedAt(value) {
        const raw = String(value || '').trim()
        if (!raw) return DEFAULT_UPDATED_AT
        const parsedMs = Date.parse(raw)
        return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : DEFAULT_UPDATED_AT
    }

    /**
     * Resolves one smoothing alpha for the next measurement.
     * Earlier samples adapt faster than established profiles.
     * @param {number} strokeSampleCount
     * @returns {number}
     */
    static #resolveBlendAlpha(strokeSampleCount) {
        const normalizedCount = Math.max(0, Math.trunc(Number(strokeSampleCount) || 0))
        if (normalizedCount <= 0) return 1
        if (normalizedCount < 12) return 0.25
        if (normalizedCount < 40) return 0.14
        return 0.08
    }

    /**
     * Normalizes one persisted draw-time profile.
     * @param {unknown} value
     * @returns {{ schemaVersion: number, updatedAt: string, strokeSampleCount: number, durationScale: number }}
     */
    static normalizeProfile(value) {
        if (!DrawTimeProfileUtils.#isPlainObject(value)) {
            return DrawTimeProfileUtils.createDefaultProfile()
        }

        return {
            schemaVersion: 1,
            updatedAt: DrawTimeProfileUtils.#normalizeUpdatedAt(value.updatedAt),
            strokeSampleCount: Math.max(
                0,
                Math.min(MAX_STROKE_SAMPLE_COUNT, Math.trunc(DrawTimeProfileUtils.#toNumber(value.strokeSampleCount, 0)))
            ),
            durationScale: DrawTimeProfileUtils.#clampDurationScale(value.durationScale)
        }
    }

    /**
     * Returns true when the profile already contains measured strokes.
     * @param {unknown} profile
     * @returns {boolean}
     */
    static hasMeasurements(profile) {
        return DrawTimeProfileUtils.normalizeProfile(profile).strokeSampleCount > 0
    }

    /**
     * Updates one profile with a newly measured stroke duration.
     * @param {unknown} profile
     * @param {{ actualDurationMs?: number, estimatedDurationMs?: number, updatedAt?: string }} measurement
     * @returns {{ schemaVersion: number, updatedAt: string, strokeSampleCount: number, durationScale: number }}
     */
    static updateWithStrokeMeasurement(profile, measurement = {}) {
        const normalizedProfile = DrawTimeProfileUtils.normalizeProfile(profile)
        const actualDurationMs = DrawTimeProfileUtils.#toNumber(measurement.actualDurationMs, Number.NaN)
        const estimatedDurationMs = DrawTimeProfileUtils.#toNumber(measurement.estimatedDurationMs, Number.NaN)
        if (!(actualDurationMs > 0) || !(estimatedDurationMs > 0)) {
            return normalizedProfile
        }

        const measuredScale = DrawTimeProfileUtils.#clampDurationScale(actualDurationMs / estimatedDurationMs)
        const alpha = DrawTimeProfileUtils.#resolveBlendAlpha(normalizedProfile.strokeSampleCount)
        const durationScale =
            normalizedProfile.strokeSampleCount > 0
                ? DrawTimeProfileUtils.#clampDurationScale(
                      normalizedProfile.durationScale * (1 - alpha) + measuredScale * alpha
                  )
                : measuredScale

        return {
            schemaVersion: 1,
            updatedAt: DrawTimeProfileUtils.#normalizeUpdatedAt(measurement.updatedAt || new Date().toISOString()),
            strokeSampleCount: Math.min(MAX_STROKE_SAMPLE_COUNT, normalizedProfile.strokeSampleCount + 1),
            durationScale
        }
    }

    /**
     * Applies the persisted duration scale to one baseline estimate.
     * @param {number} durationMs
     * @param {unknown} profile
     * @returns {number}
     */
    static applyDurationScale(durationMs, profile) {
        const normalizedDurationMs = Math.max(0, Math.round(Number(durationMs) || 0))
        if (normalizedDurationMs <= 0) return 0
        const normalizedProfile = DrawTimeProfileUtils.normalizeProfile(profile)
        return Math.max(0, Math.round(normalizedDurationMs * normalizedProfile.durationScale))
    }
}
