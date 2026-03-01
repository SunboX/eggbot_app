import { UvStrokeUnwrapUtils } from '../UvStrokeUnwrapUtils.mjs'

let textureCanvas = null
let textureContext = null
let latestRenderToken = 0
let operationQueue = Promise.resolve()

/**
 * Posts one tagged worker error response.
 * @param {number} requestId
 * @param {Error | unknown} error
 */
function postError(requestId, error) {
    const message = String(error?.message || error || 'Unknown worker error')
    let code = 'render-error'
    if (message === 'unsupported-operation') {
        code = 'unsupported-operation'
    } else if (message === 'render-not-initialized') {
        code = 'render-not-initialized'
    } else if (message === 'imported-svg-raster-unsupported') {
        code = 'imported-svg-raster-unsupported'
    } else if (message === 'worker-unavailable') {
        code = 'worker-unavailable'
    }
    self.postMessage({
        requestId,
        ok: false,
        error: {
            code,
            message,
            name: String(error?.name || 'Error')
        }
    })
}

/**
 * Handles worker init by receiving one transferred OffscreenCanvas.
 * @param {Record<string, any>} payload
 * @returns {{ initialized: true }}
 */
function initRenderer(payload) {
    const canvas = payload?.canvas
    if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('worker-unavailable')
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('worker-unavailable')
    }
    textureCanvas = canvas
    textureContext = ctx
    return { initialized: true }
}

/**
 * Executes one render operation.
 * @param {Record<string, any>} payload
 * @returns {Promise<{ token: number, stale?: boolean }>}
 */
async function renderFrame(payload) {
    if (!textureCanvas || !textureContext) {
        throw new Error('render-not-initialized')
    }
    const token = Number.isFinite(Number(payload?.token)) ? Number(payload.token) : 0
    if (token < latestRenderToken) {
        return { token, stale: true }
    }
    latestRenderToken = token
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}
    const width = Number(textureCanvas.width) || 1
    const height = Number(textureCanvas.height) || 1
    textureContext.clearRect(0, 0, width, height)
    textureContext.fillStyle = String(data.baseColor || '#efe7ce')
    textureContext.fillRect(0, 0, width, height)

    const importedSvgText = String(data.importedSvgText || '').trim()
    const strokes = Array.isArray(data.strokes) ? data.strokes : []

    if (importedSvgText && !strokes.length) {
        await drawImportedSvg(importedSvgText, Number(data.importedSvgHeightRatio) || 1, token)
        if (token !== latestRenderToken) {
            return { token, stale: true }
        }
        return { token }
    }

    drawStrokes(strokes, data.palette || ['#8b1f1a'], Number(data.lineWidth) || 1.8, data.fillPatterns !== false)
    return { token }
}

/**
 * Draws imported SVG directly for exact fill semantics.
 * @param {string} svgText
 * @param {number} heightRatio
 * @param {number} token
 * @returns {Promise<void>}
 */
async function drawImportedSvg(svgText, heightRatio, token) {
    if (!textureCanvas || !textureContext) {
        throw new Error('render-not-initialized')
    }
    if (typeof createImageBitmap !== 'function') {
        throw new Error('imported-svg-raster-unsupported')
    }
    const width = Number(textureCanvas.width) || 1
    const height = Number(textureCanvas.height) || 1
    const ratio = Math.max(0.02, Math.min(3, Number(heightRatio) || 1))
    const drawWidth = width * ratio
    const drawHeight = height * ratio
    const drawX = (width - drawWidth) / 2
    const drawY = (height - drawHeight) / 2
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const imageBitmap = await createImageBitmap(blob)
    try {
        if (token !== latestRenderToken) {
            return
        }
        textureContext.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight)
    } finally {
        if (typeof imageBitmap.close === 'function') {
            imageBitmap.close()
        }
    }
}

/**
 * Draws all stroke geometry with seam wrapping.
 * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>} strokes
 * @param {string[]} palette
 * @param {number} lineWidth
 * @param {boolean} fillPatterns
 */
function drawStrokes(strokes, palette, lineWidth, fillPatterns) {
    if (!textureCanvas || !textureContext) {
        throw new Error('render-not-initialized')
    }
    const width = Number(textureCanvas.width) || 1
    const height = Number(textureCanvas.height) || 1
    textureContext.lineCap = 'round'
    textureContext.lineJoin = 'round'
    textureContext.lineWidth = Math.max(1, lineWidth * 2.4)

    const groupedFills = new Map()
    strokes.forEach((stroke) => {
        if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
        if (!fillPatterns || typeof stroke.fillGroupId !== 'number') return
        const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
        const fillAlpha = Number.isFinite(stroke.fillAlpha) ? Math.max(0, Math.min(1, Number(stroke.fillAlpha))) : 0.16
        const fillRule = stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
        const key = `${stroke.fillGroupId}|${fillAlpha}|${fillRule}|${color}`
        const list = groupedFills.get(key) || []
        list.push(stroke)
        groupedFills.set(key, list)
    })

    groupedFills.forEach((groupStrokes, key) => {
        const parts = key.split('|')
        const fillAlpha = Number(parts[1])
        const fillRule = parts[2] === 'evenodd' ? 'evenodd' : 'nonzero'
        const color = String(parts[3] || '#8b1f1a')
        textureContext.beginPath()
        groupStrokes.forEach((stroke) => {
            const unwrapped = UvStrokeUnwrapUtils.unwrapStroke(stroke.points)
            for (let shift = -1; shift <= 1; shift += 1) {
                unwrapped.forEach((point, index) => {
                    const x = (point.u + shift) * width
                    const y = point.v * height
                    if (index === 0) {
                        textureContext.moveTo(x, y)
                        return
                    }
                    textureContext.lineTo(x, y)
                })
                textureContext.closePath()
            }
        })
        textureContext.save()
        textureContext.globalAlpha = Number.isFinite(fillAlpha) ? fillAlpha : 0.16
        textureContext.fillStyle = color
        textureContext.fill(fillRule)
        textureContext.restore()
    })

    strokes.forEach((stroke) => {
        if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
        const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
        textureContext.strokeStyle = color
        const unwrapped = UvStrokeUnwrapUtils.unwrapStroke(stroke.points)

        for (let shift = -1; shift <= 1; shift += 1) {
            textureContext.beginPath()
            unwrapped.forEach((point, index) => {
                const x = (point.u + shift) * width
                const y = point.v * height
                if (index === 0) {
                    textureContext.moveTo(x, y)
                    return
                }
                textureContext.lineTo(x, y)
            })
            if (stroke.closed) {
                textureContext.closePath()
                if (fillPatterns && typeof stroke.fillGroupId !== 'number') {
                    const fillAlpha = Number.isFinite(stroke.fillAlpha)
                        ? Math.max(0, Math.min(1, Number(stroke.fillAlpha)))
                        : 0.16
                    const fillRule = stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
                    textureContext.save()
                    textureContext.globalAlpha = fillAlpha
                    textureContext.fillStyle = color
                    textureContext.fill(fillRule)
                    textureContext.restore()
                }
            }
            textureContext.stroke()
        }
    })
}

/**
 * Executes one worker operation.
 * @param {string} op
 * @param {Record<string, any>} payload
 * @returns {Promise<Record<string, any>>}
 */
async function executeOperation(op, payload) {
    if (op === 'init') {
        return initRenderer(payload)
    }
    if (op === 'render') {
        return renderFrame(payload)
    }
    throw new Error('unsupported-operation')
}

self.addEventListener('message', (event) => {
    const message = event.data && typeof event.data === 'object' ? event.data : null
    const requestId = Number(message?.requestId)
    if (!Number.isFinite(requestId)) return
    const op = String(message?.op || '')
    const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {}

    operationQueue = operationQueue
        .catch(() => {})
        .then(async () => {
            try {
                const result = await executeOperation(op, payload)
                self.postMessage({
                    requestId,
                    ok: true,
                    result
                })
            } catch (error) {
                postError(requestId, error)
            }
        })
})
