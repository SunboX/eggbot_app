/**
 * Shared UV unwrapping helpers for texture rendering.
 */
export class UvStrokeUnwrapUtils {
    /**
     * Unwraps normalized U values into a continuous stroke sequence.
     * Only treats jumps as seam crossings when both points are near opposite seam edges.
     * @param {Array<{u:number,v:number}>} points
     * @returns {Array<{u:number,v:number}>}
     */
    static unwrapStroke(points) {
        if (!Array.isArray(points) || !points.length) return []

        const firstU = Number(points[0].u)
        const output = [
            {
                u: firstU,
                v: Number(points[0].v)
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const previous = output[index - 1]
            const currentU = Number(points[index].u)
            const previousWrapped = UvStrokeUnwrapUtils.#wrap01(previous.u)
            const currentWrapped = UvStrokeUnwrapUtils.#wrap01(currentU)
            const rawDelta = Math.abs(currentWrapped - previousWrapped)
            const seamCrossLikely = UvStrokeUnwrapUtils.#isLikelySeamCross(previousWrapped, currentWrapped)
            const revolutionOffset = Math.round(previous.u - previousWrapped)
            let nextU = currentWrapped + revolutionOffset

            if (rawDelta > 0.5 && seamCrossLikely) {
                const options = [nextU - 1, nextU, nextU + 1]
                nextU = options[0]
                let bestDistance = Math.abs(options[0] - previous.u)
                for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                    const candidate = options[optionIndex]
                    const distance = Math.abs(candidate - previous.u)
                    if (distance < bestDistance) {
                        bestDistance = distance
                        nextU = candidate
                    }
                }
            }

            output.push({
                u: nextU,
                v: Number(points[index].v)
            })
        }

        return output
    }

    /**
     * Determines whether one jump likely crosses the UV seam.
     * @param {number} previousU
     * @param {number} currentU
     * @returns {boolean}
     */
    static #isLikelySeamCross(previousU, currentU) {
        const lowThreshold = 0.1
        const highThreshold = 0.9
        return (
            (previousU >= highThreshold && currentU <= lowThreshold) ||
            (previousU <= lowThreshold && currentU >= highThreshold)
        )
    }

    /**
     * Wraps one U coordinate into [0,1).
     * @param {number} value
     * @returns {number}
     */
    static #wrap01(value) {
        const wrapped = Number(value) % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }
}
