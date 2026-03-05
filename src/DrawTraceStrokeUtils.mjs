import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'

/**
 * Helpers for keeping draw-trace overlays aligned with rendered preview geometry.
 */
export class DrawTraceStrokeUtils {
    /**
     * Builds one preview-aligned draw-trace stroke list.
     * Imported SVG rendering may apply an extra draw-area vertical remap in preview only.
     * This method mirrors that remap for live/completed trace overlays.
     * @param {{ strokes?: Array<{ colorIndex?: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>, importedPatternActive?: boolean, isInkscapeCompatMode?: boolean, drawHeightRatio?: number, previewHeightRatio?: number }} [input]
     * @returns {Array<{ colorIndex?: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number }>}
     */
    static buildPreviewAlignedStrokes(input = {}) {
        const strokes = Array.isArray(input.strokes) ? input.strokes : []
        if (!input.importedPatternActive || input.isInkscapeCompatMode) {
            return strokes
        }

        const drawHeightRatio = PatternStrokeScaleUtils.clampRatio(Number(input.drawHeightRatio) || 1)
        const previewHeightRatio = PatternStrokeScaleUtils.clampRatio(Number(input.previewHeightRatio) || drawHeightRatio)
        return PatternStrokeScaleUtils.rescaleStrokesVertical(strokes, drawHeightRatio, previewHeightRatio)
    }
}
