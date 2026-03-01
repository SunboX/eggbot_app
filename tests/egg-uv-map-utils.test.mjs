import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EggUvMapUtils } from '../src/EggUvMapUtils.mjs'

/**
 * Asserts floating-point equality with tolerance.
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon]
 */
function assertNear(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= epsilon)
}

test('EggUvMapUtils should remap vertical UVs linearly to geometry Y bounds', () => {
    const geometry = new THREE.SphereGeometry(1, 16, 12)
    geometry.scale(0.82, 1.14, 0.82)

    const position = geometry.attributes.position
    for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index)
        const y = position.getY(index)
        const z = position.getZ(index)
        const y01 = (y + 1.14) / 2.28
        const taper = 1 - y01 * 0.22
        const lowerBulge = 1 + (1 - y01) * 0.08
        position.setXYZ(index, x * taper * lowerBulge, y, z * taper * lowerBulge)
    }
    position.needsUpdate = true

    EggUvMapUtils.remapVerticalUvToLinearHeight(geometry)

    let minY = Infinity
    let maxY = -Infinity
    for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
    }
    const yRange = maxY - minY

    const uv = geometry.attributes.uv
    for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index)
        const expectedUvY = (y - minY) / yRange
        assertNear(uv.getY(index), expectedUvY, 1e-6)
    }
})

test('EggUvMapUtils should preserve horizontal UV coordinate values', () => {
    const geometry = new THREE.SphereGeometry(1, 16, 12)
    const uv = geometry.attributes.uv
    const before = []
    for (let index = 0; index < uv.count; index += 1) {
        before.push(uv.getX(index))
    }

    EggUvMapUtils.remapVerticalUvToLinearHeight(geometry)

    for (let index = 0; index < uv.count; index += 1) {
        assertNear(uv.getX(index), before[index], 1e-12)
    }
})
