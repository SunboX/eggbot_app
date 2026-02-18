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

/**
 * Computes average absolute distance from equator over values.
 * @param {number[]} values
 * @returns {number}
 */
function averageAbsDistanceFromEquator(values) {
    if (!values.length) return 0
    return values.reduce((sum, value) => sum + Math.abs(value - 0.5), 0) / values.length
}

/**
 * Computes average closed-shape span for one axis.
 * @param {Array<{ closed?: boolean, points: Array<{u:number,v:number}> }>} strokes
 * @param {'u' | 'v'} axis
 * @returns {number}
 */
function averageClosedShapeSpan(strokes, axis) {
    const spans = strokes
        .filter((stroke) => stroke.closed === true && stroke.points.length >= 3)
        .map((stroke) => {
            const values = stroke.points.map((point) => point[axis])
            return Math.max(...values) - Math.min(...values)
        })
        .filter((value) => Number.isFinite(value) && value > 0)

    if (!spans.length) return 0
    return spans.reduce((sum, value) => sum + value, 0) / spans.length
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

test('PatternGenerator should tag framework rings with motif group key', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.preset = 'kiefernzweig'
    settings.motifs = {
        dots: false,
        rays: false,
        honeycomb: false,
        wolfTeeth: false,
        pineBranch: true,
        diamonds: false
    }
    settings.showHorizontalLines = true

    const strokes = PatternGenerator.generate(settings)
    const ringStrokes = strokes.filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)

    assert.ok(ringStrokes.length > 0)
    assert.ok(ringStrokes.every((stroke) => stroke.horizontalRingGroup === 'kiefernzweig'))
})

test('PatternGenerator should tag framework rings in traditional-mix mode', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.preset = 'traditional-mix'
    settings.showHorizontalLines = true

    const strokes = PatternGenerator.generate(settings)
    const ringStrokes = strokes.filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)
    const allowed = new Set(['punkte', 'strahlen', 'wabe', 'wolfszaehne', 'kiefernzweig', 'feder-raute'])

    assert.ok(ringStrokes.length > 0)
    assert.ok(ringStrokes.every((stroke) => allowed.has(stroke.horizontalRingGroup)))
})

test('PatternGenerator should tag motif strokes with dedicated ornament groups', () => {
    const settings = AppRuntimeConfig.createDefaultState()
    settings.preset = 'traditional-mix'
    settings.motifs = {
        dots: true,
        rays: true,
        honeycomb: true,
        wolfTeeth: true,
        pineBranch: true,
        diamonds: true
    }

    const strokes = PatternGenerator.generate(settings)
    const motifStrokes = strokes.filter((stroke) => typeof stroke.motifGroup === 'string')
    const expected = ['punkte', 'strahlen', 'wabe', 'wolfszaehne', 'kiefernzweig', 'feder-raute']

    assert.ok(motifStrokes.length > 0)
    expected.forEach((group) => {
        assert.ok(motifStrokes.some((stroke) => stroke.motifGroup === group))
    })
})

test('PatternGenerator should increase ornament count when ornamentCount grows', () => {
    const lowSettings = AppRuntimeConfig.createDefaultState()
    lowSettings.seed = 77
    lowSettings.ornamentCount = 0.6

    const highSettings = AppRuntimeConfig.createDefaultState()
    highSettings.seed = 77
    highSettings.ornamentCount = 1.8

    const lowStrokes = PatternGenerator.generate(lowSettings)
    const highStrokes = PatternGenerator.generate(highSettings)

    assert.ok(highStrokes.length > lowStrokes.length)
})

test('PatternGenerator should scale ornament size in both axes', () => {
    const smallSettings = AppRuntimeConfig.createDefaultState()
    smallSettings.seed = 913
    smallSettings.preset = 'wabe'
    smallSettings.ornamentSize = 0.6
    smallSettings.showHorizontalLines = false

    const largeSettings = AppRuntimeConfig.createDefaultState()
    largeSettings.seed = 913
    largeSettings.preset = 'wabe'
    largeSettings.ornamentSize = 1.6
    largeSettings.showHorizontalLines = false

    const small = PatternGenerator.generate(smallSettings)
    const large = PatternGenerator.generate(largeSettings)

    assert.ok(averageClosedShapeSpan(large, 'u') > averageClosedShapeSpan(small, 'u'))
    assert.ok(averageClosedShapeSpan(large, 'v') > averageClosedShapeSpan(small, 'v'))
})

test('PatternGenerator should spread ornament bands vertically with ornamentDistribution', () => {
    const compactSettings = AppRuntimeConfig.createDefaultState()
    compactSettings.seed = 431
    compactSettings.bands = 8
    compactSettings.ornamentDistribution = 0.6

    const spreadSettings = AppRuntimeConfig.createDefaultState()
    spreadSettings.seed = 431
    spreadSettings.bands = 8
    spreadSettings.ornamentDistribution = 1.6

    const compact = PatternGenerator.generate(compactSettings)
    const spread = PatternGenerator.generate(spreadSettings)

    const compactRingLevels = compact
        .filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)
        .map((stroke) => stroke.points.reduce((sum, point) => sum + point.v, 0) / stroke.points.length)

    const spreadRingLevels = spread
        .filter((stroke) => stroke.closed !== true && stroke.points.length >= 180)
        .map((stroke) => stroke.points.reduce((sum, point) => sum + point.v, 0) / stroke.points.length)

    assert.ok(averageAbsDistanceFromEquator(spreadRingLevels) > averageAbsDistanceFromEquator(compactRingLevels))
})
