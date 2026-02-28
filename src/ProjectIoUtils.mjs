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
     * Converts servo value into approximate 0-100 pen position percentage.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #servoValueToPercent(value, fallback) {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return fallback
        const normalized = ((Math.trunc(parsed) - 5000) / 20000) * 100
        return Math.max(0, Math.min(100, normalized))
    }

    /**
     * Normalizes one stroke point for resume payloads.
     * @param {unknown} value
     * @returns {{ u: number, v: number } | null}
     */
    static #normalizeResumePoint(value) {
        if (!ProjectIoUtils.#isPlainObject(value)) return null
        const u = ProjectIoUtils.#toNumber(value.u, Number.NaN)
        const v = ProjectIoUtils.#toNumber(value.v, Number.NaN)
        if (!Number.isFinite(u) || !Number.isFinite(v)) return null
        return {
            u: Math.max(-8, Math.min(8, u)),
            v: Math.max(-8, Math.min(8, v))
        }
    }

    /**
     * Normalizes one stroke for resume payloads.
     * @param {unknown} value
     * @returns {{ points: Array<{ u: number, v: number }> } | null}
     */
    static #normalizeResumeStroke(value) {
        if (!ProjectIoUtils.#isPlainObject(value) || !Array.isArray(value.points)) return null
        const points = []
        for (let index = 0; index < value.points.length; index += 1) {
            const normalizedPoint = ProjectIoUtils.#normalizeResumePoint(value.points[index])
            if (!normalizedPoint) continue
            points.push(normalizedPoint)
            if (points.length >= 12000) break
        }
        if (points.length < 2) return null
        return { points }
    }

    /**
     * Normalizes persisted draw-resume state.
     * @param {unknown} value
     * @returns {{
     *   status: 'ready' | 'running' | 'paused',
     *   updatedAt: string,
     *   totalStrokes: number,
     *   completedStrokes: number,
     *   nextBatchIndex: number,
     *   nextStrokeIndex: number,
     *   coordinateMode: 'normalized-uv' | 'document-px-centered',
     *   documentWidthPx: number | null,
     *   documentHeightPx: number | null,
     *   stepScalingFactor: number,
     *   drawBatches: Array<{ colorIndex: number | null, strokes: Array<{ points: Array<{ u: number, v: number }> }> }>
     * } | null}
     */
    static #normalizeResumeState(value) {
        if (!ProjectIoUtils.#isPlainObject(value) || !Array.isArray(value.drawBatches)) {
            return null
        }

        const drawBatches = []
        let totalStrokes = 0
        for (let batchIndex = 0; batchIndex < value.drawBatches.length; batchIndex += 1) {
            if (drawBatches.length >= 120) break
            const rawBatch = value.drawBatches[batchIndex]
            if (!ProjectIoUtils.#isPlainObject(rawBatch) || !Array.isArray(rawBatch.strokes)) continue

            const strokes = []
            for (let strokeIndex = 0; strokeIndex < rawBatch.strokes.length; strokeIndex += 1) {
                if (totalStrokes >= 6000) break
                const normalizedStroke = ProjectIoUtils.#normalizeResumeStroke(rawBatch.strokes[strokeIndex])
                if (!normalizedStroke) continue
                strokes.push(normalizedStroke)
                totalStrokes += 1
            }
            if (!strokes.length) continue

            const rawColorIndex = Number(rawBatch.colorIndex)
            const colorIndex = Number.isInteger(rawColorIndex) ? rawColorIndex : null
            drawBatches.push({
                colorIndex,
                strokes
            })

            if (totalStrokes >= 6000) break
        }

        if (!drawBatches.length || totalStrokes <= 0) {
            return null
        }

        const clampedTotalStrokes = Math.max(1, totalStrokes)
        const nextBatchIndex = Math.max(
            0,
            Math.min(drawBatches.length - 1, Math.trunc(ProjectIoUtils.#toNumber(value.nextBatchIndex, 0)))
        )
        const maxStrokeIndex = Math.max(0, drawBatches[nextBatchIndex].strokes.length)
        const nextStrokeIndex = Math.max(
            0,
            Math.min(maxStrokeIndex, Math.trunc(ProjectIoUtils.#toNumber(value.nextStrokeIndex, 0)))
        )

        let fallbackCompleted = 0
        for (let index = 0; index < nextBatchIndex; index += 1) {
            fallbackCompleted += drawBatches[index].strokes.length
        }
        fallbackCompleted += nextStrokeIndex
        const completedStrokes = Math.max(
            0,
            Math.min(clampedTotalStrokes, Math.trunc(ProjectIoUtils.#toNumber(value.completedStrokes, fallbackCompleted)))
        )

        const rawStatus = String(value.status || '')
            .trim()
            .toLowerCase()
        const status = ['ready', 'running', 'paused'].includes(rawStatus) ? rawStatus : 'paused'
        const coordinateMode =
            String(value.coordinateMode || '').trim() === 'document-px-centered' ? 'document-px-centered' : 'normalized-uv'
        const documentWidthPxValue = ProjectIoUtils.#toNumber(value.documentWidthPx, Number.NaN)
        const documentHeightPxValue = ProjectIoUtils.#toNumber(value.documentHeightPx, Number.NaN)
        const documentWidthPx =
            coordinateMode === 'document-px-centered' && Number.isFinite(documentWidthPxValue) && documentWidthPxValue > 0
                ? Math.max(1, documentWidthPxValue)
                : null
        const documentHeightPx =
            coordinateMode === 'document-px-centered' && Number.isFinite(documentHeightPxValue) && documentHeightPxValue > 0
                ? Math.max(1, documentHeightPxValue)
                : null
        const stepScalingFactor = Math.max(1, Math.min(64, Math.trunc(ProjectIoUtils.#toNumber(value.stepScalingFactor, 2))))
        const updatedAt = String(value.updatedAt || '').trim() || new Date(0).toISOString()

        return {
            status,
            updatedAt,
            totalStrokes: clampedTotalStrokes,
            completedStrokes,
            nextBatchIndex,
            nextStrokeIndex,
            coordinateMode,
            documentWidthPx,
            documentHeightPx,
            stepScalingFactor,
            drawBatches
        }
    }

    /**
     * Builds a serializable payload from runtime state.
     * @param {Record<string, any>} state
     * @returns {Record<string, any>}
     */
    static buildProjectPayload(state) {
        return {
            version: AppVersion.get(),
            schemaVersion: 2,
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
            importHeightScale: Math.max(0.1, Math.min(3, ProjectIoUtils.#toNumber(state.importHeightScale, 1))),
            resumeState: ProjectIoUtils.#normalizeResumeState(state.resumeState),
            showHorizontalLines: ProjectIoUtils.#toBoolean(state.showHorizontalLines, true),
            fillPatterns: ProjectIoUtils.#toBoolean(state.fillPatterns, true),
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
                connectionTransport: ['serial', 'ble'].includes(
                    String(state?.drawConfig?.connectionTransport || '')
                        .trim()
                        .toLowerCase()
                )
                    ? String(state?.drawConfig?.connectionTransport || '')
                          .trim()
                          .toLowerCase()
                    : 'serial',
                baudRate: Math.max(300, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.baudRate, 115200))),
                wifiHost: String(state?.drawConfig?.wifiHost || '').trim(),
                wifiPort: Math.max(1, Math.min(65535, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.wifiPort, 1337)))),
                wifiSecure: ProjectIoUtils.#toBoolean(state?.drawConfig?.wifiSecure, false),
                stepsPerTurn: Math.max(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.stepsPerTurn, 3200))),
                penRangeSteps: Math.max(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penRangeSteps, 1500))),
                msPerStep: Math.max(0.2, Math.min(20, ProjectIoUtils.#toNumber(state?.drawConfig?.msPerStep, 1.8))),
                servoUp: Math.max(0, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.servoUp, 12000))),
                servoDown: Math.max(0, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.servoDown, 17000))),
                invertPen: ProjectIoUtils.#toBoolean(state?.drawConfig?.invertPen, false),
                penUpPercent: Math.max(
                    0,
                    Math.min(
                        100,
                        ProjectIoUtils.#toNumber(
                            state?.drawConfig?.penUpPercent,
                            ProjectIoUtils.#servoValueToPercent(state?.drawConfig?.servoUp, 35)
                        )
                    )
                ),
                penDownPercent: Math.max(
                    0,
                    Math.min(
                        100,
                        ProjectIoUtils.#toNumber(
                            state?.drawConfig?.penDownPercent,
                            ProjectIoUtils.#servoValueToPercent(state?.drawConfig?.servoDown, 60)
                        )
                    )
                ),
                penDownSpeed: Math.max(10, Math.min(4000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penDownSpeed, 300)))),
                penUpSpeed: Math.max(10, Math.min(4000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penUpSpeed, 400)))),
                penMotorSpeed: Math.max(
                    10,
                    Math.min(4000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penMotorSpeed, 4000)))
                ),
                eggMotorSpeed: Math.max(
                    10,
                    Math.min(4000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.eggMotorSpeed, 4000)))
                ),
                penRaiseRate: Math.max(1, Math.min(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penRaiseRate, 50)))),
                penRaiseDelayMs: Math.max(
                    0,
                    Math.min(5000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penRaiseDelayMs, 200)))
                ),
                penLowerRate: Math.max(1, Math.min(100, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penLowerRate, 20)))),
                penLowerDelayMs: Math.max(
                    0,
                    Math.min(5000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.penLowerDelayMs, 400)))
                ),
                reversePenMotor: ProjectIoUtils.#toBoolean(state?.drawConfig?.reversePenMotor, true),
                reverseEggMotor: ProjectIoUtils.#toBoolean(state?.drawConfig?.reverseEggMotor, true),
                wrapAround: ProjectIoUtils.#toBoolean(state?.drawConfig?.wrapAround, true),
                returnHome: ProjectIoUtils.#toBoolean(state?.drawConfig?.returnHome, true),
                printColorMode: String(state?.drawConfig?.printColorMode || '')
                    .trim()
                    .toLowerCase() === 'single'
                    ? 'single'
                    : 'per-color',
                inkscapeSvgCompatMode: ProjectIoUtils.#toBoolean(state?.drawConfig?.inkscapeSvgCompatMode, false),
                engraverEnabled: ProjectIoUtils.#toBoolean(state?.drawConfig?.engraverEnabled, false),
                curveSmoothing: Math.max(0, Math.min(2, ProjectIoUtils.#toNumber(state?.drawConfig?.curveSmoothing, 0.2))),
                setupApplyAction:
                    String(state?.drawConfig?.setupApplyAction || '').trim().toLowerCase() === 'raise-off'
                        ? 'raise-off'
                        : 'toggle',
                manualCommand: [
                    'disable-motors',
                    'enable-motors',
                    'raise-pen',
                    'lower-pen',
                    'walk-egg',
                    'walk-pen',
                    'query-version'
                ].includes(String(state?.drawConfig?.manualCommand || '').trim())
                    ? String(state?.drawConfig?.manualCommand || '').trim()
                    : 'disable-motors',
                manualWalkDistance: Math.max(
                    -64000,
                    Math.min(64000, Math.trunc(ProjectIoUtils.#toNumber(state?.drawConfig?.manualWalkDistance, 3200)))
                ),
                activeControlTab: ['plot', 'setup', 'timing', 'options', 'manual', 'resume', 'layers', 'advanced'].includes(
                    String(state?.drawConfig?.activeControlTab || '').trim()
                )
                    ? String(state?.drawConfig?.activeControlTab || '').trim()
                    : 'plot'
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
            palette: [...payload.palette],
            resumeState: payload.resumeState ? { ...payload.resumeState } : null
        }
    }
}
