import { EggBotPathComputeTasks } from './EggBotPathComputeTasks.mjs'
import { DrawTimeProfileUtils } from './DrawTimeProfileUtils.mjs'

/**
 * Shared helpers for estimating draw duration from stroke geometry and timing settings.
 */
export class DrawTimeEstimator {
    /**
     * Normalizes one draw config for estimation.
     * @param {Record<string, any>} drawConfig
     * @returns {{
     *   stepsPerTurn: number,
     *   penRangeSteps: number,
     *   penDownSpeed: number,
     *   penUpSpeed: number,
     *   penRaiseDelayMs: number,
     *   penLowerDelayMs: number,
     *   wrapAround: boolean,
     *   returnHome: boolean,
     *   coordinateMode: 'normalized-uv' | 'document-px-centered',
     *   documentWidthPx: number,
     *   documentHeightPx: number,
     *   stepScalingFactor: number,
     *   drawOutputScale: number
     * }}
     */
    static #normalizeDrawConfig(drawConfig = {}) {
        const penDownSpeed = Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penDownSpeed) || 300)))
        const penUpSpeed = Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penUpSpeed) || Math.max(400, penDownSpeed))))
        return {
            stepsPerTurn: Math.max(100, Math.round(Number(drawConfig.stepsPerTurn) || 3200)),
            penRangeSteps: Math.max(100, Math.round(Number(drawConfig.penRangeSteps) || 1500)),
            penDownSpeed,
            penUpSpeed,
            penRaiseDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penRaiseDelayMs) || 200))),
            penLowerDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penLowerDelayMs) || 400))),
            wrapAround: drawConfig.wrapAround !== false,
            returnHome: Boolean(drawConfig.returnHome),
            coordinateMode:
                String(drawConfig.coordinateMode || '').trim() === 'document-px-centered'
                    ? 'document-px-centered'
                    : 'normalized-uv',
            documentWidthPx: Math.max(1, Number(drawConfig.documentWidthPx) || 3200),
            documentHeightPx: Math.max(1, Number(drawConfig.documentHeightPx) || 800),
            stepScalingFactor: Math.max(1, Math.round(Number(drawConfig.stepScalingFactor) || 2)),
            drawOutputScale: Math.max(0.5, Math.min(2, Number(drawConfig.drawOutputScale) || 1))
        }
    }

    /**
     * Rounds one step coordinate with half-away-from-zero semantics.
     * @param {unknown} value
     * @returns {number}
     */
    static #roundStepCoordinate(value) {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) return 0
        return numeric < 0 ? -Math.round(Math.abs(numeric)) : Math.round(numeric)
    }

    /**
     * Resolves one move duration from one delta vector and speed.
     * @param {number} deltaX
     * @param {number} deltaY
     * @param {number} speedStepsPerSecond
     * @returns {number}
     */
    static #resolveMoveDurationMs(deltaX, deltaY, speedStepsPerSecond) {
        const profileSpeed = Math.max(10, Math.min(4000, Number(speedStepsPerSecond) || 200))
        const distanceSteps = Math.hypot(deltaX, deltaY)
        return Math.max(1, distanceSteps > 0 ? Math.ceil((distanceSteps / profileSpeed) * 1000) : 0)
    }

    /**
     * Estimates one move duration and mutates the current point.
     * @param {{ x: number, y: number }} target
     * @param {{ x: number, y: number }} current
     * @param {number} speedStepsPerSecond
     * @returns {number}
     */
    static #estimateMoveDurationMs(target, current, speedStepsPerSecond) {
        const dx = Math.round(Number(target?.x) - current.x)
        const dy = Math.round(Number(target?.y) - current.y)
        if (dx === 0 && dy === 0) return 0

        const durationMs = DrawTimeEstimator.#resolveMoveDurationMs(dx, dy, speedStepsPerSecond)
        current.x = Math.round(Number(target?.x) || 0)
        current.y = Math.round(Number(target?.y) || 0)
        return durationMs
    }

    /**
     * Resolves one bounding-box center for prepared draw strokes.
     * @param {Array<Array<{ x: number, y: number }>>} drawableStrokes
     * @returns {{ x: number, y: number } | null}
     */
    static #resolveDrawOutputBoundsCenter(drawableStrokes) {
        let minX = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY

        const preparedStrokeList = Array.isArray(drawableStrokes) ? drawableStrokes : []
        preparedStrokeList.forEach((stroke) => {
            if (!Array.isArray(stroke)) return
            stroke.forEach((point) => {
                const x = Number(point?.x)
                const y = Number(point?.y)
                if (!Number.isFinite(x) || !Number.isFinite(y)) return
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            })
        })

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null
        }

        return {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        }
    }

    /**
     * Applies the optional draw-output scaling around the prepared path center.
     * @param {Array<Array<{ x: number, y: number }>>} drawableStrokes
     * @param {number} drawOutputScale
     * @returns {Array<Array<{ x: number, y: number }>>}
     */
    static #buildDrawOutputStrokes(drawableStrokes, drawOutputScale) {
        const preparedStrokeList = Array.isArray(drawableStrokes) ? drawableStrokes : []
        if (!preparedStrokeList.length) return []

        const scale = Number(drawOutputScale)
        if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.000001) {
            return preparedStrokeList
        }

        const center = DrawTimeEstimator.#resolveDrawOutputBoundsCenter(preparedStrokeList)
        if (!center) {
            return preparedStrokeList
        }

        return preparedStrokeList.map((stroke) => {
            if (!Array.isArray(stroke)) return []
            return stroke.map((point) => {
                const x = Number(point?.x)
                const y = Number(point?.y)
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    return point
                }
                return {
                    x: DrawTimeEstimator.#roundStepCoordinate(center.x + (x - center.x) * scale),
                    y: DrawTimeEstimator.#roundStepCoordinate(center.y + (y - center.y) * scale)
                }
            })
        })
    }

    /**
     * Estimates one prepared draw run, including one initial pen-up command and optional return-home move.
     * @param {{ drawableStrokes?: Array<Array<{ x: number, y: number }>>, drawConfig?: Record<string, any>, startPoint?: { x: number, y: number } }} input
     * @returns {{ estimatedTotalMs: number, estimatedReturnHomeMs: number, estimatedStrokeDurationsMs: number[] }}
     */
    static describePreparedStrokeRun(input = {}) {
        const cfg = DrawTimeEstimator.#normalizeDrawConfig(input.drawConfig || {})
        const current = {
            x: Math.round(Number(input?.startPoint?.x) || 0),
            y: Math.round(Number(input?.startPoint?.y) || 0)
        }
        const preparedStrokeList = Array.isArray(input.drawableStrokes) ? input.drawableStrokes : []
        const estimatedStrokeDurationsMs = []
        let validStrokeCount = 0
        let totalMs = 0

        for (let strokeIndex = 0; strokeIndex < preparedStrokeList.length; strokeIndex += 1) {
            const preparedStroke = preparedStrokeList[strokeIndex]
            if (!Array.isArray(preparedStroke) || preparedStroke.length < 2) {
                estimatedStrokeDurationsMs.push(0)
                continue
            }

            if (validStrokeCount === 0) {
                totalMs += cfg.penRaiseDelayMs
            }

            let strokeDurationMs = 0
            strokeDurationMs += DrawTimeEstimator.#estimateMoveDurationMs(preparedStroke[0], current, cfg.penUpSpeed)
            strokeDurationMs += cfg.penLowerDelayMs

            for (let pointIndex = 1; pointIndex < preparedStroke.length; pointIndex += 1) {
                strokeDurationMs += DrawTimeEstimator.#estimateMoveDurationMs(preparedStroke[pointIndex], current, cfg.penDownSpeed)
            }

            strokeDurationMs += cfg.penRaiseDelayMs
            totalMs += strokeDurationMs
            validStrokeCount += 1
            estimatedStrokeDurationsMs.push(Math.max(0, Math.round(strokeDurationMs)))
        }

        let estimatedReturnHomeMs = 0
        if (validStrokeCount > 0 && cfg.returnHome) {
            estimatedReturnHomeMs = DrawTimeEstimator.#estimateMoveDurationMs({ x: 0, y: 0 }, current, cfg.penUpSpeed)
            totalMs += estimatedReturnHomeMs
        }

        return {
            estimatedTotalMs: Math.max(0, Math.round(totalMs)),
            estimatedReturnHomeMs: Math.max(0, Math.round(estimatedReturnHomeMs)),
            estimatedStrokeDurationsMs
        }
    }

    /**
     * Estimates draw duration for one raw stroke list using the current machine settings and profile.
     * @param {{ strokes?: Array<{ points?: Array<{ u: number, v: number }> }>, drawConfig?: Record<string, any>, profile?: unknown }} input
     * @returns {{ strokeCount: number, estimatedBaseMs: number, estimatedCalibratedMs: number, estimatedStrokeDurationsMs: number[] }}
     */
    static estimatePatternDuration(input = {}) {
        const cfg = DrawTimeEstimator.#normalizeDrawConfig(input.drawConfig || {})
        const prepared = EggBotPathComputeTasks.prepareDrawStrokes({
            strokes: Array.isArray(input.strokes) ? input.strokes : [],
            drawConfig: {
                stepsPerTurn: cfg.stepsPerTurn,
                penRangeSteps: cfg.penRangeSteps,
                wrapAround: cfg.wrapAround,
                coordinateMode: cfg.coordinateMode,
                documentWidthPx: cfg.documentWidthPx,
                documentHeightPx: cfg.documentHeightPx,
                stepScalingFactor: cfg.stepScalingFactor
            },
            startX: 0
        })
        const drawableStrokes = DrawTimeEstimator.#buildDrawOutputStrokes(prepared?.strokes, cfg.drawOutputScale)
        const estimatedRun = DrawTimeEstimator.describePreparedStrokeRun({
            drawableStrokes,
            drawConfig: cfg
        })
        const strokeCount = estimatedRun.estimatedStrokeDurationsMs.filter((durationMs) => durationMs > 0).length
        const estimatedBaseMs = strokeCount > 0 ? estimatedRun.estimatedTotalMs : 0

        return {
            strokeCount,
            estimatedBaseMs,
            estimatedCalibratedMs: DrawTimeProfileUtils.applyDurationScale(estimatedBaseMs, input.profile),
            estimatedStrokeDurationsMs: estimatedRun.estimatedStrokeDurationsMs
        }
    }
}
