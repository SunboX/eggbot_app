/**
 * Filename helpers for project saves and exports.
 */
export class ProjectFilenameUtils {
    /**
     * Builds a deterministic file stem from project name.
     * @param {unknown} projectName
     * @param {unknown} fallbackStem
     * @returns {string}
     */
    static buildFileStem(projectName, fallbackStem) {
        return ProjectFilenameUtils.#toStem(projectName, fallbackStem)
    }

    /**
     * Builds a deterministic filename from project name and extension.
     * @param {unknown} projectName
     * @param {unknown} fallbackStem
     * @param {unknown} extension
     * @returns {string}
     */
    static buildFileName(projectName, fallbackStem, extension) {
        const stem = ProjectFilenameUtils.buildFileStem(projectName, fallbackStem)
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
     * Normalizes file extensions and strips a leading dot if present.
     * @param {unknown} value
     * @returns {string}
     */
    static #toExtension(value) {
        const normalized = String(value || '').trim().toLowerCase().replace(/^\.+/, '')
        return normalized || 'txt'
    }
}
