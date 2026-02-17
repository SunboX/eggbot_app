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
