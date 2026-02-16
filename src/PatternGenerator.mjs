/**
 * @typedef {{ u: number, v: number }} UvPoint
 * @typedef {{ colorIndex: number, points: UvPoint[], closed?: boolean }} Stroke
 */

/**
 * Deterministic Sorbian-inspired ornament generator.
 *
 * Design rules implemented from provided references:
 * - ornaments are closed, mirrored, and arranged as continuous bands
 * - triangles and honeycomb cells are placed tip-to-tip without random gaps
 * - rays and branches converge to shared centers
 * - free random spirals are avoided
 */
export class PatternGenerator {
    /**
     * Generates all strokes for the current settings.
     * @param {Record<string, any>} settings
     * @returns {Stroke[]}
     */
    static generate(settings) {
        const seed = Math.trunc(Number(settings?.seed) || 1)
        const rng = PatternGenerator.#createRng(seed)
        const symmetry = PatternGenerator.#clampInt(settings?.symmetry, 8, 2, 24)
        const density = PatternGenerator.#clamp(Number(settings?.density) || 0.58, 0.05, 1)
        const bands = PatternGenerator.#clampInt(settings?.bands, 6, 1, 16)
        const showHorizontalLines = settings?.showHorizontalLines !== false
        const paletteSize = Math.max(1, Array.isArray(settings?.palette) ? settings.palette.length : 4)
        const cells = Math.max(6, symmetry * 2)
        const motifFlags = {
            threeDots: Boolean(settings?.motifs?.dots),
            rays: Boolean(settings?.motifs?.rays),
            honeycomb: Boolean(settings?.motifs?.honeycomb),
            wolfTeeth: Boolean(settings?.motifs?.wolfTeeth),
            pineBranch: Boolean(settings?.motifs?.pineBranch),
            diamonds: Boolean(settings?.motifs?.diamonds)
        }

        const motifSequence = PatternGenerator.#buildMotifSequence(String(settings?.preset || ''), motifFlags)
        const strokes = []

        if (!motifSequence.length) {
            PatternGenerator.#addFallbackPattern(strokes, cells, paletteSize, showHorizontalLines)
            return strokes
        }

        const ringLevels = PatternGenerator.#buildBandLevels(bands)
        if (showHorizontalLines) {
            PatternGenerator.#addFrameworkRings(strokes, ringLevels, paletteSize)
        }

        ringLevels.forEach((level, bandIndex) => {
            const motifName = motifSequence[bandIndex % motifSequence.length]
            const phase = Math.floor(rng() * cells) / cells
            const colorShift = bandIndex * 2
            const scale = 0.009 + density * 0.014
            PatternGenerator.#drawBandByMotif(strokes, {
                motifName,
                v: level,
                cells,
                density,
                amplitude: scale,
                phase,
                paletteSize,
                colorShift
            })
        })

        PatternGenerator.#addPolarRosettes(strokes, {
            rings: [0.13, 0.87],
            count: Math.max(3, Math.round(symmetry / 2)),
            paletteSize,
            density,
            colorShift: motifSequence.length + 2
        })

        return strokes
    }

    /**
     * Adds a minimal fallback when all motifs are disabled.
     * @param {Stroke[]} strokes
     * @param {number} cells
     * @param {number} paletteSize
     * @param {boolean} showHorizontalLines
     */
    static #addFallbackPattern(strokes, cells, paletteSize, showHorizontalLines) {
        if (showHorizontalLines) {
            PatternGenerator.#addRing(strokes, 0.5, 0 % paletteSize)
        }
        const count = Math.max(8, cells)
        for (let index = 0; index < count; index += 1) {
            const centerU = index / count
            PatternGenerator.#addThreeDotsCluster(strokes, {
                centerU,
                centerV: 0.5,
                size: 0.012,
                paletteSize,
                colorShift: index
            })
        }
    }

    /**
     * Returns mirrored band center levels around the egg equator.
     * @param {number} bands
     * @returns {number[]}
     */
    static #buildBandLevels(bands) {
        const clampedBands = Math.max(1, bands)
        const hasMiddleBand = clampedBands % 2 === 1
        const pairCount = Math.floor(clampedBands / 2)
        const topLevels = []

        for (let index = 0; index < pairCount; index += 1) {
            const progress = pairCount === 1 ? 0.5 : index / (pairCount - 1)
            const level = 0.22 + progress * 0.24
            topLevels.push(level)
        }

        const allLevels = [...topLevels]
        if (hasMiddleBand) {
            allLevels.push(0.5)
        }
        for (let index = topLevels.length - 1; index >= 0; index -= 1) {
            allLevels.push(1 - topLevels[index])
        }

        if (!allLevels.length) {
            allLevels.push(0.5)
        }

        return allLevels
    }

    /**
     * Adds framing rings around all motif bands.
     * @param {Stroke[]} strokes
     * @param {number[]} levels
     * @param {number} paletteSize
     */
    static #addFrameworkRings(strokes, levels, paletteSize) {
        const ringValues = new Set([0.12, 0.5, 0.88])
        levels.forEach((level) => {
            ringValues.add(PatternGenerator.#clamp(level - 0.048, 0.04, 0.96))
            ringValues.add(PatternGenerator.#clamp(level + 0.048, 0.04, 0.96))
        })

        Array.from(ringValues)
            .sort((a, b) => a - b)
            .forEach((v, index) => {
                PatternGenerator.#addRing(strokes, v, PatternGenerator.#colorAt(index, paletteSize))
            })
    }

    /**
     * Draws one band with the selected motif.
     * @param {Stroke[]} strokes
     * @param {{ motifName: string, v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #drawBandByMotif(strokes, config) {
        switch (config.motifName) {
            case 'wolfTeeth':
                PatternGenerator.#addWolfTeethBand(strokes, config)
                break
            case 'honeycomb':
                PatternGenerator.#addHoneycombBand(strokes, config)
                break
            case 'diamonds':
                PatternGenerator.#addDiamondBand(strokes, config)
                break
            case 'rays':
                PatternGenerator.#addRayBand(strokes, config)
                break
            case 'pineBranch':
                PatternGenerator.#addPineBranchBand(strokes, config)
                break
            case 'threeDots':
            default:
                PatternGenerator.#addThreeDotsBand(strokes, config)
                break
        }
    }

    /**
     * Adds a classic wolf-teeth band made from closed triangles.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addWolfTeethBand(strokes, config) {
        const step = 1 / config.cells
        const amp = config.amplitude * (1.05 + config.density * 0.5)

        for (let index = 0; index < config.cells; index += 1) {
            const u0 = config.phase + index * step
            const u1 = u0 + step
            const um = (u0 + u1) / 2
            const direction = index % 2 === 0 ? -1 : 1
            const triangle = [
                { u: u0, v: config.v },
                { u: um, v: PatternGenerator.#clamp(config.v + direction * amp, 0.03, 0.97) },
                { u: u1, v: config.v }
            ]
            const color = PatternGenerator.#colorAt(config.colorShift + (index % 2), config.paletteSize)
            PatternGenerator.#pushStroke(strokes, triangle, color, true)
        }

        if (config.density >= 0.35) {
            const rowOffset = amp * 1.55
            for (let index = 0; index < config.cells; index += 1) {
                const u0 = config.phase + index * step
                const u1 = u0 + step
                const um = (u0 + u1) / 2
                const direction = index % 2 === 0 ? 1 : -1
                const vBase = PatternGenerator.#clamp(config.v + rowOffset * (direction > 0 ? 1 : -1), 0.03, 0.97)
                const triangle = [
                    { u: u0, v: vBase },
                    { u: um, v: PatternGenerator.#clamp(vBase + direction * amp * 0.92, 0.03, 0.97) },
                    { u: u1, v: vBase }
                ]
                const color = PatternGenerator.#colorAt(config.colorShift + 1 + (index % 2), config.paletteSize)
                PatternGenerator.#pushStroke(strokes, triangle, color, true)
            }
        }
    }

    /**
     * Adds honeycomb stars as six connected triangles with center dots.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addHoneycombBand(strokes, config) {
        const unitCount = Math.max(4, Math.round(config.cells * 0.6))
        const step = 1 / unitCount
        const outerU = step * 0.43
        const outerV = config.amplitude * (1.35 + config.density * 0.5)
        const innerU = step * 0.18
        const innerV = outerV * 0.43

        for (let index = 0; index < unitCount; index += 1) {
            const centerU = config.phase + (index + 0.5) * step
            const centerV = config.v

            for (let triIndex = 0; triIndex < 6; triIndex += 1) {
                const a1 = (Math.PI * 2 * triIndex) / 6
                const a2 = (Math.PI * 2 * (triIndex + 1)) / 6
                const am = (a1 + a2) / 2
                const triangle = [
                    {
                        u: centerU + Math.cos(a1) * innerU,
                        v: centerV + Math.sin(a1) * innerV
                    },
                    {
                        u: centerU + Math.cos(am) * outerU,
                        v: centerV + Math.sin(am) * outerV
                    },
                    {
                        u: centerU + Math.cos(a2) * innerU,
                        v: centerV + Math.sin(a2) * innerV
                    }
                ]
                const color = PatternGenerator.#colorAt(config.colorShift + triIndex + index, config.paletteSize)
                PatternGenerator.#pushStroke(strokes, triangle, color, true)
            }

            if (config.density >= 0.2) {
                PatternGenerator.#addCircle(strokes, {
                    centerU,
                    centerV,
                    radiusU: step * 0.08,
                    radiusV: outerV * 0.14,
                    segments: 8,
                    colorIndex: PatternGenerator.#colorAt(config.colorShift + 2 + index, config.paletteSize)
                })
            }
        }
    }

    /**
     * Adds repeating diamonds and inner feather lines.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addDiamondBand(strokes, config) {
        const step = 1 / config.cells
        const amp = config.amplitude * (1.2 + config.density * 0.45)

        for (let index = 0; index < config.cells; index += 1) {
            const left = config.phase + index * step
            const right = left + step
            const center = (left + right) / 2
            const diamond = [
                { u: center, v: PatternGenerator.#clamp(config.v - amp, 0.03, 0.97) },
                { u: right, v: config.v },
                { u: center, v: PatternGenerator.#clamp(config.v + amp, 0.03, 0.97) },
                { u: left, v: config.v }
            ]
            const color = PatternGenerator.#colorAt(config.colorShift + index, config.paletteSize)
            PatternGenerator.#pushStroke(strokes, diamond, color, true)

            if (config.density >= 0.35) {
                PatternGenerator.#pushStroke(
                    strokes,
                    [
                        {
                            u: center,
                            v: PatternGenerator.#clamp(config.v - amp * 0.55, 0.03, 0.97)
                        },
                        {
                            u: center,
                            v: PatternGenerator.#clamp(config.v + amp * 0.55, 0.03, 0.97)
                        }
                    ],
                    PatternGenerator.#colorAt(config.colorShift + index + 1, config.paletteSize),
                    false
                )
            }
        }
    }

    /**
     * Adds ray bundles converging to a single point.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addRayBand(strokes, config) {
        const bundleCount = Math.max(3, Math.round(config.cells * 0.42))
        const step = 1 / bundleCount
        const rayCount = Math.max(3, Math.round(4 + config.density * 7))
        const spanU = step * (0.5 + config.density * 0.18)
        const reachV = config.amplitude * (1.6 + config.density * 0.45)
        const direction = config.v <= 0.5 ? 1 : -1

        for (let bundleIndex = 0; bundleIndex < bundleCount; bundleIndex += 1) {
            const centerU = config.phase + (bundleIndex + 0.5) * step
            const centerV = config.v

            for (let rayIndex = 0; rayIndex < rayCount; rayIndex += 1) {
                const t = rayCount === 1 ? 0.5 : rayIndex / (rayCount - 1)
                const offset = t - 0.5
                const tip = {
                    u: centerU + offset * spanU,
                    v: PatternGenerator.#clamp(
                        centerV + direction * reachV * (1 - Math.abs(offset) * 0.45),
                        0.03,
                        0.97
                    )
                }
                const color = PatternGenerator.#colorAt(config.colorShift + bundleIndex + rayIndex, config.paletteSize)
                PatternGenerator.#pushStroke(strokes, [tip, { u: centerU, v: centerV }], color, false)
            }

            PatternGenerator.#addCircle(strokes, {
                centerU,
                centerV,
                radiusU: step * 0.06,
                radiusV: config.amplitude * 0.2,
                segments: 8,
                colorIndex: PatternGenerator.#colorAt(config.colorShift + bundleIndex + 1, config.paletteSize)
            })
        }
    }

    /**
     * Adds branch bundles with supporting tooth rows.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addPineBranchBand(strokes, config) {
        const branchCount = Math.max(4, Math.round(config.cells * 0.38))
        const step = 1 / branchCount
        const needles = Math.max(4, Math.round(4 + config.density * 3))
        const lean = step * 0.26
        const rise = config.amplitude * (1.8 + config.density * 0.4)
        const verticalDirection = config.v <= 0.5 ? 1 : -1

        for (let index = 0; index < branchCount; index += 1) {
            const baseU = config.phase + (index + 0.35) * step
            const baseV = config.v
            const branchDirection = index % 2 === 0 ? 1 : -1

            for (let needleIndex = 0; needleIndex < needles; needleIndex += 1) {
                const t = needleIndex / Math.max(1, needles - 1)
                const tip = {
                    u: baseU + branchDirection * lean * (0.45 + t * 0.55),
                    v: PatternGenerator.#clamp(baseV + verticalDirection * rise * (0.15 + t * 0.7), 0.03, 0.97)
                }
                const color = PatternGenerator.#colorAt(config.colorShift + index + needleIndex, config.paletteSize)
                PatternGenerator.#pushStroke(strokes, [{ u: baseU, v: baseV }, tip], color, false)
            }
        }
    }

    /**
     * Adds repeating groups of three dots arranged in a triangle.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, phase: number, paletteSize: number, colorShift: number }} config
     */
    static #addThreeDotsBand(strokes, config) {
        const groupCount = Math.max(4, Math.round(config.cells * 0.45))
        const step = 1 / groupCount
        const clusterSize = config.amplitude * (0.95 + config.density * 0.25)

        for (let index = 0; index < groupCount; index += 1) {
            const centerU = config.phase + (index + 0.5) * step
            PatternGenerator.#addThreeDotsCluster(strokes, {
                centerU,
                centerV: config.v,
                size: clusterSize,
                paletteSize: config.paletteSize,
                colorShift: config.colorShift + index
            })

            if (config.density >= 0.5) {
                const edge = clusterSize * 1.9
                const triangle = [
                    {
                        u: centerU,
                        v: PatternGenerator.#clamp(config.v - edge * 0.95, 0.03, 0.97)
                    },
                    {
                        u: centerU - edge,
                        v: PatternGenerator.#clamp(config.v + edge * 0.7, 0.03, 0.97)
                    },
                    {
                        u: centerU + edge,
                        v: PatternGenerator.#clamp(config.v + edge * 0.7, 0.03, 0.97)
                    }
                ]
                PatternGenerator.#pushStroke(
                    strokes,
                    triangle,
                    PatternGenerator.#colorAt(config.colorShift + index + 1, config.paletteSize),
                    true
                )
            }
        }
    }

    /**
     * Adds top and bottom rosettes as circular symbols with rays.
     * @param {Stroke[]} strokes
     * @param {{ rings: number[], count: number, density: number, paletteSize: number, colorShift: number }} config
     */
    static #addPolarRosettes(strokes, config) {
        const petals = Math.max(8, Math.round(10 + config.density * 8))
        config.rings.forEach((ringV, ringIndex) => {
            for (let index = 0; index < config.count; index += 1) {
                const centerU = index / config.count
                const centerV = ringV
                const baseColor = PatternGenerator.#colorAt(config.colorShift + index + ringIndex, config.paletteSize)
                const spanU = 0.026
                const spanV = 0.022

                for (let petalIndex = 0; petalIndex < petals; petalIndex += 1) {
                    const angle = (Math.PI * 2 * petalIndex) / petals
                    const tip = {
                        u: centerU + Math.cos(angle) * spanU,
                        v: PatternGenerator.#clamp(centerV + Math.sin(angle) * spanV, 0.02, 0.98)
                    }
                    PatternGenerator.#pushStroke(strokes, [{ u: centerU, v: centerV }, tip], baseColor, false)
                }

                PatternGenerator.#addCircle(strokes, {
                    centerU,
                    centerV,
                    radiusU: 0.006,
                    radiusV: 0.005,
                    segments: 8,
                    colorIndex: PatternGenerator.#colorAt(baseColor + 1, config.paletteSize)
                })
            }
        })
    }

    /**
     * Adds one horizontal ring around the full egg.
     * @param {Stroke[]} strokes
     * @param {number} v
     * @param {number} colorIndex
     */
    static #addRing(strokes, v, colorIndex) {
        const segments = 192
        const points = []
        for (let index = 0; index <= segments; index += 1) {
            points.push({
                u: index / segments,
                v: PatternGenerator.#clamp(v, 0, 1)
            })
        }
        PatternGenerator.#pushStroke(strokes, points, colorIndex, false)
    }

    /**
     * Adds a classic three-dot triangular cluster.
     * @param {Stroke[]} strokes
     * @param {{ centerU: number, centerV: number, size: number, paletteSize: number, colorShift: number }} config
     */
    static #addThreeDotsCluster(strokes, config) {
        const offset = config.size * 0.82
        const positions = [
            { u: config.centerU - offset, v: config.centerV + offset * 0.4 },
            { u: config.centerU + offset, v: config.centerV + offset * 0.4 },
            { u: config.centerU, v: config.centerV - offset * 0.72 }
        ]

        positions.forEach((position, index) => {
            PatternGenerator.#addCircle(strokes, {
                centerU: position.u,
                centerV: position.v,
                radiusU: config.size * 0.34,
                radiusV: config.size * 0.3,
                segments: 8,
                colorIndex: PatternGenerator.#colorAt(config.colorShift + index, config.paletteSize)
            })
        })
    }

    /**
     * Adds one approximated circle stroke.
     * @param {Stroke[]} strokes
     * @param {{ centerU: number, centerV: number, radiusU: number, radiusV: number, segments: number, colorIndex: number }} config
     */
    static #addCircle(strokes, config) {
        const points = []
        for (let index = 0; index < config.segments; index += 1) {
            const angle = (Math.PI * 2 * index) / config.segments
            points.push({
                u: config.centerU + Math.cos(angle) * config.radiusU,
                v: PatternGenerator.#clamp(config.centerV + Math.sin(angle) * config.radiusV, 0, 1)
            })
        }
        PatternGenerator.#pushStroke(strokes, points, config.colorIndex, true)
    }

    /**
     * Builds motif order from preset and enabled toggles.
     * @param {string} preset
     * @param {{ threeDots: boolean, rays: boolean, honeycomb: boolean, wolfTeeth: boolean, pineBranch: boolean, diamonds: boolean }} flags
     * @returns {string[]}
     */
    static #buildMotifSequence(preset, flags) {
        const enabled = (list) => list.filter((name) => Boolean(flags[name]))
        const presetMap = {
            punkte: enabled(['threeDots', 'wolfTeeth']),
            strahlen: enabled(['rays', 'wolfTeeth', 'threeDots']),
            wabe: enabled(['honeycomb', 'wolfTeeth', 'threeDots']),
            wolfszaehne: enabled(['wolfTeeth', 'diamonds', 'threeDots']),
            kiefernzweig: enabled(['pineBranch', 'wolfTeeth', 'threeDots']),
            'feder-raute': enabled(['diamonds', 'rays', 'wolfTeeth'])
        }

        if (presetMap[preset] && presetMap[preset].length) {
            return presetMap[preset]
        }

        const defaultOrder = enabled(['wolfTeeth', 'honeycomb', 'diamonds', 'rays', 'pineBranch', 'threeDots'])
        return defaultOrder
    }

    /**
     * Pushes a stroke with wrapping and clamped coordinates.
     * @param {Stroke[]} strokes
     * @param {UvPoint[]} points
     * @param {number} colorIndex
     * @param {boolean} closed
     */
    static #pushStroke(strokes, points, colorIndex, closed) {
        const sanitized = points
            .map((point) => ({
                u: PatternGenerator.#normalizeU(point.u),
                v: PatternGenerator.#clamp(point.v, 0, 1)
            }))
            .filter((point) => Number.isFinite(point.u) && Number.isFinite(point.v))

        if (sanitized.length < 2) return

        const stroke = {
            colorIndex,
            points: sanitized
        }
        if (closed) {
            stroke.closed = true
        }
        strokes.push(stroke)
    }

    /**
     * Creates deterministic pseudo-random generator.
     * @param {number} seed
     * @returns {() => number}
     */
    static #createRng(seed) {
        let state = seed >>> 0
        return () => {
            state += 0x6d2b79f5
            let value = Math.imul(state ^ (state >>> 15), 1 | state)
            value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296
        }
    }

    /**
     * Wraps U coordinate into [0,1).
     * @param {number} value
     * @returns {number}
     */
    static #normalizeU(value) {
        const wrapped = value % 1
        return wrapped < 0 ? wrapped + 1 : wrapped
    }

    /**
     * Clamps a numeric value.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static #clamp(value, min, max) {
        return Math.min(max, Math.max(min, value))
    }

    /**
     * Clamps and rounds an integer.
     * @param {unknown} value
     * @param {number} fallback
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    static #clampInt(value, fallback, min, max) {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) return fallback
        return Math.round(PatternGenerator.#clamp(parsed, min, max))
    }

    /**
     * Resolves stable color index.
     * @param {number} index
     * @param {number} paletteSize
     * @returns {number}
     */
    static #colorAt(index, paletteSize) {
        const size = Math.max(1, Math.round(paletteSize))
        const normalized = index % size
        return normalized < 0 ? normalized + size : normalized
    }
}
