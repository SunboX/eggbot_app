import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternRenderer2D } from '../src/PatternRenderer2D.mjs'

/**
 * Creates a minimal canvas/context mock for renderer tests.
 * @returns {{ canvas: HTMLCanvasElement, ctx: Record<string, unknown> & { beginPathCalls: number, fillCalls: number, strokeCalls: number, drawImageCalls: number, lastDrawImageArgs: unknown[] | null } }}
 */
function createMockCanvas() {
    const ctx = {
        beginPathCalls: 0,
        fillCalls: 0,
        strokeCalls: 0,
        drawImageCalls: 0,
        lastDrawImageArgs: null,
        clearRect() {},
        fillRect() {},
        beginPath() {
            this.beginPathCalls += 1
        },
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {
            this.fillCalls += 1
        },
        stroke() {
            this.strokeCalls += 1
        },
        drawImage(...args) {
            this.drawImageCalls += 1
            this.lastDrawImageArgs = args
        }
    }

    const canvas = {
        width: 3200,
        height: 800,
        getContext: () => ctx,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
            return true
        }
    }

    return { canvas, ctx }
}

/**
 * Installs Image and URL object URL mocks for imported SVG fallback tests.
 * @returns {() => void}
 */
function installImportedSvgImageMocks() {
    const OriginalImage = globalThis.Image
    const originalCreateObjectUrl = URL.createObjectURL
    const originalRevokeObjectUrl = URL.revokeObjectURL

    class MockImage {
        constructor() {
            this.onload = null
            this.onerror = null
        }
        set src(_value) {
            if (typeof this.onload === 'function') {
                this.onload()
            }
        }
    }

    Object.defineProperty(globalThis, 'Image', {
        value: MockImage,
        configurable: true,
        writable: true
    })
    Object.defineProperty(URL, 'createObjectURL', {
        value: () => 'blob:mock-url',
        configurable: true,
        writable: true
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => {},
        configurable: true,
        writable: true
    })

    return () => {
        Object.defineProperty(globalThis, 'Image', {
            value: OriginalImage,
            configurable: true,
            writable: true
        })
        Object.defineProperty(URL, 'createObjectURL', {
            value: originalCreateObjectUrl,
            configurable: true,
            writable: true
        })
        Object.defineProperty(URL, 'revokeObjectURL', {
            value: originalRevokeObjectUrl,
            configurable: true,
            writable: true
        })
    }
}

test('PatternRenderer2D should not draw guide grid lines on a blank texture', () => {
    const { canvas, ctx } = createMockCanvas()
    const renderer = new PatternRenderer2D(canvas)

    renderer.render({
        baseColor: '#efe7ce',
        lineWidth: 1.8,
        palette: ['#8b1f1a'],
        strokes: []
    })

    assert.equal(ctx.beginPathCalls, 0)
    assert.equal(ctx.strokeCalls, 0)
})

test('PatternRenderer2D should render imported strokes with line width controls', () => {
    const { canvas, ctx } = createMockCanvas()
    const renderer = new PatternRenderer2D(canvas)

    renderer.render({
        baseColor: '#efe7ce',
        lineWidth: 2.5,
        palette: ['#8b1f1a'],
        importedSvgText: '<svg viewBox="0 0 10 10"></svg>',
        strokes: [
            {
                colorIndex: 0,
                points: [
                    { u: 0.1, v: 0.2 },
                    { u: 0.9, v: 0.8 }
                ]
            }
        ]
    })

    assert.equal(ctx.lineWidth, 6)
    assert.ok(ctx.beginPathCalls > 0)
    assert.ok(ctx.strokeCalls > 0)
})

test('PatternRenderer2D should draw imported fallback SVG with proportional width and height', () => {
    const restore = installImportedSvgImageMocks()
    const { canvas, ctx } = createMockCanvas()
    const renderer = new PatternRenderer2D(canvas)

    try {
        renderer.render({
            baseColor: '#efe7ce',
            lineWidth: 1.8,
            palette: ['#8b1f1a'],
            importedSvgText: '<svg viewBox="0 0 10 10"></svg>',
            importedSvgHeightRatio: 0.5,
            strokes: []
        })

        assert.equal(ctx.drawImageCalls, 1)
        assert.ok(Array.isArray(ctx.lastDrawImageArgs))
        const [, drawX, drawY, drawWidth, drawHeight] = /** @type {unknown[]} */ (ctx.lastDrawImageArgs)
        assert.equal(drawX, 800)
        assert.equal(drawY, 200)
        assert.equal(drawWidth, 1600)
        assert.equal(drawHeight, 400)
    } finally {
        restore()
    }
})

test('PatternRenderer2D should skip closed-shape fills when fillPatterns is false', () => {
    const { canvas, ctx } = createMockCanvas()
    const renderer = new PatternRenderer2D(canvas)

    renderer.render({
        baseColor: '#efe7ce',
        lineWidth: 2,
        fillPatterns: false,
        palette: ['#8b1f1a'],
        strokes: [
            {
                colorIndex: 0,
                closed: true,
                points: [
                    { u: 0.1, v: 0.2 },
                    { u: 0.4, v: 0.2 },
                    { u: 0.2, v: 0.6 }
                ]
            }
        ]
    })

    assert.equal(ctx.fillCalls, 0)
    assert.ok(ctx.strokeCalls > 0)
})
