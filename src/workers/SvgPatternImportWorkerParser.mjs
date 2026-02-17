import { SvgPatternImportWorkerGeometry } from './SvgPatternImportWorkerGeometry.mjs'
import { DOMParser as LinkedomDOMParser } from '../../node_modules/linkedom/worker.js'

/**
 * Worker-side SVG parser that converts geometry into EggBot UV strokes.
 */
export class SvgPatternImportWorkerParser {
    /**
     * Parses SVG text into renderer strokes.
     * @param {string} svgText
     * @param {{ maxColors?: number, sampleSpacing?: number, heightScale?: number, heightReference?: number }} [options]
     * @returns {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio: number }}
     */
    static parse(svgText, options = {}) {
        const ParserCtor = typeof DOMParser === 'function' ? DOMParser : LinkedomDOMParser
        if (typeof ParserCtor !== 'function') {
            throw new Error('worker-runtime-unavailable')
        }

        const parser = new ParserCtor()
        const xml = parser.parseFromString(String(svgText || ''), 'image/svg+xml')
        if (xml.querySelector('parsererror')) {
            throw new Error('invalid-svg')
        }

        const svg = xml.querySelector('svg')
        if (!svg) {
            throw new Error('invalid-svg')
        }

        svg.querySelectorAll('script,foreignObject').forEach((node) => node.remove())
        SvgPatternImportWorkerParser.#normalizeInkscapePaths(svg)

        const viewBox = SvgPatternImportWorkerParser.#resolveViewBox(svg)
        const cssRules = SvgPatternImportWorkerParser.#parseCssRules(svg)
        const normalizeColor = SvgPatternImportWorkerParser.#createColorNormalizer()
        const baseColor = SvgPatternImportWorkerParser.#resolveBaseColor(svg, cssRules, normalizeColor)
        const geometries = Array.from(svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse'))

        const maxColors = SvgPatternImportWorkerGeometry.clampInt(options.maxColors, 6, 1, 12)
        const sampleSpacing = Math.max(0.6, Number(options.sampleSpacing) || 3)
        const heightScale = SvgPatternImportWorkerGeometry.clamp(Number(options.heightScale) || 1, 0.1, 3)
        const heightReference = Math.max(1, Number(options.heightReference) || 800)
        const baseHeightRatio = viewBox.height / Math.max(viewBox.height, heightReference)
        const heightRatio = SvgPatternImportWorkerGeometry.clamp(baseHeightRatio * heightScale, 0.02, 3)
        const colorToIndex = new Map()
        const palette = []
        const strokes = []

        geometries.forEach((element, geometryIndex) => {
            try {
                const style = SvgPatternImportWorkerParser.#resolveElementStyle(element, cssRules)
                if (!SvgPatternImportWorkerParser.#isVisible(style)) {
                    return
                }

                const fillColor = normalizeColor(style.fill)
                const strokeColor = normalizeColor(style.stroke)
                const fillOpacity = SvgPatternImportWorkerGeometry.clamp(style.fillOpacity * style.opacity, 0, 1)
                const strokeOpacity = SvgPatternImportWorkerGeometry.clamp(style.strokeOpacity * style.opacity, 0, 1)
                const fillRule = style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'

                let color = ''
                let usesFillColor = false

                if (fillColor && fillOpacity > 0) {
                    color = fillColor
                    usesFillColor = true
                } else if (strokeColor && style.strokeWidth > 0 && strokeOpacity > 0) {
                    color = strokeColor
                }

                if (!color) {
                    return
                }

                let colorIndex = colorToIndex.get(color)
                if (typeof colorIndex !== 'number') {
                    colorIndex = colorToIndex.size < maxColors ? colorToIndex.size : colorToIndex.size % maxColors
                    colorToIndex.set(color, colorIndex)
                    if (palette.length <= colorIndex) {
                        palette[colorIndex] = color
                    }
                }

                const matrix = SvgPatternImportWorkerGeometry.resolveElementMatrix(element, svg)
                const segments = SvgPatternImportWorkerGeometry.sampleGeometrySegments(
                    element,
                    matrix,
                    viewBox,
                    sampleSpacing,
                    heightRatio
                )
                if (!segments.length) {
                    return
                }

                segments.forEach((segment) => {
                    strokes.push({
                        colorIndex,
                        points: segment.points,
                        closed: Boolean(segment.closed),
                        fillGroupId: usesFillColor ? geometryIndex : null,
                        fillAlpha: usesFillColor ? fillOpacity : undefined,
                        fillRule: usesFillColor ? fillRule : undefined
                    })
                })
            } catch (_error) {
                // Ignore one invalid geometry and continue importing the rest.
            }
        })

        if (!strokes.length) {
            throw new Error('no-drawable-geometry')
        }

        return {
            strokes,
            heightRatio,
            palette: palette.filter(Boolean),
            ...(baseColor ? { baseColor } : {})
        }
    }

    /**
     * Replaces Inkscape path-effect output with original source geometry when available.
     * @param {Element} svg
     * @returns {void}
     */
    static #normalizeInkscapePaths(svg) {
        if (!svg) return
        svg.querySelectorAll('path').forEach((path) => {
            const hasPathEffect =
                path.hasAttribute('inkscape:path-effect') ||
                Boolean(SvgPatternImportWorkerParser.#readAttributeByLocalName(path, 'path-effect'))
            if (!hasPathEffect) return

            const originalData =
                String(path.getAttribute('inkscape:original-d') || '').trim() ||
                String(SvgPatternImportWorkerParser.#readAttributeByLocalName(path, 'original-d') || '').trim()
            if (!originalData) return

            path.setAttribute('d', originalData)
        })
    }

    /**
     * Resolves inherited + inline style for one geometry element.
     * @param {Element} element
     * @param {Array<{ selector: string, declarations: Record<string, string> }>} cssRules
     * @returns {{ display: string, visibility: string, opacity: number, fill: string, fillOpacity: number, stroke: string, strokeOpacity: number, strokeWidth: number, fillRule: string }}
     */
    static #resolveElementStyle(element, cssRules) {
        const chain = []
        let cursor = element
        while (SvgPatternImportWorkerParser.#isElementNode(cursor)) {
            chain.unshift(cursor)
            cursor = cursor.parentElement
        }

        let display = 'inline'
        let visibility = 'visible'
        let opacity = 1
        let fill = '#000000'
        let fillOpacity = 1
        let stroke = 'none'
        let strokeOpacity = 1
        let strokeWidth = 1
        let fillRule = 'nonzero'

        chain.forEach((node) => {
            const declarations = SvgPatternImportWorkerParser.#resolveDeclarationsForNode(node, cssRules)

            if ('display' in declarations) {
                display = String(declarations.display || 'inline').trim().toLowerCase()
            }
            if ('visibility' in declarations) {
                visibility = String(declarations.visibility || 'visible').trim().toLowerCase()
            }
            if ('opacity' in declarations) {
                opacity *= SvgPatternImportWorkerGeometry.clamp01(
                    SvgPatternImportWorkerParser.#toNumber(declarations.opacity, 1)
                )
            }
            if ('fill' in declarations) {
                fill = String(declarations.fill || '').trim()
            }
            if ('fill-opacity' in declarations) {
                fillOpacity = SvgPatternImportWorkerGeometry.clamp01(
                    SvgPatternImportWorkerParser.#toNumber(declarations['fill-opacity'], fillOpacity)
                )
            }
            if ('stroke' in declarations) {
                stroke = String(declarations.stroke || '').trim()
            }
            if ('stroke-opacity' in declarations) {
                strokeOpacity = SvgPatternImportWorkerGeometry.clamp01(
                    SvgPatternImportWorkerParser.#toNumber(declarations['stroke-opacity'], strokeOpacity)
                )
            }
            if ('stroke-width' in declarations) {
                strokeWidth = Math.max(0, SvgPatternImportWorkerGeometry.parseSvgLength(declarations['stroke-width']))
            }
            if ('fill-rule' in declarations) {
                fillRule = String(declarations['fill-rule'] || 'nonzero').trim().toLowerCase()
            }
        })

        return {
            display,
            visibility,
            opacity: SvgPatternImportWorkerGeometry.clamp01(opacity),
            fill,
            fillOpacity,
            stroke,
            strokeOpacity,
            strokeWidth,
            fillRule
        }
    }

    /**
     * Resolves declarations for one node.
     * @param {Element} node
     * @param {Array<{ selector: string, declarations: Record<string, string> }>} cssRules
     * @returns {Record<string, string>}
     */
    static #resolveDeclarationsForNode(node, cssRules) {
        const out = {}

        cssRules.forEach((rule) => {
            if (!SvgPatternImportWorkerParser.#matchesSelector(node, rule.selector)) return
            Object.assign(out, rule.declarations)
        })

        SvgPatternImportWorkerParser.#readPresentationAttributes(node, out)
        Object.assign(out, SvgPatternImportWorkerParser.#parseStyleDeclaration(node.getAttribute('style') || ''))

        return out
    }

    /**
     * Reads presentation attributes into declarations.
     * @param {Element} node
     * @param {Record<string, string>} out
     * @returns {void}
     */
    static #readPresentationAttributes(node, out) {
        ;[
            'display',
            'visibility',
            'opacity',
            'fill',
            'fill-opacity',
            'stroke',
            'stroke-opacity',
            'stroke-width',
            'fill-rule'
        ].forEach((name) => {
            if (node.hasAttribute(name)) {
                out[name] = String(node.getAttribute(name) || '').trim()
            }
        })
    }

    /**
     * Parses CSS style blocks from SVG.
     * @param {Element} svg
     * @returns {Array<{ selector: string, declarations: Record<string, string> }>}
     */
    static #parseCssRules(svg) {
        const rules = []
        const styleNodes = Array.from(svg.querySelectorAll('style'))
        styleNodes.forEach((styleNode) => {
            const source = String(styleNode.textContent || '')
                .replace(/\/\*[^]*?\*\//g, '')
                .trim()
            if (!source) return

            const regex = /([^{}]+)\{([^}]*)\}/g
            let match = regex.exec(source)
            while (match) {
                const selectorText = String(match[1] || '').trim()
                const body = String(match[2] || '').trim()
                if (selectorText && body) {
                    const declarations = SvgPatternImportWorkerParser.#parseStyleDeclaration(body)
                    selectorText
                        .split(',')
                        .map((selector) => selector.trim())
                        .filter(Boolean)
                        .forEach((selector) => {
                            rules.push({ selector, declarations })
                        })
                }
                match = regex.exec(source)
            }
        })
        return rules
    }

    /**
     * Parses `key:value` pairs from style declaration text.
     * @param {string} styleText
     * @returns {Record<string, string>}
     */
    static #parseStyleDeclaration(styleText) {
        const out = {}
        String(styleText || '')
            .split(';')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .forEach((entry) => {
                const divider = entry.indexOf(':')
                if (divider <= 0) return
                const key = entry.slice(0, divider).trim().toLowerCase()
                const value = entry.slice(divider + 1).trim()
                if (!key) return
                out[key] = value
            })
        return out
    }

    /**
     * Matches a simple selector against an element.
     * @param {Element} element
     * @param {string} selector
     * @returns {boolean}
     */
    static #matchesSelector(element, selector) {
        const raw = String(selector || '').trim()
        if (!raw) return false
        if (raw === '*') return true

        const terminal = raw.split(/[\s>+~]+/g).filter(Boolean).pop() || ''
        const withoutPseudo = terminal.replace(/:{1,2}[a-zA-Z0-9_\-()]+/g, '')
        if (!withoutPseudo) return false

        const tagMatch = withoutPseudo.match(/^([a-zA-Z][a-zA-Z0-9:_-]*)/)
        const idMatch = withoutPseudo.match(/#([a-zA-Z0-9_-]+)/)
        const classMatches = Array.from(withoutPseudo.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((match) => match[1])

        if (tagMatch) {
            const tag = String(element.tagName || '').toLowerCase()
            if (tag !== tagMatch[1].toLowerCase()) {
                return false
            }
        }

        if (idMatch) {
            const id = String(element.getAttribute('id') || '')
            if (id !== idMatch[1]) {
                return false
            }
        }

        if (classMatches.length) {
            const classes = String(element.getAttribute('class') || '')
                .split(/\s+/)
                .map((part) => part.trim())
                .filter(Boolean)
            for (const className of classMatches) {
                if (!classes.includes(className)) {
                    return false
                }
            }
        }

        return true
    }

    /**
     * Creates a CSS color normalizer.
     * @returns {(value: string) => string}
     */
    static #createColorNormalizer() {
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
    static #resolveBaseColor(svg, cssRules, normalizeColor) {
        const declarations = SvgPatternImportWorkerParser.#resolveDeclarationsForNode(svg, cssRules)
        const background = normalizeColor(String(declarations['background-color'] || declarations.background || ''))
        if (background) return background

        const rootFill = normalizeColor(String(declarations.fill || ''))
        if (rootFill) return rootFill

        const pageColor = normalizeColor(SvgPatternImportWorkerParser.#readAttributeByLocalName(svg, 'pagecolor'))
        if (pageColor) return pageColor

        return ''
    }

    /**
     * Resolves SVG viewBox dimensions.
     * @param {Element} svg
     * @returns {{ minX: number, minY: number, width: number, height: number }}
     */
    static #resolveViewBox(svg) {
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
    static #isVisible(style) {
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
    static #readAttributeByLocalName(element, localName) {
        const match = Array.from(element.attributes || []).find((attribute) => attribute?.localName === localName)
        return String(match?.value || '')
    }

    /**
     * Converts arbitrary numeric strings into finite numbers.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #toNumber(value, fallback) {
        const parsed = Number.parseFloat(String(value ?? '').replace(/[^\d.+\-eE]/g, ''))
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Checks whether a value looks like an element node without relying on global constructors.
     * @param {unknown} value
     * @returns {value is Element}
     */
    static #isElementNode(value) {
        return Boolean(value && typeof value === 'object' && value.nodeType === 1)
    }
}
