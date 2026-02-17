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
}
