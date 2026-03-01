import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportedPatternScaleUtils } from '../src/ImportedPatternScaleUtils.mjs'
import { PatternStrokeScaleUtils } from '../src/PatternStrokeScaleUtils.mjs'
import { SvgPatternImportWorkerParser } from '../src/workers/SvgPatternImportWorkerParser.mjs'

/**
 * Returns min/max UV extents across all points.
 * @param {Array<{ points?: Array<{ u: number, v: number }> }>} strokes
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

test('Imported SVG preview remap should center V into drawable zone while preserving U span', () => {
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

    const activeImportedRatio = ImportedPatternScaleUtils.resolvePreviewHeightRatio({
        parsedHeightRatio: parsed.heightRatio,
        parsedHeightScale: 1,
        activeHeightScale: 1
    })
    const drawAreaRatio = ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
        documentHeightPx: parsed.documentHeightPx,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })
    const previewRatio = PatternStrokeScaleUtils.clampRatio(activeImportedRatio * drawAreaRatio)
    const remapped = PatternStrokeScaleUtils.rescaleStrokesVertical(parsed.strokes, activeImportedRatio, previewRatio)

    const sourceExtrema = resolveExtrema(parsed.strokes)
    const remappedExtrema = resolveExtrema(remapped)

    assert.ok(Math.abs(remappedExtrema.minV - 0.4268881889763779) < 1e-6)
    assert.ok(Math.abs(remappedExtrema.maxV - 0.5869828283464567) < 1e-6)
    assert.ok(Math.abs(sourceExtrema.minU - remappedExtrema.minU) < 1e-12)
    assert.ok(Math.abs(sourceExtrema.maxU - remappedExtrema.maxU) < 1e-12)
})
