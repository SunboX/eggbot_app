/**
 * Worker transport for texture rasterization using OffscreenCanvas.
 */
export class PatternRenderWorkerClient {
    #worker = null
    #nextRequestId = 1
    #pending = new Map()
    #workerFailed = false
    #initPromise = null
    #initialized = false

    /**
     * Returns true when runtime supports the render worker path.
     * @param {HTMLCanvasElement | null | undefined} canvas
     * @returns {boolean}
     */
    static isSupported(canvas) {
        return Boolean(
            typeof Worker === 'function' &&
                canvas &&
                typeof canvas.transferControlToOffscreen === 'function'
        )
    }

    /**
     * Pre-initializes the render worker.
     */
    warmup() {
        this.#ensureWorker()
    }

    /**
     * Transfers one HTML canvas to worker ownership.
     * @param {HTMLCanvasElement} canvas
     */
    init(canvas) {
        if (this.#initialized || this.#initPromise) {
            return
        }
        if (!PatternRenderWorkerClient.isSupported(canvas)) {
            throw PatternRenderWorkerClient.#buildError('worker-unavailable', 'Render worker is not supported')
        }
        const offscreenCanvas = canvas.transferControlToOffscreen()
        this.#initPromise = this.#request('init', { canvas: offscreenCanvas }, 30_000, [offscreenCanvas])
            .then(() => {
                this.#initialized = true
            })
            .catch((error) => {
                this.#initialized = false
                this.#workerFailed = true
                throw error
            })
    }

    /**
     * Renders one texture frame in worker thread.
     * @param {{ baseColor?: string, lineWidth?: number, fillPatterns?: boolean, palette?: string[], strokes?: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, importedSvgText?: string, importedSvgHeightRatio?: number }} data
     * @param {number} token
     * @returns {Promise<{ token: number, stale?: boolean }>}
     */
    async render(data, token) {
        if (!this.#initialized && !this.#initPromise) {
            throw PatternRenderWorkerClient.#buildError('render-not-initialized', 'Render worker is not initialized')
        }
        if (this.#initPromise) {
            await this.#initPromise
        }
        const normalizedToken = Number.isFinite(Number(token)) ? Number(token) : 0
        return this.#request(
            'render',
            {
                token: normalizedToken,
                data: data && typeof data === 'object' ? data : {}
            },
            90_000
        )
    }

    /**
     * Disposes worker resources.
     */
    dispose() {
        this.#rejectAllPending(PatternRenderWorkerClient.#buildError('worker-disposed', 'Worker disposed'))
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#workerFailed = true
        this.#initialized = false
        this.#initPromise = null
    }

    /**
     * Executes one worker request.
     * @param {string} op
     * @param {Record<string, any>} payload
     * @param {number} timeoutMs
     * @param {Transferable[]} [transfer]
     * @returns {Promise<Record<string, any>>}
     */
    #request(op, payload, timeoutMs, transfer = []) {
        const worker = this.#ensureWorker()
        const requestId = this.#nextRequestId
        this.#nextRequestId += 1

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this.#pending.delete(requestId)
                reject(PatternRenderWorkerClient.#buildError('worker-timeout', 'Worker render timed out'))
            }, timeoutMs)

            this.#pending.set(requestId, { resolve, reject, timeoutId })
            const message = {
                requestId,
                op,
                payload: payload && typeof payload === 'object' ? payload : {}
            }
            if (transfer.length) {
                worker.postMessage(message, transfer)
                return
            }
            worker.postMessage(message)
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
            throw PatternRenderWorkerClient.#buildError('worker-unavailable', 'Worker not available')
        }

        try {
            const worker = new Worker(new URL('./workers/pattern-render.worker.mjs', import.meta.url), {
                type: 'module'
            })
            worker.addEventListener('message', (event) => this.#handleWorkerMessage(event))
            worker.addEventListener('error', (event) => this.#handleWorkerFailure(event))
            this.#worker = worker
            return worker
        } catch (_error) {
            this.#workerFailed = true
            throw PatternRenderWorkerClient.#buildError('worker-unavailable', 'Failed to initialize worker')
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
            pending.resolve(payload.result)
            return
        }

        const code = String(payload?.error?.code || 'worker-error')
        const message = String(payload?.error?.message || 'Worker render failed')
        pending.reject(PatternRenderWorkerClient.#buildError(code, message))
    }

    /**
     * Handles hard worker failures and rejects active requests.
     * @param {ErrorEvent | Event} event
     */
    #handleWorkerFailure(event) {
        const message = String(event?.message || 'Worker crashed')
        this.#workerFailed = true
        this.#initialized = false
        this.#initPromise = null
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#rejectAllPending(PatternRenderWorkerClient.#buildError('worker-crashed', message))
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
