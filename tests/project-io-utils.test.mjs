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
    assert.equal(normalized.importHeightScale, 1)
    assert.equal(normalized.ornamentSize, 1)
    assert.equal(normalized.ornamentCount, 1)
    assert.equal(normalized.ornamentDistribution, 1)
    assert.equal(typeof normalized.fillPatterns, 'boolean')
    assert.equal(typeof normalized.drawConfig.connectionTransport, 'string')
    assert.equal(typeof normalized.drawConfig.baudRate, 'number')
    assert.equal(normalized.drawConfig.baudRate, 115200)
    assert.equal(typeof normalized.drawConfig.wifiHost, 'string')
    assert.equal(typeof normalized.drawConfig.wifiPort, 'number')
    assert.equal(typeof normalized.drawConfig.wifiSecure, 'boolean')
    assert.equal(typeof normalized.drawConfig.stepsPerTurn, 'number')
    assert.equal(typeof normalized.drawConfig.penDownSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.penMotorSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.eggMotorSpeed, 'number')
    assert.equal(typeof normalized.drawConfig.penUpPercent, 'number')
    assert.equal(typeof normalized.drawConfig.wrapAround, 'boolean')
    assert.equal(typeof normalized.drawConfig.printColorMode, 'string')
    assert.equal(typeof normalized.drawConfig.inkscapeSvgCompatMode, 'boolean')
})

test('Default drawing palette should not include white by default', () => {
    const defaults = AppRuntimeConfig.createDefaultState()
    const normalizedHex = defaults.palette.map((value) => String(value).trim().toLowerCase())

    assert.equal(defaults.drawConfig.connectionTransport, 'serial')
    assert.equal(defaults.drawConfig.baudRate, 115200)
    assert.equal(defaults.drawConfig.wifiPort, 1337)
    assert.equal(defaults.drawConfig.reversePenMotor, true)
    assert.equal(defaults.drawConfig.reverseEggMotor, true)
    assert.equal(defaults.drawConfig.penDownSpeed, 300)
    assert.equal(defaults.drawConfig.penUpSpeed, 400)
    assert.equal(defaults.drawConfig.returnHome, true)
    assert.equal(defaults.drawConfig.inkscapeSvgCompatMode, false)
    assert.equal(normalizedHex.includes('#ffffff'), false)
    assert.equal(normalizedHex.includes('#fff'), false)
    assert.equal(normalizedHex.includes('#f3f0e7'), false)
})

test('ProjectIoUtils should stamp project payload with app version', () => {
    const payload = ProjectIoUtils.buildProjectPayload(AppRuntimeConfig.createDefaultState())

    assert.equal(payload.version, AppVersion.get())
    assert.equal(payload.schemaVersion, 2)
})

test('ProjectIoUtils should clamp extended EggBot control payload fields', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        fillPatterns: false,
        drawConfig: {
            connectionTransport: 'unsupported',
            penUpPercent: 999,
            penDownPercent: -10,
            wifiPort: 999999,
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
            inkscapeSvgCompatMode: 'true',
            activeControlTab: 'manual'
        }
    })

    assert.equal(normalized.drawConfig.connectionTransport, 'serial')
    assert.equal(normalized.drawConfig.wifiPort, 65535)
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
    assert.equal(normalized.drawConfig.printColorMode, 'per-color')
    assert.equal(normalized.drawConfig.inkscapeSvgCompatMode, true)
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

test('ProjectIoUtils should keep single print mode when provided', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        drawConfig: {
            printColorMode: 'single'
        }
    })

    assert.equal(normalized.drawConfig.printColorMode, 'single')
})

test('ProjectIoUtils should reject Wi-Fi transport while preserving Wi-Fi fields', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        drawConfig: {
            connectionTransport: 'wifi',
            wifiHost: '192.168.1.42',
            wifiPort: 1337,
            wifiSecure: true
        }
    })

    assert.equal(normalized.drawConfig.connectionTransport, 'serial')
    assert.equal(normalized.drawConfig.wifiHost, '192.168.1.42')
    assert.equal(normalized.drawConfig.wifiPort, 1337)
    assert.equal(normalized.drawConfig.wifiSecure, true)
})

test('ProjectIoUtils should persist and normalize resume checkpoints in schema v2', () => {
    const payload = ProjectIoUtils.buildProjectPayload({
        ...AppRuntimeConfig.createDefaultState(),
        resumeState: {
            status: 'paused',
            updatedAt: '2026-02-28T12:00:00.000Z',
            totalStrokes: 3,
            completedStrokes: 1,
            nextBatchIndex: 0,
            nextStrokeIndex: 1,
            coordinateMode: 'document-px-centered',
            documentWidthPx: 1209.448,
            documentHeightPx: 377.952,
            stepScalingFactor: 2,
            drawBatches: [
                {
                    colorIndex: 0,
                    strokes: [
                        {
                            points: [
                                { u: 0.1, v: 0.2 },
                                { u: 0.3, v: 0.4 }
                            ]
                        },
                        {
                            points: [
                                { u: 0.5, v: 0.6 },
                                { u: 0.7, v: 0.8 }
                            ]
                        }
                    ]
                }
            ]
        }
    })

    assert.equal(payload.schemaVersion, 2)
    assert.equal(payload.resumeState?.status, 'paused')
    assert.equal(payload.resumeState?.totalStrokes, 2)
    assert.equal(payload.resumeState?.completedStrokes, 1)
    assert.equal(payload.resumeState?.coordinateMode, 'document-px-centered')

    const normalized = ProjectIoUtils.normalizeProjectState(payload)
    assert.equal(normalized.resumeState?.status, 'paused')
    assert.equal(Array.isArray(normalized.resumeState?.drawBatches), true)
    assert.equal(normalized.resumeState?.drawBatches?.length, 1)
})

test('ProjectIoUtils should normalize stale running resume state to paused', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        resumeState: {
            status: 'running',
            updatedAt: '2026-02-28T12:00:00.000Z',
            totalStrokes: 2,
            completedStrokes: 1,
            nextBatchIndex: 0,
            nextStrokeIndex: 1,
            drawBatches: [
                {
                    colorIndex: 0,
                    strokes: [
                        {
                            points: [
                                { u: 0.1, v: 0.2 },
                                { u: 0.2, v: 0.3 }
                            ]
                        },
                        {
                            points: [
                                { u: 0.3, v: 0.4 },
                                { u: 0.4, v: 0.5 }
                            ]
                        }
                    ]
                }
            ]
        }
    })

    assert.equal(normalized.resumeState?.status, 'paused')
})
