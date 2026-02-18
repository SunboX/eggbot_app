import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'
import { AppVersion } from './AppVersion.mjs'

/**
 * Project serialization and normalization helpers.
 */
export class ProjectIoUtils {
    /**
     * Returns true for plain objects.
     * @param {unknown} value
     * @returns {boolean}
     */
    static #isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    }

    /**
     * Coerces a number with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #toNumber(value, fallback) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Coerces a boolean with fallback.
     * @param {unknown} value
     * @param {boolean} fallback
     * @returns {boolean}
     */
    static #toBoolean(value, fallback) {
        if (typeof value === 'boolean') return value
        if (typeof value === 'number') return value !== 0
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false
        }
        return fallback
    }

    /**
     * Builds a serializable payload from runtime state.
     * @param {Record<string, any>} state
     * @returns {Record<string, any>}
     */
    static buildProjectPayload(state) {
        return {
            version: AppVersion.get(),
            schemaVersion: 1,
            projectName: String(state.projectName || '').trim() || 'Sorbische Komposition',
            preset: String(state.preset || 'traditional-mix'),
            seed: Math.trunc(ProjectIoUtils.#toNumber(state.seed, 1)),
            symmetry: Math.max(2, Math.min(24, Math.trunc(ProjectIoUtils.#toNumber(state.symmetry, 8)))),
            density: Math.max(0.05, Math.min(1, ProjectIoUtils.#toNumber(state.density, 0.58))),
            bands: Math.max(1, Math.min(16, Math.trunc(ProjectIoUtils.#toNumber(state.bands, 6)))),
            ornamentSize: Math.max(0.5, Math.min(2, ProjectIoUtils.#toNumber(state.ornamentSize, 1))),
            ornamentCount: Math.max(0.5, Math.min(2, ProjectIoUtils.#toNumber(state.ornamentCount, 1))),
            ornamentDistribution: Math.max(0.6, Math.min(1.6, ProjectIoUtils.#toNumber(state.ornamentDistribution, 1))),
            lineWidth: Math.max(0.5, Math.min(4, ProjectIoUtils.#toNumber(state.lineWidth, 1.8))),
            importHeightScale: Math.max(0.1, Math.min(3, ProjectIoUtils.#toNumber(state.importHeightScale, 0.85))),
            showHorizontalLines: ProjectIoUtils.#toBoolean(state.showHorizontalLines, true),
            baseColor: String(state.baseColor || '#efe7ce'),
            palette: Array.isArray(state.palette)
                ? state.palette.map((value) => String(value || '')).filter(Boolean)
                : AppRuntimeConfig.getDefaultPalette().slice(0, 4),
            motifs: {
                dots: ProjectIoUtils.#toBoolean(state?.motifs?.dots, true),
                rays: ProjectIoUtils.#toBoolean(state?.motifs?.rays, true),
                honeycomb: ProjectIoUtils.#toBoolean(state?.motifs?.honeycomb, true),
                wolfTeeth: ProjectIoUtils.#toBoolean(state?.motifs?.wolfTeeth, true),
                pineBranch: ProjectIoUtils.#toBoolean(state?.motifs?.pineBranch, false),
                diamonds: ProjectIoUtils.#toBoolean(state?.motifs?.diamonds, true)
            },
            drawConfig: {
                stepsPerTurn: Math.max(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.stepsPerTurn, 3200))),
                penRangeSteps: Math.max(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penRangeSteps, 1500))),
                msPerStep: Math.max(0.2, Math.min(20, ProjectIoUtils.#toNumber(state?.drawConfig?.msPerStep, 1.8))),
                servoUp: Math.max(0, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.servoUp, 12000))),
                servoDown: Math.max(0, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.servoDown, 17000))),
                invertPen: ProjectIoUtils.#toBoolean(state?.drawConfig?.invertPen, false)
            }
        }
    }

    /**
     * Applies a raw payload to a normalized runtime state.
     * @param {Record<string, any>} rawState
     * @returns {Record<string, any>}
     */
    static normalizeProjectState(rawState) {
        if (!ProjectIoUtils.#isPlainObject(rawState)) {
            throw new Error('Invalid project file: expected an object.')
        }

        const defaults = AppRuntimeConfig.createDefaultState()
        const payload = ProjectIoUtils.buildProjectPayload({ ...defaults, ...rawState })

        if (!payload.palette.length) {
            payload.palette = defaults.palette.slice()
        }

        const hasAnyMotif = Object.values(payload.motifs).some(Boolean)
        if (!hasAnyMotif) {
            payload.motifs = AppRuntimeConfig.presetMotifs(payload.preset)
        }

        return {
            ...defaults,
            ...payload,
            motifs: { ...payload.motifs },
            drawConfig: { ...payload.drawConfig },
            palette: [...payload.palette]
        }
    }
}
