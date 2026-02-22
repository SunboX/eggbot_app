import { AppVersion } from './AppVersion.mjs'

/**
 * Builds exportable SVG markup from UV stroke data.
 */
export class PatternSvgExportUtils {
    static #DEFAULT_WIDTH = 2048
    static #DEFAULT_HEIGHT = 1024
    static #DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/'
    static #CC_NAMESPACE = 'http://creativecommons.org/ns#'
    static #RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
    static #ORNAMENT_GROUPS = [
        { key: 'punkte', label: 'Punkte' },
        { key: 'strahlen', label: 'Strahlen' },
        { key: 'wabe', label: 'Wabe' },
        { key: 'wolfszaehne', label: 'Wolfszähne' },
        { key: 'kiefernzweig', label: 'Kiefernzweig' },
        { key: 'feder-raute', label: 'Feder/Raute' }
    ]

    /**
     * Builds an SVG document string from stroke data.
     * @param {{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', horizontalRingGroup?: string, motifGroup?: string }>, palette?: string[], baseColor?: string, lineWidth?: number, fillPatterns?: boolean, width?: number, height?: number, editorName?: string, editorUrl?: string, metadata?: { title?: string, date?: string, creator?: string, rights?: string, publisher?: string, identifier?: string, source?: string, relation?: string, language?: string, keywords?: string[] | string, coverage?: string, description?: string, contributors?: string[] | string } }} input
     * @returns {string}
     */
    static buildSvg(input) {
        const strokes = Array.isArray(input?.strokes) ? input.strokes : []
        const palette = Array.isArray(input?.palette) && input.palette.length ? input.palette : ['#8b1f1a']
        const width = Math.max(64, Math.round(Number(input?.width) || PatternSvgExportUtils.#DEFAULT_WIDTH))
        const height = Math.max(64, Math.round(Number(input?.height) || PatternSvgExportUtils.#DEFAULT_HEIGHT))
        const lineWidth = Math.max(0.5, Number(input?.lineWidth) || 1.8)
        const fillPatterns = input?.fillPatterns !== false
        const baseColor = String(input?.baseColor || '#efe7ce')
        const version = String(AppVersion.get() || '').trim() || '0.0.0'
        const editorName = String(input?.editorName || 'eggbot-app').trim() || 'eggbot-app'
        const fallbackEditorUrl = typeof window !== 'undefined' ? String(window.location?.href || '').trim() : ''
        const editorUrl = String(input?.editorUrl || fallbackEditorUrl).trim()
        const metadata = PatternSvgExportUtils.#resolveInkscapeMetadata({
            metadata: input?.metadata,
            version,
            editorName,
            editorUrl,
            width,
            height
        })
        const metadataElement = PatternSvgExportUtils.#buildMetadataElement(metadata)

        const fillElements = fillPatterns ? PatternSvgExportUtils.#buildFillElements(strokes, palette, width, height) : []
        const fillGroups = fillElements.length ? [`<g id="ornament-fills">\n${fillElements.join('\n')}\n</g>`] : []
        const strokeElements = PatternSvgExportUtils.#buildStrokeElements(strokes, palette, width, height, lineWidth)
        const body = [...fillGroups, ...strokeElements].join('\n')

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="${PatternSvgExportUtils.#DC_NAMESPACE}" xmlns:cc="${PatternSvgExportUtils.#CC_NAMESPACE}" xmlns:rdf="${PatternSvgExportUtils.#RDF_NAMESPACE}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none">`,
            `    ${metadataElement}`,
            `    <rect width="${width}" height="${height}" fill="${PatternSvgExportUtils.#escapeXml(baseColor)}" />`,
            body ? `    ${body.split('\n').join('\n    ')}` : '',
            '</svg>'
        ]
            .filter(Boolean)
            .join('\n')
    }

    /**
     * Resolves Dublin-Core metadata values for Inkscape-compatible exports.
     * @param {{ metadata?: { title?: string, date?: string, creator?: string, rights?: string, publisher?: string, identifier?: string, source?: string, relation?: string, language?: string, keywords?: string[] | string, coverage?: string, description?: string, contributors?: string[] | string }, version: string, editorName: string, editorUrl: string, width: number, height: number }} input
     * @returns {{ title: string, date: string, creator: string, rights: string, publisher: string, identifier: string, source: string, relation: string, language: string, keywords: string[], coverage: string, description: string, contributor: string }}
     */
    static #resolveInkscapeMetadata(input) {
        const metadata = input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}
        const currentYear = new Date().getUTCFullYear()
        const creator = PatternSvgExportUtils.#normalizeMetadataText(metadata.creator) || input.editorName
        const publisher = PatternSvgExportUtils.#normalizeMetadataText(metadata.publisher) || creator
        const rights = PatternSvgExportUtils.#normalizeMetadataText(metadata.rights) || `Copyright ${currentYear} ${creator}`
        const source = PatternSvgExportUtils.#normalizeMetadataText(metadata.source) || input.editorUrl || input.editorName
        const relation = PatternSvgExportUtils.#normalizeMetadataText(metadata.relation) || source
        const languageFallback = typeof navigator !== 'undefined' ? String(navigator.language || '').trim() : ''
        const language = PatternSvgExportUtils.#normalizeMetadataText(metadata.language) || languageFallback || 'en'
        const descriptionFallback = input.editorUrl
            ? `Generated with ${input.editorName} (${input.editorUrl}) using eggbot-app ${input.version}`
            : `Generated with ${input.editorName} using eggbot-app ${input.version}`
        const keywords = PatternSvgExportUtils.#normalizeMetadataList(metadata.keywords)
        const contributors = PatternSvgExportUtils.#normalizeMetadataList(metadata.contributors)
        return {
            title: PatternSvgExportUtils.#normalizeMetadataText(metadata.title) || 'Sorbian egg composition',
            date: PatternSvgExportUtils.#normalizeMetadataText(metadata.date) || new Date().toISOString(),
            creator,
            rights,
            publisher,
            identifier: PatternSvgExportUtils.#normalizeMetadataText(metadata.identifier) || `eggbot-app-${input.version}`,
            source,
            relation,
            language,
            keywords: keywords.length ? keywords : ['sorbian', 'eggbot-app', `version-${input.version}`],
            coverage: PatternSvgExportUtils.#normalizeMetadataText(metadata.coverage) || `${input.width}x${input.height}px`,
            description: PatternSvgExportUtils.#normalizeMetadataText(metadata.description) || descriptionFallback,
            contributor: contributors.join(', ') || creator
        }
    }

    /**
     * Builds one Inkscape-compatible metadata element using Dublin-Core fields.
     * @param {{ title: string, date: string, creator: string, rights: string, publisher: string, identifier: string, source: string, relation: string, language: string, keywords: string[], coverage: string, description: string, contributor: string }} metadata
     * @returns {string}
     */
    static #buildMetadataElement(metadata) {
        return [
            '<metadata id="metadata1">',
            '  <rdf:RDF>',
            '    <cc:Work rdf:about="">',
            '      <dc:format>image/svg+xml</dc:format>',
            '      <dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" />',
            `      <dc:title>${PatternSvgExportUtils.#escapeXml(metadata.title)}</dc:title>`,
            `      <dc:date>${PatternSvgExportUtils.#escapeXml(metadata.date)}</dc:date>`,
            PatternSvgExportUtils.#buildAgentMetadataElement('dc:creator', metadata.creator),
            PatternSvgExportUtils.#buildAgentMetadataElement('dc:rights', metadata.rights),
            PatternSvgExportUtils.#buildAgentMetadataElement('dc:publisher', metadata.publisher),
            `      <dc:identifier>${PatternSvgExportUtils.#escapeXml(metadata.identifier)}</dc:identifier>`,
            `      <dc:source>${PatternSvgExportUtils.#escapeXml(metadata.source)}</dc:source>`,
            `      <dc:relation>${PatternSvgExportUtils.#escapeXml(metadata.relation)}</dc:relation>`,
            `      <dc:language>${PatternSvgExportUtils.#escapeXml(metadata.language)}</dc:language>`,
            PatternSvgExportUtils.#buildSubjectMetadataElement(metadata.keywords),
            `      <dc:coverage>${PatternSvgExportUtils.#escapeXml(metadata.coverage)}</dc:coverage>`,
            `      <dc:description>${PatternSvgExportUtils.#escapeXml(metadata.description)}</dc:description>`,
            PatternSvgExportUtils.#buildAgentMetadataElement('dc:contributor', metadata.contributor),
            '    </cc:Work>',
            '  </rdf:RDF>',
            '</metadata>'
        ].join('\n')
    }

    /**
     * Builds one metadata element that wraps text in a CC agent block.
     * @param {string} tagName
     * @param {string} value
     * @returns {string}
     */
    static #buildAgentMetadataElement(tagName, value) {
        return `      <${tagName}><cc:Agent><dc:title>${PatternSvgExportUtils.#escapeXml(value)}</dc:title></cc:Agent></${tagName}>`
    }

    /**
     * Builds the metadata subject bag from keyword entries.
     * @param {string[]} keywords
     * @returns {string}
     */
    static #buildSubjectMetadataElement(keywords) {
        if (!keywords.length) {
            return '      <dc:subject><rdf:Bag /></dc:subject>'
        }
        const lines = ['      <dc:subject>', '        <rdf:Bag>']
        keywords.forEach((keyword) => {
            lines.push(`          <rdf:li>${PatternSvgExportUtils.#escapeXml(keyword)}</rdf:li>`)
        })
        lines.push('        </rdf:Bag>', '      </dc:subject>')
        return lines.join('\n')
    }

    /**
     * Normalizes metadata text fields.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeMetadataText(value) {
        return String(value || '').trim()
    }

    /**
     * Normalizes metadata list values from arrays or comma-separated strings.
     * @param {unknown} value
     * @returns {string[]}
     */
    static #normalizeMetadataList(value) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item || '').trim()).filter(Boolean)
        }
        if (typeof value === 'string') {
            return value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
        }
        return []
    }

    /**
     * Builds fill paths grouped by source geometry.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>} strokes
     * @param {string[]} palette
     * @param {number} width
     * @param {number} height
     * @returns {string[]}
     */
    static #buildFillElements(strokes, palette, width, height) {
        const groupedFills = new Map()
        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
            if (typeof stroke.fillGroupId !== 'number') return
            const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
            const fillAlpha = Number.isFinite(stroke.fillAlpha) ? Math.max(0, Math.min(1, Number(stroke.fillAlpha))) : 0.16
            const fillRule = stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
            const key = `${stroke.fillGroupId}|${fillAlpha}|${fillRule}|${color}`
            const list = groupedFills.get(key) || []
            list.push(stroke)
            groupedFills.set(key, list)
        })

        const output = []
        groupedFills.forEach((groupStrokes, key) => {
            const [_, alphaPart, fillRulePart, ...colorParts] = key.split('|')
            const fillAlpha = Number(alphaPart)
            const fillRule = fillRulePart === 'evenodd' ? 'evenodd' : 'nonzero'
            const color = String(colorParts.join('|') || '#8b1f1a')
            const paths = []
            groupStrokes.forEach((stroke) => {
                paths.push(...PatternSvgExportUtils.#buildWrappedPathData(stroke.points, width, height, true))
            })
            if (!paths.length) return
            output.push(
                `<path d="${PatternSvgExportUtils.#escapeXml(paths.join(' '))}" fill="${PatternSvgExportUtils.#escapeXml(color)}" fill-opacity="${PatternSvgExportUtils.#formatNumber(fillAlpha)}" fill-rule="${fillRule}" />`
            )
        })

        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
            if (!stroke.closed) return
            if (typeof stroke.fillGroupId === 'number') return
            const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
            const fillAlpha = Number.isFinite(stroke.fillAlpha) ? Math.max(0, Math.min(1, Number(stroke.fillAlpha))) : 0.16
            const fillRule = stroke.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
            const paths = PatternSvgExportUtils.#buildWrappedPathData(stroke.points, width, height, true)
            if (!paths.length) return
            output.push(
                `<path d="${PatternSvgExportUtils.#escapeXml(paths.join(' '))}" fill="${PatternSvgExportUtils.#escapeXml(color)}" fill-opacity="${PatternSvgExportUtils.#formatNumber(fillAlpha)}" fill-rule="${fillRule}" />`
            )
        })

        return output
    }

    /**
     * Builds stroke paths for all visible lines.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd', horizontalRingGroup?: string, motifGroup?: string }>} strokes
     * @param {string[]} palette
     * @param {number} width
     * @param {number} height
     * @param {number} lineWidth
     * @returns {string[]}
     */
    static #buildStrokeElements(strokes, palette, width, height, lineWidth) {
        const ungroupedPaths = []
        const horizontalRingGroups = new Map()
        const motifGroups = new Map()
        strokes.forEach((stroke) => {
            if (!Array.isArray(stroke?.points) || stroke.points.length < 2) return
            const color = String(palette[stroke.colorIndex % Math.max(1, palette.length)] || '#8b1f1a')
            const segments = PatternSvgExportUtils.#buildWrappedPathData(stroke.points, width, height, Boolean(stroke.closed))
            const horizontalRingGroupKey = PatternSvgExportUtils.#resolveOrnamentGroupKey(stroke.horizontalRingGroup)
            const motifGroupKey = PatternSvgExportUtils.#resolveOrnamentGroupKey(stroke.motifGroup)
            segments.forEach((pathData) => {
                const pathElement = PatternSvgExportUtils.#buildStrokePathElement(pathData, color, lineWidth)
                if (horizontalRingGroupKey) {
                    const list = horizontalRingGroups.get(horizontalRingGroupKey) || []
                    list.push(pathElement)
                    horizontalRingGroups.set(horizontalRingGroupKey, list)
                    return
                }
                if (motifGroupKey) {
                    const list = motifGroups.get(motifGroupKey) || []
                    list.push(pathElement)
                    motifGroups.set(motifGroupKey, list)
                    return
                }
                ungroupedPaths.push(pathElement)
            })
        })

        const groupedBlocks = []
        if (horizontalRingGroups.size) {
            groupedBlocks.push(PatternSvgExportUtils.#buildGroupBlock(horizontalRingGroups, 'horizontal-lines-rings', 'horizontal-lines-'))
        }
        if (motifGroups.size) {
            groupedBlocks.push(PatternSvgExportUtils.#buildGroupBlock(motifGroups, 'ornaments-by-motif', 'ornament-'))
        }
        if (ungroupedPaths.length) {
            groupedBlocks.push(`<g id="ungrouped-strokes">\n${ungroupedPaths.join('\n')}\n</g>`)
        }

        return groupedBlocks
    }

    /**
     * Builds one grouped block with fixed ornament subgroup order.
     * @param {Map<string, string[]>} groups
     * @param {string} rootId
     * @param {string} childPrefix
     * @returns {string}
     */
    static #buildGroupBlock(groups, rootId, childPrefix) {
        const grouped = [`<g id="${rootId}">`]
        PatternSvgExportUtils.#ORNAMENT_GROUPS.forEach((group) => {
            const lines = groups.get(group.key) || []
            grouped.push(
                `<g id="${childPrefix}${group.key}" data-label="${PatternSvgExportUtils.#escapeXml(group.label)}">`
            )
            if (lines.length) {
                grouped.push(lines.join('\n'))
            }
            grouped.push('</g>')
        })
        grouped.push('</g>')
        return grouped.join('\n')
    }

    /**
     * Builds one stroke path element.
     * @param {string} pathData
     * @param {string} color
     * @param {number} lineWidth
     * @returns {string}
     */
    static #buildStrokePathElement(pathData, color, lineWidth) {
        return `<path d="${PatternSvgExportUtils.#escapeXml(pathData)}" stroke="${PatternSvgExportUtils.#escapeXml(color)}" stroke-width="${PatternSvgExportUtils.#formatNumber(lineWidth)}" stroke-linecap="round" stroke-linejoin="round" fill="none" />`
    }

    /**
     * Resolves one supported ornament-group key.
     * @param {unknown} value
     * @returns {string}
     */
    static #resolveOrnamentGroupKey(value) {
        const normalized = String(value || '').trim().toLowerCase()
        const aliases = {
            punkte: 'punkte',
            strahlen: 'strahlen',
            wabe: 'wabe',
            wolfszaehne: 'wolfszaehne',
            'wolfszähne': 'wolfszaehne',
            kiefernzweig: 'kiefernzweig',
            'feder-raute': 'feder-raute',
            'feder/raute': 'feder-raute'
        }
        return aliases[normalized] || ''
    }

    /**
     * Builds seam-safe path data by drawing neighboring wrap copies.
     * @param {Array<{u:number,v:number}>} points
     * @param {number} width
     * @param {number} height
     * @param {boolean} closed
     * @returns {string[]}
     */
    static #buildWrappedPathData(points, width, height, closed) {
        if (!Array.isArray(points) || points.length < 2) return []
        const unwrapped = PatternSvgExportUtils.#unwrapStroke(points)
        const output = []
        for (let shift = -1; shift <= 1; shift += 1) {
            const commands = []
            unwrapped.forEach((point, index) => {
                const x = (point.u + shift) * width
                const y = point.v * height
                const command = index === 0 ? 'M' : 'L'
                commands.push(`${command}${PatternSvgExportUtils.#formatNumber(x)} ${PatternSvgExportUtils.#formatNumber(y)}`)
            })
            if (closed) {
                commands.push('Z')
            }
            output.push(commands.join(' '))
        }
        return output
    }

    /**
     * Converts wrapped U values into a continuous path.
     * @param {Array<{u:number,v:number}>} points
     * @returns {Array<{u:number,v:number}>}
     */
    static #unwrapStroke(points) {
        if (!points.length) return []
        const result = [{ u: Number(points[0].u), v: Number(points[0].v) }]
        for (let index = 1; index < points.length; index += 1) {
            const previous = result[index - 1]
            const current = points[index]
            const options = [Number(current.u) - 1, Number(current.u), Number(current.u) + 1]
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
                v: Number(current.v)
            })
        }
        return result
    }

    /**
     * Formats numeric path values with compact precision.
     * @param {number} value
     * @returns {string}
     */
    static #formatNumber(value) {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) return '0'
        const rounded = Math.round(numeric * 1000) / 1000
        const normalized = rounded.toFixed(3).replace(/\.?0+$/g, '')
        return normalized === '-0' ? '0' : normalized
    }

    /**
     * Escapes XML text values for attributes.
     * @param {string} value
     * @returns {string}
     */
    static #escapeXml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

}
