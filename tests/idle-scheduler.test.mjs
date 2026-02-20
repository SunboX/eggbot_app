import test from 'node:test'
import assert from 'node:assert/strict'
import { IdleScheduler } from '../src/IdleScheduler.mjs'

/**
 * Installs one mock window object.
 * @param {Record<string, any>} mockWindow
 * @returns {() => void}
 */
function installWindowMock(mockWindow) {
    const originalWindow = globalThis.window
    globalThis.window = mockWindow
    return () => {
        if (originalWindow === undefined) {
            delete globalThis.window
            return
        }
        globalThis.window = originalWindow
    }
}

test('IdleScheduler should use requestIdleCallback when available', () => {
    let idleCallback = null
    let idleOptions = null
    let canceledIdleId = null
    const timeoutIdsCleared = []
    let callbackCount = 0
    let callbackDeadline = null

    const restore = installWindowMock({
        requestIdleCallback: (cb, options) => {
            idleCallback = cb
            idleOptions = options
            return 31
        },
        cancelIdleCallback: (id) => {
            canceledIdleId = id
        },
        setTimeout: () => 41,
        clearTimeout: (id) => {
            timeoutIdsCleared.push(id)
        }
    })

    try {
        IdleScheduler.schedule((deadline) => {
            callbackCount += 1
            callbackDeadline = deadline
        }, { timeout: 250 })

        assert.equal(typeof idleCallback, 'function')
        assert.deepEqual(idleOptions, { timeout: 250 })

        idleCallback({
            didTimeout: false,
            timeRemaining: () => 13
        })

        assert.equal(callbackCount, 1)
        assert.equal(callbackDeadline.didTimeout, false)
        assert.equal(callbackDeadline.timeRemaining(), 13)
        assert.equal(canceledIdleId, 31)
        assert.deepEqual(timeoutIdsCleared, [41])
    } finally {
        restore()
    }
})

test('IdleScheduler should fall back to setTimeout when requestIdleCallback is unavailable', () => {
    let callbackCount = 0
    let fallbackDeadline = null

    const restore = installWindowMock({
        setTimeout: (callback) => {
            callback()
            return 51
        },
        clearTimeout: () => {}
    })

    try {
        IdleScheduler.schedule((deadline) => {
            callbackCount += 1
            fallbackDeadline = deadline
        })

        assert.equal(callbackCount, 1)
        assert.equal(fallbackDeadline.didTimeout, false)
        assert.equal(typeof fallbackDeadline.timeRemaining, 'function')
        assert.equal(fallbackDeadline.timeRemaining() >= 0, true)
    } finally {
        restore()
    }
})

test('IdleScheduler cancel should prevent callback execution', () => {
    let idleCallback = null
    let timeoutCallback = null
    let callbackCount = 0

    const restore = installWindowMock({
        requestIdleCallback: (callback) => {
            idleCallback = callback
            return 61
        },
        cancelIdleCallback: () => {},
        setTimeout: (callback) => {
            timeoutCallback = callback
            return 71
        },
        clearTimeout: () => {}
    })

    try {
        const handle = IdleScheduler.schedule(() => {
            callbackCount += 1
        }, { timeout: 100 })
        handle.cancel()

        assert.equal(typeof idleCallback, 'function')
        assert.equal(typeof timeoutCallback, 'function')
        idleCallback({ didTimeout: false, timeRemaining: () => 9 })
        timeoutCallback()

        assert.equal(callbackCount, 0)
    } finally {
        restore()
    }
})

test('IdleScheduler should execute timeout fallback when idle callback starves', () => {
    let timeoutCallback = null
    let callbackCount = 0
    let callbackDeadline = null

    const restore = installWindowMock({
        requestIdleCallback: () => 81,
        cancelIdleCallback: () => {},
        setTimeout: (callback) => {
            timeoutCallback = callback
            return 91
        },
        clearTimeout: () => {}
    })

    try {
        IdleScheduler.schedule((deadline) => {
            callbackCount += 1
            callbackDeadline = deadline
        }, { timeout: 75 })

        assert.equal(typeof timeoutCallback, 'function')
        timeoutCallback()

        assert.equal(callbackCount, 1)
        assert.equal(callbackDeadline.didTimeout, true)
    } finally {
        restore()
    }
})
