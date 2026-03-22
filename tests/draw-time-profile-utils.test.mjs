import assert from 'node:assert/strict'
import test from 'node:test'
import { DrawTimeProfileUtils } from '../src/DrawTimeProfileUtils.mjs'

test('DrawTimeProfileUtils.normalizeProfile should fall back to defaults for invalid input', () => {
    const normalized = DrawTimeProfileUtils.normalizeProfile({
        schemaVersion: 'nope',
        updatedAt: '',
        strokeSampleCount: -4,
        durationScale: 'fast'
    })

    assert.equal(normalized.schemaVersion, 1)
    assert.equal(normalized.strokeSampleCount, 0)
    assert.equal(normalized.durationScale, 1)
    assert.equal(typeof normalized.updatedAt, 'string')
})

test('DrawTimeProfileUtils.updateWithStrokeMeasurement should blend measured stroke timing into the persisted scale', () => {
    const initial = DrawTimeProfileUtils.createDefaultProfile()
    const first = DrawTimeProfileUtils.updateWithStrokeMeasurement(initial, {
        actualDurationMs: 3000,
        estimatedDurationMs: 2000,
        updatedAt: '2026-03-16T10:00:00.000Z'
    })

    assert.equal(first.strokeSampleCount, 1)
    assert.equal(first.durationScale, 1.5)
    assert.equal(first.updatedAt, '2026-03-16T10:00:00.000Z')

    const second = DrawTimeProfileUtils.updateWithStrokeMeasurement(first, {
        actualDurationMs: 1000,
        estimatedDurationMs: 2000,
        updatedAt: '2026-03-16T10:01:00.000Z'
    })

    assert.equal(second.strokeSampleCount, 2)
    assert.equal(second.updatedAt, '2026-03-16T10:01:00.000Z')
    assert.equal(second.durationScale < 1.5, true)
    assert.equal(second.durationScale > 0.5, true)
})

test('DrawTimeProfileUtils.applyDurationScale should scale one baseline duration with the persisted profile', () => {
    const scaled = DrawTimeProfileUtils.applyDurationScale(2400, {
        strokeSampleCount: 5,
        durationScale: 1.25
    })

    assert.equal(scaled, 3000)
})
