import assert from 'node:assert/strict'
import test from 'node:test'
import { DrawTimeEstimator } from '../src/DrawTimeEstimator.mjs'
import { DrawTimeProfileUtils } from '../src/DrawTimeProfileUtils.mjs'

test('DrawTimeEstimator.describePreparedStrokeRun should estimate total and per-stroke durations', () => {
    const result = DrawTimeEstimator.describePreparedStrokeRun({
        drawableStrokes: [
            [
                { x: 0, y: 0 },
                { x: 0, y: 100 }
            ]
        ],
        drawConfig: {
            penUpSpeed: 100,
            penDownSpeed: 50,
            penRaiseDelayMs: 200,
            penLowerDelayMs: 400,
            returnHome: true
        }
    })

    assert.deepEqual(result.estimatedStrokeDurationsMs, [2600])
    assert.equal(result.estimatedReturnHomeMs, 1000)
    assert.equal(result.estimatedTotalMs, 3800)
})

test('DrawTimeEstimator.estimatePatternDuration should apply the persisted timing profile to raw strokes', () => {
    const result = DrawTimeEstimator.estimatePatternDuration({
        strokes: [
            {
                points: [
                    { u: 0, v: 0.5 },
                    { u: 0.1, v: 0.5 }
                ]
            }
        ],
        drawConfig: {
            stepsPerTurn: 3200,
            penRangeSteps: 1500,
            penDownSpeed: 300,
            penUpSpeed: 400,
            penRaiseDelayMs: 200,
            penLowerDelayMs: 400,
            reversePenMotor: true,
            reverseEggMotor: true,
            wrapAround: true,
            returnHome: false,
            coordinateMode: 'normalized-uv',
            drawOutputScale: 1
        },
        profile: DrawTimeProfileUtils.normalizeProfile({
            strokeSampleCount: 8,
            durationScale: 1.25
        })
    })

    assert.equal(result.strokeCount, 1)
    assert.equal(result.estimatedBaseMs > 0, true)
    assert.equal(result.estimatedCalibratedMs, Math.round(result.estimatedBaseMs * 1.25))
})
