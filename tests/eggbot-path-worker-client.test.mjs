import test from 'node:test'
import assert from 'node:assert/strict'
import { EggBotPathWorkerClient } from '../src/EggBotPathWorkerClient.mjs'
import { AppVersion } from '../src/AppVersion.mjs'

/**
 * Minimal event-target worker stub for path transport tests.
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
                                      [
                                          { x: 0, y: 0 },
                                          { x: 32, y: 4 }
                                      ]
                                  ],
                                  schemaVersion: 2
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

test('EggBotPathWorkerClient should resolve successful preprocessing responses', async (context) => {
    const { restore, getWorkers } = installWorkerEnvironment()
    context.after(restore)

    const client = new EggBotPathWorkerClient()
    const result = await client.prepareDrawStrokes({
        strokes: [
            {
                points: [
                    { u: 0, v: 0.5 },
                    { u: 0.2, v: 0.6 }
                ]
            }
        ]
    })

    assert.equal(Array.isArray(result.strokes), true)
    assert.equal(getWorkers().length, 1)
    assert.equal(getWorkers()[0].options.type, 'module')
    assert.equal(getWorkers()[0].url.searchParams.get('v'), AppVersion.get())
})

test('EggBotPathWorkerClient should reject stale worker schema responses', async (context) => {
    class StaleSchemaWorker extends MockWorker {
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
                                [
                                    { x: 0, y: 0 },
                                    { x: 32, y: 4 }
                                ]
                            ],
                            schemaVersion: 1
                        }
                    }
                })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: StaleSchemaWorker })
    context.after(restore)

    const client = new EggBotPathWorkerClient()
    await assert.rejects(
        () => client.prepareDrawStrokes({ strokes: [] }),
        (error) => {
            assert.equal(error.code, 'worker-incompatible')
            return true
        }
    )
})

test('EggBotPathWorkerClient warmup should create one reusable worker', async (context) => {
    const { restore, getWorkers } = installWorkerEnvironment()
    context.after(restore)

    const client = new EggBotPathWorkerClient()
    client.warmup()
    client.warmup()
    assert.equal(getWorkers().length, 1)

    await client.prepareDrawStrokes({ strokes: [] })
    assert.equal(getWorkers().length, 1)
})

test('EggBotPathWorkerClient should reject timed-out requests', async (context) => {
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

    const client = new EggBotPathWorkerClient()
    await assert.rejects(
        () => client.prepareDrawStrokes({ strokes: [] }),
        (error) => {
            assert.equal(error.code, 'worker-timeout')
            return true
        }
    )
    assert.equal(timeoutCalls.length > 0, true)
})

test('EggBotPathWorkerClient should reject pending requests when worker crashes', async (context) => {
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

    const client = new EggBotPathWorkerClient()
    await assert.rejects(
        () => client.prepareDrawStrokes({ strokes: [] }),
        (error) => {
            assert.equal(error.code, 'worker-crashed')
            return true
        }
    )
})

test('EggBotPathWorkerClient should throw when Worker is unavailable', () => {
    const originalWindow = globalThis.window
    const originalWorker = globalThis.Worker
    globalThis.window = {
        setTimeout,
        clearTimeout
    }
    delete globalThis.Worker

    try {
        const client = new EggBotPathWorkerClient()
        assert.throws(
            () => client.prepareDrawStrokes({ strokes: [] }),
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

test('EggBotPathWorkerClient should reject active requests when disposed', async (context) => {
    class PendingWorker extends MockWorker {}

    const { restore } = installWorkerEnvironment({ workerCtor: PendingWorker })
    context.after(restore)

    const client = new EggBotPathWorkerClient()
    const promise = client.prepareDrawStrokes({ strokes: [] })
    client.dispose()

    await assert.rejects(
        () => promise,
        (error) => {
            assert.equal(error.code, 'worker-disposed')
            return true
        }
    )
})
