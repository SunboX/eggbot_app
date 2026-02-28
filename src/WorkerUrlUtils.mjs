import { AppVersion } from './AppVersion.mjs'

/**
 * Helper for cache-busted worker module URLs.
 */
export class WorkerUrlUtils {
    /**
     * Builds a versioned worker URL to avoid stale browser worker caches.
     * @param {string} relativeWorkerPath
     * @param {string} baseUrl
     * @returns {URL}
     */
    static resolveVersionedWorkerUrl(relativeWorkerPath, baseUrl) {
        const url = new URL(relativeWorkerPath, baseUrl)
        url.searchParams.set('v', WorkerUrlUtils.#resolveAppVersionToken())
        return url
    }

    /**
     * Resolves one stable version token.
     * @returns {string}
     */
    static #resolveAppVersionToken() {
        const version = String(AppVersion.get() || '').trim()
        return version || '0'
    }
}
