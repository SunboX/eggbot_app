/**
 * Filename helpers for project saves and exports.
 */
export class ProjectFilenameUtils {
    /**
     * Builds a deterministic file stem from project name and seed.
     * @param {unknown} projectName
     * @param {unknown} fallbackStem
     * @param {unknown} seed
     * @returns {string}
     */
    static buildFileStem(projectName, fallbackStem, seed) {
        const stem = ProjectFilenameUtils.#toStem(projectName, fallbackStem)
        const normalizedSeed = ProjectFilenameUtils.#toSeed(seed)
        return `${stem}-seed-${normalizedSeed}`
    }

    /**
     * Builds a deterministic filename from project name, seed, and extension.
     * @param {unknown} projectName
     * @param {unknown} fallbackStem
     * @param {unknown} seed
     * @param {unknown} extension
     * @returns {string}
     */
    static buildFileName(projectName, fallbackStem, seed, extension) {
        const stem = ProjectFilenameUtils.buildFileStem(projectName, fallbackStem, seed)
        const normalizedExtension = ProjectFilenameUtils.#toExtension(extension)
        return `${stem}.${normalizedExtension}`
    }

    /**
     * Normalizes project names to lowercase dash-separated file stems.
     * @param {unknown} value
     * @param {unknown} fallback
     * @returns {string}
     */
    static #toStem(value, fallback) {
        const normalizedValue = String(value || '').trim()
        const normalizedFallback = String(fallback || '').trim() || 'project'
        const source = normalizedValue || normalizedFallback
        return source.replace(/\s+/g, '-').toLowerCase()
    }

    /**
     * Normalizes seed input to an integer.
     * @param {unknown} value
     * @returns {number}
     */
    static #toSeed(value) {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
            return 1
        }
        return Math.trunc(parsed)
    }

    /**
     * Normalizes file extensions and strips a leading dot if present.
     * @param {unknown} value
     * @returns {string}
     */
    static #toExtension(value) {
        const normalized = String(value || '').trim().toLowerCase().replace(/^\.+/, '')
        return normalized || 'txt'
    }
}
