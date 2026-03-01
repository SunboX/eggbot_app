import test from 'node:test'
import assert from 'node:assert/strict'
import { UvStrokeUnwrapUtils } from '../src/UvStrokeUnwrapUtils.mjs'

test('UvStrokeUnwrapUtils should unwrap near-seam jumps into continuous segments', () => {
    const points = [
        { u: 0.97, v: 0.5 },
        { u: 0.02, v: 0.5 },
        { u: 0.08, v: 0.5 }
    ]

    const unwrapped = UvStrokeUnwrapUtils.unwrapStroke(points)
    const delta1 = Math.abs(unwrapped[1].u - unwrapped[0].u)
    const delta2 = Math.abs(unwrapped[2].u - unwrapped[1].u)

    assert.ok(delta1 < 0.2)
    assert.ok(delta2 < 0.2)
})

test('UvStrokeUnwrapUtils should not force-wrap wide non-seam segments', () => {
    const points = [
        { u: 0.064, v: 0.2 },
        { u: 0.776, v: 0.2 },
        { u: 0.776, v: 0.8 },
        { u: 0.064, v: 0.8 },
        { u: 0.064, v: 0.2 }
    ]

    const unwrapped = UvStrokeUnwrapUtils.unwrapStroke(points)

    const maxU = Math.max(...unwrapped.map((point) => point.u))
    const minU = Math.min(...unwrapped.map((point) => point.u))
    assert.ok(maxU < 1)
    assert.ok(minU >= 0)
    assert.ok(Math.abs(unwrapped[3].u - unwrapped[2].u) > 0.6)
})
