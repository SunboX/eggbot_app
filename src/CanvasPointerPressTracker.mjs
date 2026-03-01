/**
 * Tracks whether one canvas currently has active pointer presses.
 */
export class CanvasPointerPressTracker {
    #canvas
    #activePointerIds
    #boundPointerDown
    #boundPointerUp
    #boundPointerCancel
    #boundLostPointerCapture

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.#canvas = canvas
        this.#activePointerIds = new Set()
        this.#boundPointerDown = (event) => this.#handlePointerDown(event)
        this.#boundPointerUp = (event) => this.#handlePointerUp(event)
        this.#boundPointerCancel = (event) => this.#handlePointerCancel(event)
        this.#boundLostPointerCapture = (event) => this.#handleLostPointerCapture(event)

        this.#canvas.addEventListener('pointerdown', this.#boundPointerDown)
        this.#canvas.addEventListener('pointerup', this.#boundPointerUp)
        this.#canvas.addEventListener('pointercancel', this.#boundPointerCancel)
        this.#canvas.addEventListener('lostpointercapture', this.#boundLostPointerCapture)
    }

    /**
     * Returns true while at least one tracked pointer is active.
     * @returns {boolean}
     */
    isPressActive() {
        return this.#activePointerIds.size > 0
    }

    /**
     * Removes listeners and clears active state.
     */
    dispose() {
        this.#canvas.removeEventListener('pointerdown', this.#boundPointerDown)
        this.#canvas.removeEventListener('pointerup', this.#boundPointerUp)
        this.#canvas.removeEventListener('pointercancel', this.#boundPointerCancel)
        this.#canvas.removeEventListener('lostpointercapture', this.#boundLostPointerCapture)
        this.#activePointerIds.clear()
    }

    /**
     * Handles one canvas pointer-down event.
     * @param {PointerEvent} event
     */
    #handlePointerDown(event) {
        if (!CanvasPointerPressTracker.#shouldTrackPointerDown(event)) return
        const pointerId = CanvasPointerPressTracker.#resolvePointerId(event)
        if (pointerId === null) return
        this.#activePointerIds.add(pointerId)
        CanvasPointerPressTracker.#trySetPointerCapture(this.#canvas, pointerId)
    }

    /**
     * Handles one pointer-up event.
     * @param {PointerEvent} event
     */
    #handlePointerUp(event) {
        this.#releasePointer(event)
    }

    /**
     * Handles one pointer-cancel event.
     * @param {PointerEvent} event
     */
    #handlePointerCancel(event) {
        this.#releasePointer(event)
    }

    /**
     * Handles one lost-pointer-capture event.
     * @param {PointerEvent} event
     */
    #handleLostPointerCapture(event) {
        const pointerId = CanvasPointerPressTracker.#resolvePointerId(event)
        if (pointerId === null) {
            this.#activePointerIds.clear()
            return
        }
        this.#activePointerIds.delete(pointerId)
    }

    /**
     * Clears tracking for one finished pointer.
     * @param {PointerEvent} event
     */
    #releasePointer(event) {
        const pointerId = CanvasPointerPressTracker.#resolvePointerId(event)
        if (pointerId === null) {
            this.#activePointerIds.clear()
            return
        }
        this.#activePointerIds.delete(pointerId)
        CanvasPointerPressTracker.#tryReleasePointerCapture(this.#canvas, pointerId)
    }

    /**
     * Resolves one pointer id from an event.
     * @param {PointerEvent} event
     * @returns {number | null}
     */
    static #resolvePointerId(event) {
        const pointerId = Number(event?.pointerId)
        if (!Number.isInteger(pointerId)) return null
        return pointerId
    }

    /**
     * Returns true when pointer-down should pause auto-rotation.
     * @param {PointerEvent} event
     * @returns {boolean}
     */
    static #shouldTrackPointerDown(event) {
        if (!event) return false
        if (event.pointerType !== 'mouse') return true
        if (!Number.isInteger(event.button)) return true
        return event.button === 0
    }

    /**
     * Attempts to capture one pointer on the canvas.
     * @param {HTMLCanvasElement} canvas
     * @param {number} pointerId
     */
    static #trySetPointerCapture(canvas, pointerId) {
        if (typeof canvas?.setPointerCapture !== 'function') return
        try {
            canvas.setPointerCapture(pointerId)
        } catch (_error) {
            // Ignore unsupported/invalid pointer capture states.
        }
    }

    /**
     * Attempts to release one pointer capture from the canvas.
     * @param {HTMLCanvasElement} canvas
     * @param {number} pointerId
     */
    static #tryReleasePointerCapture(canvas, pointerId) {
        if (typeof canvas?.releasePointerCapture !== 'function') return
        try {
            canvas.releasePointerCapture(pointerId)
        } catch (_error) {
            // Ignore unsupported/invalid pointer capture states.
        }
    }
}
