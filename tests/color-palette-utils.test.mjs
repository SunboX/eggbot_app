import test from 'node:test'
import assert from 'node:assert/strict'
import { ColorPaletteUtils } from '../src/ColorPaletteUtils.mjs'

test('ColorPaletteUtils should replace feature colors that match the egg base color', () => {
    const palette = ColorPaletteUtils.sanitizeFeaturePalette({
        baseColor: '#efe7ce',
        palette: ['#8b1f1a', '#efe7ce', '#1f3f8b'],
        desiredCount: 3
    })

    assert.equal(palette.length, 3)
    assert.deepEqual(palette, ['#8b1f1a', '#c78916', '#1f3f8b'])
})

test('ColorPaletteUtils should grow the palette without reusing the base color', () => {
    const palette = ColorPaletteUtils.sanitizeFeaturePalette({
        baseColor: '#8b1f1a',
        palette: ['#1f3f8b'],
        desiredCount: 4
    })

    assert.equal(palette.length, 4)
    assert.equal(palette.includes('#8b1f1a'), false)
    assert.deepEqual(palette, ['#1f3f8b', '#c78916', '#4c7f3b', '#2f2f2f'])
})
