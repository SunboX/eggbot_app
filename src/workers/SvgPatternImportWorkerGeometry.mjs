/**
 * Worker-side geometry sampling helpers for SVG import.
 */
export class SvgPatternImportWorkerGeometry {
    /**
     * Resolves a composed element transform matrix from root SVG to element.
     * @param {Element} element
     * @param {Element} svg
     * @returns {{ a: number, b: number, c: number, d: number, e: number, f: number }}
     */
    static resolveElementMatrix(element, svg) {
        const chain = []
        let cursor = element
        while (SvgPatternImportWorkerGeometry.isElementNode(cursor)) {
            chain.unshift(cursor)
            if (cursor === svg) break
            cursor = cursor.parentElement
        }

        let matrix = SvgPatternImportWorkerGeometry.identityMatrix()
        chain.forEach((node) => {
            const transform = SvgPatternImportWorkerGeometry.parseTransform(String(node.getAttribute('transform') || ''))
            matrix = SvgPatternImportWorkerGeometry.multiplyMatrices(matrix, transform)
        })

        return matrix
    }

    /**
     * Parses an SVG transform list.
     * @param {string} transformText
     * @returns {{ a: number, b: number, c: number, d: number, e: number, f: number }}
     */
    static parseTransform(transformText) {
        const raw = String(transformText || '').trim()
        if (!raw) {
            return SvgPatternImportWorkerGeometry.identityMatrix()
        }

        let result = SvgPatternImportWorkerGeometry.identityMatrix()
        const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g
        let match = regex.exec(raw)
        while (match) {
            const op = String(match[1] || '').trim().toLowerCase()
            const values = SvgPatternImportWorkerGeometry.parseNumberList(String(match[2] || ''))
            let matrix = SvgPatternImportWorkerGeometry.identityMatrix()

            if (op === 'matrix' && values.length >= 6) {
                matrix = {
                    a: values[0],
                    b: values[1],
                    c: values[2],
                    d: values[3],
                    e: values[4],
                    f: values[5]
                }
            } else if (op === 'translate') {
                const tx = values[0] || 0
                const ty = values.length >= 2 ? values[1] : 0
                matrix = { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
            } else if (op === 'scale') {
                const sx = values.length >= 1 ? values[0] : 1
                const sy = values.length >= 2 ? values[1] : sx
                matrix = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
            } else if (op === 'rotate') {
                const angle = ((values[0] || 0) * Math.PI) / 180
                const cos = Math.cos(angle)
                const sin = Math.sin(angle)
                const rotation = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
                if (values.length >= 3) {
                    const cx = values[1]
                    const cy = values[2]
                    const pre = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }
                    const post = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }
                    matrix = SvgPatternImportWorkerGeometry.multiplyMatrices(
                        SvgPatternImportWorkerGeometry.multiplyMatrices(pre, rotation),
                        post
                    )
                } else {
                    matrix = rotation
                }
            } else if (op === 'skewx') {
                const angle = ((values[0] || 0) * Math.PI) / 180
                matrix = { a: 1, b: 0, c: Math.tan(angle), d: 1, e: 0, f: 0 }
            } else if (op === 'skewy') {
                const angle = ((values[0] || 0) * Math.PI) / 180
                matrix = { a: 1, b: Math.tan(angle), c: 0, d: 1, e: 0, f: 0 }
            }

            result = SvgPatternImportWorkerGeometry.multiplyMatrices(result, matrix)
            match = regex.exec(raw)
        }

        return result
    }

    /**
     * Samples one geometry into UV segments.
     * @param {Element} element
     * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} matrix
     * @param {{ minX: number, minY: number, width: number, height: number }} viewBox
     * @param {number} sampleSpacing
     * @param {number} heightRatio
     * @returns {Array<{ points: Array<{u:number,v:number}>, closed: boolean }>}
     */
    static sampleGeometrySegments(element, matrix, viewBox, sampleSpacing, heightRatio) {
        const tag = String(element.tagName || '')
            .trim()
            .toLowerCase()

        /** @type {Array<{ points: Array<{x:number,y:number}>, closed: boolean }>} */
        let sampled = []

        if (tag === 'path') {
            sampled = SvgPatternImportWorkerGeometry.samplePathSegments(
                String(element.getAttribute('d') || ''),
                sampleSpacing
            )
        } else if (tag === 'line') {
            const x1 = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('x1'))
            const y1 = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('y1'))
            const x2 = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('x2'))
            const y2 = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('y2'))
            sampled = [
                {
                    points: SvgPatternImportWorkerGeometry.sampleLine(
                        { x: x1, y: y1 },
                        { x: x2, y: y2 },
                        sampleSpacing
                    ),
                    closed: false
                }
            ]
        } else if (tag === 'polyline' || tag === 'polygon') {
            const points = SvgPatternImportWorkerGeometry.parsePointList(String(element.getAttribute('points') || ''))
            if (points.length >= 2) {
                const polylinePoints = SvgPatternImportWorkerGeometry.samplePointSequence(
                    points,
                    sampleSpacing,
                    tag === 'polygon'
                )
                sampled = [
                    {
                        points: polylinePoints,
                        closed: tag === 'polygon'
                    }
                ]
            }
        } else if (tag === 'rect') {
            const x = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('x'))
            const y = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('y'))
            const width = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('width'))
            const height = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('height'))
            if (width > 0 && height > 0) {
                const corners = [
                    { x, y },
                    { x: x + width, y },
                    { x: x + width, y: y + height },
                    { x, y: y + height }
                ]
                sampled = [
                    {
                        points: SvgPatternImportWorkerGeometry.samplePointSequence(corners, sampleSpacing, true),
                        closed: true
                    }
                ]
            }
        } else if (tag === 'circle') {
            const cx = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('cx'))
            const cy = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('cy'))
            const r = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('r'))
            if (r > 0) {
                sampled = [
                    {
                        points: SvgPatternImportWorkerGeometry.sampleEllipse(cx, cy, r, r, sampleSpacing),
                        closed: true
                    }
                ]
            }
        } else if (tag === 'ellipse') {
            const cx = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('cx'))
            const cy = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('cy'))
            const rx = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('rx'))
            const ry = SvgPatternImportWorkerGeometry.parseSvgLength(element.getAttribute('ry'))
            if (rx > 0 && ry > 0) {
                sampled = [
                    {
                        points: SvgPatternImportWorkerGeometry.sampleEllipse(cx, cy, rx, ry, sampleSpacing),
                        closed: true
                    }
                ]
            }
        }

        const out = []
        sampled.forEach((segment) => {
            if (!Array.isArray(segment.points) || segment.points.length < 2) return
            const uvPoints = []
            const verticalOffset = (1 - heightRatio) / 2
            segment.points.forEach((point) => {
                const transformed = SvgPatternImportWorkerGeometry.transformPoint(point, matrix)
                const u = SvgPatternImportWorkerGeometry.wrap01((transformed.x - viewBox.minX) / viewBox.width)
                const localV = (transformed.y - viewBox.minY) / viewBox.height
                const v = SvgPatternImportWorkerGeometry.clamp(verticalOffset + localV * heightRatio, 0, 1)
                const last = uvPoints[uvPoints.length - 1]
                if (last && Math.abs(last.u - u) < 1e-5 && Math.abs(last.v - v) < 1e-5) {
                    return
                }
                uvPoints.push({ u, v })
            })

            if (uvPoints.length < 2) return
            out.push({
                points: uvPoints,
                closed: Boolean(segment.closed)
            })
        })

        return out
    }

    /**
     * Samples all path subsegments.
     * @param {string} pathData
     * @param {number} sampleSpacing
     * @returns {Array<{ points: Array<{x:number,y:number}>, closed: boolean }>}
     */
    static samplePathSegments(pathData, sampleSpacing) {
        const tokens = SvgPatternImportWorkerGeometry.tokenizePathCommands(pathData)
        if (!tokens.length) return []

        const segments = []
        let currentSegment = []
        let currentX = 0
        let currentY = 0
        let startX = 0
        let startY = 0
        let prevCubicControl = null
        let prevQuadraticControl = null
        let previousCommand = ''

        const ensureSegmentStart = (x, y) => {
            if (!currentSegment.length) {
                currentSegment.push({ x, y })
            }
        }

        const pushSegment = (closed) => {
            if (currentSegment.length >= 2) {
                segments.push({ points: currentSegment, closed })
            }
            currentSegment = []
        }

        const appendLineTo = (x, y) => {
            ensureSegmentStart(currentX, currentY)
            const sampled = SvgPatternImportWorkerGeometry.sampleLine(
                { x: currentX, y: currentY },
                { x, y },
                sampleSpacing
            )
            sampled.slice(1).forEach((point) => currentSegment.push(point))
            currentX = x
            currentY = y
        }

        tokens.forEach((token) => {
            const command = token.command
            const lower = command.toLowerCase()
            const relative = command === lower
            const values = token.values

            if (lower === 'm') {
                for (let index = 0; index + 1 < values.length; index += 2) {
                    const nextX = relative ? currentX + values[index] : values[index]
                    const nextY = relative ? currentY + values[index + 1] : values[index + 1]
                    if (index === 0) {
                        pushSegment(false)
                        currentSegment = [{ x: nextX, y: nextY }]
                        startX = nextX
                        startY = nextY
                    } else {
                        appendLineTo(nextX, nextY)
                    }
                    currentX = nextX
                    currentY = nextY
                }
                prevCubicControl = null
                prevQuadraticControl = null
                previousCommand = 'm'
                return
            }

            if (lower === 'z') {
                appendLineTo(startX, startY)
                pushSegment(true)
                currentX = startX
                currentY = startY
                prevCubicControl = null
                prevQuadraticControl = null
                previousCommand = 'z'
                return
            }

            if (lower === 'l') {
                for (let index = 0; index + 1 < values.length; index += 2) {
                    const nextX = relative ? currentX + values[index] : values[index]
                    const nextY = relative ? currentY + values[index + 1] : values[index + 1]
                    appendLineTo(nextX, nextY)
                }
                prevCubicControl = null
                prevQuadraticControl = null
                previousCommand = 'l'
                return
            }

            if (lower === 'h') {
                values.forEach((value) => {
                    const nextX = relative ? currentX + value : value
                    appendLineTo(nextX, currentY)
                })
                prevCubicControl = null
                prevQuadraticControl = null
                previousCommand = 'h'
                return
            }

            if (lower === 'v') {
                values.forEach((value) => {
                    const nextY = relative ? currentY + value : value
                    appendLineTo(currentX, nextY)
                })
                prevCubicControl = null
                prevQuadraticControl = null
                previousCommand = 'v'
                return
            }

            if (lower === 'c') {
                for (let index = 0; index + 5 < values.length; index += 6) {
                    const x1 = relative ? currentX + values[index] : values[index]
                    const y1 = relative ? currentY + values[index + 1] : values[index + 1]
                    const x2 = relative ? currentX + values[index + 2] : values[index + 2]
                    const y2 = relative ? currentY + values[index + 3] : values[index + 3]
                    const x = relative ? currentX + values[index + 4] : values[index + 4]
                    const y = relative ? currentY + values[index + 5] : values[index + 5]

                    ensureSegmentStart(currentX, currentY)
                    const curve = SvgPatternImportWorkerGeometry.sampleCubicBezier(
                        { x: currentX, y: currentY },
                        { x: x1, y: y1 },
                        { x: x2, y: y2 },
                        { x, y },
                        sampleSpacing
                    )
                    curve.slice(1).forEach((point) => currentSegment.push(point))

                    currentX = x
                    currentY = y
                    prevCubicControl = { x: x2, y: y2 }
                    prevQuadraticControl = null
                }
                previousCommand = 'c'
                return
            }

            if (lower === 's') {
                for (let index = 0; index + 3 < values.length; index += 4) {
                    const reflected =
                        previousCommand === 'c' || previousCommand === 's'
                            ? {
                                  x: currentX + (currentX - (prevCubicControl?.x ?? currentX)),
                                  y: currentY + (currentY - (prevCubicControl?.y ?? currentY))
                              }
                            : { x: currentX, y: currentY }
                    const x2 = relative ? currentX + values[index] : values[index]
                    const y2 = relative ? currentY + values[index + 1] : values[index + 1]
                    const x = relative ? currentX + values[index + 2] : values[index + 2]
                    const y = relative ? currentY + values[index + 3] : values[index + 3]

                    ensureSegmentStart(currentX, currentY)
                    const curve = SvgPatternImportWorkerGeometry.sampleCubicBezier(
                        { x: currentX, y: currentY },
                        reflected,
                        { x: x2, y: y2 },
                        { x, y },
                        sampleSpacing
                    )
                    curve.slice(1).forEach((point) => currentSegment.push(point))

                    currentX = x
                    currentY = y
                    prevCubicControl = { x: x2, y: y2 }
                    prevQuadraticControl = null
                }
                previousCommand = 's'
                return
            }

            if (lower === 'q') {
                for (let index = 0; index + 3 < values.length; index += 4) {
                    const x1 = relative ? currentX + values[index] : values[index]
                    const y1 = relative ? currentY + values[index + 1] : values[index + 1]
                    const x = relative ? currentX + values[index + 2] : values[index + 2]
                    const y = relative ? currentY + values[index + 3] : values[index + 3]

                    ensureSegmentStart(currentX, currentY)
                    const curve = SvgPatternImportWorkerGeometry.sampleQuadraticBezier(
                        { x: currentX, y: currentY },
                        { x: x1, y: y1 },
                        { x, y },
                        sampleSpacing
                    )
                    curve.slice(1).forEach((point) => currentSegment.push(point))

                    currentX = x
                    currentY = y
                    prevQuadraticControl = { x: x1, y: y1 }
                    prevCubicControl = null
                }
                previousCommand = 'q'
                return
            }

            if (lower === 't') {
                for (let index = 0; index + 1 < values.length; index += 2) {
                    const reflected =
                        previousCommand === 'q' || previousCommand === 't'
                            ? {
                                  x: currentX + (currentX - (prevQuadraticControl?.x ?? currentX)),
                                  y: currentY + (currentY - (prevQuadraticControl?.y ?? currentY))
                              }
                            : { x: currentX, y: currentY }
                    const x = relative ? currentX + values[index] : values[index]
                    const y = relative ? currentY + values[index + 1] : values[index + 1]

                    ensureSegmentStart(currentX, currentY)
                    const curve = SvgPatternImportWorkerGeometry.sampleQuadraticBezier(
                        { x: currentX, y: currentY },
                        reflected,
                        { x, y },
                        sampleSpacing
                    )
                    curve.slice(1).forEach((point) => currentSegment.push(point))

                    currentX = x
                    currentY = y
                    prevQuadraticControl = reflected
                    prevCubicControl = null
                }
                previousCommand = 't'
                return
            }

            if (lower === 'a') {
                for (let index = 0; index + 6 < values.length; index += 7) {
                    const rx = Math.abs(values[index])
                    const ry = Math.abs(values[index + 1])
                    const xAxisRotation = values[index + 2]
                    const largeArcFlag = Number(values[index + 3]) ? 1 : 0
                    const sweepFlag = Number(values[index + 4]) ? 1 : 0
                    const x = relative ? currentX + values[index + 5] : values[index + 5]
                    const y = relative ? currentY + values[index + 6] : values[index + 6]

                    ensureSegmentStart(currentX, currentY)
                    const arc = SvgPatternImportWorkerGeometry.sampleArc(
                        { x: currentX, y: currentY },
                        {
                            rx,
                            ry,
                            xAxisRotation,
                            largeArcFlag,
                            sweepFlag,
                            x,
                            y
                        },
                        sampleSpacing
                    )
                    arc.slice(1).forEach((point) => currentSegment.push(point))

                    currentX = x
                    currentY = y
                    prevCubicControl = null
                    prevQuadraticControl = null
                }
                previousCommand = 'a'
                return
            }

            prevCubicControl = null
            prevQuadraticControl = null
            previousCommand = lower
        })

        pushSegment(false)
        return segments.filter((segment) => segment.points.length >= 2)
    }

    /**
     * Samples points along a line segment.
     * @param {{x:number,y:number}} start
     * @param {{x:number,y:number}} end
     * @param {number} sampleSpacing
     * @returns {Array<{x:number,y:number}>}
     */
    static sampleLine(start, end, sampleSpacing) {
        const length = Math.hypot(end.x - start.x, end.y - start.y)
        const count = Math.max(1, Math.ceil(length / Math.max(0.1, sampleSpacing)))
        const points = []
        for (let index = 0; index <= count; index += 1) {
            const t = index / count
            points.push({
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t
            })
        }
        return points
    }

    /**
     * Samples points along a cubic bezier segment.
     * @param {{x:number,y:number}} p0
     * @param {{x:number,y:number}} p1
     * @param {{x:number,y:number}} p2
     * @param {{x:number,y:number}} p3
     * @param {number} sampleSpacing
     * @returns {Array<{x:number,y:number}>}
     */
    static sampleCubicBezier(p0, p1, p2, p3, sampleSpacing) {
        const estimate =
            Math.hypot(p1.x - p0.x, p1.y - p0.y) +
            Math.hypot(p2.x - p1.x, p2.y - p1.y) +
            Math.hypot(p3.x - p2.x, p3.y - p2.y)
        const count = Math.max(2, Math.min(3000, Math.ceil(estimate / Math.max(0.1, sampleSpacing))))
        const out = []

        for (let index = 0; index <= count; index += 1) {
            const t = index / count
            const mt = 1 - t
            out.push({
                x:
                    mt * mt * mt * p0.x +
                    3 * mt * mt * t * p1.x +
                    3 * mt * t * t * p2.x +
                    t * t * t * p3.x,
                y:
                    mt * mt * mt * p0.y +
                    3 * mt * mt * t * p1.y +
                    3 * mt * t * t * p2.y +
                    t * t * t * p3.y
            })
        }

        return out
    }

    /**
     * Samples points along a quadratic bezier segment.
     * @param {{x:number,y:number}} p0
     * @param {{x:number,y:number}} p1
     * @param {{x:number,y:number}} p2
     * @param {number} sampleSpacing
     * @returns {Array<{x:number,y:number}>}
     */
    static sampleQuadraticBezier(p0, p1, p2, sampleSpacing) {
        const estimate = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y)
        const count = Math.max(2, Math.min(3000, Math.ceil(estimate / Math.max(0.1, sampleSpacing))))
        const out = []

        for (let index = 0; index <= count; index += 1) {
            const t = index / count
            const mt = 1 - t
            out.push({
                x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
                y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
            })
        }

        return out
    }

    /**
     * Samples points along an SVG arc command.
     * @param {{x:number,y:number}} start
     * @param {{ rx: number, ry: number, xAxisRotation: number, largeArcFlag: number, sweepFlag: number, x: number, y: number }} command
     * @param {number} sampleSpacing
     * @returns {Array<{x:number,y:number}>}
     */
    static sampleArc(start, command, sampleSpacing) {
        const end = { x: command.x, y: command.y }
        if (command.rx <= 0 || command.ry <= 0) {
            return SvgPatternImportWorkerGeometry.sampleLine(start, end, sampleSpacing)
        }

        const phi = (command.xAxisRotation * Math.PI) / 180
        const cosPhi = Math.cos(phi)
        const sinPhi = Math.sin(phi)

        const dx = (start.x - end.x) / 2
        const dy = (start.y - end.y) / 2
        const x1p = cosPhi * dx + sinPhi * dy
        const y1p = -sinPhi * dx + cosPhi * dy

        let rx = Math.abs(command.rx)
        let ry = Math.abs(command.ry)

        const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if (lambda > 1) {
            const scale = Math.sqrt(lambda)
            rx *= scale
            ry *= scale
        }

        const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p

        const base = denominator === 0 ? 0 : Math.max(0, numerator / denominator)
        const factor = (command.largeArcFlag === command.sweepFlag ? -1 : 1) * Math.sqrt(base)

        const cxp = factor * ((rx * y1p) / ry)
        const cyp = factor * ((-ry * x1p) / rx)

        const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2
        const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2

        const vectorAngle = (ux, uy, vx, vy) => {
            const dot = ux * vx + uy * vy
            const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
            if (!len) return 0
            const clamped = SvgPatternImportWorkerGeometry.clamp(dot / len, -1, 1)
            const sign = ux * vy - uy * vx < 0 ? -1 : 1
            return sign * Math.acos(clamped)
        }

        const startVectorX = (x1p - cxp) / rx
        const startVectorY = (y1p - cyp) / ry
        const endVectorX = (-x1p - cxp) / rx
        const endVectorY = (-y1p - cyp) / ry

        const theta1 = vectorAngle(1, 0, startVectorX, startVectorY)
        let deltaTheta = vectorAngle(startVectorX, startVectorY, endVectorX, endVectorY)

        if (!command.sweepFlag && deltaTheta > 0) {
            deltaTheta -= Math.PI * 2
        }
        if (command.sweepFlag && deltaTheta < 0) {
            deltaTheta += Math.PI * 2
        }

        const averageRadius = (Math.abs(rx) + Math.abs(ry)) / 2
        const estimate = Math.abs(deltaTheta) * averageRadius
        const count = Math.max(4, Math.min(6000, Math.ceil(estimate / Math.max(0.1, sampleSpacing))))

        const out = []
        for (let index = 0; index <= count; index += 1) {
            const t = index / count
            const angle = theta1 + deltaTheta * t
            const cosAngle = Math.cos(angle)
            const sinAngle = Math.sin(angle)
            out.push({
                x: cx + rx * cosPhi * cosAngle - ry * sinPhi * sinAngle,
                y: cy + rx * sinPhi * cosAngle + ry * cosPhi * sinAngle
            })
        }

        return out
    }

    /**
     * Samples a polyline or polygon sequence.
     * @param {Array<{x:number,y:number}>} points
     * @param {number} sampleSpacing
     * @param {boolean} closed
     * @returns {Array<{x:number,y:number}>}
     */
    static samplePointSequence(points, sampleSpacing, closed) {
        if (points.length < 2) return []
        const out = [points[0]]
        for (let index = 1; index < points.length; index += 1) {
            const piece = SvgPatternImportWorkerGeometry.sampleLine(points[index - 1], points[index], sampleSpacing)
            piece.slice(1).forEach((point) => out.push(point))
        }
        if (closed) {
            const piece = SvgPatternImportWorkerGeometry.sampleLine(points[points.length - 1], points[0], sampleSpacing)
            piece.slice(1).forEach((point) => out.push(point))
        }
        return out
    }

    /**
     * Samples an ellipse perimeter.
     * @param {number} cx
     * @param {number} cy
     * @param {number} rx
     * @param {number} ry
     * @param {number} sampleSpacing
     * @returns {Array<{x:number,y:number}>}
     */
    static sampleEllipse(cx, cy, rx, ry, sampleSpacing) {
        const circumference = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2)
        const count = Math.max(24, Math.min(4000, Math.ceil(circumference / Math.max(0.1, sampleSpacing))))
        const out = []
        for (let index = 0; index <= count; index += 1) {
            const angle = (index / count) * Math.PI * 2
            out.push({
                x: cx + Math.cos(angle) * rx,
                y: cy + Math.sin(angle) * ry
            })
        }
        return out
    }

    /**
     * Parses coordinate pairs from SVG point list text.
     * @param {string} raw
     * @returns {Array<{x:number,y:number}>}
     */
    static parsePointList(raw) {
        const values = SvgPatternImportWorkerGeometry.parseNumberList(raw)
        const out = []
        for (let index = 0; index + 1 < values.length; index += 2) {
            out.push({ x: values[index], y: values[index + 1] })
        }
        return out
    }

    /**
     * Tokenizes path command chunks.
     * @param {string} pathData
     * @returns {Array<{ command: string, values: number[] }>}
     */
    static tokenizePathCommands(pathData) {
        const chunks = String(pathData || '').match(/[MmZzLlHhVvCcSsQqTtAa][^MmZzLlHhVvCcSsQqTtAa]*/g) || []
        return chunks
            .map((chunk) => String(chunk || '').trim())
            .filter(Boolean)
            .map((chunk) => ({
                command: chunk[0],
                values: SvgPatternImportWorkerGeometry.parseNumberList(chunk.slice(1))
            }))
    }

    /**
     * Creates a CSS color normalizer.
     * @returns {(value: string) => string}
     */
    static createColorNormalizer() {
        if (typeof OffscreenCanvas === 'function') {
            const canvas = new OffscreenCanvas(1, 1)
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx) {
                return (value) => {
                    const raw = String(value || '')
                        .trim()
                        .toLowerCase()
                    if (!raw || raw === 'none' || raw === 'transparent') return ''

                    ctx.clearRect(0, 0, 1, 1)
                    try {
                        ctx.fillStyle = raw
                    } catch (_error) {
                        return ''
                    }
                    ctx.fillRect(0, 0, 1, 1)

                    const pixel = ctx.getImageData(0, 0, 1, 1).data
                    if (!pixel || pixel[3] === 0) return ''
                    const toHex = (channel) => channel.toString(16).padStart(2, '0')
                    return `#${toHex(pixel[0])}${toHex(pixel[1])}${toHex(pixel[2])}`
                }
            }
        }

        return (value) => {
            const raw = String(value || '')
                .trim()
                .toLowerCase()
            if (!raw || raw === 'none' || raw === 'transparent') return ''
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
                if (raw.length === 4) {
                    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
                }
                return raw
            }
            const rgb = raw.match(/^rgba?\(([^)]+)\)$/)
            if (!rgb) return ''
            const values = rgb[1]
                .split(',')
                .map((entry) => Number.parseFloat(entry.trim()))
                .filter((entry) => Number.isFinite(entry))
            if (values.length < 3) return ''
            const toByte = (channel) => Math.max(0, Math.min(255, Math.round(channel)))
            const toHex = (channel) => channel.toString(16).padStart(2, '0')
            return `#${toHex(toByte(values[0]))}${toHex(toByte(values[1]))}${toHex(toByte(values[2]))}`
        }
    }

    /**
     * Resolves optional base color from root SVG styles.
     * @param {Element} svg
     * @param {Array<{ selector: string, declarations: Record<string, string> }>} cssRules
     * @param {(value: string) => string} normalizeColor
     * @returns {string}
     */
    static resolveBaseColor(svg, cssRules, normalizeColor) {
        const declarations = SvgPatternImportWorkerGeometry.resolveDeclarationsForNode(svg, cssRules)
        const background = normalizeColor(String(declarations['background-color'] || declarations.background || ''))
        if (background) return background

        const rootFill = normalizeColor(String(declarations.fill || ''))
        if (rootFill) return rootFill

        const pageColor = normalizeColor(SvgPatternImportWorkerGeometry.readAttributeByLocalName(svg, 'pagecolor'))
        if (pageColor) return pageColor

        return ''
    }

    /**
     * Parses numeric SVG length.
     * @param {string | null | undefined} value
     * @returns {number}
     */
    static parseSvgLength(value) {
        return SvgPatternImportWorkerGeometry.toNumber(value, 0)
    }

    /**
     * Converts arbitrary numeric strings into finite numbers.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static toNumber(value, fallback) {
        const parsed = Number.parseFloat(String(value ?? '').replace(/[^\d.+\-eE]/g, ''))
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Parses a number list.
     * @param {string} raw
     * @returns {number[]}
     */
    static parseNumberList(raw) {
        const matches = String(raw || '').match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) || []
        return matches.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value))
    }

    /**
     * Resolves SVG viewBox dimensions.
     * @param {Element} svg
     * @returns {{ minX: number, minY: number, width: number, height: number }}
     */
    static resolveViewBox(svg) {
        const values = SvgPatternImportWorkerGeometry.parseNumberList(String(svg.getAttribute('viewBox') || ''))
        if (values.length === 4 && values[2] > 0 && values[3] > 0) {
            return {
                minX: values[0],
                minY: values[1],
                width: values[2],
                height: values[3]
            }
        }

        const width = SvgPatternImportWorkerGeometry.parseSvgLength(svg.getAttribute('width')) || 3200
        const height = SvgPatternImportWorkerGeometry.parseSvgLength(svg.getAttribute('height')) || 800
        return {
            minX: 0,
            minY: 0,
            width: Math.max(1, width),
            height: Math.max(1, height)
        }
    }

    /**
     * Checks whether a style block should be rendered.
     * @param {{ display: string, visibility: string, opacity: number }} style
     * @returns {boolean}
     */
    static isVisible(style) {
        if (style.display === 'none') return false
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
        if (style.opacity <= 0) return false
        return true
    }

    /**
     * Reads namespaced attributes by local-name.
     * @param {Element} element
     * @param {string} localName
     * @returns {string}
     */
    static readAttributeByLocalName(element, localName) {
        const match = Array.from(element.attributes || []).find((attribute) => attribute?.localName === localName)
        return String(match?.value || '')
    }

    /**
     * Returns identity matrix.
     * @returns {{ a: number, b: number, c: number, d: number, e: number, f: number }}
     */
    static identityMatrix() {
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    }

    /**
     * Multiplies 2D affine matrices.
     * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} left
     * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} right
     * @returns {{ a: number, b: number, c: number, d: number, e: number, f: number }}
     */
    static multiplyMatrices(left, right) {
        return {
            a: left.a * right.a + left.c * right.b,
            b: left.b * right.a + left.d * right.b,
            c: left.a * right.c + left.c * right.d,
            d: left.b * right.c + left.d * right.d,
            e: left.a * right.e + left.c * right.f + left.e,
            f: left.b * right.e + left.d * right.f + left.f
        }
    }

    /**
     * Applies matrix transform to a point.
     * @param {{ x: number, y: number }} point
     * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} matrix
     * @returns {{ x: number, y: number }}
     */
    static transformPoint(point, matrix) {
        return {
            x: matrix.a * point.x + matrix.c * point.y + matrix.e,
            y: matrix.b * point.x + matrix.d * point.y + matrix.f
        }
    }

    /**
     * Clamps number to [0, 1].
     * @param {number} value
     * @returns {number}
     */
    static clamp01(value) {
        return SvgPatternImportWorkerGeometry.clamp(value, 0, 1)
    }

    /**
     * Clamps a number.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value))
    }

    /**
     * Clamps an integer.
     * @param {unknown} value
     * @param {number} fallback
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static clampInt(value, fallback, min, max) {
        const parsed = Math.trunc(Number(value))
        if (!Number.isFinite(parsed)) return fallback
        return Math.max(min, Math.min(max, parsed))
    }

    /**
     * Wraps a number into [0, 1).
     * @param {number} value
     * @returns {number}
     */
    static wrap01(value) {
        if (!Number.isFinite(value)) return 0
        const wrapped = value % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }

    /**
     * Checks whether a value looks like an element node without relying on global constructors.
     * @param {unknown} value
     * @returns {value is Element}
     */
    static isElementNode(value) {
        return Boolean(value && typeof value === 'object' && value.nodeType === 1)
    }
}
