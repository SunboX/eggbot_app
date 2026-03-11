import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EggScene } from '../src/EggScene.mjs'

test('EggScene should configure canvas textures for crisp ornament detail', () => {
    const scene = Object.assign(Object.create(EggScene.prototype), {
        constructor: EggScene,
        texture: null,
        mesh: {
            material: {
                map: null,
                needsUpdate: false
            }
        }
    })
    const textureCanvas = {
        width: 2048,
        height: 1024
    }

    EggScene.prototype.updateTexture.call(scene, textureCanvas)

    assert.ok(scene.texture instanceof THREE.CanvasTexture)
    assert.equal(scene.texture.image, textureCanvas)
    assert.equal(scene.texture.minFilter, THREE.LinearFilter)
    assert.equal(scene.texture.magFilter, THREE.LinearFilter)
    assert.equal(scene.texture.generateMipmaps, false)
    assert.equal(scene.mesh.material.map, scene.texture)
    assert.equal(scene.mesh.material.needsUpdate, true)
})
