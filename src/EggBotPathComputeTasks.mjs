/**
 * Pure math tasks for EggBot draw-path preprocessing.
 */
export class EggBotPathComputeTasks {
    /**
     * Converts UV strokes into EggBot step coordinates and aligns seam-wrapped X travel.
     * @param {{ strokes?: Array<{ points: Array<{u:number,v:number}>, closed?: boolean }>, drawConfig?: { stepsPerTurn?: number, penRangeSteps?: number, wrapAround?: boolean }, startX?: number }} input
     * @returns {{ strokes: Array<Array<{x:number,y:number}>> }}
     */
    static prepareDrawStrokes(input) {
        const cfg = EggBotPathComputeTasks.#normalizeConfig(input?.drawConfig)
        const strokes = Array.isArray(input?.strokes) ? input.strokes : []
        const output = []
        let currentX = Number.isFinite(Number(input?.startX)) ? Math.round(Number(input.startX)) : 0

        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
            const normalizedStrokePoints = EggBotPathComputeTasks.#normalizeStrokePoints(
                stroke.points,
                Boolean(stroke?.closed)
            )
            const scaled = EggBotPathComputeTasks.#scaleStrokePoints(normalizedStrokePoints, cfg)
            const aligned = cfg.wrapAround ? EggBotPathComputeTasks.#alignStrokeXToCurrent(scaled, currentX, cfg.wrapPeriod) : scaled
            if (aligned.length < 2) return
            output.push(aligned)
            currentX = aligned[aligned.length - 1].x
        })

        return { strokes: output }
    }

    /**
     * Normalizes required draw configuration values.
     * @param {{ stepsPerTurn?: number, penRangeSteps?: number, wrapAround?: boolean, coordinateMode?: string, documentWidthPx?: number, documentHeightPx?: number, stepScalingFactor?: number } | undefined} drawConfig
     * @returns {{ stepsPerTurn: number, penRangeSteps: number, wrapAround: boolean, coordinateMode: 'normalized-uv' | 'document-px-centered', documentWidthPx: number, documentHeightPx: number, stepScalingFactor: number, wrapPeriod: number }}
     */
    static #normalizeConfig(drawConfig) {
        const stepsPerTurn = Math.max(100, Math.round(Number(drawConfig?.stepsPerTurn) || 3200))
        const penRangeSteps = Math.max(100, Math.round(Number(drawConfig?.penRangeSteps) || 1500))
        const coordinateMode =
            String(drawConfig?.coordinateMode || '').trim() === 'document-px-centered'
                ? 'document-px-centered'
                : 'normalized-uv'
        const documentWidthPx = Math.max(1, Number(drawConfig?.documentWidthPx) || stepsPerTurn)
        const documentHeightPx = Math.max(1, Number(drawConfig?.documentHeightPx) || penRangeSteps)
        const stepScalingFactor = Math.max(1, Math.round(Number(drawConfig?.stepScalingFactor) || 2))
        const wrapPeriod = stepsPerTurn
        return {
            stepsPerTurn,
            penRangeSteps,
            wrapAround: drawConfig?.wrapAround !== false,
            coordinateMode,
            documentWidthPx,
            documentHeightPx,
            stepScalingFactor,
            wrapPeriod
        }
    }

    /**
     * Normalizes one stroke and appends the start point for closed paths when needed.
     * @param {Array<{u:number,v:number}>} points
     * @param {boolean} closed
     * @returns {Array<{u:number,v:number}>}
     */
    static #normalizeStrokePoints(points, closed) {
        if (!Array.isArray(points) || !points.length) return []

        const normalized = points
            .map((point) => ({
                u: Number(point?.u),
                v: Number(point?.v)
            }))
            .filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v))

        if (normalized.length < 2 || !closed) return normalized

        const first = normalized[0]
        const last = normalized[normalized.length - 1]
        const wrappedDeltaU = (((last.u - first.u) % 1) + 1) % 1
        const seamDistanceU = Math.min(wrappedDeltaU, 1 - wrappedDeltaU)
        const distanceV = Math.abs(last.v - first.v)
        const endpointDistance = Math.hypot(seamDistanceU, distanceV)

        if (endpointDistance <= 1e-6) {
            return normalized
        }

        return [
            ...normalized,
            {
                u: first.u,
                v: first.v
            }
        ]
    }

    /**
     * Converts normalized stroke points into step coordinates according to active coordinate mode.
     * @param {Array<{u:number,v:number}>} points
     * @param {{ stepsPerTurn: number, penRangeSteps: number, coordinateMode: 'normalized-uv' | 'document-px-centered', documentWidthPx: number, documentHeightPx: number, stepScalingFactor: number }} cfg
     * @returns {Array<{x:number,y:number}>}
     */
    static #scaleStrokePoints(points, cfg) {
        if (cfg.coordinateMode === 'document-px-centered') {
            return EggBotPathComputeTasks.#unwrapAndScaleDocumentStroke(points, cfg)
        }
        return EggBotPathComputeTasks.#unwrapAndScaleStroke(points, cfg)
    }

    /**
     * Converts wrapped UV points into step coordinates.
     * @param {Array<{u:number,v:number}>} points
     * @param {{ stepsPerTurn: number, penRangeSteps: number }} cfg
     * @returns {Array<{x:number,y:number}>}
     */
    static #unwrapAndScaleStroke(points, cfg) {
        if (!points.length) return []

        const unwrapped = [
            {
                u: points[0].u,
                v: points[0].v
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const prev = unwrapped[index - 1]
            const current = points[index]
            const options = [current.u - 1, current.u, current.u + 1]
            let selected = options[0]
            let distance = Math.abs(options[0] - prev.u)
            for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                const candidate = options[optionIndex]
                const candidateDistance = Math.abs(candidate - prev.u)
                if (candidateDistance < distance) {
                    distance = candidateDistance
                    selected = candidate
                }
            }
            unwrapped.push({
                u: selected,
                v: current.v
            })
        }

        const maxY = cfg.penRangeSteps / 2
        return unwrapped.map((point) => ({
            x: Math.round(point.u * cfg.stepsPerTurn),
            y: Math.max(-maxY, Math.min(maxY, Math.round((0.5 - point.v) * cfg.penRangeSteps)))
        }))
    }

    /**
     * Converts wrapped UV points into v281-style centered document coordinates.
     * @param {Array<{u:number,v:number}>} points
     * @param {{ documentWidthPx: number, documentHeightPx: number, stepScalingFactor: number }} cfg
     * @returns {Array<{x:number,y:number}>}
     */
    static #unwrapAndScaleDocumentStroke(points, cfg) {
        if (!points.length) return []
        const widthFactor = (2 * cfg.documentWidthPx) / cfg.stepScalingFactor
        const heightFactor = (2 * cfg.documentHeightPx) / cfg.stepScalingFactor
        return points.map((point) => ({
            x: Math.round((point.u - 0.5) * widthFactor),
            y: Math.round((point.v - 0.5) * heightFactor)
        }))
    }

    /**
     * Aligns a stroke along X to minimize travel from current position.
     * @param {Array<{x:number,y:number}>} points
     * @param {number} currentX
     * @param {number} period
     * @returns {Array<{x:number,y:number}>}
     */
    static #alignStrokeXToCurrent(points, currentX, period) {
        if (!points.length) return []
        const safePeriod = Math.max(1, Math.round(Number(period) || 1))
        const shiftTurns = Math.round((currentX - points[0].x) / safePeriod)
        const shift = shiftTurns * safePeriod
        return points.map((point) => ({
            x: point.x + shift,
            y: point.y
        }))
    }
}
