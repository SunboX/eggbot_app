import test from 'node:test'
import assert from 'node:assert/strict'
import { DrawTraceStrokeUtils } from '../src/DrawTraceStrokeUtils.mjs'

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
