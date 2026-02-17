import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternImportControlUtils } from '../src/PatternImportControlUtils.mjs'

test('PatternImportControlUtils should disable only valid auto-generation controls', () => {
    const controls = [{ disabled: false }, { disabled: false }, null, {}, undefined]

    PatternImportControlUtils.setAutoGenerateOrnamentControlsDisabled(controls, true)

    assert.equal(controls[0].disabled, true)
    assert.equal(controls[1].disabled, true)
    assert.equal('disabled' in controls[3], false)
})

test('PatternImportControlUtils should re-enable auto-generation controls', () => {
    const controls = [{ disabled: true }, { disabled: true }]

    PatternImportControlUtils.setAutoGenerateOrnamentControlsDisabled(controls, false)

    assert.equal(controls[0].disabled, false)
    assert.equal(controls[1].disabled, false)
})
