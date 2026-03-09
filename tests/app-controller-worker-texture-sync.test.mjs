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
