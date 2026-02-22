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
    assert.equal(typeof normalized.fillPatterns, 'boolean')
    assert.equal(typeof normalized.drawConfig.baudRate, 'number')
    assert.equal(typeof normalized.drawConfig.stepsPerTurn, 'number')
    assert.equal(typeof normalized.drawConfig.penDownSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.penMotorSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.eggMotorSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.penUpPercent, 'number')
    assert.equal(typeof normalized.drawConfig.wrapAround, 'boolean')
    assert.equal(typeof normalized.drawConfig.printColorMode, 'string')
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

test('ProjectIoUtils should clamp extended EggBot control payload fields', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        fillPatterns: false,
        drawConfig: {
            penUpPercent: 999,
            penDownPercent: -10,
            penDownSpeed: 9000,
            penUpSpeed: -40,
            penMotorSpeed: 99999,
            eggMotorSpeed: -5,
            penRaiseRate: 500,
            penRaiseDelayMs: -2,
            penLowerRate: 0,
            penLowerDelayMs: 999999,
            curveSmoothing: 8,
            manualWalkDistance: 999999,
            printColorMode: 'unsupported',
            activeControlTab: 'manual'
        }
    })

    assert.equal(normalized.drawConfig.penUpPercent, 100)
    assert.equal(normalized.drawConfig.penDownPercent, 0)
    assert.equal(normalized.drawConfig.penDownSpeed, 4000)
    assert.equal(normalized.drawConfig.penUpSpeed, 10)
    assert.equal(normalized.drawConfig.penMotorSpeed, 4000)
    assert.equal(normalized.drawConfig.eggMotorSpeed, 10)
    assert.equal(normalized.drawConfig.penRaiseRate, 100)
    assert.equal(normalized.drawConfig.penRaiseDelayMs, 0)
    assert.equal(normalized.drawConfig.penLowerRate, 1)
    assert.equal(normalized.drawConfig.penLowerDelayMs, 5000)
    assert.equal(normalized.drawConfig.curveSmoothing, 2)
    assert.equal(normalized.drawConfig.manualWalkDistance, 64000)
    assert.equal(normalized.drawConfig.printColorMode, 'single')
    assert.equal(normalized.drawConfig.activeControlTab, 'manual')
    assert.equal(normalized.fillPatterns, false)
})

test('ProjectIoUtils should keep per-color print mode when provided', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        drawConfig: {
            printColorMode: 'per-color'
        }
    })

    assert.equal(normalized.drawConfig.printColorMode, 'per-color')
})
