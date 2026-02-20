/**
 * Pure math tasks for EggBot draw-path preprocessing.
 */
export class EggBotPathComputeTasks {
    /**
     * Converts UV strokes into EggBot step coordinates and aligns seam-wrapped X travel.
     * @param {{ strokes?: Array<{ points: Array<{u:number,v:number}> }>, drawConfig?: { stepsPerTurn?: number, penRangeSteps?: number }, startX?: number }} input
     * @returns {{ strokes: Array<Array<{x:number,y:number}>> }}
     */
    static prepareDrawStrokes(input) {
        const cfg = EggBotPathComputeTasks.#normalizeConfig(input?.drawConfig)
        const strokes = Array.isArray(input?.strokes) ? input.strokes : []
        const output = []
        let currentX = Number.isFinite(Number(input?.startX)) ? Math.round(Number(input.startX)) : 0

        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
            const scaled = EggBotPathComputeTasks.#unwrapAndScaleStroke(stroke.points, cfg)
            const aligned = EggBotPathComputeTasks.#alignStrokeXToCurrent(scaled, currentX, cfg.stepsPerTurn)
            if (aligned.length < 2) return
            output.push(aligned)
            currentX = aligned[aligned.length - 1].x
        })

        return { strokes: output }
    }

    /**
     * Normalizes required draw configuration values.
     * @param {{ stepsPerTurn?: number, penRangeSteps?: number } | undefined} drawConfig
     * @returns {{ stepsPerTurn: number, penRangeSteps: number }}
     */
    static #normalizeConfig(drawConfig) {
        return {
            stepsPerTurn: Math.max(100, Math.round(Number(drawConfig?.stepsPerTurn) || 3200)),
            penRangeSteps: Math.max(100, Math.round(Number(drawConfig?.penRangeSteps) || 1500))
        }
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
     * Aligns a stroke along X to minimize travel from current position.
     * @param {Array<{x:number,y:number}>} points
     * @param {number} currentX
     * @param {number} stepsPerTurn
     * @returns {Array<{x:number,y:number}>}
     */
    static #alignStrokeXToCurrent(points, currentX, stepsPerTurn) {
        if (!points.length) return []
        const shiftTurns = Math.round((currentX - points[0].x) / stepsPerTurn)
        const shift = shiftTurns * stepsPerTurn
        return points.map((point) => ({
            x: point.x + shift,
            y: point.y
        }))
    }
}
