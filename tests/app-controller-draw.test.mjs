import test from 'node:test'
import assert from 'node:assert/strict'
import { AppControllerDraw } from '../src/AppControllerDraw.mjs'

test('AppControllerDraw should wait for async imported SVG raster renders on fallback canvases', async () => {
    const textureCanvas = new EventTarget()
    const rendererCanvas = new EventTarget()
    let resolved = false

    const controller = {
        els: {
            textureCanvas
        },
        _ensureMainThreadRenderer() {},
        renderer2d: {
            canvas: rendererCanvas,
            render() {}
        }
    }

    const renderPromise = AppControllerDraw.prototype._renderWithMainThreadRenderer.call(
        controller,
        {
            importedSvgText: '<svg viewBox="0 0 10 10"></svg>',
            preferImportedSvgRaster: true,
            strokes: [
                {
                    colorIndex: 0,
                    points: [
                        { u: 0.1, v: 0.2 },
                        { u: 0.9, v: 0.8 }
                    ]
                }
            ]
        },
        true
    ).then(() => {
        resolved = true
    })

    await Promise.resolve()
    assert.equal(resolved, false)

    rendererCanvas.dispatchEvent(new Event('pattern-rendered'))
    await renderPromise

    assert.equal(resolved, true)
})

test('AppControllerDraw should not grow the palette with the egg base color', () => {
    const controller = {
        state: {
            baseColor: '#8b1f1a',
            palette: ['#1f3f8b']
        }
    }

    AppControllerDraw.prototype._normalizePaletteLength.call(controller, 4)

    assert.deepEqual(controller.state.palette, ['#1f3f8b', '#c78916', '#4c7f3b', '#2f2f2f'])
})
