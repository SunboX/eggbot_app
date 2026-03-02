const APP_VERSION_FALLBACK = '0.0.0'
const PACKAGE_JSON_DEFAULT_URL = '/package.json'

/**
 * Runtime application version resolved from deployed package.json.
 */
export class AppVersion {
    static #current = APP_VERSION_FALLBACK
    static #loadPromise = null

    /**
     * Returns current application version.
     * @returns {string}
     */
    static get() {
        return AppVersion.#current
    }

    /**
     * Loads and caches one version from deployed package.json.
     * @param {{ packageJsonUrl?: string, fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok?: boolean, json?: () => Promise<any> }> }} [options]
     * @returns {Promise<string>}
     */
    static async loadFromPackageJson(options = {}) {
        if (AppVersion.#loadPromise) {
            return AppVersion.#loadPromise
        }

        const fetchImpl = AppVersion.#resolveFetchImpl(options.fetchImpl)
        if (!fetchImpl) {
            return AppVersion.#current
        }

        const packageJsonUrl = AppVersion.#resolvePackageJsonUrl(options.packageJsonUrl)
        AppVersion.#loadPromise = AppVersion.#readVersionFromPackageJson(packageJsonUrl, fetchImpl)
        return AppVersion.#loadPromise
    }

    /**
     * Resolves package.json URL with fallback.
     * @param {string | undefined} packageJsonUrl
     * @returns {string}
     */
    static #resolvePackageJsonUrl(packageJsonUrl) {
        const normalized = String(packageJsonUrl || '').trim()
        return normalized || PACKAGE_JSON_DEFAULT_URL
    }

    /**
     * Resolves fetch implementation with fallback.
     * @param {unknown} fetchImpl
     * @returns {null | ((input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok?: boolean, json?: () => Promise<any> }>)}
     */
    static #resolveFetchImpl(fetchImpl) {
        if (typeof fetchImpl === 'function') {
            return fetchImpl
        }
        if (typeof globalThis.fetch === 'function') {
            return globalThis.fetch.bind(globalThis)
        }
        return null
    }

    /**
     * Fetches package.json and updates current version when valid.
     * @param {string} packageJsonUrl
     * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok?: boolean, json?: () => Promise<any> }>} fetchImpl
     * @returns {Promise<string>}
     */
    static async #readVersionFromPackageJson(packageJsonUrl, fetchImpl) {
        try {
            const response = await fetchImpl(packageJsonUrl, { cache: 'no-store' })
            if (!response?.ok || typeof response.json !== 'function') {
                return AppVersion.#current
            }

            const payload = await response.json()
            const nextVersion = AppVersion.#normalizeVersion(payload?.version)
            if (nextVersion) {
                AppVersion.#current = nextVersion
            }
        } catch (_error) {
            // Keep fallback when package version cannot be loaded.
        }

        return AppVersion.#current
    }

    /**
     * Normalizes one version value.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeVersion(value) {
        return String(value || '').trim()
    }
}
