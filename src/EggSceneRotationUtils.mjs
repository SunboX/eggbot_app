/**
 * Math helpers for EggScene yaw tracking and smooth angle motion.
 */
export class EggSceneRotationUtils {
    /**
     * Wraps one normalized U coordinate into the [0, 1) range.
     * @param {number} value
     * @returns {number}
     */
    static wrapNormalizedU(value) {
        if (!Number.isFinite(Number(value))) return 0
        const wrapped = Number(value) % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }

    /**
     * Resolves one mesh Y-rotation that brings the provided texture U longitude toward the camera azimuth.
     * @param {{ u: number, cameraX: number, cameraZ: number, targetX?: number, targetZ?: number }} input
     * @returns {number}
     */
    static resolveFollowRotationY(input) {
        const wrappedU = EggSceneRotationUtils.wrapNormalizedU(Number(input?.u))
        const targetX = Number(input?.targetX) || 0
        const targetZ = Number(input?.targetZ) || 0
        const cameraX = Number(input?.cameraX) || 0
        const cameraZ = Number(input?.cameraZ) || 1
        const cameraAzimuth = Math.atan2(cameraX - targetX, cameraZ - targetZ)
        return cameraAzimuth + Math.PI / 2 - wrappedU * Math.PI * 2
    }

    /**
     * Moves one current angle toward target angle via shortest angular delta.
     * @param {number} current
     * @param {number} target
     * @param {number} factor
     * @returns {number}
     */
    static approachAngle(current, target, factor) {
        const normalizedFactor = Math.max(0, Math.min(1, Number(factor) || 0))
        const delta = EggSceneRotationUtils.#shortestAngleDelta(current, target)
        return Number(current) + delta * normalizedFactor
    }

    /**
     * Resolves shortest signed delta from one source angle to target angle.
     * @param {number} from
     * @param {number} to
     * @returns {number}
     */
    static #shortestAngleDelta(from, to) {
        const fullTurn = Math.PI * 2
        let delta = (Number(to) || 0) - (Number(from) || 0)
        delta = ((delta + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
        return delta
    }
}
