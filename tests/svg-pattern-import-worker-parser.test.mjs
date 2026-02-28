import test from 'node:test'
import assert from 'node:assert/strict'
import { SvgPatternImportWorkerParser } from '../src/workers/SvgPatternImportWorkerParser.mjs'

/**
 * Returns min/max v across all parsed points.
 * @param {Array<{ points?: Array<{ v: number }> }>} strokes
 * @returns {{ min: number, max: number }}
 */
function resolveVerticalExtrema(strokes) {
    const values = []
    strokes.forEach((stroke) => {
        if (!Array.isArray(stroke?.points)) return
        stroke.points.forEach((point) => {
            values.push(Number(point?.v))
        })
    })
    return {
        min: Math.min(...values),
        max: Math.max(...values)
    }
}

test('SvgPatternImportWorkerParser should apply height normalization by default', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 400">
            <line x1="0" y1="0" x2="100" y2="400" stroke="#cc0000" fill="none" />
        </svg>
    `
    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        sampleSpacing: 1000,
        heightScale: 0.5,
        heightReference: 800
    })
    const vertical = resolveVerticalExtrema(parsed.strokes)

    assert.equal(parsed.heightRatio, 0.25)
    assert.ok(vertical.min > 0)
    assert.ok(vertical.max < 1)
})

test('SvgPatternImportWorkerParser should preserve full SVG height in compat mode', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 400">
            <line x1="0" y1="0" x2="100" y2="400" stroke="#cc0000" fill="none" />
        </svg>
    `
    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        sampleSpacing: 1000,
        heightScale: 0.5,
        heightReference: 800,
        preserveRawHeight: true
    })
    const vertical = resolveVerticalExtrema(parsed.strokes)

    assert.equal(parsed.heightRatio, 1)
    assert.equal(vertical.min, 0)
    assert.equal(vertical.max, 1)
})

test('SvgPatternImportWorkerParser should convert document units to px@96dpi and expose pixel metadata', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <rect x="20.606821" y="20.98375" width="227.91998" height="63.53756" fill="none" stroke="#000" />
        </svg>
    `

    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        heightScale: 1,
        heightReference: 800,
        curveSmoothing: 0.2
    })

    assert.ok(Math.abs(parsed.documentWidthPx - 1209.448) < 0.01)
    assert.ok(Math.abs(parsed.documentHeightPx - 377.952) < 0.01)
    assert.equal(parsed.strokes.length >= 1, true)
})

test('SvgPatternImportWorkerParser should keep rectangle segmentation compact like v281', () => {
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <rect x="20.606821" y="20.98375" width="227.91998" height="63.53756" fill="none" stroke="#000" />
        </svg>
    `

    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        heightScale: 1,
        heightReference: 800,
        curveSmoothing: 0.2
    })
    const firstStroke = parsed.strokes[0]

    assert.ok(firstStroke)
    assert.equal(firstStroke.points.length <= 6, true)
})
