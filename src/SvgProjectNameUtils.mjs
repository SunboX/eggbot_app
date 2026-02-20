/**
 * Helpers for deriving a project name from imported SVG content.
 */
export class SvgProjectNameUtils {
    /**
     * Resolves a project name from SVG metadata or falls back to the file name.
     * @param {unknown} svgText
     * @param {unknown} fileName
     * @returns {string}
     */
    static resolveProjectName(svgText, fileName) {
        const metadataTitle = SvgProjectNameUtils.#extractMetadataTitle(String(svgText || ''))
        if (metadataTitle) {
            return metadataTitle
        }
        return SvgProjectNameUtils.#buildNameFromFileName(fileName)
    }

    /**
     * Extracts title-like metadata from SVG markup.
     * @param {string} svgText
     * @returns {string}
     */
    static #extractMetadataTitle(svgText) {
        const normalizedSvgText = String(svgText || '')
        if (!normalizedSvgText.trim()) return ''
        if (typeof DOMParser !== 'function') return ''

        try {
            const parser = new DOMParser()
            const xml = parser.parseFromString(normalizedSvgText, 'image/svg+xml')
            if (SvgProjectNameUtils.#hasParserError(xml)) return ''

            const svg = SvgProjectNameUtils.#resolveRootSvg(xml)
            if (!svg) return ''

            return (
                SvgProjectNameUtils.#resolveWorkMetadataTitle(svg) ||
                SvgProjectNameUtils.#resolveGenericMetadataTitle(svg) ||
                SvgProjectNameUtils.#resolveSvgTitle(svg) ||
                SvgProjectNameUtils.#resolveDocNameTitle(svg)
            )
        } catch (_error) {
            return ''
        }
    }

    /**
     * Detects parser errors in one parsed SVG document.
     * @param {Document} xml
     * @returns {boolean}
     */
    static #hasParserError(xml) {
        if (!xml || typeof xml.querySelectorAll !== 'function') return true
        if (xml.querySelector('parsererror')) return true
        return SvgProjectNameUtils.#getLocalName(xml.documentElement) === 'parsererror'
    }

    /**
     * Resolves the first root SVG element from a parsed document.
     * @param {Document} xml
     * @returns {Element | null}
     */
    static #resolveRootSvg(xml) {
        if (!xml) return null
        const documentElement = xml.documentElement
        if (SvgProjectNameUtils.#getLocalName(documentElement) === 'svg') {
            return documentElement
        }
        const svgNodes = SvgProjectNameUtils.#findDescendantsByLocalName(xml, 'svg')
        return svgNodes[0] || null
    }

    /**
     * Resolves the preferred metadata title from `cc:Work > dc:title`.
     * @param {Element} svg
     * @returns {string}
     */
    static #resolveWorkMetadataTitle(svg) {
        const metadataNodes = SvgProjectNameUtils.#findDescendantsByLocalName(svg, 'metadata')
        for (const metadataNode of metadataNodes) {
            const workNodes = SvgProjectNameUtils.#findDescendantsByLocalName(metadataNode, 'work')
            for (const workNode of workNodes) {
                const workTitle = SvgProjectNameUtils.#findFirstDescendantTextByLocalName(workNode, 'title')
                if (workTitle) {
                    return workTitle
                }
            }
        }
        return ''
    }

    /**
     * Resolves a generic metadata title while skipping creator/agent titles.
     * @param {Element} svg
     * @returns {string}
     */
    static #resolveGenericMetadataTitle(svg) {
        const metadataNodes = SvgProjectNameUtils.#findDescendantsByLocalName(svg, 'metadata')
        for (const metadataNode of metadataNodes) {
            const titleNodes = SvgProjectNameUtils.#findDescendantsByLocalName(metadataNode, 'title')
            for (const titleNode of titleNodes) {
                if (SvgProjectNameUtils.#hasAncestorWithLocalName(titleNode, 'agent', metadataNode)) {
                    continue
                }
                const title = SvgProjectNameUtils.#normalizeTitle(titleNode.textContent)
                if (title) {
                    return title
                }
            }
        }
        return ''
    }

    /**
     * Resolves a plain `<svg><title>…</title></svg>` title.
     * @param {Element} svg
     * @returns {string}
     */
    static #resolveSvgTitle(svg) {
        const directChildren = Array.from(svg?.children || [])
        for (const child of directChildren) {
            if (SvgProjectNameUtils.#getLocalName(child) !== 'title') continue
            const title = SvgProjectNameUtils.#normalizeTitle(child.textContent)
            if (title) {
                return title
            }
        }
        return ''
    }

    /**
     * Resolves one optional document name attribute used by editors like Inkscape.
     * @param {Element} svg
     * @returns {string}
     */
    static #resolveDocNameTitle(svg) {
        const docName = SvgProjectNameUtils.#readAttributeByLocalName(svg, 'docname')
        if (!docName) return ''
        return SvgProjectNameUtils.#normalizeTitle(SvgProjectNameUtils.#stripFileExtension(docName))
    }

    /**
     * Returns the first descendant text for a local-name match.
     * @param {ParentNode | Element} root
     * @param {string} localName
     * @returns {string}
     */
    static #findFirstDescendantTextByLocalName(root, localName) {
        const candidates = SvgProjectNameUtils.#findDescendantsByLocalName(root, localName)
        for (const candidate of candidates) {
            const text = SvgProjectNameUtils.#normalizeTitle(candidate.textContent)
            if (text) {
                return text
            }
        }
        return ''
    }

    /**
     * Finds descendant nodes with one matching local name.
     * @param {ParentNode | Element} root
     * @param {string} localName
     * @returns {Element[]}
     */
    static #findDescendantsByLocalName(root, localName) {
        if (!root || typeof root.querySelectorAll !== 'function') return []
        const targetName = String(localName || '').trim().toLowerCase()
        if (!targetName) return []
        return Array.from(root.querySelectorAll('*')).filter((node) => SvgProjectNameUtils.#getLocalName(node) === targetName)
    }

    /**
     * Checks whether one node has an ancestor with a matching local name.
     * @param {Element} node
     * @param {string} localName
     * @param {Element} stopNode
     * @returns {boolean}
     */
    static #hasAncestorWithLocalName(node, localName, stopNode) {
        const targetName = String(localName || '').trim().toLowerCase()
        let cursor = node?.parentNode || null
        while (cursor && cursor !== stopNode) {
            if (cursor.nodeType === 1 && SvgProjectNameUtils.#getLocalName(cursor) === targetName) {
                return true
            }
            cursor = cursor.parentNode
        }
        return false
    }

    /**
     * Reads one namespaced attribute by local name.
     * @param {Element} node
     * @param {string} localName
     * @returns {string}
     */
    static #readAttributeByLocalName(node, localName) {
        if (!node?.attributes) return ''
        const targetName = String(localName || '').trim().toLowerCase()
        const attributes = Array.from(node.attributes)
        for (const attribute of attributes) {
            const attributeLocalName = SvgProjectNameUtils.#normalizeNodeName(attribute?.localName || attribute?.name)
            if (attributeLocalName !== targetName) continue
            return String(attribute.value || '')
        }
        return ''
    }

    /**
     * Builds one readable title from a file name by replacing separators.
     * @param {unknown} fileName
     * @returns {string}
     */
    static #buildNameFromFileName(fileName) {
        const baseName = SvgProjectNameUtils.#resolveBaseFileName(fileName)
        if (!baseName) return ''
        const withoutExtension = SvgProjectNameUtils.#stripFileExtension(baseName)
        const spaced = withoutExtension.replace(/[-_]+/g, ' ')
        return SvgProjectNameUtils.#normalizeTitle(spaced)
    }

    /**
     * Resolves one filename stem from optional path-like file names.
     * @param {unknown} fileName
     * @returns {string}
     */
    static #resolveBaseFileName(fileName) {
        const raw = String(fileName || '').trim()
        if (!raw) return ''
        const withoutHashOrQuery = raw.split(/[?#]/)[0]
        const segments = withoutHashOrQuery.split(/[\\/]/)
        const base = String(segments[segments.length - 1] || '').trim()
        if (!base) return ''
        try {
            return decodeURIComponent(base)
        } catch (_error) {
            return base
        }
    }

    /**
     * Removes one trailing extension from a file-like string.
     * @param {string} value
     * @returns {string}
     */
    static #stripFileExtension(value) {
        const normalized = String(value || '').trim()
        if (/^\.[^.]+$/.test(normalized)) {
            return normalized
        }
        return normalized.replace(/\.[^.]+$/, '')
    }

    /**
     * Normalizes text to single-space-separated titles.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeTitle(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
    }

    /**
     * Resolves the normalized local-name for nodes and attributes.
     * @param {any} node
     * @returns {string}
     */
    static #getLocalName(node) {
        return SvgProjectNameUtils.#normalizeNodeName(node?.localName || node?.nodeName)
    }

    /**
     * Normalizes node names to lowercase local-name form without prefixes.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeNodeName(value) {
        const normalized = String(value || '').trim().toLowerCase()
        if (!normalized) return ''
        return normalized.includes(':') ? normalized.split(':').pop() || '' : normalized
    }
}
