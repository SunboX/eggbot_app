/**
 * UV remapping helpers for egg preview geometry.
 */
export class EggUvMapUtils {
    /**
     * Remaps vertical UV values to a linear Y-height gradient.
     * Keeps horizontal UV values unchanged.
     * @param {import('three').BufferGeometry} geometry
     * @returns {void}
     */
    static remapVerticalUvToLinearHeight(geometry) {
        const position = geometry?.attributes?.position
        const uv = geometry?.attributes?.uv
        if (!position || !uv) return
        if (typeof position.count !== 'number' || typeof uv.count !== 'number') return
        if (position.count !== uv.count) return

        let minY = Infinity
        let maxY = -Infinity
        for (let index = 0; index < position.count; index += 1) {
            const y = Number(position.getY(index))
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
        }
        const yRange = maxY - minY
        if (!Number.isFinite(yRange) || yRange <= 1e-9) return

        for (let index = 0; index < uv.count; index += 1) {
            const y = Number(position.getY(index))
            const normalized = (y - minY) / yRange
            uv.setY(index, Math.max(0, Math.min(1, normalized)))
        }
        uv.needsUpdate = true
    }
}
