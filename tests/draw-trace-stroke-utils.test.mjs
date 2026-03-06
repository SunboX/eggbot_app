import test from 'node:test'
import assert from 'node:assert/strict'
import { DrawTraceStrokeUtils } from '../src/DrawTraceStrokeUtils.mjs'
import { ImportedPatternScaleUtils } from '../src/ImportedPatternScaleUtils.mjs'
import { ImportedPreviewStrokeUtils } from '../src/ImportedPreviewStrokeUtils.mjs'
import { PatternStrokeScaleUtils } from '../src/PatternStrokeScaleUtils.mjs'
import { SvgPatternImportWorkerParser } from '../src/workers/SvgPatternImportWorkerParser.mjs'

/**
 * Returns min/max UV values across all stroke points.
 * @param {Array<{ points?: Array<{ u?: number, v?: number }> }>} strokes
 * @returns {{ minU: number, maxU: number, minV: number, maxV: number }}
 */
function resolveExtrema(strokes) {
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    strokes.forEach((stroke) => {
        if (!Array.isArray(stroke?.points)) return
        stroke.points.forEach((point) => {
            minU = Math.min(minU, Number(point.u))
            maxU = Math.max(maxU, Number(point.u))
            minV = Math.min(minV, Number(point.v))
            maxV = Math.max(maxV, Number(point.v))
        })
    })
    return { minU, maxU, minV, maxV }
}

test('DrawTraceStrokeUtils should keep generated trace strokes unchanged', () => {
    const strokes = [
        {
            colorIndex: 0,
            points: [
                { u: 0.2, v: 0.2 },
                { u: 0.8, v: 0.8 }
            ]
        }
    ]

    const result = DrawTraceStrokeUtils.buildPreviewAlignedStrokes({
        strokes,
        importedPatternActive: false,
        isInkscapeCompatMode: false,
        drawHeightRatio: 1,
        previewHeightRatio: 1
    })

    assert.equal(result, strokes)
})

test('DrawTraceStrokeUtils should remap imported trace strokes to preview ratio', () => {
    const strokes = [
        {
            colorIndex: 1,
            points: [
                { u: 0.1, v: 0.1 },
                { u: 0.9, v: 0.9 }
            ]
        }
    ]

    const result = DrawTraceStrokeUtils.buildPreviewAlignedStrokes({
        strokes,
        importedPatternActive: true,
        isInkscapeCompatMode: false,
        drawHeightRatio: 0.8,
        previewHeightRatio: 0.5
    })

    assert.notEqual(result, strokes)
    assert.equal(result[0].points[0].u, 0.1)
    assert.equal(result[0].points[1].u, 0.9)
    assert.equal(result[0].points[0].v, 0.25)
    assert.equal(result[0].points[1].v, 0.75)
})

test('DrawTraceStrokeUtils should align imported trace with preview mapping when draw height is capped', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <g transform="translate(0,-197)">
                <rect x="20.606821" y="217.98375" width="227.91998" height="63.53756" fill="none" stroke="#000000" />
            </g>
        </svg>
    `
    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        heightScale: 1,
        heightReference: 1,
        curveSmoothing: 0.2
    })
    const activeHeightScale = 3
    const drawHeightRatio = ImportedPatternScaleUtils.resolveDrawHeightRatio({
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale
    })
    const drawSource = PatternStrokeScaleUtils.rescaleStrokesVertical(parsed.strokes, parsed.heightRatio, drawHeightRatio)
    const preview = ImportedPreviewStrokeUtils.buildPreviewStrokes({
        strokes: parsed.strokes,
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale,
        documentWidthPx: parsed.documentWidthPx,
        documentHeightPx: parsed.documentHeightPx,
        stepsPerTurn: 3200,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const drawAreaScales = ImportedPatternScaleUtils.resolveDrawAreaPreviewScales({
        documentWidthPx: parsed.documentWidthPx,
        documentHeightPx: parsed.documentHeightPx,
        stepsPerTurn: 3200,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const trace = DrawTraceStrokeUtils.buildPreviewAlignedStrokes({
        strokes: drawSource,
        importedPatternActive: true,
        isInkscapeCompatMode: false,
        previewScaleU: drawAreaScales.uScale,
        previewScaleV: drawAreaScales.vScale
    })
    const traceExtrema = resolveExtrema(trace)
    const previewExtrema = resolveExtrema(preview.strokes)

    assert.ok(Math.abs(traceExtrema.minU - previewExtrema.minU) < 1e-9)
    assert.ok(Math.abs(traceExtrema.maxU - previewExtrema.maxU) < 1e-9)
    assert.ok(Math.abs(traceExtrema.minV - previewExtrema.minV) < 1e-9)
    assert.ok(Math.abs(traceExtrema.maxV - previewExtrema.maxV) < 1e-9)
})
