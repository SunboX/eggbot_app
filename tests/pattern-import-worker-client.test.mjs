import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternImportWorkerClient } from '../src/PatternImportWorkerClient.mjs'
import { AppVersion } from '../src/AppVersion.mjs'

/**
 * Minimal event-target worker stub for import transport tests.
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
                              result: {
                                  strokes: [],
                                  palette: ['#111111'],
                                  schemaVersion: 4
                              }
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

test('PatternImportWorkerClient should resolve successful parse responses', async (context) => {
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
                                        { u: 0.1, v: 0.2 },
                                        { u: 0.3, v: 0.4 }
                                    ]
                                }
                            ],
                            palette: ['#111111'],
                            baseColor: '#ffffff',
                            heightRatio: 0.9,
                            documentWidthPx: 1209.448,
                            documentHeightPx: 377.952,
                            schemaVersion: 4
                        }
                    }
                })
            })
        }
    }

    const { restore, getWorkers } = installWorkerEnvironment({ workerCtor: SuccessWorker })
    context.after(restore)

    const client = new PatternImportWorkerClient()
    client.warmup()
    const result = await client.parse('<svg />', { maxColors: 3 })

    assert.equal(Array.isArray(result.strokes), true)
    assert.deepEqual(result.palette, ['#111111'])
    assert.equal(getWorkers().length, 1)
    assert.equal(getWorkers()[0].options.type, 'module')
    assert.equal(getWorkers()[0].url.searchParams.get('v'), AppVersion.get())
})

test('PatternImportWorkerClient should refresh legacy worker parse payloads via current parser', async (context) => {
    class LegacyWorkerResult extends MockWorker {
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
                                        { u: 0.1, v: 0.2 },
                                        { u: 0.3, v: 0.4 }
                                    ]
                                }
                            ],
                            palette: ['#111111']
                        }
                    }
                })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: LegacyWorkerResult })
    context.after(restore)

    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <g transform="translate(0,-197)">
                <rect x="20.606821" y="217.98375" width="227.91998" height="63.53756" fill="none" stroke="#000000" />
            </g>
        </svg>
    `

    const client = new PatternImportWorkerClient()
    const result = await client.parse(svgText, {
        heightScale: 1,
        heightReference: 1,
        curveSmoothing: 0.2
    })

    assert.equal(Array.isArray(result.strokes), true)
    assert.equal(result.strokes.length, 1)
    assert.equal(result.strokes[0].points.length, 5)
    assert.ok(Math.abs(Number(result.documentWidthPx) - 1209.448) < 0.01)
    assert.ok(Math.abs(Number(result.documentHeightPx) - 377.952) < 0.01)
})

test('PatternImportWorkerClient should fallback when worker schema version is stale', async (context) => {
    class StaleSchemaWorkerResult extends MockWorker {
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
                                        { u: 0.1, v: 0.2 },
                                        { u: 0.3, v: 0.4 }
                                    ]
                                }
                            ],
                            palette: ['#111111'],
                            heightRatio: 1,
                            documentWidthPx: 1209.448,
                            documentHeightPx: 377.952,
                            schemaVersion: 3
                        }
                    }
                })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: StaleSchemaWorkerResult })
    context.after(restore)

    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <g transform="translate(0,-197)">
                <rect x="20.606821" y="217.98375" width="227.91998" height="63.53756" fill="none" stroke="#000000" />
            </g>
        </svg>
    `

    const client = new PatternImportWorkerClient()
    const result = await client.parse(svgText, {
        heightScale: 1,
        heightReference: 1,
        curveSmoothing: 0.2
    })

    assert.equal(Array.isArray(result.strokes), true)
    assert.equal(result.strokes.length, 1)
    assert.equal(result.strokes[0].points.length, 5)
    assert.ok(Math.abs(Number(result.documentWidthPx) - 1209.448) < 0.01)
    assert.ok(Math.abs(Number(result.documentHeightPx) - 377.952) < 0.01)
})

test('PatternImportWorkerClient should reject timed-out requests', async (context) => {
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

    const client = new PatternImportWorkerClient()
    await assert.rejects(
        () => client.parse('<svg />'),
        (error) => {
            assert.equal(error.code, 'worker-timeout')
            return true
        }
    )
    assert.equal(timeoutCalls.length > 0, true)
})

test('PatternImportWorkerClient should reject pending requests when worker crashes', async (context) => {
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

    const client = new PatternImportWorkerClient()
    await assert.rejects(
        () => client.parse('<svg />'),
        (error) => {
            assert.equal(error.code, 'worker-crashed')
            return true
        }
    )
})

test('PatternImportWorkerClient should reject when Worker is unavailable', async () => {
    const originalWindow = globalThis.window
    const originalWorker = globalThis.Worker
    globalThis.window = {
        setTimeout,
        clearTimeout
    }
    delete globalThis.Worker

    try {
        const client = new PatternImportWorkerClient()
        await assert.rejects(
            () => client.parse('<svg />'),
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

test('PatternImportWorkerClient should reject active requests when disposed', async (context) => {
    class PendingWorker extends MockWorker {}

    const { restore } = installWorkerEnvironment({ workerCtor: PendingWorker })
    context.after(restore)

    const client = new PatternImportWorkerClient()
    const promise = client.parse('<svg />')
    client.dispose()

    await assert.rejects(
        () => promise,
        (error) => {
            assert.equal(error.code, 'worker-disposed')
            return true
        }
    )
})
