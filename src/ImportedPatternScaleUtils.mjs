/**
 * Math helpers for imported pattern vertical scaling.
 */
export class ImportedPatternScaleUtils {
    /**
     * Clamps an imported pattern height scale value.
     * @param {number} value
     * @returns {number}
     */
    static clampScale(value) {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) return 1
        return Math.max(0.1, Math.min(3, numeric))
    }

    /**
     * Resolves the live preview height ratio from parsed and active scale values.
     * @param {{ parsedHeightRatio?: number, parsedHeightScale?: number, activeHeightScale?: number }} [input]
     * @returns {number}
     */
    static resolvePreviewHeightRatio(input = {}) {
        const parsedHeightRatio = Number(input.parsedHeightRatio)
        if (!Number.isFinite(parsedHeightRatio) || parsedHeightRatio <= 0) {
            return 1
        }

        const parsedHeightScale = ImportedPatternScaleUtils.clampScale(input.parsedHeightScale)
        const activeHeightScale = ImportedPatternScaleUtils.clampScale(input.activeHeightScale)
        const baseHeightRatio = parsedHeightRatio / parsedHeightScale

        return Math.max(0.02, Math.min(3, baseHeightRatio * activeHeightScale))
    }

    /**
     * Resolves one imported draw ratio while preventing out-of-bounds clipping distortion.
     * Imported SVG plotting should never scale above the source document height (v281 parity).
     * @param {{ parsedHeightRatio?: number, parsedHeightScale?: number, activeHeightScale?: number }} [input]
     * @returns {number}
     */
    static resolveDrawHeightRatio(input = {}) {
        const previewRatio = ImportedPatternScaleUtils.resolvePreviewHeightRatio(input)
        return Math.max(0.02, Math.min(1, previewRatio))
    }

    /**
     * Resolves one preview multiplier from document pixel size and draw range settings.
     * @param {{ documentHeightPx?: number, penRangeSteps?: number, stepScalingFactor?: number }} [input]
     * @returns {number}
     */
    static resolveDrawAreaPreviewRatio(input = {}) {
        const documentHeightPx = Number(input.documentHeightPx)
        const penRangeSteps = Number(input.penRangeSteps)
        const stepScalingFactor = Number(input.stepScalingFactor)

        if (!Number.isFinite(documentHeightPx) || documentHeightPx <= 0) return 1
        if (!Number.isFinite(penRangeSteps) || penRangeSteps <= 0) return 1
        if (!Number.isFinite(stepScalingFactor) || stepScalingFactor <= 0) return 1

        const ratio = (2 * documentHeightPx) / (stepScalingFactor * penRangeSteps)
        if (!Number.isFinite(ratio) || ratio <= 0) return 1
        return Math.max(0.02, Math.min(3, ratio))
    }
}
