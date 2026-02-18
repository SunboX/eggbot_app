/**
 * Helpers for remapping UV stroke ranges.
 */
export class PatternStrokeScaleUtils {
    /**
     * Clamps one ratio value into supported bounds.
     * @param {number} ratio
     * @returns {number}
     */
    static clampRatio(ratio) {
        return Math.max(0.02, Math.min(3, Number(ratio) || 1))
    }

    /**
     * Rescales UV strokes proportionally from one drawable ratio into another.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>} strokes
     * @param {number} fromRatio
     * @param {number} toRatio
     * @returns {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>}
     */
    static rescaleStrokes(strokes, fromRatio, toRatio) {
        const sourceRatio = PatternStrokeScaleUtils.clampRatio(fromRatio)
        const targetRatio = PatternStrokeScaleUtils.clampRatio(toRatio)
        if (Math.abs(sourceRatio - targetRatio) < 1e-6) return Array.isArray(strokes) ? strokes : []
        if (!Array.isArray(strokes)) return []

        const scale = targetRatio / sourceRatio
        const sourceOffsetV = (1 - sourceRatio) / 2
        const targetOffsetV = (1 - targetRatio) / 2
        const entries = strokes.map((stroke, index) => {
            if (!Array.isArray(stroke?.points)) {
                return {
                    index,
                    stroke,
                    groupKey: PatternStrokeScaleUtils.#resolveScaleGroupKey(stroke, index),
                    unwrapped: [],
                    shouldScaleU: false,
                    centerU: 0
                }
            }
            const unwrapped = PatternStrokeScaleUtils.#unwrapStroke(stroke.points)
            const minU = Math.min(...unwrapped.map((point) => Number(point.u)))
            const maxU = Math.max(...unwrapped.map((point) => Number(point.u)))
            const spanU = Math.max(0, maxU - minU)
            const centerU = unwrapped.reduce((sum, point) => sum + Number(point.u), 0) / Math.max(1, unwrapped.length)
            return {
                index,
                stroke,
                groupKey: PatternStrokeScaleUtils.#resolveScaleGroupKey(stroke, index),
                unwrapped,
                shouldScaleU: spanU < 0.95,
                centerU
            }
        })

        const groupedEntries = new Map()
        entries.forEach((entry) => {
            const list = groupedEntries.get(entry.groupKey) || []
            list.push(entry)
            groupedEntries.set(entry.groupKey, list)
        })
        const groupTransforms = new Map()
        groupedEntries.forEach((group, key) => {
            groupTransforms.set(key, PatternStrokeScaleUtils.#buildGroupTransform(group))
        })

        return entries.map((entry) => {
            const stroke = entry.stroke
            if (!Array.isArray(stroke?.points)) return stroke
            const transform = groupTransforms.get(entry.groupKey)
            const shift = transform?.shifts.get(entry.index) || 0
            const anchorU = transform?.anchorU ?? entry.centerU
            return {
                ...stroke,
                points: stroke.points.map((point, index) => {
                    const unwrappedPoint = entry.unwrapped[index]
                    const alignedU = Number(unwrappedPoint.u) + shift
                    const uScaled = entry.shouldScaleU ? anchorU + (alignedU - anchorU) * scale : Number(unwrappedPoint.u)
                    const localV = PatternStrokeScaleUtils.#clamp(
                        (Number(point.v) - sourceOffsetV) / sourceRatio,
                        0,
                        1
                    )
                    return {
                        u: PatternStrokeScaleUtils.#normalizeU(uScaled),
                        v: PatternStrokeScaleUtils.#clamp(targetOffsetV + localV * targetRatio, 0, 1)
                    }
                })
            }
        })
    }

    /**
     * Resolves one stable scale-group key for shared U-anchor transforms.
     * @param {Record<string, any>} stroke
     * @param {number} index
     * @returns {string}
     */
    static #resolveScaleGroupKey(stroke, index) {
        const transformGroupId = Math.trunc(Number(stroke?.transformGroupId))
        if (Number.isFinite(transformGroupId) && transformGroupId > 0) {
            return `transform:${transformGroupId}`
        }
        const fillGroupId = Math.trunc(Number(stroke?.fillGroupId))
        if (Number.isFinite(fillGroupId)) {
            return `fill:${fillGroupId}`
        }
        return `stroke:${index}`
    }

    /**
     * Builds one per-group U transform and unwrap shifts.
     * @param {Array<{ index: number, unwrapped: Array<{u:number,v:number}>, shouldScaleU: boolean, centerU: number }>} entries
     * @returns {{ anchorU: number, shifts: Map<number, number> }}
     */
    static #buildGroupTransform(entries) {
        const shifts = new Map()
        const scalable = entries.filter((entry) => entry.shouldScaleU && entry.unwrapped.length)
        if (!scalable.length) {
            return { anchorU: 0.5, shifts }
        }

        let runningCenter = scalable[0].centerU
        let weightedSum = 0
        let totalWeight = 0
        scalable.forEach((entry) => {
            const shift = Math.round(runningCenter - entry.centerU)
            const alignedCenter = entry.centerU + shift
            const weight = Math.max(1, entry.unwrapped.length)
            shifts.set(entry.index, shift)
            weightedSum += alignedCenter * weight
            totalWeight += weight
            runningCenter = weightedSum / totalWeight
        })

        return {
            anchorU: totalWeight > 0 ? weightedSum / totalWeight : 0.5,
            shifts
        }
    }

    /**
     * Converts wrapped U values into a continuous path.
     * @param {Array<{u:number,v:number}>} points
     * @returns {Array<{u:number,v:number}>}
     */
    static #unwrapStroke(points) {
        if (!points.length) return []
        const result = [
            {
                u: Number(points[0].u),
                v: Number(points[0].v)
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const previous = result[index - 1]
            const current = points[index]
            const baseU = Number(current.u)
            const options = [
                { value: baseU - 1, wrapShift: 1 },
                { value: baseU, wrapShift: 0 },
                { value: baseU + 1, wrapShift: 1 }
            ]
            let selected = options[0]
            let bestDistance = Math.abs(options[0].value - previous.u)
            for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                const candidate = options[optionIndex]
                const distance = Math.abs(candidate.value - previous.u)
                if (
                    distance < bestDistance - 1e-9 ||
                    (Math.abs(distance - bestDistance) <= 1e-9 && candidate.wrapShift < selected.wrapShift)
                ) {
                    bestDistance = distance
                    selected = candidate
                }
            }
            result.push({
                u: selected.value,
                v: Number(current.v)
            })
        }

        return result
    }

    /**
     * Wraps U coordinate into [0,1).
     * @param {number} value
     * @returns {number}
     */
    static #normalizeU(value) {
        const wrapped = value % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }

    /**
     * Clamps one numeric value into min/max bounds.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static #clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value)))
    }
}
