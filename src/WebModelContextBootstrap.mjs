const WEBMCP_QUERY_PARAM = 'webmcp'
const WEBMCP_POLYFILL_SCRIPT_PATH = '/node_modules/@mcp-b/global/dist/index.iife.js'

/**
 * Conditionally enables the WebMCP polyfill fallback in environments that need it.
 */
export class WebModelContextBootstrap {
    static #initializationPromise = null

    /**
     * Returns true when the fallback polyfill should be loaded.
     * @param {{ location?: { hostname?: string, search?: string }, navigator?: Record<string, unknown> }} [environment]
     * @returns {boolean}
     */
    static shouldLoadPolyfill(environment = globalThis) {
        if (this.#hasModelContext(environment?.navigator)) {
            return false
        }

        const explicitSetting = this.#resolveExplicitOptIn(environment?.location?.search)
        if (explicitSetting !== null) {
            return explicitSetting
        }

        return false
    }

    /**
     * Loads and initializes the WebMCP polyfill when the current environment requires it.
     * @param {{ location?: { hostname?: string, search?: string }, navigator?: Record<string, unknown> }} [environment]
     * @returns {Promise<boolean>}
     */
    static async ensure(environment = globalThis) {
        if (!this.shouldLoadPolyfill(environment)) {
            return false
        }

        if (!this.#initializationPromise) {
            this.#initializationPromise = this.#loadPolyfill(environment).catch((error) => {
                this.#initializationPromise = null
                throw error
            })
        }

        await this.#initializationPromise
        return this.#hasModelContext(environment?.navigator)
    }

    /**
     * Loads the self-contained polyfill script and waits for initialization.
     * @param {{ navigator?: Record<string, unknown>, document?: Record<string, unknown>, window?: Record<string, unknown> }} environment
     * @returns {Promise<void>}
     */
    static async #loadPolyfill(environment) {
        if (this.#hasModelContext(environment?.navigator)) {
            return
        }

        const documentValue = environment?.document
        if (!documentValue || typeof documentValue.createElement !== 'function') {
            throw new Error('Document is unavailable for WebMCP polyfill loading.')
        }

        const windowValue =
            environment?.window && typeof environment.window === 'object' ? environment.window : environment
        windowValue.__webModelContextOptions = {
            transport: {
                tabServer: {
                    allowedOrigins: ['*']
                }
            }
        }

        await this.#appendPolyfillScript(documentValue)
    }

    /**
     * Appends the IIFE polyfill script to the current document and waits for it to load.
     * @param {Record<string, unknown>} documentValue
     * @returns {Promise<void>}
     */
    static #appendPolyfillScript(documentValue) {
        const target =
            documentValue.head && typeof documentValue.head.appendChild === 'function'
                ? documentValue.head
                : documentValue.body && typeof documentValue.body.appendChild === 'function'
                  ? documentValue.body
                  : documentValue.documentElement && typeof documentValue.documentElement.appendChild === 'function'
                    ? documentValue.documentElement
                    : null

        if (!target) {
            throw new Error('Document has no valid target for WebMCP polyfill loading.')
        }

        return new Promise((resolve, reject) => {
            const script = documentValue.createElement('script')
            script.async = true
            script.src = WEBMCP_POLYFILL_SCRIPT_PATH
            if (script.dataset && typeof script.dataset === 'object') {
                script.dataset.webmcpPolyfill = 'true'
            }
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('WebMCP polyfill script failed to load.'))
            target.appendChild(script)
        })
    }

    /**
     * Returns true when navigator.modelContext is already present.
     * @param {Record<string, unknown> | undefined} navigatorValue
     * @returns {boolean}
     */
    static #hasModelContext(navigatorValue) {
        return Boolean(navigatorValue && typeof navigatorValue === 'object' && navigatorValue.modelContext)
    }

    /**
     * Resolves one explicit query-string override.
     * @param {string | undefined} search
     * @returns {boolean | null}
     */
    static #resolveExplicitOptIn(search) {
        const normalizedSearch = String(search || '').trim()
        if (!normalizedSearch) {
            return null
        }

        const params = new URLSearchParams(normalizedSearch.startsWith('?') ? normalizedSearch.slice(1) : normalizedSearch)
        const raw = String(params.get(WEBMCP_QUERY_PARAM) || '')
            .trim()
            .toLowerCase()

        if (['1', 'true', 'yes', 'on'].includes(raw)) {
            return true
        }
        if (['0', 'false', 'no', 'off'].includes(raw)) {
            return false
        }

        return null
    }

}
