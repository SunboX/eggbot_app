/**
 * Browser-environment helpers for BLE troubleshooting hints.
 */
export class BleLinuxChromiumHints {
    /**
     * Returns true when BLE troubleshooting hint should be shown.
     * @param {{ transportKind?: unknown, userAgent?: unknown, brands?: Array<{ brand?: unknown }> | null | undefined }} [context]
     * @returns {boolean}
     */
    static shouldShowBleTroubleshooting(context = {}) {
        const transportKind = String(context?.transportKind || '')
            .trim()
            .toLowerCase()
        if (transportKind !== 'ble') {
            return false
        }

        const userAgent = String(context?.userAgent || '')
        if (!BleLinuxChromiumHints.#isLinuxDesktopUserAgent(userAgent)) {
            return false
        }

        return BleLinuxChromiumHints.#isChromiumUserAgent(userAgent, context?.brands)
    }

    /**
     * Returns true when user agent looks like desktop Linux.
     * @param {string} userAgent
     * @returns {boolean}
     */
    static #isLinuxDesktopUserAgent(userAgent) {
        const normalized = String(userAgent || '').toLowerCase()
        if (!normalized.includes('linux')) {
            return false
        }
        if (normalized.includes('android')) {
            return false
        }
        return true
    }

    /**
     * Returns true when browser looks Chromium-based.
     * @param {string} userAgent
     * @param {Array<{ brand?: unknown }> | null | undefined} brands
     * @returns {boolean}
     */
    static #isChromiumUserAgent(userAgent, brands) {
        const normalizedUserAgent = String(userAgent || '').toLowerCase()
        if (normalizedUserAgent.includes('firefox/') || normalizedUserAgent.includes('fxios/')) {
            return false
        }

        const normalizedBrands = BleLinuxChromiumHints.#normalizeBrands(brands)
        if (normalizedBrands.some((brand) => /(chrom|edge|opera|brave|vivaldi)/.test(brand))) {
            return true
        }

        return /(chromium|chrome|crios|edg|opr|brave|vivaldi)\//.test(normalizedUserAgent)
    }

    /**
     * Normalizes userAgentData brand names.
     * @param {Array<{ brand?: unknown }> | null | undefined} brands
     * @returns {string[]}
     */
    static #normalizeBrands(brands) {
        if (!Array.isArray(brands)) {
            return []
        }
        return brands
            .map((entry) => String(entry?.brand || '').trim().toLowerCase())
            .filter((brand) => brand.length > 0)
    }
}
