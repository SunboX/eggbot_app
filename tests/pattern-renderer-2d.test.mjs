import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternRenderer2D } from '../src/PatternRenderer2D.mjs'

/**
 * Creates a minimal canvas/context mock for renderer tests.
 * @returns {{ canvas: HTMLCanvasElement, ctx: Record<string, unknown> & { beginPathCalls: number, strokeCalls: number } }}
 */
function createMockCanvas() {
    const ctx = {
        beginPathCalls: 0,
        strokeCalls: 0,
        clearRect() {},
        fillRect() {},
        beginPath() {
            this.beginPathCalls += 1
        },
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        stroke() {
            this.strokeCalls += 1
        },
        drawImage() {}
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
