import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectIoUtils } from '../src/ProjectIoUtils.mjs'
import { AppRuntimeConfig } from '../src/AppRuntimeConfig.mjs'
import { AppVersion } from '../src/AppVersion.mjs'

test('ProjectIoUtils should normalize partial raw project payload', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        projectName: 'Partial',
        seed: 42,
        motifs: {
            dots: true,
            rays: false,
            honeycomb: false,
            wolfTeeth: false,
            pineBranch: false,
            diamonds: false
        }
    })

    assert.equal(normalized.projectName, 'Partial')
    assert.equal(normalized.seed, 42)
    assert.equal(Array.isArray(normalized.palette), true)
    assert.ok(normalized.palette.length >= 1)
    assert.equal(normalized.importHeightScale, 0.85)
    assert.equal(normalized.ornamentSize, 1)
    assert.equal(normalized.ornamentCount, 1)
    assert.equal(normalized.ornamentDistribution, 1)
    assert.equal(typeof normalized.drawConfig.stepsPerTurn, 'number')
})

test('Default drawing palette should not include white by default', () => {
    const defaults = AppRuntimeConfig.createDefaultState()
    const normalizedHex = defaults.palette.map((value) => String(value).trim().toLowerCase())

    assert.equal(normalizedHex.includes('#ffffff'), false)
    assert.equal(normalizedHex.includes('#fff'), false)
    assert.equal(normalizedHex.includes('#f3f0e7'), false)
})

test('ProjectIoUtils should stamp project payload with app version', () => {
    const payload = ProjectIoUtils.buildProjectPayload(AppRuntimeConfig.createDefaultState())

    assert.equal(payload.version, AppVersion.get())
    assert.equal(payload.schemaVersion, 1)
})
