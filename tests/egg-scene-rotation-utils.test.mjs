import test from 'node:test'
import assert from 'node:assert/strict'
import { EggSceneRotationUtils } from '../src/EggSceneRotationUtils.mjs'

test('EggSceneRotationUtils should resolve follow rotation for wrapped U using camera azimuth', () => {
    const rotationA = EggSceneRotationUtils.resolveFollowRotationY({
        u: 0,
        cameraX: 0.8,
        cameraZ: 2.4,
        targetX: 0,
        targetZ: 0
    })
    const rotationB = EggSceneRotationUtils.resolveFollowRotationY({
        u: 1,
        cameraX: 0.8,
        cameraZ: 2.4,
        targetX: 0,
        targetZ: 0
    })

    assert.equal(rotationA, rotationB)
})

test('EggSceneRotationUtils should approach target angle via shortest turn direction', () => {
    const current = Math.PI - 0.1
    const target = -Math.PI + 0.1
    const next = EggSceneRotationUtils.approachAngle(current, target, 0.25)

    assert.ok(next > current)
})
