import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Imports one isolated AppVersion module instance.
 * @returns {Promise<{ AppVersion: { get: () => string, loadFromPackageJson: (options?: { packageJsonUrl?: string, fetchImpl?: Function }) => Promise<string> } }>}
 */
async function importIsolatedAppVersionModule() {
    const token = `${Date.now()}-${Math.random()}`
    return import(`../src/AppVersion.mjs?testCase=${encodeURIComponent(token)}`)
}

test('AppVersion.loadFromPackageJson should update current version from fetched package payload', async () => {
    const { AppVersion } = await importIsolatedAppVersionModule()
    const fetchCalls = []

    const loadedVersion = await AppVersion.loadFromPackageJson({
        fetchImpl: async (...args) => {
            fetchCalls.push(args)
            return {
                ok: true,
                async json() {
                    return { version: '9.8.7' }
                }
            }
        }
    })

    assert.equal(fetchCalls.length, 1)
    assert.equal(loadedVersion, '9.8.7')
    assert.equal(AppVersion.get(), '9.8.7')
})

test('AppVersion.loadFromPackageJson should keep current version when package payload is invalid', async () => {
    const { AppVersion } = await importIsolatedAppVersionModule()
    const initialVersion = AppVersion.get()

    const loadedVersion = await AppVersion.loadFromPackageJson({
        fetchImpl: async () => ({
            ok: true,
            async json() {
                return { version: '' }
            }
        })
    })

    assert.equal(loadedVersion, initialVersion)
    assert.equal(AppVersion.get(), initialVersion)
})
