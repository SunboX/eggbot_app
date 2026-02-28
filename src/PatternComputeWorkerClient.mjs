import { WorkerUrlUtils } from './WorkerUrlUtils.mjs'

/**
 * Worker transport for generated-pattern compute tasks.
 */
export class PatternComputeWorkerClient {
    #worker = null
    #nextRequestId = 1
    #pending = new Map()
    #workerFailed = false

    /**
     * Computes generated render strokes in worker thread.
     * @param {{ state?: Record<string, any>, activeHeightRatio?: number }} payload
     * @returns {Promise<{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', transformGroupId?: number, horizontalRingGroup?: string, motifGroup?: string }> }>}
     */
    computeGeneratedRenderedStrokes(payload) {
        return this.#request('compute-generated-rendered-strokes', payload, 30_000)
    }

    /**
     * Builds SVG export content in worker thread.
     * @param {{ svgInput?: Record<string, any> }} payload
     * @returns {Promise<{ contents: string }>}
     */
    buildExportSvg(payload) {
        return this.#request('build-export-svg', payload, 90_000)
    }

    /**
     * Pre-initializes the compute worker.
     */
    warmup() {
        this.#ensureWorker()
    }

    /**
     * Disposes worker resources.
     */
    dispose() {
        this.#rejectAllPending(PatternComputeWorkerClient.#buildError('worker-disposed', 'Worker disposed'))
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#workerFailed = true
    }

    /**
     * Executes one worker operation.
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
                reject(PatternComputeWorkerClient.#buildError('worker-timeout', 'Worker compute timed out'))
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
            throw PatternComputeWorkerClient.#buildError('worker-unavailable', 'Worker not available')
        }

        try {
            const worker = new Worker(WorkerUrlUtils.resolveVersionedWorkerUrl('./workers/pattern-compute.worker.mjs', import.meta.url), {
                type: 'module'
            })
            worker.addEventListener('message', (event) => this.#handleWorkerMessage(event))
            worker.addEventListener('error', (event) => this.#handleWorkerFailure(event))
            this.#worker = worker
            return worker
        } catch (_error) {
            this.#workerFailed = true
            throw PatternComputeWorkerClient.#buildError('worker-unavailable', 'Failed to initialize worker')
        }
    }

    /**
     * Handles worker messages.
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
            pending.resolve(payload.result)
            return
        }

        const code = String(payload?.error?.code || 'worker-error')
        const message = String(payload?.error?.message || 'Worker compute failed')
        pending.reject(PatternComputeWorkerClient.#buildError(code, message))
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
        this.#rejectAllPending(PatternComputeWorkerClient.#buildError('worker-crashed', message))
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
}
