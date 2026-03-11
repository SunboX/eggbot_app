import assert from 'node:assert/strict'
import test from 'node:test'
import { AppControllerRender } from '../src/AppControllerRender.mjs'
import { AppControllerRuntime } from '../src/AppControllerRuntime.mjs'

/**
 * Installs one fake animation-frame environment for runtime tests.
 * @returns {{ queuedCount: () => number, runNextFrame: () => void, restore: () => void }}
 */
function installAnimationFrameEnvironment() {
    const originalWindow = globalThis.window
    const callbacks = new Map()
    let nextFrameId = 1

    globalThis.window = {
        ...(originalWindow && typeof originalWindow === 'object' ? originalWindow : {}),
        requestAnimationFrame(callback) {
            const frameId = nextFrameId
            nextFrameId += 1
            callbacks.set(frameId, callback)
            return frameId
        },
        cancelAnimationFrame(frameId) {
            callbacks.delete(frameId)
        }
    }

    return {
        queuedCount: () => callbacks.size,
        runNextFrame: () => {
            const nextEntry = callbacks.entries().next().value
            assert.ok(nextEntry, 'Expected one queued animation frame callback.')
            const [frameId, callback] = nextEntry
            callbacks.delete(frameId)
            callback(16)
        },
        restore: () => {
            if (originalWindow === undefined) {
                delete globalThis.window
                return
            }
            globalThis.window = originalWindow
        }
    }
}

test('AppControllerRuntime should refresh worker-backed egg textures across follow-up animation frames', (context) => {
    const animationFrameEnv = installAnimationFrameEnvironment()
    context.after(animationFrameEnv.restore)

    let syncCount = 0
    const runtime = {
        renderToken: 7,
        renderBackendMode: 'worker',
        disableRenderWorker: false,
        pendingEggTextureSyncAnimationFrame: 0,
        _syncEggSceneTexture() {
            syncCount += 1
        }
    }

    AppControllerRuntime.prototype._scheduleEggSceneTextureFollowUpSync.call(runtime, 7)

    assert.equal(animationFrameEnv.queuedCount(), 1)
    animationFrameEnv.runNextFrame()
    assert.equal(syncCount, 1)
    assert.equal(animationFrameEnv.queuedCount(), 1)

    animationFrameEnv.runNextFrame()
    assert.equal(syncCount, 2)
    assert.equal(animationFrameEnv.queuedCount(), 0)
})

test('AppControllerRender should schedule a follow-up egg texture sync after worker renders complete', async () => {
    let syncCount = 0
    let scheduledToken = null
    let deferredStartupCount = 0

    const controller = {
        renderToken: 5,
        state: {
            baseColor: '#efe7ce',
            lineWidth: 1.8,
            fillPatterns: true,
            palette: ['#8b1f1a'],
            strokes: []
        },
        els: {
            textureCanvas: {
                dispatchEvent() {}
            }
        },
        importedPattern: null,
        _buildRenderInputStrokes(strokes) {
            return strokes
        },
        _resolveImportedSvgRasterRenderConfig() {
            return {
                preferImportedSvgRaster: false,
                importedSvgScaleU: 1,
                importedSvgScaleV: 1
            }
        },
        async _renderTextureFrame() {
            return { scheduleFollowUpTextureSync: true }
        },
        _syncEggSceneTexture() {
            syncCount += 1
        },
        _scheduleEggSceneTextureFollowUpSync(token) {
            scheduledToken = token
        },
        _scheduleDeferredStartupTasks() {
            deferredStartupCount += 1
        },
        _t(key) {
            return key
        },
        _setStatus() {}
    }

    await AppControllerRender.prototype._renderComputedPattern.call(controller, {
        token: 5,
        importedSvgText: '',
        importedSvgHeightRatio: 1,
        skipImportedStatus: true
    })

    assert.equal(syncCount, 1)
    assert.equal(scheduledToken, 5)
    assert.equal(deferredStartupCount, 1)
})

test('AppControllerRender should prefer exact SVG raster preview for normalized UV imports', () => {
    const controller = {
        importedPattern: {
            coordinateMode: 'normalized-uv'
        },
        state: {
            fillPatterns: true
        },
        _resolveActiveRenderHeightRatio() {
            return 0.75
        },
        _usesDocumentCenteredImportedMapping() {
            return false
        }
    }

    assert.deepEqual(AppControllerRender.prototype._resolveImportedSvgRasterRenderConfig.call(controller), {
        preferImportedSvgRaster: true,
        importedSvgScaleU: 1,
        importedSvgScaleV: 0.75
    })
})

test('AppControllerRender should rerender worker failures onto a restored visible texture canvas', async () => {
    const oldCanvas = {
        width: 2048,
        height: 1024,
        cloneNode() {
            return {
                width: 2048,
                height: 1024,
                addEventListener() {},
                dispatchEvent() {
                    return true
                }
            }
        },
        parentNode: {
            replaceChild() {}
        }
    }
    const controller = Object.assign(Object.create(AppControllerRender.prototype), {
        renderBackendMode: 'worker',
        disableRenderWorker: false,
        textureCanvasTransferredToWorker: true,
        els: {
            textureCanvas: oldCanvas
        },
        activeTextureCanvas: oldCanvas,
        patternRenderWorker: {
            async render() {
                const error = new Error('The source image could not be decoded.')
                error.code = 'render-error'
                throw error
            },
            dispose() {}
        },
        _ensureMainThreadRenderer(useFallbackCanvas) {
            this._ensureMainThreadRendererArgs = useFallbackCanvas
        },
        _bindTextureCanvasRenderSync() {},
        async _renderWithMainThreadRenderer(_input, useFallbackCanvas) {
            this._mainThreadRenderArgs = useFallbackCanvas
            return { dispatchImportedRenderedEvent: false }
        }
    })

    await AppControllerRender.prototype._renderTextureFrame.call(
        controller,
        {
            importedSvgText: '<svg viewBox="0 0 10 10"></svg>',
            preferImportedSvgRaster: true,
            strokes: []
        },
        1
    )

    assert.equal(controller.renderBackendMode, 'main')
    assert.equal(controller.textureCanvasTransferredToWorker, false)
    assert.equal(controller._ensureMainThreadRendererArgs, false)
    assert.equal(controller._mainThreadRenderArgs, false)
    assert.notEqual(controller.els.textureCanvas, oldCanvas)
})

test('AppControllerRuntime should restore a visible texture canvas after worker fallback rendering', () => {
    const replacementLog = []
    const newCanvasContext = {
        drawImage(source, x, y, width, height) {
            replacementLog.push({ source, x, y, width, height })
        }
    }
    const newCanvas = {
        width: 2048,
        height: 1024,
        getContext() {
            return newCanvasContext
        },
        addEventListener() {},
        dispatchEvent() {
            return true
        }
    }
    const oldCanvas = {
        width: 2048,
        height: 1024,
        cloneNode() {
            return newCanvas
        },
        parentNode: {
            replaceChild(replacement, existing) {
                assert.equal(replacement, newCanvas)
                assert.equal(existing, oldCanvas)
            }
        }
    }
    const fallbackCanvas = {
        width: 2048,
        height: 1024
    }
    const runtime = Object.assign(Object.create(AppControllerRuntime.prototype), {
        els: {
            textureCanvas: oldCanvas
        },
        activeTextureCanvas: fallbackCanvas,
        textureCanvasTransferredToWorker: true,
        _syncEggSceneTexture() {}
    })

    const restored = AppControllerRuntime.prototype._restoreVisibleTextureCanvasAfterWorkerFallback.call(runtime)

    assert.equal(restored, true)
    assert.equal(runtime.els.textureCanvas, newCanvas)
    assert.equal(runtime.activeTextureCanvas, newCanvas)
    assert.equal(runtime.textureCanvasTransferredToWorker, false)
    assert.deepEqual(replacementLog, [{ source: fallbackCanvas, x: 0, y: 0, width: 2048, height: 1024 }])
})
