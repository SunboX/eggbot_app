import { WorkerUrlUtils } from './WorkerUrlUtils.mjs'

/**
 * Worker transport for EggBot draw-path preprocessing.
 */
export class EggBotPathWorkerClient {
    static #WORKER_SCHEMA_VERSION = 4

    #worker = null
    #nextRequestId = 1
    #pending = new Map()
    #workerFailed = false

    /**
     * Precomputes drawable stroke paths in worker thread.
     * @param {{ strokes?: Array<{ points: Array<{u:number,v:number}> }>, drawConfig?: { stepsPerTurn?: number, penRangeSteps?: number, wrapAround?: boolean }, startX?: number }} payload
     * @returns {Promise<{ strokes: Array<Array<{x:number,y:number}>> }>}
     */
    prepareDrawStrokes(payload) {
        return this.#request('prepare-draw-strokes', payload, 60_000)
    }

    /**
     * Pre-initializes the path worker.
     */
    warmup() {
        this.#ensureWorker()
    }

    /**
     * Disposes worker resources.
     */
    dispose() {
        this.#rejectAllPending(EggBotPathWorkerClient.#buildError('worker-disposed', 'Worker disposed'))
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#workerFailed = true
    }

    /**
     * Executes one worker request.
     * @param {string} op
     * @param {Record<string, any>} payload
     * @param {number} timeoutMs
     * @returns {Promise<Record<string, any>>}
     */
    #request(op, payload, timeoutMs) {
        const worker = this.#ensureWorker()
        const requestId = this.#nextRequestId
        this.#nextRequestId += 1

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this.#pending.delete(requestId)
                reject(EggBotPathWorkerClient.#buildError('worker-timeout', 'Worker path preprocessing timed out'))
            }, timeoutMs)

            this.#pending.set(requestId, { resolve, reject, timeoutId })
            worker.postMessage({
                requestId,
                op,
                payload: payload && typeof payload === 'object' ? payload : {}
            })
        })
    }

    /**
     * Ensures one worker instance exists.
     * @returns {Worker}
     */
    #ensureWorker() {
        if (this.#worker) {
            return this.#worker
        }

        if (this.#workerFailed || typeof Worker !== 'function') {
            throw EggBotPathWorkerClient.#buildError('worker-unavailable', 'Worker not available')
        }

        try {
            const worker = new Worker(WorkerUrlUtils.resolveVersionedWorkerUrl('./workers/eggbot-path.worker.mjs', import.meta.url), {
                type: 'module'
            })
            worker.addEventListener('message', (event) => this.#handleWorkerMessage(event))
            worker.addEventListener('error', (event) => this.#handleWorkerFailure(event))
            this.#worker = worker
            return worker
        } catch (_error) {
            this.#workerFailed = true
            throw EggBotPathWorkerClient.#buildError('worker-unavailable', 'Failed to initialize worker')
        }
    }

    /**
     * Handles worker responses.
     * @param {MessageEvent} event
     */
    #handleWorkerMessage(event) {
        const payload = event.data && typeof event.data === 'object' ? event.data : null
        const requestId = Number(payload?.requestId)
        if (!Number.isFinite(requestId)) return

        const pending = this.#pending.get(requestId)
        if (!pending) return
        this.#pending.delete(requestId)
        window.clearTimeout(pending.timeoutId)

        if (payload?.ok) {
            const result = payload.result
            if (!EggBotPathWorkerClient.#isCompatibleWorkerResult(result)) {
                pending.reject(EggBotPathWorkerClient.#buildError('worker-incompatible', 'Worker response schema is incompatible'))
                return
            }
            pending.resolve(EggBotPathWorkerClient.#stripWorkerMetadata(result))
            return
        }

        const code = String(payload?.error?.code || 'worker-error')
        const message = String(payload?.error?.message || 'Worker path preprocessing failed')
        pending.reject(EggBotPathWorkerClient.#buildError(code, message))
    }

    /**
     * Handles hard worker failures and rejects active requests.
     * @param {ErrorEvent | Event} event
     */
    #handleWorkerFailure(event) {
        const message = String(event?.message || 'Worker crashed')
        this.#workerFailed = true
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#rejectAllPending(EggBotPathWorkerClient.#buildError('worker-crashed', message))
    }

    /**
     * Rejects all pending requests.
     * @param {Error} error
     */
    #rejectAllPending(error) {
        this.#pending.forEach((pending) => {
            window.clearTimeout(pending.timeoutId)
            pending.reject(error)
        })
        this.#pending.clear()
    }

    /**
     * Creates one tagged error.
     * @param {string} code
     * @param {string} message
     * @returns {Error & { code: string }}
     */
    static #buildError(code, message) {
        const error = new Error(message)
        error.code = code
        return error
    }

    /**
     * Checks worker response schema compatibility.
     * @param {Record<string, any> | null | undefined} result
     * @returns {boolean}
     */
    static #isCompatibleWorkerResult(result) {
        if (!result || typeof result !== 'object') return false
        if (Math.trunc(Number(result.schemaVersion)) !== EggBotPathWorkerClient.#WORKER_SCHEMA_VERSION) {
            return false
        }
        return Array.isArray(result.strokes)
    }

    /**
     * Removes worker-specific metadata before returning path payload to callers.
     * @param {Record<string, any>} result
     * @returns {{ strokes: Array<Array<{x:number,y:number}>> }}
     */
    static #stripWorkerMetadata(result) {
        const {
            schemaVersion: _schemaVersion,
            ...normalized
        } = result
        return normalized
    }
}
