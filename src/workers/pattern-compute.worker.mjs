import { PatternComputeTasks } from '../PatternComputeTasks.mjs'

/**
 * Posts one tagged worker error.
 * @param {number} requestId
 * @param {Error | unknown} error
 */
function postError(requestId, error) {
    const message = String(error?.message || error || 'Unknown worker error')
    self.postMessage({
        requestId,
        ok: false,
        error: {
            code: message === 'unsupported-operation' ? 'unsupported-operation' : 'compute-error',
            message,
            name: String(error?.name || 'Error')
        }
    })
}

/**
 * Executes one supported worker operation.
 * @param {string} op
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function executeOperation(op, payload) {
    if (op === 'compute-generated-rendered-strokes') {
        return PatternComputeTasks.computeGeneratedRenderedStrokes(payload)
    }
    if (op === 'build-export-svg') {
        return PatternComputeTasks.buildExportSvg(payload)
    }
    throw new Error('unsupported-operation')
}

self.addEventListener('message', (event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : null
    const requestId = Number(data?.requestId)
    if (!Number.isFinite(requestId)) return

    try {
        const op = String(data?.op || '')
        const payload = data?.payload && typeof data.payload === 'object' ? data.payload : {}
        const result = executeOperation(op, payload)
        self.postMessage({ requestId, ok: true, result })
    } catch (error) {
        postError(requestId, error)
    }
})
