/**
 * @typedef {{ u: number, v: number }} UvPoint
 * @typedef {{ colorIndex: number, points: UvPoint[], closed?: boolean, transformGroupId?: number, horizontalRingGroup?: string, motifGroup?: string }} Stroke
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
        const ornamentSize = PatternGenerator.#clamp(Number(settings?.ornamentSize) || 1, 0.5, 2)
        const ornamentCount = PatternGenerator.#clamp(Number(settings?.ornamentCount) || 1, 0.5, 2)
        const ornamentDistribution = PatternGenerator.#clamp(Number(settings?.ornamentDistribution) || 1, 0.6, 1.6)
        const showHorizontalLines = settings?.showHorizontalLines !== false
        const paletteSize = Math.max(1, Array.isArray(settings?.palette) ? settings.palette.length : 4)
        const cells = Math.max(6, Math.round(symmetry * 2 * ornamentCount))
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
        const transformGroupCounter = { value: 1 }

        if (!motifSequence.length) {
            PatternGenerator.#addFallbackPattern(
                strokes,
                cells,
                paletteSize,
                showHorizontalLines,
                ornamentSize,
                transformGroupCounter
            )
            return strokes
        }

        const ringLevels = PatternGenerator.#buildBandLevels(bands, ornamentDistribution)
        const bandConfigs = ringLevels.map((level, bandIndex) => ({
            level,
            motifName: motifSequence[bandIndex % motifSequence.length]
        }))
        if (showHorizontalLines) {
            PatternGenerator.#addFrameworkRings(strokes, bandConfigs, paletteSize)
        }

        bandConfigs.forEach((band, bandIndex) => {
            const phase = Math.floor(rng() * cells) / cells
            const colorShift = bandIndex * 2
            const scale = (0.009 + density * 0.014) * ornamentSize
            PatternGenerator.#drawBandByMotif(strokes, {
                motifName: band.motifName,
                v: band.level,
                cells,
                density,
                amplitude: scale,
                sizeFactor: ornamentSize,
                phase,
                paletteSize,
                colorShift
            }, transformGroupCounter)
        })

        PatternGenerator.#addPolarRosettes(strokes, {
            rings: [0.13, 0.87],
            count: Math.max(3, Math.round((symmetry / 2) * ornamentCount)),
            paletteSize,
            density,
            sizeFactor: ornamentSize,
            colorShift: motifSequence.length + 2
        }, transformGroupCounter)

        return strokes
    }

    /**
     * Adds a minimal fallback when all motifs are disabled.
     * @param {Stroke[]} strokes
     * @param {number} cells
     * @param {number} paletteSize
     * @param {boolean} showHorizontalLines
     * @param {number} sizeFactor
     * @param {{ value: number }} transformGroupCounter
     */
    static #addFallbackPattern(strokes, cells, paletteSize, showHorizontalLines, sizeFactor, transformGroupCounter) {
        if (showHorizontalLines) {
            PatternGenerator.#addRing(strokes, 0.5, 0 % paletteSize, 'punkte')
        }
        const count = Math.max(8, cells)
        for (let index = 0; index < count; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
            const centerU = index / count
            PatternGenerator.#addThreeDotsCluster(strokes, {
                centerU,
                centerV: 0.5,
                size: 0.012 * sizeFactor,
                paletteSize,
                colorShift: index,
                transformGroupId,
                motifGroup: 'punkte'
            })
        }
    }

    /**
     * Returns mirrored band center levels around the egg equator.
     * @param {number} bands
     * @param {number} distributionFactor
     * @returns {number[]}
     */
    static #buildBandLevels(bands, distributionFactor) {
        const clampedBands = Math.max(1, bands)
        const factor = PatternGenerator.#clamp(Number(distributionFactor) || 1, 0.6, 1.6)
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

        return allLevels.map((level) => PatternGenerator.#clamp(0.5 + (level - 0.5) * factor, 0.03, 0.97))
    }

    /**
     * Adds framing rings around all motif bands.
     * @param {Stroke[]} strokes
     * @param {Array<{ level: number, motifName: string }>} bands
     * @param {number} paletteSize
     */
    static #addFrameworkRings(strokes, bands, paletteSize) {
        const ringEntries = new Map()
        const registerRing = (v, motifName, priority) => {
            const level = PatternGenerator.#clamp(v, 0.04, 0.96)
            const key = String(Math.round(level * 1000000))
            const existing = ringEntries.get(key)
            if (!existing || priority < existing.priority) {
                ringEntries.set(key, {
                    v: level,
                    motifName,
                    priority
                })
            }
        }

        const resolveNearestMotif = (v) => {
            if (!bands.length) return 'threeDots'
            let winner = bands[0]
            let winnerDistance = Math.abs(v - bands[0].level)
            for (let index = 1; index < bands.length; index += 1) {
                const candidate = bands[index]
                const distance = Math.abs(v - candidate.level)
                if (distance < winnerDistance) {
                    winner = candidate
                    winnerDistance = distance
                }
            }
            return winner.motifName
        }

        const baselineRingValues = [0.12, 0.5, 0.88]
        baselineRingValues.forEach((v) => {
            registerRing(v, resolveNearestMotif(v), 2)
        })
        bands.forEach((band) => {
            registerRing(band.level - 0.048, band.motifName, 1)
            registerRing(band.level + 0.048, band.motifName, 1)
        })

        Array.from(ringEntries.values())
            .sort((left, right) => left.v - right.v)
            .forEach((entry, index) => {
                PatternGenerator.#addRing(
                    strokes,
                    entry.v,
                    PatternGenerator.#colorAt(index, paletteSize),
                    PatternGenerator.#resolveOrnamentGroupFromMotif(entry.motifName)
                )
            })
    }

    /**
     * Draws one band with the selected motif.
     * @param {Stroke[]} strokes
     * @param {{ motifName: string, v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     */
    static #drawBandByMotif(strokes, config, transformGroupCounter) {
        const motifGroup = PatternGenerator.#resolveOrnamentGroupFromMotif(config.motifName)
        switch (config.motifName) {
            case 'wolfTeeth':
                PatternGenerator.#addWolfTeethBand(strokes, config, transformGroupCounter, motifGroup)
                break
            case 'honeycomb':
                PatternGenerator.#addHoneycombBand(strokes, config, transformGroupCounter, motifGroup)
                break
            case 'diamonds':
                PatternGenerator.#addDiamondBand(strokes, config, transformGroupCounter, motifGroup)
                break
            case 'rays':
                PatternGenerator.#addRayBand(strokes, config, transformGroupCounter, motifGroup)
                break
            case 'pineBranch':
                PatternGenerator.#addPineBranchBand(strokes, config, transformGroupCounter, motifGroup)
                break
            case 'threeDots':
            default:
                PatternGenerator.#addThreeDotsBand(strokes, config, transformGroupCounter, motifGroup)
                break
        }
    }

    /**
     * Adds a classic wolf-teeth band made from closed triangles.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addWolfTeethBand(strokes, config, transformGroupCounter, motifGroup) {
        const step = 1 / config.cells
        const amp = config.amplitude * (1.05 + config.density * 0.5)
        const halfWidth = (step * PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.6)) / 2

        for (let index = 0; index < config.cells; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
            const um = config.phase + (index + 0.5) * step
            const u0 = um - halfWidth
            const u1 = um + halfWidth
            const direction = index % 2 === 0 ? -1 : 1
            const triangle = [
                { u: u0, v: config.v },
                { u: um, v: PatternGenerator.#clamp(config.v + direction * amp, 0.03, 0.97) },
                { u: u1, v: config.v }
            ]
            const color = PatternGenerator.#colorAt(config.colorShift + (index % 2), config.paletteSize)
            PatternGenerator.#pushStroke(strokes, triangle, color, true, transformGroupId, undefined, motifGroup)
        }

        if (config.density >= 0.35) {
            const rowOffset = amp * 1.55
            for (let index = 0; index < config.cells; index += 1) {
                const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
                const um = config.phase + (index + 0.5) * step
                const u0 = um - halfWidth
                const u1 = um + halfWidth
                const direction = index % 2 === 0 ? 1 : -1
                const vBase = PatternGenerator.#clamp(config.v + rowOffset * (direction > 0 ? 1 : -1), 0.03, 0.97)
                const triangle = [
                    { u: u0, v: vBase },
                    { u: um, v: PatternGenerator.#clamp(vBase + direction * amp * 0.92, 0.03, 0.97) },
                    { u: u1, v: vBase }
                ]
                const color = PatternGenerator.#colorAt(config.colorShift + 1 + (index % 2), config.paletteSize)
                PatternGenerator.#pushStroke(strokes, triangle, color, true, transformGroupId, undefined, motifGroup)
            }
        }
    }

    /**
     * Adds honeycomb stars as six connected triangles with center dots.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addHoneycombBand(strokes, config, transformGroupCounter, motifGroup) {
        const unitCount = Math.max(4, Math.round(config.cells * 0.6))
        const step = 1 / unitCount
        const sizeFactor = PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.8)
        const outerU = step * 0.43 * sizeFactor
        const outerV = config.amplitude * (1.35 + config.density * 0.5)
        const innerU = step * 0.18 * sizeFactor
        const innerV = outerV * 0.43

        for (let index = 0; index < unitCount; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
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
                PatternGenerator.#pushStroke(strokes, triangle, color, true, transformGroupId, undefined, motifGroup)
            }

            if (config.density >= 0.2) {
                PatternGenerator.#addCircle(strokes, {
                    centerU,
                    centerV,
                    radiusU: step * 0.08 * sizeFactor,
                    radiusV: outerV * 0.14,
                    segments: 8,
                    colorIndex: PatternGenerator.#colorAt(config.colorShift + 2 + index, config.paletteSize),
                    transformGroupId,
                    motifGroup
                })
            }
        }
    }

    /**
     * Adds repeating diamonds and inner feather lines.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addDiamondBand(strokes, config, transformGroupCounter, motifGroup) {
        const step = 1 / config.cells
        const amp = config.amplitude * (1.2 + config.density * 0.45)
        const halfWidth = (step * PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.6)) / 2

        for (let index = 0; index < config.cells; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
            const center = config.phase + (index + 0.5) * step
            const left = center - halfWidth
            const right = center + halfWidth
            const diamond = [
                { u: center, v: PatternGenerator.#clamp(config.v - amp, 0.03, 0.97) },
                { u: right, v: config.v },
                { u: center, v: PatternGenerator.#clamp(config.v + amp, 0.03, 0.97) },
                { u: left, v: config.v }
            ]
            const color = PatternGenerator.#colorAt(config.colorShift + index, config.paletteSize)
            PatternGenerator.#pushStroke(strokes, diamond, color, true, transformGroupId, undefined, motifGroup)

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
                    false,
                    transformGroupId,
                    undefined,
                    motifGroup
                )
            }
        }
    }

    /**
     * Adds ray bundles converging to a single point.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addRayBand(strokes, config, transformGroupCounter, motifGroup) {
        const bundleCount = Math.max(3, Math.round(config.cells * 0.42))
        const step = 1 / bundleCount
        const rayCount = Math.max(3, Math.round(4 + config.density * 7))
        const spanU = step * (0.5 + config.density * 0.18) * PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.8)
        const reachV = config.amplitude * (1.6 + config.density * 0.45)
        const direction = config.v <= 0.5 ? 1 : -1

        for (let bundleIndex = 0; bundleIndex < bundleCount; bundleIndex += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
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
                PatternGenerator.#pushStroke(
                    strokes,
                    [tip, { u: centerU, v: centerV }],
                    color,
                    false,
                    transformGroupId,
                    undefined,
                    motifGroup
                )
            }

            PatternGenerator.#addCircle(strokes, {
                centerU,
                centerV,
                radiusU: step * 0.06 * PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.8),
                radiusV: config.amplitude * 0.2,
                segments: 8,
                colorIndex: PatternGenerator.#colorAt(config.colorShift + bundleIndex + 1, config.paletteSize),
                transformGroupId,
                motifGroup
            })
        }
    }

    /**
     * Adds branch bundles with supporting tooth rows.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addPineBranchBand(strokes, config, transformGroupCounter, motifGroup) {
        const branchCount = Math.max(4, Math.round(config.cells * 0.38))
        const step = 1 / branchCount
        const needles = Math.max(4, Math.round(4 + config.density * 3))
        const lean = step * 0.26 * PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.8)
        const rise = config.amplitude * (1.8 + config.density * 0.4)
        const verticalDirection = config.v <= 0.5 ? 1 : -1

        for (let index = 0; index < branchCount; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
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
                PatternGenerator.#pushStroke(
                    strokes,
                    [{ u: baseU, v: baseV }, tip],
                    color,
                    false,
                    transformGroupId,
                    undefined,
                    motifGroup
                )
            }
        }
    }

    /**
     * Adds repeating groups of three dots arranged in a triangle.
     * @param {Stroke[]} strokes
     * @param {{ v: number, cells: number, density: number, amplitude: number, sizeFactor: number, phase: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     * @param {string} motifGroup
     */
    static #addThreeDotsBand(strokes, config, transformGroupCounter, motifGroup) {
        const groupCount = Math.max(4, Math.round(config.cells * 0.45))
        const step = 1 / groupCount
        const clusterSize = config.amplitude * (0.95 + config.density * 0.25)

        for (let index = 0; index < groupCount; index += 1) {
            const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
            const centerU = config.phase + (index + 0.5) * step
            PatternGenerator.#addThreeDotsCluster(strokes, {
                centerU,
                centerV: config.v,
                size: clusterSize,
                paletteSize: config.paletteSize,
                colorShift: config.colorShift + index,
                transformGroupId,
                motifGroup
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
                    true,
                    transformGroupId,
                    undefined,
                    motifGroup
                )
            }
        }
    }

    /**
     * Adds top and bottom rosettes as circular symbols with rays.
     * @param {Stroke[]} strokes
     * @param {{ rings: number[], count: number, density: number, sizeFactor: number, paletteSize: number, colorShift: number }} config
     * @param {{ value: number }} transformGroupCounter
     */
    static #addPolarRosettes(strokes, config, transformGroupCounter) {
        const petals = Math.max(8, Math.round(10 + config.density * 8))
        const sizeFactor = PatternGenerator.#clamp(config.sizeFactor, 0.5, 1.8)
        const motifGroup = 'strahlen'
        config.rings.forEach((ringV, ringIndex) => {
            for (let index = 0; index < config.count; index += 1) {
                const transformGroupId = PatternGenerator.#allocateTransformGroupId(transformGroupCounter)
                const centerU = index / config.count
                const centerV = ringV
                const baseColor = PatternGenerator.#colorAt(config.colorShift + index + ringIndex, config.paletteSize)
                const spanU = 0.026 * sizeFactor
                const spanV = 0.022 * sizeFactor

                for (let petalIndex = 0; petalIndex < petals; petalIndex += 1) {
                    const angle = (Math.PI * 2 * petalIndex) / petals
                    const tip = {
                        u: centerU + Math.cos(angle) * spanU,
                        v: PatternGenerator.#clamp(centerV + Math.sin(angle) * spanV, 0.02, 0.98)
                    }
                    PatternGenerator.#pushStroke(
                        strokes,
                        [{ u: centerU, v: centerV }, tip],
                        baseColor,
                        false,
                        transformGroupId,
                        undefined,
                        motifGroup
                    )
                }

                PatternGenerator.#addCircle(strokes, {
                    centerU,
                    centerV,
                    radiusU: 0.006 * sizeFactor,
                    radiusV: 0.005 * sizeFactor,
                    segments: 8,
                    colorIndex: PatternGenerator.#colorAt(baseColor + 1, config.paletteSize),
                    transformGroupId,
                    motifGroup
                })
            }
        })
    }

    /**
     * Adds one horizontal ring around the full egg.
     * @param {Stroke[]} strokes
     * @param {number} v
     * @param {number} colorIndex
     * @param {string} [horizontalRingGroup]
     */
    static #addRing(strokes, v, colorIndex, horizontalRingGroup) {
        const segments = 192
        const points = []
        for (let index = 0; index <= segments; index += 1) {
            points.push({
                u: index / segments,
                v: PatternGenerator.#clamp(v, 0, 1)
            })
        }
        PatternGenerator.#pushStroke(strokes, points, colorIndex, false, undefined, horizontalRingGroup)
    }

    /**
     * Adds a classic three-dot triangular cluster.
     * @param {Stroke[]} strokes
     * @param {{ centerU: number, centerV: number, size: number, paletteSize: number, colorShift: number, transformGroupId?: number, motifGroup?: string }} config
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
                colorIndex: PatternGenerator.#colorAt(config.colorShift + index, config.paletteSize),
                transformGroupId: config.transformGroupId,
                motifGroup: config.motifGroup
            })
        })
    }

    /**
     * Adds one approximated circle stroke.
     * @param {Stroke[]} strokes
     * @param {{ centerU: number, centerV: number, radiusU: number, radiusV: number, segments: number, colorIndex: number, transformGroupId?: number, motifGroup?: string }} config
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
        PatternGenerator.#pushStroke(strokes, points, config.colorIndex, true, config.transformGroupId, undefined, config.motifGroup)
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
     * Resolves one ornament export group key from motif name.
     * @param {string} motifName
     * @returns {string}
     */
    static #resolveOrnamentGroupFromMotif(motifName) {
        const mapping = {
            threeDots: 'punkte',
            rays: 'strahlen',
            honeycomb: 'wabe',
            wolfTeeth: 'wolfszaehne',
            pineBranch: 'kiefernzweig',
            diamonds: 'feder-raute'
        }
        return mapping[motifName] || 'punkte'
    }

    /**
     * Pushes a stroke with wrapping and clamped coordinates.
     * @param {Stroke[]} strokes
     * @param {UvPoint[]} points
     * @param {number} colorIndex
     * @param {boolean} closed
     * @param {number} [transformGroupId]
     * @param {string} [horizontalRingGroup]
     * @param {string} [motifGroup]
     */
    static #pushStroke(strokes, points, colorIndex, closed, transformGroupId, horizontalRingGroup, motifGroup) {
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
        if (Number.isFinite(transformGroupId)) {
            stroke.transformGroupId = Math.trunc(Number(transformGroupId))
        }
        const ringGroup = String(horizontalRingGroup || '').trim()
        if (ringGroup) {
            stroke.horizontalRingGroup = ringGroup
        }
        const normalizedMotifGroup = String(motifGroup || '').trim()
        if (normalizedMotifGroup) {
            stroke.motifGroup = normalizedMotifGroup
        }
        strokes.push(stroke)
    }

    /**
     * Allocates one stable transform-group id.
     * @param {{ value: number }} counter
     * @returns {number}
     */
    static #allocateTransformGroupId(counter) {
        const nextId = Math.max(1, Math.trunc(Number(counter?.value) || 1))
        counter.value = nextId + 1
        return nextId
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
