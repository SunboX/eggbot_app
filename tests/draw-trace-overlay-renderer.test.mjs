import test from 'node:test'
import assert from 'node:assert/strict'
import { DrawTraceOverlayRenderer } from '../src/DrawTraceOverlayRenderer.mjs'

/**
 * Creates one minimal canvas/context pair for overlay rendering tests.
 * @returns {{ canvas: HTMLCanvasElement, ctx: Record<string, any> }}
 */
function createMockCanvas() {
    const ctx = {
        clearRectCalls: 0,
        beginPathCalls: 0,
        strokeCalls: 0,
        fillCalls: 0,
        moveToCalls: [],
        lineToCalls: [],
        strokeStyleHistory: [],
        lineWidthHistory: [],
        clearRect() {
            this.clearRectCalls += 1
        },
        beginPath() {
            this.beginPathCalls += 1
        },
        moveTo(x, y) {
            this.moveToCalls.push([x, y])
        },
        lineTo(x, y) {
            this.lineToCalls.push([x, y])
        },
        stroke() {
            this.strokeCalls += 1
            this.strokeStyleHistory.push(this.strokeStyle)
            this.lineWidthHistory.push(this.lineWidth)
        },
        save() {},
        restore() {},
        closePath() {},
        arc() {},
        fill() {
            this.fillCalls += 1
        }
    }

    const canvas = {
        width: 1000,
        height: 500,
        getContext: () => ctx
    }

    return { canvas, ctx }
}

test('DrawTraceOverlayRenderer should render completed and active strokes with seam wrapping', () => {
    const { canvas, ctx } = createMockCanvas()
    const strokes = [
        {
            points: [
                { u: 0.1, v: 0.2 },
                { u: 0.2, v: 0.3 }
            ]
        },
        {
            points: [
                { u: 0.45, v: 0.55 },
                { u: 0.6, v: 0.7 }
            ]
        }
    ]

    DrawTraceOverlayRenderer.render(canvas, {
        strokes,
        completedStrokeCount: 1,
        activeStrokeIndex: 1,
        lineWidth: 2
    })

    assert.equal(ctx.clearRectCalls, 1)
    assert.equal(ctx.strokeCalls, 6)
    assert.equal(ctx.fillCalls, 3)
    assert.equal(ctx.strokeStyleHistory.includes('rgba(57, 201, 126, 0.85)'), true)
    assert.equal(ctx.strokeStyleHistory.includes('#ff4d3a'), true)
})

test('DrawTraceOverlayRenderer should keep seam-crossing paths continuous after unwrapping', () => {
    const { canvas, ctx } = createMockCanvas()
    const strokes = [
        {
            points: [
                { u: 0.99, v: 0.5 },
                { u: 0.01, v: 0.5 }
            ]
        }
    ]

    DrawTraceOverlayRenderer.render(canvas, {
        strokes,
        completedStrokeCount: 0,
        activeStrokeIndex: 0,
        lineWidth: 2
    })

    assert.ok(ctx.moveToCalls.length > 0)
    assert.ok(ctx.lineToCalls.length > 0)
    const [startX] = ctx.moveToCalls[1]
    const [endX] = ctx.lineToCalls[1]
    assert.ok(Math.abs(endX - startX) < 60)
})
