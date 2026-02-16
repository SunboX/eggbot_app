import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternGenerator } from '../src/PatternGenerator.mjs'
import { AppRuntimeConfig } from '../src/AppRuntimeConfig.mjs'

/**
 * Returns true if any numeric value is within tolerance from target.
 * @param {number[]} values
 * @param {number} target
 * @param {number} tolerance
 * @returns {boolean}
 */
function hasNear(values, target, tolerance) {
    return values.some((value) => Math.abs(value - target) <= tolerance)
}

test('PatternGenerator should be deterministic for same seed and settings', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.seed = 987654

    const first = PatternGenerator.generate(settings)
    const second = PatternGenerator.generate(settings)

    assert.deepEqual(second, first)
    assert.ok(first.length > 20)
})

test('PatternGenerator should produce fallback stroke if all motifs are disabled', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.motifs = {
        dots: false,
        rays: false,
        honeycomb: false,
        wolfTeeth: false,
        pineBranch: false,
        diamonds: false
    }

    const strokes = PatternGenerator.generate(settings)
    assert.ok(strokes.length > 10)
    assert.ok(strokes.some((stroke) => stroke.closed === true))
    assert.ok(strokes.some((stroke) => stroke.points.length >= 180))
})

test('PatternGenerator should build many closed triangle ornaments for wolfszaehne preset', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.preset = 'wolfszaehne'
    settings.symmetry = 10
    settings.bands = 7
    settings.density = 0.64
    settings.motifs = {
        dots: false,
        rays: false,
        honeycomb: false,
        wolfTeeth: true,
        pineBranch: false,
        diamonds: false
    }

    const strokes = PatternGenerator.generate(settings)
    const closedTriangles = strokes.filter((stroke) => stroke.closed === true && stroke.points.length === 3)
    assert.ok(closedTriangles.length >= 40)
})

test('PatternGenerator should keep framework rings near top, middle, and bottom', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.seed = 13
    settings.bands = 5

    const strokes = PatternGenerator.generate(settings)
    const ringStrokes = strokes.filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)
    const meanLevels = ringStrokes.map((stroke) => {
        const mean = stroke.points.reduce((sum, point) => sum + point.v, 0) / stroke.points.length
        return Number(mean.toFixed(3))
    })

    assert.ok(hasNear(meanLevels, 0.12, 0.03))
    assert.ok(hasNear(meanLevels, 0.5, 0.03))
    assert.ok(hasNear(meanLevels, 0.88, 0.03))
})

test('PatternGenerator should remove horizontal framework rings when disabled', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.showHorizontalLines = false

    const strokes = PatternGenerator.generate(settings)
    const ringStrokes = strokes.filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)

    assert.equal(ringStrokes.length, 0)
})
