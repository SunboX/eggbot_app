import { PatternGenerator } from './PatternGenerator.mjs'
import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'
import { PatternSvgExportUtils } from './PatternSvgExportUtils.mjs'

/**
 * Pure compute tasks that can run on main thread or worker thread.
 */
export class PatternComputeTasks {
    /**
     * Builds generated + height-scaled render strokes from app settings.
     * @param {{ state?: Record<string, any>, activeHeightRatio?: number }} input
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number, horizontalRingGroup?: string, motifGroup?: string }> }}
     */
    static computeGeneratedRenderedStrokes(input) {
        const state = input?.state && typeof input.state === 'object' ? input.state : {}
        const activeHeightRatio = PatternStrokeScaleUtils.clampRatio(Number(input?.activeHeightRatio) || 1)
        const generated = PatternGenerator.generate(state)
        const strokes = PatternStrokeScaleUtils.rescaleStrokes(generated, 1, activeHeightRatio)
        return { strokes }
    }

    /**
     * Builds SVG export content from a pre-built export payload.
     * @param {{ svgInput?: Record<string, any> }} input
     * @returns {{ contents: string }}
     */
    static buildExportSvg(input) {
        const svgInput = input?.svgInput && typeof input.svgInput === 'object' ? input.svgInput : {}
        const contents = PatternSvgExportUtils.buildSvg(svgInput)
        return { contents }
    }
}
