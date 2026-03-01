import { ImportedPatternScaleUtils } from './ImportedPatternScaleUtils.mjs'
import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'

/**
 * Builds imported preview strokes mapped into the active drawable zone.
 */
export class ImportedPreviewStrokeUtils {
    /**
     * Builds one preview-mapped stroke list from imported source geometry.
     * @param {{ strokes?: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, parsedHeightRatio?: number, parsedHeightScale?: number, activeHeightScale?: number, documentHeightPx?: number, penRangeSteps?: number, stepScalingFactor?: number }} input
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, previewHeightRatio: number }}
     */
    static buildPreviewStrokes(input = {}) {
        const sourceStrokes = Array.isArray(input.strokes) ? input.strokes : []
        const sourceRatio = PatternStrokeScaleUtils.clampRatio(input.parsedHeightRatio)
        const activeImportedRatio = ImportedPatternScaleUtils.resolvePreviewHeightRatio({
            parsedHeightRatio: input.parsedHeightRatio,
            parsedHeightScale: input.parsedHeightScale,
            activeHeightScale: input.activeHeightScale
        })
        const drawAreaRatio = ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
            documentHeightPx: input.documentHeightPx,
            penRangeSteps: input.penRangeSteps,
            stepScalingFactor: input.stepScalingFactor
        })
        const previewHeightRatio = PatternStrokeScaleUtils.clampRatio(activeImportedRatio * drawAreaRatio)
        return {
            strokes: PatternStrokeScaleUtils.rescaleStrokesVertical(sourceStrokes, sourceRatio, previewHeightRatio),
            previewHeightRatio
        }
    }
}
