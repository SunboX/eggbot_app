import test from 'node:test'
import assert from 'node:assert/strict'
import { EggBotPathComputeTasks } from '../src/EggBotPathComputeTasks.mjs'

/**
 * Legacy equivalent for unwrap + scale.
 * @param {Array<{u:number,v:number}>} points
 * @param {{ stepsPerTurn: number, penRangeSteps: number }} cfg
 * @returns {Array<{x:number,y:number}>}
 */
function legacyUnwrapAndScale(points, cfg) {
    if (!points.length) return []
    const unwrapped = [
        {
            u: points[0].u,
            v: points[0].v
        }
    ]

    for (let index = 1; index < points.length; index += 1) {
        const prev = unwrapped[index - 1]
        const current = points[index]
        const options = [current.u - 1, current.u, current.u + 1]
        let selected = options[0]
        let distance = Math.abs(options[0] - prev.u)
        for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
            const candidate = options[optionIndex]
            const candidateDistance = Math.abs(candidate - prev.u)
            if (candidateDistance < distance) {
                distance = candidateDistance
                selected = candidate
            }
        }
        unwrapped.push({
            u: selected,
            v: current.v
        })
    }

    const maxY = cfg.penRangeSteps / 2
    return unwrapped.map((point) => ({
        x: Math.round(point.u * cfg.stepsPerTurn),
        y: Math.max(-maxY, Math.min(maxY, Math.round((0.5 - point.v) * cfg.penRangeSteps)))
    }))
}

/**
 * Legacy equivalent for X-alignment.
 * @param {Array<{x:number,y:number}>} points
 * @param {number} currentX
 * @param {number} stepsPerTurn
 * @returns {Array<{x:number,y:number}>}
 */
function legacyAlignStrokeXToCurrent(points, currentX, stepsPerTurn) {
    if (!points.length) return []
    const shiftTurns = Math.round((currentX - points[0].x) / stepsPerTurn)
    const shift = shiftTurns * stepsPerTurn
    return points.map((point) => ({
        x: point.x + shift,
        y: point.y
    }))
}

test('EggBotPathComputeTasks should match legacy preprocessing for multiple strokes', () => {
    const strokes = [
        {
            points: [
                { u: 0.95, v: 0.5 },
                { u: 0.02, v: 0.42 },
                { u: 0.09, v: 0.4 }
            ]
        },
        {
            points: [
                { u: 0.15, v: 0.58 },
                { u: 0.22, v: 0.62 }
            ]
        }
    ]
    const drawConfig = {
        stepsPerTurn: 3200,
        penRangeSteps: 1500
    }

    let currentX = 0
    const expected = []
    strokes.forEach((stroke) => {
        const scaled = legacyUnwrapAndScale(stroke.points, drawConfig)
        const aligned = legacyAlignStrokeXToCurrent(scaled, currentX, drawConfig.stepsPerTurn)
        expected.push(aligned)
        currentX = aligned[aligned.length - 1].x
    })

    const result = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes,
        drawConfig,
        startX: 0
    })

    assert.deepEqual(result.strokes, expected)
    assert.equal(result.strokes.length, 2)
})

test('EggBotPathComputeTasks should ignore non-drawable strokes', () => {
    const result = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes: [
            { points: [] },
            { points: [{ u: 0.1, v: 0.4 }] },
            {
                points: [
                    { u: 0.1, v: 0.4 },
                    { u: 0.2, v: 0.6 }
                ]
            }
        ],
        drawConfig: {
            stepsPerTurn: 3200,
            penRangeSteps: 1500
        }
    })

    assert.equal(result.strokes.length, 1)
})

test('EggBotPathComputeTasks should clamp Y values to pen range', () => {
    const result = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes: [
            {
                points: [
                    { u: 0, v: -2 },
                    { u: 0.5, v: 4 }
                ]
            }
        ],
        drawConfig: {
            stepsPerTurn: 1000,
            penRangeSteps: 400
        }
    })

    assert.equal(result.strokes.length, 1)
    assert.equal(result.strokes[0][0].y, 200)
    assert.equal(result.strokes[0][1].y, -200)
})

test('EggBotPathComputeTasks should convert imported UV to centered document coordinates', () => {
    const result = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes: [
            {
                points: [
                    { u: 0, v: 0 },
                    { u: 1, v: 1 },
                    { u: 0.5, v: 0.5 }
                ]
            }
        ],
        drawConfig: {
            coordinateMode: 'document-px-centered',
            documentWidthPx: 1209.448,
            documentHeightPx: 377.952,
            stepScalingFactor: 2,
            wrapAround: false
        }
    })

    assert.equal(result.strokes.length, 1)
    assert.deepEqual(result.strokes[0][0], { x: -605, y: -189 })
    assert.deepEqual(result.strokes[0][1], { x: 605, y: 189 })
    assert.deepEqual(result.strokes[0][2], { x: 0, y: 0 })
})

test('EggBotPathComputeTasks should append start point when a closed stroke lacks an explicit final point', () => {
    const result = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes: [
            {
                closed: true,
                points: [
                    { u: 0.2, v: 0.5 },
                    { u: 0.3, v: 0.3 },
                    { u: 0.4, v: 0.5 }
                ]
            }
        ],
        drawConfig: {
            stepsPerTurn: 1000,
            penRangeSteps: 400,
            wrapAround: false
        }
    })

    assert.equal(result.strokes.length, 1)
    assert.equal(result.strokes[0].length, 4)
    assert.deepEqual(result.strokes[0][0], { x: 200, y: 0 })
    assert.deepEqual(result.strokes[0][3], { x: 200, y: 0 })
})
