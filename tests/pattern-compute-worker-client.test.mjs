import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternComputeWorkerClient } from '../src/PatternComputeWorkerClient.mjs'
import { AppVersion } from '../src/AppVersion.mjs'

/**
 * Minimal event-target worker stub for client transport tests.
 */
class MockWorker {
    /**
     * @param {URL} url
     * @param {Record<string, any>} options
     */
    constructor(url, options) {
        this.url = url
        this.options = options
        this.terminated = false
        this.listeners = new Map([
            ['message', []],
            ['error', []]
        ])
    }

    /**
     * Registers one event callback.
     * @param {'message' | 'error'} type
     * @param {(event: Record<string, any>) => void} callback
     */
    addEventListener(type, callback) {
        const callbacks = this.listeners.get(type) || []
        callbacks.push(callback)
        this.listeners.set(type, callbacks)
    }

    /**
     * Accepts one worker request payload.
     * @param {Record<string, any>} _payload
     */
    postMessage(_payload) {
        // Overridden in concrete subclasses.
    }

    /**
     * Marks worker as terminated.
     */
    terminate() {
        this.terminated = true
    }

    /**
     * Emits one worker event.
     * @param {'message' | 'error'} type
     * @param {Record<string, any>} event
     */
    emit(type, event) {
        const callbacks = this.listeners.get(type) || []
        callbacks.forEach((callback) => callback(event))
    }
}

/**
 * Installs mock `window` + `Worker` globals for one test.
 * @param {{ workerCtor?: new (url: URL, options: Record<string, any>) => MockWorker, setTimeoutImpl?: typeof setTimeout, clearTimeoutImpl?: typeof clearTimeout }} input
 * @returns {{ restore: () => void, getWorkers: () => MockWorker[] }}
 */
function installWorkerEnvironment(input = {}) {
    const originalWindow = globalThis.window
    const originalWorker = globalThis.Worker
    const workers = []

    const workerCtor = input.workerCtor
        ? input.workerCtor
        : class extends MockWorker {
              postMessage(payload) {
                  queueMicrotask(() => {
                      this.emit('message', {
                          data: {
                              requestId: payload.requestId,
                              ok: true,
                              result: { strokes: [] }
                          }
                      })
                  })
              }
          }

    globalThis.window = {
        setTimeout: input.setTimeoutImpl || setTimeout,
        clearTimeout: input.clearTimeoutImpl || clearTimeout
    }
    globalThis.Worker = class extends workerCtor {
        /**
         * @param {URL} url
         * @param {Record<string, any>} options
         */
        constructor(url, options) {
            super(url, options)
            workers.push(this)
        }
    }

    return {
        restore: () => {
            if (originalWindow === undefined) {
                delete globalThis.window
            } else {
                globalThis.window = originalWindow
            }
            if (originalWorker === undefined) {
                delete globalThis.Worker
            } else {
                globalThis.Worker = originalWorker
            }
        },
        getWorkers: () => workers
    }
}

test('PatternComputeWorkerClient should resolve successful compute responses', async (context) => {
    class SuccessWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         */
        postMessage(payload) {
            queueMicrotask(() => {
                this.emit('message', {
                    data: {
                        requestId: payload.requestId,
                        ok: true,
                        result: {
                            strokes: [
                                {
                                    colorIndex: 0,
                                    points: [
                                        { u: 0, v: 0.5 },
                                        { u: 0.3, v: 0.7 }
                                    ]
                                }
                            ]
                        }
                    }
                })
            })
        }
    }

    const { restore, getWorkers } = installWorkerEnvironment({ workerCtor: SuccessWorker })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    const first = await client.computeGeneratedRenderedStrokes({ state: { seed: 1 }, activeHeightRatio: 0.8 })
    const second = await client.computeGeneratedRenderedStrokes({ state: { seed: 2 }, activeHeightRatio: 0.9 })

    assert.equal(Array.isArray(first.strokes), true)
    assert.equal(Array.isArray(second.strokes), true)
    assert.equal(getWorkers().length, 1)
    assert.equal(getWorkers()[0].options.type, 'module')
    assert.equal(getWorkers()[0].url.searchParams.get('v'), AppVersion.get())
})

test('PatternComputeWorkerClient should resolve successful export build responses', async (context) => {
    class SuccessWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         */
        postMessage(payload) {
            queueMicrotask(() => {
                this.emit('message', {
                    data: {
                        requestId: payload.requestId,
                        ok: true,
                        result: {
                            contents: '<svg></svg>'
                        }
                    }
                })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: SuccessWorker })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    const result = await client.buildExportSvg({
        svgInput: {
            strokes: [],
            palette: ['#111111']
        }
    })

    assert.equal(result.contents, '<svg></svg>')
})

test('PatternComputeWorkerClient warmup should create one reusable worker', async (context) => {
    class SuccessWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         */
        postMessage(payload) {
            queueMicrotask(() => {
                this.emit('message', {
                    data: {
                        requestId: payload.requestId,
                        ok: true,
                        result: { strokes: [] }
                    }
                })
            })
        }
    }

    const { restore, getWorkers } = installWorkerEnvironment({ workerCtor: SuccessWorker })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    client.warmup()
    client.warmup()
    assert.equal(getWorkers().length, 1)

    await client.computeGeneratedRenderedStrokes({ state: { seed: 3 }, activeHeightRatio: 1 })
    assert.equal(getWorkers().length, 1)
})

test('PatternComputeWorkerClient should reject timed-out requests', async (context) => {
    class NeverRespondWorker extends MockWorker {}

    const timeoutCalls = []
    const setTimeoutImpl = (callback) => {
        timeoutCalls.push(true)
        queueMicrotask(callback)
        return 1
    }
    const clearTimeoutImpl = () => {}
    const { restore } = installWorkerEnvironment({
        workerCtor: NeverRespondWorker,
        setTimeoutImpl,
        clearTimeoutImpl
    })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    await assert.rejects(
        () => client.computeGeneratedRenderedStrokes({ state: { seed: 10 }, activeHeightRatio: 1 }),
        (error) => {
            assert.equal(error.code, 'worker-timeout')
            return true
        }
    )
    assert.equal(timeoutCalls.length > 0, true)
})

test('PatternComputeWorkerClient should reject pending requests when worker crashes', async (context) => {
    class CrashWorker extends MockWorker {
        /**
         * @param {Record<string, any>} _payload
         */
        postMessage(_payload) {
            queueMicrotask(() => {
                this.emit('error', { message: 'Synthetic worker crash' })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: CrashWorker })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    await assert.rejects(
        () => client.computeGeneratedRenderedStrokes({ state: { seed: 5 }, activeHeightRatio: 0.9 }),
        (error) => {
            assert.equal(error.code, 'worker-crashed')
            return true
        }
    )
})

test('PatternComputeWorkerClient should throw when Worker is unavailable', () => {
    const originalWindow = globalThis.window
    const originalWorker = globalThis.Worker
    globalThis.window = {
        setTimeout,
        clearTimeout
    }
    delete globalThis.Worker

    try {
        const client = new PatternComputeWorkerClient()
        assert.throws(
            () => client.computeGeneratedRenderedStrokes({ state: {}, activeHeightRatio: 1 }),
            (error) => {
                assert.equal(error.code, 'worker-unavailable')
                return true
            }
        )
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window
        } else {
            globalThis.window = originalWindow
        }
        if (originalWorker === undefined) {
            delete globalThis.Worker
        } else {
            globalThis.Worker = originalWorker
        }
    }
})

test('PatternComputeWorkerClient should reject active requests when disposed', async (context) => {
    class PendingWorker extends MockWorker {}

    const { restore } = installWorkerEnvironment({ workerCtor: PendingWorker })
    context.after(restore)

    const client = new PatternComputeWorkerClient()
    const promise = client.computeGeneratedRenderedStrokes({ state: { seed: 99 }, activeHeightRatio: 1 })
    client.dispose()

    await assert.rejects(
        () => promise,
        (error) => {
            assert.equal(error.code, 'worker-disposed')
            return true
        }
    )
})
