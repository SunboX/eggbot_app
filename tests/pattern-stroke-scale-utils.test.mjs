import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternStrokeScaleUtils } from '../src/PatternStrokeScaleUtils.mjs'

/**
 * Asserts that two floating-point values are near.
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon]
 */
function assertNear(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= epsilon)
}

/**
 * Returns wrapped distance between two U coordinates.
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function wrappedDistance(left, right) {
    const delta = Math.abs(left - right)
    return Math.min(delta, Math.abs(1 - delta))
}

/**
 * Returns bounding-box width and height for one stroke list.
 * @param {Array<{ points: Array<{u:number,v:number}> }>} strokes
 * @returns {{ width: number, height: number }}
 */
function strokeBounds(strokes) {
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    strokes.forEach((stroke) => {
        stroke.points.forEach((point) => {
            minU = Math.min(minU, point.u)
            maxU = Math.max(maxU, point.u)
            minV = Math.min(minV, point.v)
            maxV = Math.max(maxV, point.v)
        })
    })
    return {
        width: maxU - minU,
        height: maxV - minV
    }
}

/**
 * Returns the continuous unwrapped U span of one stroke.
 * @param {{ points: Array<{u:number,v:number}> }} stroke
 * @returns {number}
 */
function unwrappedUSpan(stroke) {
    const points = Array.isArray(stroke?.points) ? stroke.points : []
    if (points.length < 2) return 0
    const unwrapped = [{ u: Number(points[0].u), v: Number(points[0].v) }]
    for (let index = 1; index < points.length; index += 1) {
        const previous = unwrapped[index - 1]
        const current = points[index]
        const options = [Number(current.u) - 1, Number(current.u), Number(current.u) + 1]
        let selected = options[0]
        let bestDistance = Math.abs(options[0] - previous.u)
        for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
            const candidate = options[optionIndex]
            const distance = Math.abs(candidate - previous.u)
            if (distance < bestDistance) {
                bestDistance = distance
                selected = candidate
            }
        }
        unwrapped.push({ u: selected, v: Number(current.v) })
    }
    const minU = Math.min(...unwrapped.map((point) => point.u))
    const maxU = Math.max(...unwrapped.map((point) => point.u))
    return maxU - minU
}

test('PatternStrokeScaleUtils should scale generated strokes into centered drawable zone', () => {
    const strokes = [
        {
            colorIndex: 0,
            points: [
                { u: 0.1, v: 0 },
                { u: 0.3, v: 0.5 },
                { u: 0.8, v: 1 }
            ]
        }
    ]

    const scaled = PatternStrokeScaleUtils.rescaleStrokes(strokes, 1, 0.85)

    assertNear(scaled[0].points[0].u, 0.14500000000000007)
    assertNear(scaled[0].points[1].u, 0.315)
    assertNear(scaled[0].points[2].u, 0.74)
    assertNear(scaled[0].points[0].v, 0.075)
    assertNear(scaled[0].points[1].v, 0.5)
    assertNear(scaled[0].points[2].v, 0.925)
})

test('PatternStrokeScaleUtils should remap imported stroke ratios consistently', () => {
    const strokes = [
        {
            colorIndex: 0,
            closed: true,
            fillGroupId: 3,
            fillAlpha: 0.24,
            fillRule: 'evenodd',
            points: [
                { u: 0.1, v: 0.2 },
                { u: 0.5, v: 0.5 },
                { u: 0.8, v: 0.8 }
            ]
        }
    ]

    const scaled = PatternStrokeScaleUtils.rescaleStrokes(strokes, 0.6, 0.85)

    assertNear(scaled[0].points[0].u, 0.9472222222222222)
    assertNear(scaled[0].points[1].u, 0.513888888888889)
    assertNear(scaled[0].points[2].u, 0.938888888888889)
    assertNear(scaled[0].points[0].v, 0.075)
    assertNear(scaled[0].points[1].v, 0.5)
    assertNear(scaled[0].points[2].v, 0.925)
    assert.equal(scaled[0].closed, true)
    assert.equal(scaled[0].fillGroupId, 3)
    assert.equal(scaled[0].fillRule, 'evenodd')
})

test('PatternStrokeScaleUtils should return same reference when ratios are equal', () => {
    const strokes = [
        {
            colorIndex: 1,
            points: [
                { u: 0.2, v: 0.3 },
                { u: 0.4, v: 0.9 }
            ]
        }
    ]

    const scaled = PatternStrokeScaleUtils.rescaleStrokes(strokes, 0.85, 0.85)

    assert.equal(scaled, strokes)
})

test('PatternStrokeScaleUtils should preserve seam continuity for wrapped U input', () => {
    const strokes = [
        {
            colorIndex: 0,
            points: [
                { u: 0.97, v: 0.3 },
                { u: 0.02, v: 0.4 },
                { u: 0.08, v: 0.5 }
            ]
        }
    ]

    const scaled = PatternStrokeScaleUtils.rescaleStrokes(strokes, 1, 1.8)
    const [first, second, third] = scaled[0].points

    assert.ok(wrappedDistance(first.u, second.u) < 0.2)
    assert.ok(wrappedDistance(second.u, third.u) < 0.2)
    assert.ok(first.u >= 0 && first.u < 1)
    assert.ok(second.u >= 0 && second.u < 1)
    assert.ok(third.u >= 0 && third.u < 1)
})

test('PatternStrokeScaleUtils should scale grouped motif strokes with one shared U anchor', () => {
    const strokes = [
        {
            colorIndex: 0,
            transformGroupId: 42,
            points: [
                { u: 0.4, v: 0.4 },
                { u: 0.44, v: 0.6 }
            ]
        },
        {
            colorIndex: 1,
            transformGroupId: 42,
            points: [
                { u: 0.56, v: 0.4 },
                { u: 0.6, v: 0.6 }
            ]
        }
    ]

    const sourceBounds = strokeBounds(strokes)
    const scaled = PatternStrokeScaleUtils.rescaleStrokes(strokes, 1, 0.5)
    const scaledBounds = strokeBounds(scaled)

    assertNear(scaledBounds.width / sourceBounds.width, 0.5)
    assertNear(scaledBounds.height / sourceBounds.height, 0.5)
})

test('PatternStrokeScaleUtils should keep full-wrap ring strokes spanning the full U range', () => {
    const ring = {
        colorIndex: 0,
        points: [
            { u: 0, v: 0.5 },
            { u: 0.25, v: 0.5 },
            { u: 0.5, v: 0.5 },
            { u: 0.75, v: 0.5 },
            { u: 1, v: 0.5 }
        ]
    }

    const scaled = PatternStrokeScaleUtils.rescaleStrokes([ring], 1, 0.7)
    assert.ok(unwrappedUSpan(scaled[0]) > 0.98)
})
