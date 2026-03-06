import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'

/**
 * Helpers for keeping draw-trace overlays aligned with rendered preview geometry.
 */
export class DrawTraceStrokeUtils {
    /**
     * Builds one preview-aligned draw-trace stroke list.
     * Imported SVG rendering remaps draw geometry into the machine footprint on the egg.
     * This method mirrors that remap for live/completed trace overlays.
     * @param {{ strokes?: Array<{ colorIndex?: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>, importedPatternActive?: boolean, isInkscapeCompatMode?: boolean, drawHeightRatio?: number, previewHeightRatio?: number, previewScaleU?: number, previewScaleV?: number }} [input]
     * @returns {Array<{ colorIndex?: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>}
     */
    static buildPreviewAlignedStrokes(input = {}) {
        const strokes = Array.isArray(input.strokes) ? input.strokes : []
        if (!input.importedPatternActive || input.isInkscapeCompatMode) {
            return strokes
        }

        const previewScaleU = Number(input.previewScaleU)
        const previewScaleV = Number(input.previewScaleV)
        if (Number.isFinite(previewScaleU) && Number.isFinite(previewScaleV)) {
            return PatternStrokeScaleUtils.scaleStrokesAroundDocumentCenter(strokes, previewScaleU, previewScaleV)
        }

        const drawHeightRatio = PatternStrokeScaleUtils.clampRatio(Number(input.drawHeightRatio) || 1)
        const previewHeightRatio = PatternStrokeScaleUtils.clampRatio(Number(input.previewHeightRatio) || drawHeightRatio)
        return PatternStrokeScaleUtils.rescaleStrokesVertical(strokes, drawHeightRatio, previewHeightRatio)
    }
}
