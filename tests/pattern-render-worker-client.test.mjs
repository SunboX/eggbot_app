import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternRenderWorkerClient } from '../src/PatternRenderWorkerClient.mjs'

/**
 * Minimal event-target worker stub for render transport tests.
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
        this.messages = []
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
     * @param {Record<string, any>} payload
     * @param {Transferable[]} [transfer]
     */
    postMessage(payload, transfer) {
        this.messages.push({ payload, transfer: transfer || [] })
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
 * Creates a minimal transferable-canvas stub.
 * @returns {{ canvas: HTMLCanvasElement, offscreen: OffscreenCanvas }}
 */
function createTransferCanvas() {
    const offscreen = { width: 1024, height: 512 }
    const canvas = {
        width: 1024,
        height: 512,
        transferControlToOffscreen() {
            return offscreen
        }
    }
    return { canvas, offscreen }
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
               * @param {Transferable[]} [transfer]
               */
              postMessage(payload, transfer) {
                  super.postMessage(payload, transfer)
                  queueMicrotask(() => {
                      this.emit('message', {
                          data: {
                              requestId: payload.requestId,
                              ok: true,
                              result: payload.op === 'render' ? { token: payload.payload?.token || 0 } : { initialized: true }
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

test('PatternRenderWorkerClient should initialize and render successfully', async (context) => {
    const { restore, getWorkers } = installWorkerEnvironment()
    context.after(restore)
    const { canvas, offscreen } = createTransferCanvas()

    const client = new PatternRenderWorkerClient()
    client.init(canvas)
    const result = await client.render(
        {
            baseColor: '#fff',
            lineWidth: 1.8,
            palette: ['#111111'],
            strokes: []
        },
        7
    )

    assert.equal(result.token, 7)
    assert.equal(getWorkers().length, 1)
    assert.equal(getWorkers()[0].options.type, 'module')
    assert.equal(getWorkers()[0].messages[0].payload.op, 'init')
    assert.equal(getWorkers()[0].messages[0].transfer[0], offscreen)
    assert.equal(getWorkers()[0].messages[1].payload.op, 'render')
})

test('PatternRenderWorkerClient warmup should create one reusable worker', async (context) => {
    const { restore, getWorkers } = installWorkerEnvironment()
    context.after(restore)
    const { canvas } = createTransferCanvas()

    const client = new PatternRenderWorkerClient()
    client.warmup()
    client.warmup()
    assert.equal(getWorkers().length, 1)

    client.init(canvas)
    await client.render({ strokes: [] }, 2)
    assert.equal(getWorkers().length, 1)
})

test('PatternRenderWorkerClient should require init before render', async (context) => {
    const { restore } = installWorkerEnvironment()
    context.after(restore)

    const client = new PatternRenderWorkerClient()
    await assert.rejects(
        () => client.render({ strokes: [] }, 1),
        (error) => {
            assert.equal(error.code, 'render-not-initialized')
            return true
        }
    )
})

test('PatternRenderWorkerClient should reject timed-out render requests', async (context) => {
    class NeverRespondWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         * @param {Transferable[]} [transfer]
         */
        postMessage(payload, transfer) {
            super.postMessage(payload, transfer)
            if (payload.op === 'init') {
                queueMicrotask(() => {
                    this.emit('message', {
                        data: {
                            requestId: payload.requestId,
                            ok: true,
                            result: { initialized: true }
                        }
                    })
                })
            }
        }
    }

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
    const { canvas } = createTransferCanvas()

    const client = new PatternRenderWorkerClient()
    client.init(canvas)
    await assert.rejects(
        () => client.render({ strokes: [] }, 4),
        (error) => {
            assert.equal(error.code, 'worker-timeout')
            return true
        }
    )
    assert.equal(timeoutCalls.length > 0, true)
})

test('PatternRenderWorkerClient should reject pending requests when worker crashes', async (context) => {
    class CrashWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         * @param {Transferable[]} [transfer]
         */
        postMessage(payload, transfer) {
            super.postMessage(payload, transfer)
            if (payload.op === 'init') {
                queueMicrotask(() => {
                    this.emit('message', {
                        data: {
                            requestId: payload.requestId,
                            ok: true,
                            result: { initialized: true }
                        }
                    })
                })
                return
            }
            queueMicrotask(() => {
                this.emit('error', { message: 'Synthetic worker crash' })
            })
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: CrashWorker })
    context.after(restore)
    const { canvas } = createTransferCanvas()

    const client = new PatternRenderWorkerClient()
    client.init(canvas)
    await assert.rejects(
        () => client.render({ strokes: [] }, 9),
        (error) => {
            assert.equal(error.code, 'worker-crashed')
            return true
        }
    )
})

test('PatternRenderWorkerClient should throw for unsupported init/runtime', () => {
    const originalWindow = globalThis.window
    const originalWorker = globalThis.Worker
    globalThis.window = {
        setTimeout,
        clearTimeout
    }
    delete globalThis.Worker

    try {
        const client = new PatternRenderWorkerClient()
        assert.throws(
            () => client.init(/** @type {HTMLCanvasElement} */ ({ transferControlToOffscreen: () => ({}) })),
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

test('PatternRenderWorkerClient should reject active requests when disposed', async (context) => {
    class PendingWorker extends MockWorker {
        /**
         * @param {Record<string, any>} payload
         * @param {Transferable[]} [transfer]
         */
        postMessage(payload, transfer) {
            super.postMessage(payload, transfer)
            if (payload.op === 'init') {
                queueMicrotask(() => {
                    this.emit('message', {
                        data: {
                            requestId: payload.requestId,
                            ok: true,
                            result: { initialized: true }
                        }
                    })
                })
            }
        }
    }

    const { restore } = installWorkerEnvironment({ workerCtor: PendingWorker })
    context.after(restore)
    const { canvas } = createTransferCanvas()

    const client = new PatternRenderWorkerClient()
    client.init(canvas)
    const promise = client.render({ strokes: [] }, 11)
    client.dispose()

    await assert.rejects(
        () => promise,
        (error) => {
            assert.equal(error.code, 'worker-disposed')
            return true
        }
    )
})
