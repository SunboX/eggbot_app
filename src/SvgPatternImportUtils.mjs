/**
 * Utilities for importing SVG-based EggBot patterns as UV strokes.
 */
export class SvgPatternImportUtils {
    /**
     * Parses SVG text into renderer strokes.
     * @param {string} svgText
     * @param {{ maxColors?: number, sampleSpacing?: number, debug?: boolean, sourceName?: string }} [options]
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string }}
     */
    static parse(svgText, options = {}) {
        const debug = options.debug !== false
        const sourceName = String(options.sourceName || 'svg-input')
        SvgPatternImportUtils.#logDebug(debug, 'Parsing started', {
            sourceName,
            inputLength: String(svgText || '').length
        })

        const parser = new DOMParser()
        const xml = parser.parseFromString(String(svgText || ''), 'image/svg+xml')
        if (xml.querySelector('parsererror')) {
            SvgPatternImportUtils.#logDebug(debug, 'Parser error detected', { sourceName })
            throw new Error('invalid-svg')
        }

        const rawSvg = xml.querySelector('svg')
        if (!rawSvg) {
            SvgPatternImportUtils.#logDebug(debug, 'No root <svg> found', { sourceName })
            throw new Error('invalid-svg')
        }

        rawSvg.querySelectorAll('script,foreignObject').forEach((node) => node.remove())
        SvgPatternImportUtils.#normalizeInkscapePaths(rawSvg, debug, sourceName)
        const viewBox = SvgPatternImportUtils.#resolveViewBox(rawSvg)

        const mount = document.createElement('div')
        mount.style.position = 'fixed'
        mount.style.left = '-10000px'
        mount.style.top = '-10000px'
        mount.style.pointerEvents = 'none'
        mount.style.overflow = 'hidden'
        mount.style.zIndex = '-1'
        document.body.appendChild(mount)
        mount.appendChild(document.importNode(rawSvg, true))

        try {
            const svg = mount.querySelector('svg')
            if (!svg) throw new Error('invalid-svg')

            const geometries = Array.from(svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse'))
            const colorToIndex = new Map()
            const palette = []
            const strokes = []
            const stats = {
                sourceName,
                geometries: geometries.length,
                visible: 0,
                withColor: 0,
                withSegments: 0,
                segments: 0,
                skippedInvisible: 0,
                skippedNoColor: 0,
                skippedNoSegments: 0,
                geometryErrors: 0
            }
            const maxColors = SvgPatternImportUtils.#clampInt(options.maxColors, 6, 1, 12)
            const sampleSpacing = Math.max(0.6, Number(options.sampleSpacing) || 3)
            const normalizeColor = SvgPatternImportUtils.#createColorNormalizer()
            const baseColor = SvgPatternImportUtils.#resolveBaseColor(svg, normalizeColor)

            geometries.forEach((element, geometryIndex) => {
                try {
                    const style = window.getComputedStyle(element)
                    if (!SvgPatternImportUtils.#isVisibleGeometry(element, style)) {
                        stats.skippedInvisible += 1
                        return
                    }

                    stats.visible += 1

                    const strokeWidth = Number.parseFloat(String(style.strokeWidth || '1'))
                    const strokeOpacity = Number.parseFloat(String(style.strokeOpacity || '1'))
                    const fillOpacity = Number.parseFloat(String(style.fillOpacity || '1'))

                    let color = ''
                    let usesFillColor = false
                    const fillRuleRaw = String(style.fillRule || '').toLowerCase()
                    const fillRule = fillRuleRaw === 'evenodd' ? 'evenodd' : 'nonzero'
                    const fillColor = normalizeColor(style.fill)
                    if (fillColor && fillOpacity > 0) {
                        color = fillColor
                        usesFillColor = true
                    } else {
                        const strokeColor = normalizeColor(style.stroke)
                        if (strokeColor && strokeWidth > 0 && strokeOpacity > 0) {
                            color = strokeColor
                        }
                    }
                    if (!color) {
                        stats.skippedNoColor += 1
                        return
                    }

                    stats.withColor += 1
                    let colorIndex = colorToIndex.get(color)
                    if (typeof colorIndex !== 'number') {
                        colorIndex = colorToIndex.size < maxColors ? colorToIndex.size : colorToIndex.size % maxColors
                        colorToIndex.set(color, colorIndex)
                        if (palette.length <= colorIndex) {
                            palette[colorIndex] = color
                        }
                    }

                    const segments = SvgPatternImportUtils.#sampleGeometrySegments(element, svg, viewBox, sampleSpacing, debug)
                    if (!segments.length) {
                        stats.skippedNoSegments += 1
                        return
                    }

                    stats.withSegments += 1
                    stats.segments += segments.length
                    const closedSegments = segments.filter((segment) => Boolean(segment.closed)).length
                    SvgPatternImportUtils.#logDebug(debug, 'Geometry sampled', {
                        sourceName,
                        geometryIndex,
                        tag: String(element?.tagName || '').toLowerCase(),
                        id: String(element.getAttribute('id') || ''),
                        usesFillColor,
                        fillRule: usesFillColor ? fillRule : '',
                        fillOpacity: usesFillColor ? SvgPatternImportUtils.#clamp(fillOpacity, 0, 1) : 0,
                        segments: segments.length,
                        closedSegments
                    })
                    segments.forEach((segment) => {
                        strokes.push({
                            colorIndex,
                            points: segment.points,
                            closed: Boolean(segment.closed),
                            fillGroupId: usesFillColor ? geometryIndex : null,
                            fillAlpha: usesFillColor ? SvgPatternImportUtils.#clamp(fillOpacity, 0, 1) : undefined,
                            fillRule: usesFillColor ? fillRule : undefined
                        })
                    })
                } catch (error) {
                    stats.geometryErrors += 1
                    SvgPatternImportUtils.#logWarn(debug, 'Geometry processing failed', {
                        sourceName,
                        geometryIndex,
                        tag: String(element?.tagName || '').toLowerCase(),
                        message: String(error?.message || error)
                    })
                }
            })

            SvgPatternImportUtils.#logDebug(debug, 'Parsing summary', {
                ...stats,
                strokes: strokes.length,
                palette: palette.filter(Boolean).length
            })

            if (!strokes.length) {
                throw new Error('no-drawable-geometry')
            }

            return {
                strokes,
                palette: palette.filter(Boolean),
                ...(baseColor ? { baseColor } : {})
            }
        } finally {
            mount.remove()
        }
    }

    /**
     * Returns true when an SVG geometry node is drawable.
     * @param {Element} element
     * @param {CSSStyleDeclaration} [computedStyle]
     * @returns {boolean}
     */
    static #isVisibleGeometry(element, computedStyle) {
        if (!element || !(element instanceof Element)) return false
        if (element.getAttribute('display') === 'none') return false
        if (element.getAttribute('visibility') === 'hidden') return false
        const style = element.getAttribute('style') || ''
        if (/\bdisplay\s*:\s*none\b/i.test(style)) return false
        if (/\bvisibility\s*:\s*hidden\b/i.test(style)) return false
        if (computedStyle) {
            const display = String(computedStyle.display || '').toLowerCase()
            const visibility = String(computedStyle.visibility || '').toLowerCase()
            const opacity = Number.parseFloat(String(computedStyle.opacity || '1'))
            if (display === 'none') return false
            if (visibility === 'hidden' || visibility === 'collapse') return false
            if (Number.isFinite(opacity) && opacity <= 0) return false
        }
        return true
    }

    /**
     * Samples one geometry element into UV stroke segments.
     * @param {Element} element
     * @param {SVGSVGElement} svg
     * @param {{ minX: number, minY: number, width: number, height: number }} viewBox
     * @param {number} sampleSpacing
     * @param {boolean} debug
     * @returns {Array<{ points: Array<{u:number,v:number}>, closed: boolean }>}
     */
    static #sampleGeometrySegments(element, svg, viewBox, sampleSpacing, debug) {
        if (typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') {
            return []
        }

        const tag = String(element?.tagName || '')
            .trim()
            .toLowerCase()
        const closeThreshold = 0.012
        if (tag === 'path') {
            const explicitPathSegments = SvgPatternImportUtils.#samplePathBySubpaths(
                element,
                svg,
                viewBox,
                sampleSpacing,
                closeThreshold,
                debug
            )
            if (explicitPathSegments.length) {
                return explicitPathSegments
            }
        }

        let totalLength = 0
        try {
            totalLength = Number(element.getTotalLength())
        } catch (_error) {
            return []
        }
        if (!Number.isFinite(totalLength) || totalLength <= 0) {
            return []
        }

        const moveCommands = SvgPatternImportUtils.#countPathMoveCommands(element)
        const maxSamples = moveCommands > 1 ? 14000 : 9000
        const sampleCount = Math.max(12, Math.min(maxSamples, Math.ceil(totalLength / sampleSpacing)))
        const nodeToScreen = SvgPatternImportUtils.#getScreenMatrix(element, debug)
        const rootToScreen = SvgPatternImportUtils.#getScreenMatrix(svg, debug)
        const screenToRoot = SvgPatternImportUtils.#safeInverse(rootToScreen, debug)
        const allPoints = []

        for (let index = 0; index <= sampleCount; index += 1) {
            const distance = (index / sampleCount) * totalLength
            let point = null
            try {
                point = element.getPointAtLength(distance)
            } catch (_error) {
                continue
            }
            if (!point) continue

            let x = Number(point.x)
            let y = Number(point.y)
            if (
                nodeToScreen &&
                screenToRoot &&
                typeof point.matrixTransform === 'function' &&
                Number.isFinite(nodeToScreen.a) &&
                Number.isFinite(screenToRoot.a)
            ) {
                const rootPoint = point.matrixTransform(nodeToScreen).matrixTransform(screenToRoot)
                x = Number(rootPoint.x)
                y = Number(rootPoint.y)
            }

            if (!Number.isFinite(x) || !Number.isFinite(y)) continue

            const u = SvgPatternImportUtils.#wrap01((x - viewBox.minX) / viewBox.width)
            const v = SvgPatternImportUtils.#clamp((y - viewBox.minY) / viewBox.height, 0, 1)
            const last = allPoints[allPoints.length - 1]
            if (last && Math.abs(last.u - u) < 1e-4 && Math.abs(last.v - v) < 1e-4) {
                continue
            }
            allPoints.push({ u, v })
        }

        if (allPoints.length < 2) {
            return []
        }

        // Split samples at path jumps to avoid connecting independent SVG subpaths.
        const jumpThreshold = SvgPatternImportUtils.#estimateJumpThreshold(allPoints, element)
        const sourceClosed = SvgPatternImportUtils.#isSourceClosed(element)
        const segments = []
        let current = [allPoints[0]]

        for (let index = 1; index < allPoints.length; index += 1) {
            const nextPoint = allPoints[index]
            const previousPoint = current[current.length - 1]
            const distance = SvgPatternImportUtils.#wrappedDistance(previousPoint, nextPoint)
            if (distance > jumpThreshold) {
                SvgPatternImportUtils.#pushSegment(segments, current, closeThreshold, sourceClosed)
                current = [nextPoint]
                continue
            }
            current.push(nextPoint)
        }
        SvgPatternImportUtils.#pushSegment(segments, current, closeThreshold, sourceClosed)

        return segments
    }

    /**
     * Samples one SVG path by explicit `M/m` subpaths to preserve pen lifts.
     * @param {SVGPathElement | Element} element
     * @param {SVGSVGElement} svg
     * @param {{ minX: number, minY: number, width: number, height: number }} viewBox
     * @param {number} sampleSpacing
     * @param {number} closeThreshold
     * @param {boolean} debug
     * @returns {Array<{ points: Array<{u:number,v:number}>, closed: boolean }>}
     */
    static #samplePathBySubpaths(element, svg, viewBox, sampleSpacing, closeThreshold, debug) {
        const pathData = String(element.getAttribute('d') || '').trim()
        if (!pathData) return []

        const subpaths = SvgPatternImportUtils.#splitPathDataSubpaths(pathData)
        if (!subpaths.length) return []

        const parent = element.parentNode
        if (!parent || typeof parent.insertBefore !== 'function') return []

        const sampledSegments = []
        subpaths.forEach((subpath) => {
            const probe = element.cloneNode(false)
            if (!(probe instanceof Element)) return
            probe.setAttribute('d', subpath.d)
            if (probe.hasAttribute('id')) {
                probe.removeAttribute('id')
            }

            let points = []
            try {
                parent.insertBefore(probe, element.nextSibling)
                points = SvgPatternImportUtils.#sampleGeometryPoints(probe, svg, viewBox, sampleSpacing, debug)
            } finally {
                if (probe.parentNode) {
                    probe.remove()
                }
            }
            SvgPatternImportUtils.#pushSegment(sampledSegments, points, closeThreshold, subpath.closed)
        })

        return sampledSegments
    }

    /**
     * Splits path data into explicit subpaths at move commands.
     * @param {string} pathData
     * @returns {Array<{ d: string, closed: boolean }>}
     */
    static #splitPathDataSubpaths(pathData) {
        const tokens = SvgPatternImportUtils.#tokenizePathCommands(pathData)
        if (!tokens.length) return []

        const out = []
        let currentParts = []
        let currentClosed = false

        let currentX = 0
        let currentY = 0
        let startX = 0
        let startY = 0

        const pushCurrent = () => {
            if (!currentParts.length) return
            out.push({
                d: currentParts.join(' '),
                closed: currentClosed
            })
            currentParts = []
            currentClosed = false
        }

        tokens.forEach((token) => {
            const command = token.command
            const lower = command.toLowerCase()
            const isRelative = command === lower
            const values = token.values

            if (lower === 'm') {
                for (let index = 0; index + 1 < values.length; index += 2) {
                    const rawX = values[index]
                    const rawY = values[index + 1]
                    const nextX = isRelative ? currentX + rawX : rawX
                    const nextY = isRelative ? currentY + rawY : rawY
                    if (index === 0) {
                        pushCurrent()
                        currentParts.push(`M ${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`)
                        startX = nextX
                        startY = nextY
                        currentClosed = false
                    } else {
                        currentParts.push(`L ${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`)
                    }
                    currentX = nextX
                    currentY = nextY
                }
                return
            }

            if (!currentParts.length) return

            if (lower === 'z') {
                currentParts.push('Z')
                currentX = startX
                currentY = startY
                currentClosed = true
                return
            }

            const paramCount = SvgPatternImportUtils.#pathParamCount(lower)
            if (paramCount <= 0) return

            for (let index = 0; index + paramCount - 1 < values.length; index += paramCount) {
                if (lower === 'l') {
                    const nextX = isRelative ? currentX + values[index] : values[index]
                    const nextY = isRelative ? currentY + values[index + 1] : values[index + 1]
                    currentParts.push(`L ${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`)
                    currentX = nextX
                    currentY = nextY
                    continue
                }
                if (lower === 'h') {
                    const nextX = isRelative ? currentX + values[index] : values[index]
                    currentParts.push(`L ${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(currentY)}`)
                    currentX = nextX
                    continue
                }
                if (lower === 'v') {
                    const nextY = isRelative ? currentY + values[index] : values[index]
                    currentParts.push(`L ${SvgPatternImportUtils.#formatPathNumber(currentX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`)
                    currentY = nextY
                    continue
                }
                if (lower === 'c') {
                    const x1 = isRelative ? currentX + values[index] : values[index]
                    const y1 = isRelative ? currentY + values[index + 1] : values[index + 1]
                    const x2 = isRelative ? currentX + values[index + 2] : values[index + 2]
                    const y2 = isRelative ? currentY + values[index + 3] : values[index + 3]
                    const nextX = isRelative ? currentX + values[index + 4] : values[index + 4]
                    const nextY = isRelative ? currentY + values[index + 5] : values[index + 5]
                    currentParts.push(
                        `C ${SvgPatternImportUtils.#formatPathNumber(x1)} ${SvgPatternImportUtils.#formatPathNumber(y1)} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(x2)} ${SvgPatternImportUtils.#formatPathNumber(y2)} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`
                    )
                    currentX = nextX
                    currentY = nextY
                    continue
                }
                if (lower === 's') {
                    const x2 = isRelative ? currentX + values[index] : values[index]
                    const y2 = isRelative ? currentY + values[index + 1] : values[index + 1]
                    const nextX = isRelative ? currentX + values[index + 2] : values[index + 2]
                    const nextY = isRelative ? currentY + values[index + 3] : values[index + 3]
                    currentParts.push(
                        `S ${SvgPatternImportUtils.#formatPathNumber(x2)} ${SvgPatternImportUtils.#formatPathNumber(y2)} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`
                    )
                    currentX = nextX
                    currentY = nextY
                    continue
                }
                if (lower === 'q') {
                    const x1 = isRelative ? currentX + values[index] : values[index]
                    const y1 = isRelative ? currentY + values[index + 1] : values[index + 1]
                    const nextX = isRelative ? currentX + values[index + 2] : values[index + 2]
                    const nextY = isRelative ? currentY + values[index + 3] : values[index + 3]
                    currentParts.push(
                        `Q ${SvgPatternImportUtils.#formatPathNumber(x1)} ${SvgPatternImportUtils.#formatPathNumber(y1)} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`
                    )
                    currentX = nextX
                    currentY = nextY
                    continue
                }
                if (lower === 't') {
                    const nextX = isRelative ? currentX + values[index] : values[index]
                    const nextY = isRelative ? currentY + values[index + 1] : values[index + 1]
                    currentParts.push(`T ${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`)
                    currentX = nextX
                    currentY = nextY
                    continue
                }
                if (lower === 'a') {
                    const radiusX = values[index]
                    const radiusY = values[index + 1]
                    const rotation = values[index + 2]
                    const largeArc = values[index + 3] ? 1 : 0
                    const sweep = values[index + 4] ? 1 : 0
                    const nextX = isRelative ? currentX + values[index + 5] : values[index + 5]
                    const nextY = isRelative ? currentY + values[index + 6] : values[index + 6]
                    currentParts.push(
                        `A ${SvgPatternImportUtils.#formatPathNumber(radiusX)} ${SvgPatternImportUtils.#formatPathNumber(radiusY)} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(rotation)} ${largeArc} ${sweep} ` +
                            `${SvgPatternImportUtils.#formatPathNumber(nextX)} ${SvgPatternImportUtils.#formatPathNumber(nextY)}`
                    )
                    currentX = nextX
                    currentY = nextY
                }
            }
        })

        pushCurrent()
        return out
    }

    /**
     * Tokenizes path command chunks.
     * @param {string} pathData
     * @returns {Array<{ command: string, values: number[] }>}
     */
    static #tokenizePathCommands(pathData) {
        const chunks = String(pathData || '').match(/[MmZzLlHhVvCcSsQqTtAa][^MmZzLlHhVvCcSsQqTtAa]*/g) || []
        return chunks
            .map((chunk) => String(chunk || '').trim())
            .filter(Boolean)
            .map((chunk) => ({
                command: chunk[0],
                values: SvgPatternImportUtils.#parsePathNumbers(chunk.slice(1))
            }))
    }

    /**
     * Parses numeric path parameters.
     * @param {string} raw
     * @returns {number[]}
     */
    static #parsePathNumbers(raw) {
        const matches = String(raw || '').match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) || []
        return matches.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value))
    }

    /**
     * Returns the parameter count for one command segment.
     * @param {string} commandLower
     * @returns {number}
     */
    static #pathParamCount(commandLower) {
        if (commandLower === 'l' || commandLower === 't') return 2
        if (commandLower === 'h' || commandLower === 'v') return 1
        if (commandLower === 'q' || commandLower === 's') return 4
        if (commandLower === 'c') return 6
        if (commandLower === 'a') return 7
        return 0
    }

    /**
     * Formats one numeric value for SVG path output.
     * @param {number} value
     * @returns {string}
     */
    static #formatPathNumber(value) {
        if (!Number.isFinite(value)) return '0'
        const rounded = Math.round(value * 1e6) / 1e6
        if (Math.abs(rounded) < 1e-9) return '0'
        const text = String(rounded)
        if (!/[eE]/.test(text)) return text
        const normalized = rounded.toFixed(6).replace(/\.?0+$/g, '')
        return normalized === '-0' ? '0' : normalized
    }

    /**
     * Samples UV points along one geometry element.
     * @param {Element} element
     * @param {SVGSVGElement} svg
     * @param {{ minX: number, minY: number, width: number, height: number }} viewBox
     * @param {number} sampleSpacing
     * @param {boolean} debug
     * @returns {Array<{u:number,v:number}>}
     */
    static #sampleGeometryPoints(element, svg, viewBox, sampleSpacing, debug) {
        if (typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') {
            return []
        }

        let totalLength = 0
        try {
            totalLength = Number(element.getTotalLength())
        } catch (_error) {
            return []
        }
        if (!Number.isFinite(totalLength) || totalLength <= 0) {
            return []
        }

        const moveCommands = SvgPatternImportUtils.#countPathMoveCommands(element)
        const maxSamples = moveCommands > 1 ? 14000 : 9000
        const sampleCount = Math.max(12, Math.min(maxSamples, Math.ceil(totalLength / sampleSpacing)))
        const nodeToScreen = SvgPatternImportUtils.#getScreenMatrix(element, debug)
        const rootToScreen = SvgPatternImportUtils.#getScreenMatrix(svg, debug)
        const screenToRoot = SvgPatternImportUtils.#safeInverse(rootToScreen, debug)
        const points = []

        for (let index = 0; index <= sampleCount; index += 1) {
            const distance = (index / sampleCount) * totalLength
            let point = null
            try {
                point = element.getPointAtLength(distance)
            } catch (_error) {
                continue
            }
            if (!point) continue

            let x = Number(point.x)
            let y = Number(point.y)
            if (
                nodeToScreen &&
                screenToRoot &&
                typeof point.matrixTransform === 'function' &&
                Number.isFinite(nodeToScreen.a) &&
                Number.isFinite(screenToRoot.a)
            ) {
                const rootPoint = point.matrixTransform(nodeToScreen).matrixTransform(screenToRoot)
                x = Number(rootPoint.x)
                y = Number(rootPoint.y)
            }

            if (!Number.isFinite(x) || !Number.isFinite(y)) continue

            const u = SvgPatternImportUtils.#wrap01((x - viewBox.minX) / viewBox.width)
            const v = SvgPatternImportUtils.#clamp((y - viewBox.minY) / viewBox.height, 0, 1)
            const last = points[points.length - 1]
            if (last && Math.abs(last.u - u) < 1e-4 && Math.abs(last.v - v) < 1e-4) {
                continue
            }
            points.push({ u, v })
        }

        return points
    }

    /**
     * Replaces Inkscape path-effect output with original source geometry when available.
     * This avoids artificial hatch connector artifacts generated by editor effects.
     * @param {Element} svg
     * @param {boolean} debug
     * @param {string} sourceName
     * @returns {void}
     */
    static #normalizeInkscapePaths(svg, debug, sourceName) {
        if (!svg) return
        let replaced = 0
        const paths = svg.querySelectorAll('path')
        paths.forEach((path) => {
            const hasPathEffect =
                path.hasAttribute('inkscape:path-effect') ||
                Boolean(SvgPatternImportUtils.#readAttributeByLocalName(path, 'path-effect'))
            if (!hasPathEffect) return

            const originalData =
                String(path.getAttribute('inkscape:original-d') || '').trim() ||
                String(SvgPatternImportUtils.#readAttributeByLocalName(path, 'original-d') || '').trim()
            if (!originalData) return

            const currentData = String(path.getAttribute('d') || '').trim()
            if (!currentData || currentData === originalData) return

            path.setAttribute('d', originalData)
            replaced += 1
        })

        if (replaced > 0) {
            SvgPatternImportUtils.#logDebug(debug, 'Normalized Inkscape path effects', {
                sourceName,
                replacedPaths: replaced
            })
        }
    }

    /**
     * Reads an attribute by local-name, independent from namespace prefix.
     * @param {Element} element
     * @param {string} localName
     * @returns {string}
     */
    static #readAttributeByLocalName(element, localName) {
        if (!element || !localName) return ''
        const match = Array.from(element.attributes || []).find((attribute) => attribute?.localName === localName)
        return String(match?.value || '')
    }

    /**
     * Resolves an optional egg/base background color from SVG metadata.
     * @param {SVGSVGElement} svg
     * @param {(value: string) => string} normalizeColor
     * @returns {string}
     */
    static #resolveBaseColor(svg, normalizeColor) {
        if (!svg) return ''
        const style = String(svg.getAttribute('style') || '')
        const styleMatch = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)
        if (styleMatch?.[1]) {
            const fromStyle = normalizeColor(styleMatch[1])
            if (fromStyle) return fromStyle
        }

        const rootFill = normalizeColor(String(svg.getAttribute('fill') || ''))
        if (rootFill) return rootFill

        const pageColorOnRoot = normalizeColor(SvgPatternImportUtils.#readAttributeByLocalName(svg, 'pagecolor'))
        if (pageColorOnRoot) return pageColorOnRoot

        const nodes = svg.querySelectorAll('*')
        for (const node of nodes) {
            const pageColor = normalizeColor(SvgPatternImportUtils.#readAttributeByLocalName(node, 'pagecolor'))
            if (pageColor) {
                return pageColor
            }
        }
        return ''
    }

    /**
     * Estimates a robust jump threshold for splitting sampled points.
     * Paths with multiple move commands are split more aggressively to preserve pen lifts.
     * @param {Array<{u:number,v:number}>} points
     * @param {Element} element
     * @returns {number}
     */
    static #estimateJumpThreshold(points, element) {
        if (!Array.isArray(points) || points.length < 3) return 0.02

        const distances = []
        for (let index = 1; index < points.length; index += 1) {
            distances.push(SvgPatternImportUtils.#wrappedDistance(points[index - 1], points[index]))
        }
        const positive = distances.filter((value) => Number.isFinite(value) && value > 0)
        if (!positive.length) return 0.02

        positive.sort((left, right) => left - right)
        const median = SvgPatternImportUtils.#quantile(positive, 0.5)
        const p90 = SvgPatternImportUtils.#quantile(positive, 0.9)
        const typicalStep = Math.max(median, p90 * 0.8, 0.0008)
        const moveCommands = SvgPatternImportUtils.#countPathMoveCommands(element)

        if (moveCommands > 1) {
            return SvgPatternImportUtils.#clamp(typicalStep * 2.4, 0.0015, 0.02)
        }
        return SvgPatternImportUtils.#clamp(typicalStep * 6, 0.012, 0.08)
    }

    /**
     * Counts move commands in a path to detect explicit subpaths.
     * @param {Element} element
     * @returns {number}
     */
    static #countPathMoveCommands(element) {
        const tag = String(element?.tagName || '')
            .trim()
            .toLowerCase()
        if (tag !== 'path') return 1
        const data = String(element.getAttribute('d') || '')
        const matches = data.match(/[Mm]/g)
        return Math.max(1, matches ? matches.length : 1)
    }

    /**
     * Returns a quantile from an ascending-sorted numeric array.
     * @param {number[]} sortedValues
     * @param {number} q
     * @returns {number}
     */
    static #quantile(sortedValues, q) {
        if (!Array.isArray(sortedValues) || !sortedValues.length) return 0
        const clampedQ = SvgPatternImportUtils.#clamp(q, 0, 1)
        const position = (sortedValues.length - 1) * clampedQ
        const lowerIndex = Math.floor(position)
        const upperIndex = Math.ceil(position)
        if (lowerIndex === upperIndex) return sortedValues[lowerIndex]
        const lower = sortedValues[lowerIndex]
        const upper = sortedValues[upperIndex]
        const ratio = position - lowerIndex
        return lower + (upper - lower) * ratio
    }

    /**
     * Reads getScreenCTM safely.
     * @param {Element} element
     * @param {boolean} debug
     * @returns {DOMMatrix | SVGMatrix | null}
     */
    static #getScreenMatrix(element, debug) {
        if (!element || typeof element.getScreenCTM !== 'function') {
            return null
        }
        try {
            return element.getScreenCTM() || null
        } catch (error) {
            SvgPatternImportUtils.#logWarn(debug, 'getScreenCTM failed', {
                tag: String(element?.tagName || '').toLowerCase(),
                message: String(error?.message || error)
            })
            return null
        }
    }

    /**
     * Inverts an SVG matrix safely.
     * @param {DOMMatrix | SVGMatrix | null} matrix
     * @param {boolean} debug
     * @returns {DOMMatrix | SVGMatrix | null}
     */
    static #safeInverse(matrix, debug) {
        if (!matrix || typeof matrix.inverse !== 'function') {
            return null
        }
        try {
            return matrix.inverse() || null
        } catch (error) {
            SvgPatternImportUtils.#logWarn(debug, 'Matrix inversion failed', {
                message: String(error?.message || error)
            })
            return null
        }
    }

    /**
     * Appends one sampled segment if it is meaningful.
     * @param {Array<{ points: Array<{u:number,v:number}>, closed: boolean }>} out
     * @param {Array<{u:number,v:number}>} points
     * @param {number} closeThreshold
     * @param {boolean} sourceClosed
     */
    static #pushSegment(out, points, closeThreshold, sourceClosed) {
        if (!Array.isArray(points) || points.length < 2) return

        let totalLength = 0
        for (let index = 1; index < points.length; index += 1) {
            totalLength += SvgPatternImportUtils.#wrappedDistance(points[index - 1], points[index])
        }
        if (totalLength < 0.00015) return

        const first = points[0]
        const last = points[points.length - 1]
        const closed =
            Boolean(sourceClosed) &&
            points.length >= 4 &&
            SvgPatternImportUtils.#distance(first, last) <= closeThreshold

        out.push({
            points,
            closed
        })
    }

    /**
     * Detects if the source SVG geometry is explicitly closed.
     * @param {Element} element
     * @returns {boolean}
     */
    static #isSourceClosed(element) {
        const tag = String(element?.tagName || '')
            .trim()
            .toLowerCase()
        if (!tag) return false
        if (tag === 'polygon' || tag === 'rect' || tag === 'circle' || tag === 'ellipse') {
            return true
        }
        if (tag === 'path') {
            const data = String(element.getAttribute('d') || '')
            return /[zZ]/.test(data)
        }
        return false
    }

    /**
     * Resolves SVG viewBox dimensions.
     * @param {Element} svg
     * @returns {{ minX: number, minY: number, width: number, height: number }}
     */
    static #resolveViewBox(svg) {
        const viewBoxAttr = String(svg.getAttribute('viewBox') || '').trim()
        const viewBoxValues = viewBoxAttr
            .split(/[,\s]+/)
            .map((value) => Number.parseFloat(value))
            .filter((value) => Number.isFinite(value))

        if (viewBoxValues.length === 4 && viewBoxValues[2] > 0 && viewBoxValues[3] > 0) {
            return {
                minX: viewBoxValues[0],
                minY: viewBoxValues[1],
                width: viewBoxValues[2],
                height: viewBoxValues[3]
            }
        }

        const width = SvgPatternImportUtils.#parseSvgLength(svg.getAttribute('width')) || 3200
        const height = SvgPatternImportUtils.#parseSvgLength(svg.getAttribute('height')) || 800
        return {
            minX: 0,
            minY: 0,
            width: Math.max(1, width),
            height: Math.max(1, height)
        }
    }

    /**
     * Parses a numeric SVG length.
     * @param {string | null} value
     * @returns {number}
     */
    static #parseSvgLength(value) {
        const parsed = Number.parseFloat(String(value || '').replace(/[^\d.+-]/g, ''))
        return Number.isFinite(parsed) ? parsed : 0
    }

    /**
     * Creates a CSS color normalizer returning hex colors.
     * @returns {(value: string) => string}
     */
    static #createColorNormalizer() {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
            return () => ''
        }

        return (value) => {
            const raw = String(value || '')
                .trim()
                .toLowerCase()
            if (!raw || raw === 'none' || raw === 'transparent') return ''
            if (window.CSS && typeof window.CSS.supports === 'function' && !window.CSS.supports('color', raw)) {
                return ''
            }

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

    /**
     * Clamps a number.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static #clamp(value, min, max) {
        return Math.max(min, Math.min(max, value))
    }

    /**
     * Distance between two UV points with seam-aware U wrapping.
     * @param {{u:number,v:number}} left
     * @param {{u:number,v:number}} right
     * @returns {number}
     */
    static #wrappedDistance(left, right) {
        let du = Math.abs((left?.u ?? 0) - (right?.u ?? 0))
        du = Math.min(du, 1 - du)
        const dv = Math.abs((left?.v ?? 0) - (right?.v ?? 0))
        return Math.hypot(du, dv)
    }

    /**
     * Plain euclidean distance in UV space without seam wrapping.
     * @param {{u:number,v:number}} left
     * @param {{u:number,v:number}} right
     * @returns {number}
     */
    static #distance(left, right) {
        const du = Math.abs((left?.u ?? 0) - (right?.u ?? 0))
        const dv = Math.abs((left?.v ?? 0) - (right?.v ?? 0))
        return Math.hypot(du, dv)
    }

    /**
     * Wraps a number into [0, 1).
     * @param {number} value
     * @returns {number}
     */
    static #wrap01(value) {
        if (!Number.isFinite(value)) return 0
        const wrapped = value % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }

    /**
     * Clamps an integer.
     * @param {unknown} value
     * @param {number} fallback
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static #clampInt(value, fallback, min, max) {
        const parsed = Math.trunc(Number(value))
        if (!Number.isFinite(parsed)) return fallback
        return Math.max(min, Math.min(max, parsed))
    }

    /**
     * Writes one debug log entry.
     * @param {boolean} debug
     * @param {string} message
     * @param {Record<string, unknown>} [data]
     */
    static #logDebug(debug, message, data = {}) {
        if (!debug) return
        console.debug('[SvgPatternImport]', message, data)
    }

    /**
     * Writes one warning log entry.
     * @param {boolean} debug
     * @param {string} message
     * @param {Record<string, unknown>} [data]
     */
    static #logWarn(debug, message, data = {}) {
        if (!debug) return
        console.warn('[SvgPatternImport]', message, data)
    }
}
