import { WorkerUrlUtils } from './WorkerUrlUtils.mjs'
import { SvgPatternImportWorkerParser } from './workers/SvgPatternImportWorkerParser.mjs'

/**
 * Worker transport for loading and parsing imported SVG patterns.
 */
export class PatternImportWorkerClient {
    static #WORKER_SCHEMA_VERSION = 2

    #worker = null
    #nextRequestId = 1
    #pending = new Map()
    #workerFailed = false

    /**
     * Parses SVG text in the worker thread.
     * @param {string} svgText
     * @param {{ maxColors?: number, sampleSpacing?: number, heightScale?: number, heightReference?: number, preserveRawHeight?: boolean, curveSmoothing?: number }} [options]
     * @returns {Promise<{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio?: number, documentWidthPx?: number, documentHeightPx?: number }>}
     */
    async parse(svgText, options = {}) {
        const normalizedSvgText = String(svgText || '')
        const normalizedOptions = options && typeof options === 'object' ? options : {}

        try {
            const result = await this.#requestWorkerParse(normalizedSvgText, normalizedOptions)
            if (PatternImportWorkerClient.#isCompatibleWorkerResult(result)) {
                return PatternImportWorkerClient.#stripWorkerMetadata(result)
            }
        } catch (error) {
            throw error
        }

        return SvgPatternImportWorkerParser.parse(normalizedSvgText, normalizedOptions)
    }

    /**
     * Parses SVG text in worker transport.
     * @param {string} svgText
     * @param {{ maxColors?: number, sampleSpacing?: number, heightScale?: number, heightReference?: number, preserveRawHeight?: boolean, curveSmoothing?: number }} options
     * @returns {Promise<{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio?: number, documentWidthPx?: number, documentHeightPx?: number }>}
     */
    #requestWorkerParse(svgText, options) {
        const worker = this.#ensureWorker()
        const requestId = this.#nextRequestId
        this.#nextRequestId += 1

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                this.#pending.delete(requestId)
                reject(PatternImportWorkerClient.#buildError('worker-timeout', 'Worker parsing timed out'))
            }, 90_000)

            this.#pending.set(requestId, { resolve, reject, timeoutId })
            worker.postMessage({
                requestId,
                svgText,
                options
            })
        })
    }

    /**
     * Pre-initializes the import worker.
     */
    warmup() {
        this.#ensureWorker()
    }

    /**
     * Disposes worker resources.
     */
    dispose() {
        this.#rejectAllPending(PatternImportWorkerClient.#buildError('worker-disposed', 'Worker disposed'))
        if (this.#worker) {
            this.#worker.terminate()
            this.#worker = null
        }
        this.#workerFailed = true
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
            throw PatternImportWorkerClient.#buildError('worker-unavailable', 'Worker not available')
        }

        try {
            const worker = new Worker(WorkerUrlUtils.resolveVersionedWorkerUrl('./workers/pattern-import.worker.mjs', import.meta.url), {
                type: 'module'
            })
            worker.addEventListener('message', (event) => this.#handleWorkerMessage(event))
            worker.addEventListener('error', (event) => this.#handleWorkerFailure(event))
            this.#worker = worker
            return worker
        } catch (_error) {
            this.#workerFailed = true
            throw PatternImportWorkerClient.#buildError('worker-unavailable', 'Failed to initialize worker')
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
        const message = String(payload?.error?.message || 'Worker parsing failed')
        pending.reject(PatternImportWorkerClient.#buildError(code, message))
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
        this.#rejectAllPending(PatternImportWorkerClient.#buildError('worker-crashed', message))
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
     * Validates whether worker parse result already follows the modern v281 import schema.
     * Legacy worker builds may return strokes/palette only, which we refresh via main-thread parser.
     * @param {Record<string, any> | null | undefined} result
     * @returns {boolean}
     */
    static #isCompatibleWorkerResult(result) {
        if (!result || typeof result !== 'object') return false
        if (Math.trunc(Number(result.schemaVersion)) !== PatternImportWorkerClient.#WORKER_SCHEMA_VERSION) {
            return false
        }
        if (!Array.isArray(result.strokes) || result.strokes.length <= 0) return false

        const width = Number(result.documentWidthPx)
        const height = Number(result.documentHeightPx)
        const heightRatio = Number(result.heightRatio)
        return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 && Number.isFinite(heightRatio) && heightRatio > 0
    }

    /**
     * Removes worker-specific metadata before returning parser payload to callers.
     * @param {Record<string, any>} result
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio?: number, documentWidthPx?: number, documentHeightPx?: number }}
     */
    static #stripWorkerMetadata(result) {
        const {
            schemaVersion: _schemaVersion,
            ...normalized
        } = result
        return normalized
    }
}
