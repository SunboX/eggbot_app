/**
 * Current application version synced from package.json.
 */
export class AppVersion {
    static #current = '1.3.62'

    /**
     * Returns current application version.
     * @returns {string}
     */
    static get() {
        return AppVersion.#current
    }
}
