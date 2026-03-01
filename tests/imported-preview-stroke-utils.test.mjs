import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportedPreviewStrokeUtils } from '../src/ImportedPreviewStrokeUtils.mjs'
import { SvgPatternImportWorkerParser } from '../src/workers/SvgPatternImportWorkerParser.mjs'

/**
 * Returns min/max V values across all stroke points.
 * @param {Array<{ points?: Array<{ v: number }> }>} strokes
 * @returns {{ minV: number, maxV: number }}
 */
function resolveVExtrema(strokes) {
    let minV = Infinity
    let maxV = -Infinity
    strokes.forEach((stroke) => {
        if (!Array.isArray(stroke?.points)) return
        stroke.points.forEach((point) => {
            minV = Math.min(minV, Number(point.v))
            maxV = Math.max(maxV, Number(point.v))
        })
    })
    return { minV, maxV }
}

test('ImportedPreviewStrokeUtils should map default import scale into centered drawable zone', () => {
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
        documentHeightPx: parsed.documentHeightPx,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const extrema = resolveVExtrema(preview.strokes)

    assert.ok(Math.abs(extrema.minV - 0.4268881889763779) < 1e-6)
    assert.ok(Math.abs(extrema.maxV - 0.5869828283464567) < 1e-6)
})

test('ImportedPreviewStrokeUtils should expand preview with higher height scale without top/bottom clipping', () => {
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
        documentHeightPx: parsed.documentHeightPx,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const extrema = resolveVExtrema(preview.strokes)

    assert.ok(Math.abs(extrema.minV - 0.2806645669291339) < 1e-6)
    assert.ok(Math.abs(extrema.maxV - 0.7609484850393701) < 1e-6)
})
