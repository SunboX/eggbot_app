import assert from 'node:assert/strict'
import test from 'node:test'
import { DrawProgressTimeUtils } from '../src/DrawProgressTimeUtils.mjs'

test('DrawProgressTimeUtils.normalizeRemainingMs should return null for nullish or empty inputs', () => {
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(null), null)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(undefined), null)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(''), null)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs('  '), null)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs('abc'), null)
})

test('DrawProgressTimeUtils.normalizeRemainingMs should normalize and clamp finite numeric inputs', () => {
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(1499.6), 1500)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs('1200'), 1200)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(-42), 0)
    assert.equal(DrawProgressTimeUtils.normalizeRemainingMs(0), 0)
})
