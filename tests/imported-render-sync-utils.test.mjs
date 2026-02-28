import test from 'node:test'
import assert from 'node:assert/strict'
import { ImportedRenderSyncUtils } from '../src/ImportedRenderSyncUtils.mjs'

test('ImportedRenderSyncUtils should always sync immediately for generated renders', () => {
    assert.deepEqual(ImportedRenderSyncUtils.resolvePostRenderAction('', { dispatchImportedRenderedEvent: true }), {
        shouldSyncEggTextureNow: true,
        shouldDispatchImportedRenderedEvent: false
    })
})

test('ImportedRenderSyncUtils should dispatch imported rendered event when requested', () => {
    assert.deepEqual(ImportedRenderSyncUtils.resolvePostRenderAction('<svg />', { dispatchImportedRenderedEvent: true }), {
        shouldSyncEggTextureNow: false,
        shouldDispatchImportedRenderedEvent: true
    })
})

test('ImportedRenderSyncUtils should sync immediately when imported render does not dispatch events', () => {
    assert.deepEqual(ImportedRenderSyncUtils.resolvePostRenderAction('<svg />', { dispatchImportedRenderedEvent: false }), {
        shouldSyncEggTextureNow: true,
        shouldDispatchImportedRenderedEvent: false
    })
})
