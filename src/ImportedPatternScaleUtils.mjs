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
     * Resolves imported preview scale factors relative to the full egg UV space.
     * Mirrors document-centered draw conversion on both axes.
     * @param {{ documentWidthPx?: number, documentHeightPx?: number, stepsPerTurn?: number, penRangeSteps?: number, stepScalingFactor?: number }} [input]
     * @returns {{ uScale: number, vScale: number }}
     */
    static resolveDrawAreaPreviewScales(input = {}) {
        const documentWidthPx = Number(input.documentWidthPx)
        const documentHeightPx = Number(input.documentHeightPx)
        const stepsPerTurn = Number(input.stepsPerTurn)
        const penRangeSteps = Number(input.penRangeSteps)
        const stepScalingFactor = Number(input.stepScalingFactor)

        if (!Number.isFinite(documentWidthPx) || documentWidthPx <= 0) {
            return { uScale: 1, vScale: 1 }
        }
        if (!Number.isFinite(documentHeightPx) || documentHeightPx <= 0) {
            return { uScale: 1, vScale: 1 }
        }
        if (!Number.isFinite(stepsPerTurn) || stepsPerTurn <= 0) {
            return { uScale: 1, vScale: 1 }
        }
        if (!Number.isFinite(penRangeSteps) || penRangeSteps <= 0) {
            return { uScale: 1, vScale: 1 }
        }
        if (!Number.isFinite(stepScalingFactor) || stepScalingFactor <= 0) {
            return { uScale: 1, vScale: 1 }
        }

        const uScale = (2 * documentWidthPx) / (stepScalingFactor * stepsPerTurn)
        const vScale = (2 * documentHeightPx) / (stepScalingFactor * penRangeSteps)
        if (!Number.isFinite(uScale) || uScale <= 0 || !Number.isFinite(vScale) || vScale <= 0) {
            return { uScale: 1, vScale: 1 }
        }

        return {
            uScale: Math.max(0.02, Math.min(3, uScale)),
            vScale: Math.max(0.02, Math.min(3, vScale))
        }
    }

    /**
     * Resolves one preview multiplier from document pixel size and draw range settings.
     * Returns preview aspect ratio as V/U scale for legacy callers.
     * @param {{ documentWidthPx?: number, documentHeightPx?: number, stepsPerTurn?: number, penRangeSteps?: number, stepScalingFactor?: number }} [input]
     * @returns {number}
     */
    static resolveDrawAreaPreviewRatio(input = {}) {
        const scales = ImportedPatternScaleUtils.resolveDrawAreaPreviewScales(input)
        const ratio = scales.vScale / scales.uScale
        if (!Number.isFinite(ratio) || ratio <= 0) return 1
        return Math.max(0.02, Math.min(3, ratio))
    }
}
