import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'

/**
 * Shared helpers for feature palette sanitization.
 */
export class ColorPaletteUtils {
    static #emergencyPalette = ['#8b1f1a', '#1f3f8b', '#c78916', '#4c7f3b', '#2f2f2f', '#7a1f4f', '#111111', '#ffffff']

    /**
     * Normalizes one palette token for equality checks.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizeToken(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
    }

    /**
     * Picks one replacement color that differs from the egg base color.
     * Prefers unused default palette colors to keep imported color indices stable.
     * @param {string} normalizedBaseColor
     * @param {Set<string>} reservedColors
     * @returns {string}
     */
    static #pickReplacement(normalizedBaseColor, reservedColors) {
        const candidates = [...AppRuntimeConfig.getDefaultPalette(), ...ColorPaletteUtils.#emergencyPalette]
        let fallback = ''

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = String(candidates[index] || '').trim()
            const normalizedCandidate = ColorPaletteUtils.#normalizeToken(candidate)
            if (!normalizedCandidate || normalizedCandidate === normalizedBaseColor) {
                continue
            }
            if (!reservedColors.has(normalizedCandidate)) {
                reservedColors.add(normalizedCandidate)
                return candidate
            }
            if (!fallback) {
                fallback = candidate
            }
        }

        return fallback || '#111111'
    }

    /**
     * Returns a palette with the requested length while keeping the egg base color out of ornament colors.
     * Existing valid palette indices stay in place so imported stroke color mapping remains stable.
     * @param {{ baseColor?: string, palette?: unknown[], desiredCount?: number }} input
     * @returns {string[]}
     */
    static sanitizeFeaturePalette(input) {
        const rawPalette = Array.isArray(input?.palette) ? input.palette : []
        const sourcePalette = rawPalette
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .slice(0, 6)
        const fallbackCount = sourcePalette.length || 4
        const requestedCount = Math.max(1, Math.min(6, Math.trunc(Number(input?.desiredCount) || fallbackCount)))
        const normalizedBaseColor = ColorPaletteUtils.#normalizeToken(input?.baseColor)
        const reservedColors = new Set(
            sourcePalette
                .map((value) => ColorPaletteUtils.#normalizeToken(value))
                .filter((value) => value && value !== normalizedBaseColor)
        )
        const result = []

        for (let index = 0; index < requestedCount; index += 1) {
            const color = String(sourcePalette[index] || '').trim()
            const normalizedColor = ColorPaletteUtils.#normalizeToken(color)
            if (normalizedColor && normalizedColor !== normalizedBaseColor) {
                result.push(color)
                continue
            }
            result.push(ColorPaletteUtils.#pickReplacement(normalizedBaseColor, reservedColors))
        }

        return result
    }
}
