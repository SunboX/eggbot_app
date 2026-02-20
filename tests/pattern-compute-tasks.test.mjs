import test from 'node:test'
import assert from 'node:assert/strict'
import { AppRuntimeConfig } from '../src/AppRuntimeConfig.mjs'
import { PatternComputeTasks } from '../src/PatternComputeTasks.mjs'
import { PatternGenerator } from '../src/PatternGenerator.mjs'
import { PatternStrokeScaleUtils } from '../src/PatternStrokeScaleUtils.mjs'
import { PatternSvgExportUtils } from '../src/PatternSvgExportUtils.mjs'

/**
 * Builds one deterministic state variant for task parity tests.
 * @returns {Record<string, any>}
 */
function buildDenseState() {
    const state = AppRuntimeConfig.createDefaultState()
    state.seed = 246810
    state.preset = 'traditional-mix'
    state.symmetry = 24
    state.bands = 16
    state.density = 1
    state.ornamentSize = 2
    state.ornamentCount = 2
    state.ornamentDistribution = 1.6
    state.showHorizontalLines = true
    state.motifs = {
        dots: true,
        rays: true,
        honeycomb: true,
        wolfTeeth: true,
        pineBranch: true,
        diamonds: true
    }
    state.palette = ['#8b1f1a', '#1f3f8b', '#c78916', '#4c7f3b', '#2f2f2f', '#7a1f4f']
    return state
}

test('PatternComputeTasks should match direct generation pipeline for default settings', () => {
    const state = AppRuntimeConfig.createDefaultState()
    const activeHeightRatio = PatternStrokeScaleUtils.clampRatio(state.importHeightScale)
    const direct = PatternStrokeScaleUtils.rescaleStrokes(PatternGenerator.generate(state), 1, activeHeightRatio)
    const computed = PatternComputeTasks.computeGeneratedRenderedStrokes({
        state,
        activeHeightRatio
    })

    assert.deepEqual(computed.strokes, direct)
})

test('PatternComputeTasks should match direct generation pipeline for dense settings', () => {
    const state = buildDenseState()
    const activeHeightRatio = 0.82
    const direct = PatternStrokeScaleUtils.rescaleStrokes(PatternGenerator.generate(state), 1, activeHeightRatio)
    const computed = PatternComputeTasks.computeGeneratedRenderedStrokes({
        state,
        activeHeightRatio
    })

    assert.deepEqual(computed.strokes, direct)
    assert.ok(computed.strokes.length > 1000)
})

test('PatternComputeTasks should build export SVG content', () => {
    const state = AppRuntimeConfig.createDefaultState()
    const activeHeightRatio = PatternStrokeScaleUtils.clampRatio(state.importHeightScale)
    const strokes = PatternComputeTasks.computeGeneratedRenderedStrokes({
        state,
        activeHeightRatio
    }).strokes
    const svgInput = {
        strokes,
        palette: state.palette,
        baseColor: state.baseColor,
        lineWidth: state.lineWidth * 2.4,
        width: 512,
        height: 256,
        editorName: 'eggbot-tests',
        editorUrl: 'https://example.com/tests',
        metadata: {
            date: '2026-01-01T00:00:00.000Z'
        }
    }

    const direct = PatternSvgExportUtils.buildSvg(svgInput)
    const computed = PatternComputeTasks.buildExportSvg({ svgInput })

    assert.equal(computed.contents, direct)
    assert.ok(computed.contents.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
})
