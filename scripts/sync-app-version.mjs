import { readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const packageJsonPath = join(projectRoot, 'package.json')
const appVersionModulePath = join(projectRoot, 'src', 'AppVersion.mjs')

/**
 * Escapes a string for a single-quoted JavaScript literal.
 * @param {string} value
 * @returns {string}
 */
function escapeForSingleQuotedLiteral(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
}

/**
 * Builds the source text for `AppVersion.mjs`.
 * @param {string} version
 * @returns {string}
 */
function buildAppVersionModuleSource(version) {
    const escapedVersion = escapeForSingleQuotedLiteral(version)
    return `/**
 * Current application version synced from package.json.
 */
export class AppVersion {
    static #current = '${escapedVersion}'

    /**
     * Returns current application version.
     * @returns {string}
     */
    static get() {
        return AppVersion.#current
    }
}
`
}

/**
 * Synchronizes `src/AppVersion.mjs` with package.json version.
 * @returns {Promise<void>}
 */
async function syncAppVersionModule() {
    const packageJsonRaw = await readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonRaw)
    const version = String(packageJson?.version || '').trim()

    if (!version) {
        throw new Error('Missing `version` in package.json')
    }

    const nextContents = buildAppVersionModuleSource(version)
    let currentContents = ''
    try {
        currentContents = await readFile(appVersionModulePath, 'utf8')
    } catch (_error) {
        currentContents = ''
    }

    if (currentContents !== nextContents) {
        await writeFile(appVersionModulePath, nextContents, 'utf8')
    }
}

syncAppVersionModule().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
