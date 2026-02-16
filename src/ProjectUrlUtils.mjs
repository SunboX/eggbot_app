/**
 * URL encoding helpers for project sharing.
 */
export class ProjectUrlUtils {
    static #projectParam = 'project'

    /**
     * Returns the query parameter key for embedded project payloads.
     * @returns {string}
     */
    static get PROJECT_PARAM() {
        return ProjectUrlUtils.#projectParam
    }

    /**
     * Converts bytes to base64url text.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    static #toBase64Url(bytes) {
        let base64 = ''
        if (typeof btoa === 'function') {
            let binary = ''
            const chunkSize = 0x8000
            for (let index = 0; index < bytes.length; index += chunkSize) {
                const chunk = bytes.subarray(index, index + chunkSize)
                binary += String.fromCharCode(...chunk)
            }
            base64 = btoa(binary)
        } else {
            base64 = Buffer.from(bytes).toString('base64')
        }
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }

    /**
     * Converts base64url text to bytes.
     * @param {string} value
     * @returns {Uint8Array}
     */
    static #fromBase64Url(value) {
        const normalized = String(value || '')
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
        const fullValue = normalized + padding

        if (typeof atob === 'function') {
            const binary = atob(fullValue)
            const bytes = new Uint8Array(binary.length)
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index)
            }
            return bytes
        }

        return Uint8Array.from(Buffer.from(fullValue, 'base64'))
    }

    /**
     * Encodes a project payload for URL transport.
     * @param {Record<string, any>} payload
     * @returns {string}
     */
    static encodeProjectPayloadParam(payload) {
        const jsonText = JSON.stringify(payload)
        const bytes = new TextEncoder().encode(jsonText)
        return ProjectUrlUtils.#toBase64Url(bytes)
    }

    /**
     * Decodes a base64url project parameter.
     * @param {string} paramValue
     * @returns {Record<string, any>}
     */
    static decodeEmbeddedProjectParam(paramValue) {
        const bytes = ProjectUrlUtils.#fromBase64Url(paramValue)
        const jsonText = new TextDecoder().decode(bytes)
        return JSON.parse(jsonText)
    }

    /**
     * Resolves project source from URL query parameters.
     * @param {URLSearchParams} searchParams
     * @returns {{ kind: 'embedded' | null, value: string | null }}
     */
    static resolveProjectSource(searchParams) {
        const embedded = searchParams.get(ProjectUrlUtils.PROJECT_PARAM)
        if (embedded) {
            return {
                kind: 'embedded',
                value: embedded
            }
        }
        return {
            kind: null,
            value: null
        }
    }
}
