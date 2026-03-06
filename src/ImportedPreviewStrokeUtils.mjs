import { ImportedPatternScaleUtils } from './ImportedPatternScaleUtils.mjs'
import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'

/**
 * Builds imported preview strokes mapped into the active drawable zone.
 */
export class ImportedPreviewStrokeUtils {
    /**
     * Builds one preview-mapped stroke list from imported source geometry.
     * @param {{ strokes?: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, parsedHeightRatio?: number, parsedHeightScale?: number, activeHeightScale?: number, documentWidthPx?: number, documentHeightPx?: number, stepsPerTurn?: number, penRangeSteps?: number, stepScalingFactor?: number }} input
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, previewHeightRatio: number, previewScaleU: number, previewScaleV: number }}
     */
    static buildPreviewStrokes(input = {}) {
        const sourceStrokes = Array.isArray(input.strokes) ? input.strokes : []
        const sourceRatio = PatternStrokeScaleUtils.clampRatio(input.parsedHeightRatio)
        const drawHeightRatio = ImportedPatternScaleUtils.resolveDrawHeightRatio({
            parsedHeightRatio: input.parsedHeightRatio,
            parsedHeightScale: input.parsedHeightScale,
            activeHeightScale: input.activeHeightScale
        })
        const previewScales = ImportedPatternScaleUtils.resolveDrawAreaPreviewScales({
            documentWidthPx: input.documentWidthPx,
            documentHeightPx: input.documentHeightPx,
            stepsPerTurn: input.stepsPerTurn,
            penRangeSteps: input.penRangeSteps,
            stepScalingFactor: input.stepScalingFactor
        })
        const drawHeightStrokes = PatternStrokeScaleUtils.rescaleStrokesVertical(sourceStrokes, sourceRatio, drawHeightRatio)
        return {
            strokes: PatternStrokeScaleUtils.scaleStrokesAroundDocumentCenter(
                drawHeightStrokes,
                previewScales.uScale,
                previewScales.vScale
            ),
            previewHeightRatio: drawHeightRatio,
            previewScaleU: previewScales.uScale,
            previewScaleV: previewScales.vScale
        }
    }
}
