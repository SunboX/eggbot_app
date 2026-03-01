import { SvgPatternImportWorkerParser } from './SvgPatternImportWorkerParser.mjs'

const IMPORT_WORKER_SCHEMA_VERSION = 4

/**
 * Posts one error response to the main thread.
 * @param {number} requestId
 * @param {Error | unknown} error
 */
function postError(requestId, error) {
    const message = String(error?.message || error || 'Unknown worker error')
    const isRuntimeError = message === 'worker-runtime-unavailable'
    self.postMessage({
        requestId,
        ok: false,
        error: {
            code: isRuntimeError ? 'worker-unavailable' : 'parse-error',
            message,
            name: String(error?.name || 'Error')
        }
    })
}

self.addEventListener('message', (event) => {
    const payload = event.data && typeof event.data === 'object' ? event.data : null
    const requestId = Number(payload?.requestId)
    if (!Number.isFinite(requestId)) return

    try {
        const svgText = String(payload?.svgText || '')
        const options = payload?.options && typeof payload.options === 'object' ? payload.options : {}
        const result = SvgPatternImportWorkerParser.parse(svgText, options)
        self.postMessage({
            requestId,
            ok: true,
            result: {
                ...result,
                schemaVersion: IMPORT_WORKER_SCHEMA_VERSION
            }
        })
    } catch (error) {
        postError(requestId, error)
    }
})
