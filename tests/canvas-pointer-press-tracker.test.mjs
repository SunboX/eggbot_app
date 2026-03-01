import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasPointerPressTracker } from '../src/CanvasPointerPressTracker.mjs'

/**
 * Builds one minimal canvas-like event target for pointer tests.
 * @returns {{
 *   canvas: HTMLCanvasElement,
 *   dispatch: (type: string, event: Record<string, unknown>) => void,
 *   captureCalls: number[],
 *   releaseCalls: number[]
 * }}
 */
function createMockCanvas() {
    const listeners = new Map()
    const captureCalls = []
    const releaseCalls = []
    const canvas = {
        addEventListener(type, callback) {
            const callbacks = listeners.get(type) || []
            callbacks.push(callback)
            listeners.set(type, callbacks)
        },
        removeEventListener(type, callback) {
            const callbacks = listeners.get(type) || []
            listeners.set(
                type,
                callbacks.filter((entry) => entry !== callback)
            )
        },
        setPointerCapture(pointerId) {
            captureCalls.push(pointerId)
        },
        releasePointerCapture(pointerId) {
            releaseCalls.push(pointerId)
        }
    }

    return {
        canvas,
        captureCalls,
        releaseCalls,
        dispatch(type, event) {
            const callbacks = listeners.get(type) || []
            callbacks.forEach((callback) => callback(event))
        }
    }
}

test('CanvasPointerPressTracker should pause while primary mouse button is held', () => {
    const { canvas, dispatch, captureCalls, releaseCalls } = createMockCanvas()
    const tracker = new CanvasPointerPressTracker(canvas)

    assert.equal(tracker.isPressActive(), false)

    dispatch('pointerdown', {
        pointerId: 11,
        pointerType: 'mouse',
        button: 0
    })
    assert.equal(tracker.isPressActive(), true)
    assert.deepEqual(captureCalls, [11])

    dispatch('pointerup', {
        pointerId: 11
    })
    assert.equal(tracker.isPressActive(), false)
    assert.deepEqual(releaseCalls, [11])

    tracker.dispose()
})

test('CanvasPointerPressTracker should ignore secondary mouse button presses', () => {
    const { canvas, dispatch, captureCalls } = createMockCanvas()
    const tracker = new CanvasPointerPressTracker(canvas)

    dispatch('pointerdown', {
        pointerId: 21,
        pointerType: 'mouse',
        button: 2
    })

    assert.equal(tracker.isPressActive(), false)
    assert.equal(captureCalls.length, 0)
    tracker.dispose()
})

test('CanvasPointerPressTracker should stop tracking on pointer cancel', () => {
    const { canvas, dispatch } = createMockCanvas()
    const tracker = new CanvasPointerPressTracker(canvas)

    dispatch('pointerdown', {
        pointerId: 31,
        pointerType: 'mouse',
        button: 0
    })
    assert.equal(tracker.isPressActive(), true)

    dispatch('pointercancel', {
        pointerId: 31
    })
    assert.equal(tracker.isPressActive(), false)
    tracker.dispose()
})

test('CanvasPointerPressTracker should clear active presses on dispose', () => {
    const { canvas, dispatch } = createMockCanvas()
    const tracker = new CanvasPointerPressTracker(canvas)

    dispatch('pointerdown', {
        pointerId: 41,
        pointerType: 'mouse',
        button: 0
    })
    assert.equal(tracker.isPressActive(), true)

    tracker.dispose()
    assert.equal(tracker.isPressActive(), false)
})
