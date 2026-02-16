/**
 * Renders generated strokes into a 2D texture map for the 3D egg.
 */
export class PatternRenderer2D {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        if (!this.ctx) {
            throw new Error('Unable to create 2D rendering context')
        }
        this.importedSvgRenderToken = 0
    }

    /**
     * Renders a full texture frame.
     * @param {{ baseColor: string, lineWidth: number, palette: string[], strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean }>, showGuides?: boolean, importedSvgText?: string }} data
     */
    render(data) {
        const width = this.canvas.width
        const height = this.canvas.height
        const token = ++this.importedSvgRenderToken
        this.ctx.clearRect(0, 0, width, height)

        this.ctx.fillStyle = String(data.baseColor || '#efe7ce')
        this.ctx.fillRect(0, 0, width, height)

        if (data.showGuides !== false) {
            this.#drawGuides(width, height)
        }

        const importedSvgText = String(data.importedSvgText || '').trim()
        if (importedSvgText) {
            this.#drawImportedSvg(importedSvgText, token)
            return
        }
        this.#drawStrokes(data.strokes || [], data.palette || ['#8b1f1a'], Number(data.lineWidth) || 1.8)
    }

    /**
     * Draws an imported SVG directly so fill-rule/hole semantics stay exact.
     * @param {string} svgText
     * @param {number} token
     * @returns {void}
     */
    #drawImportedSvg(svgText, token) {
        const width = this.canvas.width
        const height = this.canvas.height
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const image = new Image()
        image.onload = () => {
            URL.revokeObjectURL(url)
            if (token !== this.importedSvgRenderToken) return
            this.ctx.drawImage(image, 0, 0, width, height)
        }
        image.onerror = () => {
            URL.revokeObjectURL(url)
        }
        image.src = url
    }

    /**
     * Draws subtle guide rings to communicate orientation.
     * @param {number} width
     * @param {number} height
     */
    #drawGuides(width, height) {
        this.ctx.save()
        this.ctx.globalAlpha = 0.15
        this.ctx.strokeStyle = '#6b4f1f'
        this.ctx.lineWidth = 1
        for (let lineIndex = 1; lineIndex <= 7; lineIndex += 1) {
            const y = (lineIndex / 8) * height
            this.ctx.beginPath()
            this.ctx.moveTo(0, y)
            this.ctx.lineTo(width, y)
            this.ctx.stroke()
        }
        for (let lineIndex = 0; lineIndex < 24; lineIndex += 1) {
            const x = (lineIndex / 24) * width
            this.ctx.beginPath()
            this.ctx.moveTo(x, 0)
            this.ctx.lineTo(x, height)
            this.ctx.stroke()
        }
        this.ctx.restore()
    }

    /**
     * Draws all strokes with seam wrapping.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>} strokes
     * @param {string[]} palette
     * @param {number} lineWidth
     */
    #drawStrokes(strokes, palette, lineWidth) {
        const width = this.canvas.width
        const height = this.canvas.height

        this.ctx.lineCap = 'round'
        this.ctx.lineJoin = 'round'
        this.ctx.lineWidth = Math.max(1, lineWidth * 2.4)

        const groupedFills = new Map()
        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke.points) || stroke.points.length < 2) return
            if (typeof stroke.fillGroupId !== 'number') return
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
            this.ctx.beginPath()
            groupStrokes.forEach((stroke) => {
                const unwrapped = PatternRenderer2D.#unwrapStroke(stroke.points)
                for (let shift = -1; shift <= 1; shift += 1) {
                    unwrapped.forEach((point, index) => {
                        const x = (point.u + shift) * width
                        const y = point.v * height
                        if (index === 0) {
                            this.ctx.moveTo(x, y)
                            return
                        }
                        this.ctx.lineTo(x, y)
                    })
                    this.ctx.closePath()
                }
            })
            this.ctx.save()
            this.ctx.globalAlpha = Number.isFinite(fillAlpha) ? fillAlpha : 0.16
            this.ctx.fillStyle = color
            this.ctx.fill(fillRule)
            this.ctx.restore()
        })

        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke.points) || stroke.points.length < 2) return
            const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
            this.ctx.strokeStyle = color
            const unwrapped = PatternRenderer2D.#unwrapStroke(stroke.points)

            for (let shift = -1; shift <= 1; shift += 1) {
                this.ctx.beginPath()
                unwrapped.forEach((point, index) => {
                    const x = (point.u + shift) * width
                    const y = point.v * height
                    if (index === 0) {
                        this.ctx.moveTo(x, y)
                        return
                    }
                    this.ctx.lineTo(x, y)
                })
                if (stroke.closed) {
                    this.ctx.closePath()
                    if (typeof stroke.fillGroupId !== 'number') {
                        const fillAlpha = Number.isFinite(stroke.fillAlpha)
                            ? Math.max(0, Math.min(1, Number(stroke.fillAlpha)))
                            : 0.16
                        const fillRule = stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
                        this.ctx.save()
                        this.ctx.globalAlpha = fillAlpha
                        this.ctx.fillStyle = color
                        this.ctx.fill(fillRule)
                        this.ctx.restore()
                    }
                }
                this.ctx.stroke()
            }
        })
    }

    /**
     * Converts wrapped U values into a continuous path.
     * @param {Array<{u:number,v:number}>} points
     * @returns {Array<{u:number,v:number}>}
     */
    static #unwrapStroke(points) {
        if (!points.length) return []
        const result = [
            {
                u: points[0].u,
                v: points[0].v
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const previous = result[index - 1]
            const current = points[index]
            const options = [current.u - 1, current.u, current.u + 1]
            let nextU = options[0]
            let bestDistance = Math.abs(options[0] - previous.u)
            for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                const candidate = options[optionIndex]
                const distance = Math.abs(candidate - previous.u)
                if (distance < bestDistance) {
                    bestDistance = distance
                    nextU = candidate
                }
            }
            result.push({
                u: nextU,
                v: current.v
            })
        }

        return result
    }
}
