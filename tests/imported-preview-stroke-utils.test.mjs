import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportedPreviewStrokeUtils } from '../src/ImportedPreviewStrokeUtils.mjs'
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

test('ImportedPreviewStrokeUtils should map default import scale into document-centered draw footprint', () => {
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

    const preview = ImportedPreviewStrokeUtils.buildPreviewStrokes({
        strokes: parsed.strokes,
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale: 1,
        documentWidthPx: parsed.documentWidthPx,
        documentHeightPx: parsed.documentHeightPx,
        stepsPerTurn: 3200,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const extrema = resolveExtrema(preview.strokes)

    assert.ok(Math.abs(extrema.minU - 0.22660645787401573) < 1e-6)
    assert.ok(Math.abs(extrema.maxU - 0.335362387007874) < 1e-6)
    assert.ok(Math.abs(extrema.minV - 0.4268881889763779) < 1e-6)
    assert.ok(Math.abs(extrema.maxV - 0.5869828283464567) < 1e-6)
})

test('ImportedPreviewStrokeUtils should keep preview footprint stable when draw height is capped', () => {
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

    const preview = ImportedPreviewStrokeUtils.buildPreviewStrokes({
        strokes: parsed.strokes,
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale: 3,
        documentWidthPx: parsed.documentWidthPx,
        documentHeightPx: parsed.documentHeightPx,
        stepsPerTurn: 3200,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const extrema = resolveExtrema(preview.strokes)

    assert.ok(Math.abs(extrema.minU - 0.22660645787401573) < 1e-6)
    assert.ok(Math.abs(extrema.maxU - 0.335362387007874) < 1e-6)
    assert.ok(Math.abs(extrema.minV - 0.4268881889763779) < 1e-6)
    assert.ok(Math.abs(extrema.maxV - 0.5869828283464567) < 1e-6)
})

test('ImportedPreviewStrokeUtils should match document-centered preview footprint for imported circles', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <g transform="translate(0,-197)">
                <path
                    d="M 111.88095,245.56995 A 36.85268,38.364582 0 0 1 75.028275,283.93453 36.85268,38.364582 0 0 1 38.175594,245.56995 36.85268,38.364582 0 0 1 75.028275,207.20536 36.85268,38.364582 0 0 1 111.88095,245.56995 Z"
                    fill="none"
                    stroke="#000000"
                />
            </g>
        </svg>
    `
    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        heightScale: 1,
        heightReference: 1,
        curveSmoothing: 0.2
    })

    const preview = ImportedPreviewStrokeUtils.buildPreviewStrokes({
        strokes: parsed.strokes,
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale: 1,
        documentWidthPx: parsed.documentWidthPx,
        documentHeightPx: parsed.documentHeightPx,
        stepsPerTurn: 3200,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const extrema = resolveExtrema(preview.strokes)

    assert.ok(Math.abs(extrema.minU - 0.35611290629921255) < 1e-6)
    assert.ok(Math.abs(extrema.maxU - 0.44316647637795276) < 1e-6)
    assert.ok(Math.abs(extrema.minV - 0.39973004094488185) < 1e-6)
    assert.ok(Math.abs(extrema.maxV - 0.5930633826771654) < 1e-6)
})
