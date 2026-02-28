/**
 * Draws a lightweight live-trace overlay for the active EggBot run.
 */
export class DrawTraceOverlayRenderer {
    /**
     * Draws completed and active trace strokes onto one transparent overlay canvas.
     * @param {HTMLCanvasElement} canvas
     * @param {{ strokes?: Array<{ points?: Array<{u:number,v:number}> }>, completedStrokeCount?: number, activeStrokeIndex?: number, lineWidth?: number, completedColor?: string, activeColor?: string }} [input]
     * @returns {void}
     */
    static render(canvas, input = {}) {
        const ctx = canvas?.getContext?.('2d')
        if (!ctx) return

        const width = Math.max(1, Math.round(Number(canvas.width) || 1))
        const height = Math.max(1, Math.round(Number(canvas.height) || 1))
        const strokes = Array.isArray(input.strokes) ? input.strokes : []
        const completedStrokeCount = Math.max(0, Math.trunc(Number(input.completedStrokeCount) || 0))
        const activeStrokeIndex = DrawTraceOverlayRenderer.#resolveActiveStrokeIndex(input.activeStrokeIndex, strokes.length)
        const completedColor = String(input.completedColor || 'rgba(57, 201, 126, 0.85)')
        const activeColor = String(input.activeColor || '#ff4d3a')
        const baseLineWidth = Math.max(1, Number(input.lineWidth) || 1.8)
        const completedLineWidth = Math.max(1, baseLineWidth * 2.2)
        const activeLineWidth = Math.max(completedLineWidth + 1, baseLineWidth * 3)

        ctx.clearRect(0, 0, width, height)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
            const stroke = strokes[strokeIndex]
            const points = Array.isArray(stroke?.points) ? stroke.points : []
            if (points.length < 2) continue

            if (strokeIndex < completedStrokeCount) {
                DrawTraceOverlayRenderer.#drawStroke(ctx, points, width, height, completedColor, completedLineWidth)
                continue
            }

            if (strokeIndex === activeStrokeIndex) {
                DrawTraceOverlayRenderer.#drawStroke(ctx, points, width, height, activeColor, activeLineWidth)
                DrawTraceOverlayRenderer.#drawActiveTip(ctx, points, width, height, activeColor, activeLineWidth)
            }
        }
    }

    /**
     * Resolves one valid active stroke index or -1 when inactive.
     * @param {unknown} value
     * @param {number} strokeCount
     * @returns {number}
     */
    static #resolveActiveStrokeIndex(value, strokeCount) {
        const normalized = Math.trunc(Number(value))
        if (!Number.isFinite(normalized)) return -1
        if (normalized < 0 || normalized >= Math.max(0, strokeCount)) return -1
        return normalized
    }

    /**
     * Draws one seam-wrapped stroke.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Array<{u:number,v:number}>} points
     * @param {number} width
     * @param {number} height
     * @param {string} color
     * @param {number} lineWidth
     * @returns {void}
     */
    static #drawStroke(ctx, points, width, height, color, lineWidth) {
        const unwrapped = DrawTraceOverlayRenderer.#unwrapStroke(points)
        if (unwrapped.length < 2) return

        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth

        for (let shift = -1; shift <= 1; shift += 1) {
            ctx.beginPath()
            unwrapped.forEach((point, index) => {
                const x = (point.u + shift) * width
                const y = point.v * height
                if (index === 0) {
                    ctx.moveTo(x, y)
                    return
                }
                ctx.lineTo(x, y)
            })
            ctx.stroke()
        }
    }

    /**
     * Draws one active-tip marker for the current stroke endpoint.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Array<{u:number,v:number}>} points
     * @param {number} width
     * @param {number} height
     * @param {string} color
     * @param {number} lineWidth
     * @returns {void}
     */
    static #drawActiveTip(ctx, points, width, height, color, lineWidth) {
        const unwrapped = DrawTraceOverlayRenderer.#unwrapStroke(points)
        if (!unwrapped.length) return
        const tip = unwrapped[unwrapped.length - 1]
        const radius = Math.max(2, lineWidth * 0.65)

        ctx.fillStyle = color
        for (let shift = -1; shift <= 1; shift += 1) {
            ctx.beginPath()
            ctx.arc((tip.u + shift) * width, tip.v * height, radius, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    /**
     * Converts wrapped U coordinates into a continuous stroke path.
     * @param {Array<{u:number,v:number}>} points
     * @returns {Array<{u:number,v:number}>}
     */
    static #unwrapStroke(points) {
        if (!Array.isArray(points) || !points.length) return []
        const result = [
            {
                u: Number(points[0].u) || 0,
                v: Number(points[0].v) || 0
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const previous = result[index - 1]
            const point = points[index] || { u: 0, v: 0 }
            const baseU = Number(point.u) || 0
            const options = [baseU - 1, baseU, baseU + 1]
            let selectedU = options[0]
            let selectedDistance = Math.abs(options[0] - previous.u)

            for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                const candidateU = options[optionIndex]
                const distance = Math.abs(candidateU - previous.u)
                if (distance < selectedDistance) {
                    selectedDistance = distance
                    selectedU = candidateU
                }
            }

            result.push({
                u: selectedU,
                v: Number(point.v) || 0
            })
        }

        return result
    }
}
