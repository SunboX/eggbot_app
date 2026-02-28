import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternImportRuntimeGuards } from '../src/PatternImportRuntimeGuards.mjs'

test('PatternImportRuntimeGuards should block import interaction while drawing', () => {
    assert.equal(
        PatternImportRuntimeGuards.isImportInteractionBlocked({
            isPatternImporting: false,
            isDrawing: true
        }),
        true
    )
})

test('PatternImportRuntimeGuards should block import interaction while import is already running', () => {
    assert.equal(
        PatternImportRuntimeGuards.isImportInteractionBlocked({
            isPatternImporting: true,
            isDrawing: false
        }),
        true
    )
})

test('PatternImportRuntimeGuards should allow import interaction when idle', () => {
    assert.equal(
        PatternImportRuntimeGuards.isImportInteractionBlocked({
            isPatternImporting: false,
            isDrawing: false
        }),
        false
    )
})

test('PatternImportRuntimeGuards should block draw start while import is running', () => {
    assert.equal(
        PatternImportRuntimeGuards.isDrawStartBlocked({
            isPatternImporting: true
        }),
        true
    )
})

test('PatternImportRuntimeGuards should allow draw start when no import is running', () => {
    assert.equal(
        PatternImportRuntimeGuards.isDrawStartBlocked({
            isPatternImporting: false
        }),
        false
    )
})
