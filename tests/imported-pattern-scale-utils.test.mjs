import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportedPatternScaleUtils } from '../src/ImportedPatternScaleUtils.mjs'

test('ImportedPatternScaleUtils should clamp imported scale values', () => {
    assert.equal(ImportedPatternScaleUtils.clampScale(0.05), 0.1)
    assert.equal(ImportedPatternScaleUtils.clampScale(1.75), 1.75)
    assert.equal(ImportedPatternScaleUtils.clampScale(9), 3)
    assert.equal(ImportedPatternScaleUtils.clampScale(Number.NaN), 1)
})

test('ImportedPatternScaleUtils should preserve parsed ratio at same scale', () => {
    const ratio = ImportedPatternScaleUtils.resolvePreviewHeightRatio({
        parsedHeightRatio: 1.2,
        parsedHeightScale: 1.5,
        activeHeightScale: 1.5
    })

    assert.equal(ratio, 1.2)
})

test('ImportedPatternScaleUtils should update preview ratio for live slider scale', () => {
    const ratio = ImportedPatternScaleUtils.resolvePreviewHeightRatio({
        parsedHeightRatio: 1.8,
        parsedHeightScale: 1.5,
        activeHeightScale: 0.5
    })

    assert.equal(ratio, 0.6)
})

test('ImportedPatternScaleUtils should clamp resolved preview ratio bounds', () => {
    const ratio = ImportedPatternScaleUtils.resolvePreviewHeightRatio({
        parsedHeightRatio: 2.8,
        parsedHeightScale: 0.1,
        activeHeightScale: 3
    })

    assert.equal(ratio, 3)
})

test('ImportedPatternScaleUtils should resolve draw-area preview ratio from document height and draw settings', () => {
    const ratio = ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
        documentHeightPx: 377.9527559,
        penRangeSteps: 1500,
        stepScalingFactor: 2
    })

    assert.ok(Math.abs(ratio - 0.25196850393333335) < 1e-9)
})

test('ImportedPatternScaleUtils should fallback to neutral draw-area preview ratio for invalid input', () => {
    assert.equal(
        ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
            documentHeightPx: Number.NaN,
            penRangeSteps: 1500,
            stepScalingFactor: 2
        }),
        1
    )
    assert.equal(
        ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
            documentHeightPx: 377.9527559,
            penRangeSteps: 0,
            stepScalingFactor: 2
        }),
        1
    )
    assert.equal(
        ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
            documentHeightPx: 377.9527559,
            penRangeSteps: 1500,
            stepScalingFactor: Number.NaN
        }),
        1
    )
})
