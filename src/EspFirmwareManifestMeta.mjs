const ESP_FIRMWARE_NAME_FALLBACK = 'EggDuino ESP32 Firmware'

/**
 * Helpers for reading one ESP Web Tools manifest metadata summary.
 */
export class EspFirmwareManifestMeta {
    /**
     * Resolves normalized metadata from one raw manifest payload.
     * @param {unknown} manifest
     * @returns {{ name: string, version: string, chipFamily: string } | null}
     */
    static resolve(manifest) {
        const version = EspFirmwareManifestMeta.#normalizeString(manifest?.version)
        if (!version) {
            return null
        }

        const name = EspFirmwareManifestMeta.#normalizeString(manifest?.name) || ESP_FIRMWARE_NAME_FALLBACK
        const chipFamily = EspFirmwareManifestMeta.#normalizeString(manifest?.builds?.[0]?.chipFamily)
        return { name, version, chipFamily }
    }

    /**
     * Formats one metadata object into a compact user-facing label.
     * @param {{ name?: unknown, version?: unknown, chipFamily?: unknown } | null | undefined} meta
     * @returns {string}
     */
    static formatDisplayLabel(meta) {
        const name = EspFirmwareManifestMeta.#normalizeString(meta?.name) || ESP_FIRMWARE_NAME_FALLBACK
        const version = EspFirmwareManifestMeta.#normalizeString(meta?.version)
        if (!version) {
            return ''
        }
        const chipFamily = EspFirmwareManifestMeta.#normalizeString(meta?.chipFamily)
        if (chipFamily) {
            return `${name} v${version} (${chipFamily})`
        }
        return `${name} v${version}`
    }

    /**
     * Normalizes one text-like value.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeString(value) {
        return String(value || '').trim()
    }
}
