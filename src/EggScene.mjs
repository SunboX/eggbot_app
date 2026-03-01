import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EggUvMapUtils } from './EggUvMapUtils.mjs'
import { CanvasPointerPressTracker } from './CanvasPointerPressTracker.mjs'

/**
 * Interactive Three.js egg viewport.
 */
export class EggScene {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas
        this.scene = new THREE.Scene()
        this.scene.background = new THREE.Color('#f0e1c7')

        this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
        this.camera.position.set(0.8, 0.5, 2.4)

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
        this.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.renderer.shadowMap.enabled = true

        this.controls = new OrbitControls(this.camera, canvas)
        this.controls.enableDamping = true
        this.controls.enablePan = false
        this.controls.minDistance = 1.4
        this.controls.maxDistance = 5
        this.controls.target.set(0, 0, 0)
        this.pointerPressTracker = new CanvasPointerPressTracker(canvas)

        this.texture = null
        this.mesh = this.#buildEggMesh()
        this.scene.add(this.mesh)

        this.#addLights()
        this.#resize()

        this.resizeObserver = new ResizeObserver(() => this.#resize())
        this.resizeObserver.observe(canvas)

        this.animationFrameId = 0
        this.animateFrame = this.#animate.bind(this)
        this.animateFrame()
    }

    /**
     * Applies a canvas texture to the egg material.
     * @param {HTMLCanvasElement} textureCanvas
     */
    updateTexture(textureCanvas) {
        if (!this.texture) {
            this.texture = new THREE.CanvasTexture(textureCanvas)
            this.texture.colorSpace = THREE.SRGBColorSpace
            this.texture.wrapS = THREE.RepeatWrapping
            this.texture.wrapT = THREE.ClampToEdgeWrapping
            this.texture.needsUpdate = true
            this.mesh.material.map = this.texture
            this.mesh.material.needsUpdate = true
            return
        }
        this.texture.image = textureCanvas
        this.texture.needsUpdate = true
    }

    /**
     * Disposes all graphics resources.
     */
    dispose() {
        cancelAnimationFrame(this.animationFrameId)
        this.resizeObserver.disconnect()
        this.pointerPressTracker.dispose()
        this.controls.dispose()
        this.renderer.dispose()
        this.mesh.geometry.dispose()
        this.mesh.material.dispose()
        if (this.texture) {
            this.texture.dispose()
            this.texture = null
        }
    }

    /**
     * Builds the egg mesh.
     * @returns {THREE.Mesh}
     */
    #buildEggMesh() {
        const geometry = new THREE.SphereGeometry(1, 96, 72)
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
        // Match preview texture mapping to linear EggBot Y coordinates.
        EggUvMapUtils.remapVerticalUvToLinearHeight(geometry)
        geometry.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.66,
            metalness: 0.05,
            map: null
        })

        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        return mesh
    }

    /**
     * Adds key and fill lights.
     */
    #addLights() {
        const ambient = new THREE.HemisphereLight('#fff2db', '#8a6a2b', 1.0)
        this.scene.add(ambient)

        const key = new THREE.DirectionalLight('#fff8ef', 1.3)
        key.position.set(2.4, 3.2, 3.1)
        key.castShadow = true
        key.shadow.mapSize.set(1024, 1024)
        this.scene.add(key)

        const rim = new THREE.DirectionalLight('#ffd08f', 0.5)
        rim.position.set(-2.4, 1.6, -3)
        this.scene.add(rim)

        const standGeometry = new THREE.CylinderGeometry(0.94, 1.14, 0.08, 64)
        const standMaterial = new THREE.MeshStandardMaterial({
            color: '#7f5d2d',
            roughness: 0.85,
            metalness: 0.03
        })
        const stand = new THREE.Mesh(standGeometry, standMaterial)
        stand.position.set(0, -1.25, 0)
        stand.receiveShadow = true
        this.scene.add(stand)
    }

    /**
     * Handles viewport resize.
     */
    #resize() {
        const width = Math.max(1, this.canvas.clientWidth)
        const height = Math.max(1, this.canvas.clientHeight)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

        this.renderer.setPixelRatio(pixelRatio)
        this.renderer.setSize(width, height, false)

        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
    }

    /**
     * Renders one animation frame.
     */
    #animate() {
        this.controls.update()
        if (!this.pointerPressTracker.isPressActive()) {
            this.mesh.rotation.y += 0.0015
        }
        this.renderer.render(this.scene, this.camera)
        this.animationFrameId = requestAnimationFrame(this.animateFrame)
    }
}
