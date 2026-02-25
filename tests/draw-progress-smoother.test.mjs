import assert from 'node:assert/strict'
import test from 'node:test'
import { DrawProgressSmoother } from '../src/DrawProgressSmoother.mjs'

test('DrawProgressSmoother should return first sample unchanged', () => {
    const smoother = new DrawProgressSmoother()
    assert.equal(smoother.update(12000, 1000), 12000)
})

test('DrawProgressSmoother should damp upward estimate spikes while continuing countdown', () => {
    const smoother = new DrawProgressSmoother()
    const first = smoother.update(10000, 1000)
    const second = smoother.update(11000, 2000)
    const third = smoother.update(12000, 3000)

    assert.equal(first, 10000)
    assert.equal(second < first, true)
    assert.equal(third <= second, true)
})

test('DrawProgressSmoother should react to lower estimates and clamp completion to zero', () => {
    const smoother = new DrawProgressSmoother()
    smoother.update(10000, 1000)
    const lower = smoother.update(4000, 2000)
    const done = smoother.update(0, 3000)

    assert.equal(lower < 7000, true)
    assert.equal(done, 0)
})

test('DrawProgressSmoother reset should clear previous state', () => {
    const smoother = new DrawProgressSmoother()
    smoother.update(8000, 1000)
    smoother.reset()

    assert.equal(smoother.update(5000, 2000), 5000)
})
