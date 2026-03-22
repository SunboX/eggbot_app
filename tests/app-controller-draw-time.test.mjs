import assert from 'node:assert/strict'
import test from 'node:test'
import { AppControllerRender } from '../src/AppControllerRender.mjs'
import { AppControllerRuntime } from '../src/AppControllerRuntime.mjs'
import { DrawTimeProfileUtils } from '../src/DrawTimeProfileUtils.mjs'

/**
 * Creates one minimal localStorage mock.
 * @returns {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }}
 */
function createLocalStorageMock() {
    const data = new Map()

    return {
        getItem(key) {
            return data.has(key) ? data.get(key) : null
        },
        setItem(key, value) {
            data.set(key, String(value))
        },
        removeItem(key) {
            data.delete(key)
        }
    }
}

test('AppControllerRuntime should persist updated draw-time profile measurements', () => {
    const originalWindow = globalThis.window
    const localStorage = createLocalStorageMock()
    globalThis.window = {
        localStorage
    }

    const runtime = {
        drawTimeProfile: DrawTimeProfileUtils.createDefaultProfile(),
        refreshCount: 0,
        _persistDrawTimeProfileToLocalStorage() {
            return AppControllerRuntime.prototype._persistDrawTimeProfileToLocalStorage.call(this)
        },
        _scheduleDrawTimeEstimateRefresh() {
            this.refreshCount += 1
        }
    }

    try {
        AppControllerRuntime.prototype._updateDrawTimeProfileFromStrokeMeasurement.call(runtime, {
            actualDurationMs: 3000,
            estimatedDurationMs: 2000,
            updatedAt: '2026-03-16T10:00:00.000Z'
        })

        const persisted = JSON.parse(localStorage.getItem('eggbot.drawTimeProfile.v1') || '{}')
        assert.equal(runtime.drawTimeProfile.strokeSampleCount, 1)
        assert.equal(runtime.drawTimeProfile.durationScale, 1.5)
        assert.equal(persisted.strokeSampleCount, 1)
        assert.equal(persisted.durationScale, 1.5)
        assert.equal(runtime.refreshCount, 1)
    } finally {
        globalThis.window = originalWindow
    }
})

test('AppControllerRender should compute one visible draw-time estimate from current strokes and profile', async () => {
    const controller = {
        pendingGeneratedRenderPromise: null,
        state: {
            strokes: [
                {
                    points: [
                        { u: 0, v: 0.5 },
                        { u: 0.1, v: 0.5 }
                    ]
                }
            ],
            drawConfig: {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                penDownSpeed: 300,
                penUpSpeed: 400,
                penRaiseDelayMs: 200,
                penLowerDelayMs: 400,
                wrapAround: true,
                returnHome: false,
                drawOutputScale: 1
            }
        },
        drawTimeProfile: DrawTimeProfileUtils.normalizeProfile({
            strokeSampleCount: 6,
            durationScale: 1.25
        }),
        currentDrawTimeEstimateMs: null,
        uiValue: null,
        _resolveDrawCoordinateConfig() {
            return {
                coordinateMode: 'normalized-uv'
            }
        },
        _setDrawTimeEstimateUi(durationMs) {
            this.uiValue = durationMs
        },
        _resetDrawTimeEstimateUi() {
            this.currentDrawTimeEstimateMs = null
            this.uiValue = null
        }
    }

    await AppControllerRender.prototype._refreshCurrentDrawTimeEstimate.call(controller)

    assert.equal(controller.currentDrawTimeEstimateMs > 0, true)
    assert.equal(controller.uiValue, controller.currentDrawTimeEstimateMs)
})
