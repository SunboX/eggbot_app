/**
 * DOM lookup helpers for the EggBot app.
 */
export class AppElements {
    /**
     * Queries all required app elements.
     * @param {Document} root
     * @returns {Record<string, HTMLElement>}
     */
    static query(root) {
        const query = (selector) => {
            const element = root.querySelector(selector)
            if (!element) {
                throw new Error(`Missing required element: ${selector}`)
            }
            return element
        }
        const queryOptional = (selector) => root.querySelector(selector)

        return {
            localeSelect: query('[data-locale-select]'),
            projectName: query('[data-project-name]'),
            preset: query('[data-preset]'),
            seed: query('[data-seed]'),
            rerollSeed: query('[data-reroll-seed]'),
            regenerate: query('[data-regenerate]'),
            loadPattern: query('[data-load-pattern]'),
            symmetry: query('[data-symmetry]'),
            symmetryLabel: query('[data-symmetry-label]'),
            density: query('[data-density]'),
            densityLabel: query('[data-density-label]'),
            bands: query('[data-bands]'),
            bandsLabel: query('[data-bands-label]'),
            ornamentSize: query('[data-ornament-size]'),
            ornamentSizeLabel: query('[data-ornament-size-label]'),
            ornamentCount: query('[data-ornament-count]'),
            ornamentCountLabel: query('[data-ornament-count-label]'),
            ornamentDistribution: query('[data-ornament-distribution]'),
            ornamentDistributionLabel: query('[data-ornament-distribution-label]'),
            lineWidth: query('[data-line-width]'),
            lineWidthLabel: query('[data-line-width-label]'),
            importHeightScale: query('[data-import-height-scale]'),
            importHeightScaleLabel: query('[data-import-height-scale-label]'),
            showHorizontalLines: query('[data-show-horizontal-lines]'),
            baseColor: query('[data-base-color]'),
            colorCount: query('[data-color-count]'),
            paletteList: query('[data-palette-list]'),
            motifDots: query('[data-motif-dots]'),
            motifRays: query('[data-motif-rays]'),
            motifHoneycomb: query('[data-motif-honeycomb]'),
            motifWolfTeeth: query('[data-motif-wolf-teeth]'),
            motifPine: query('[data-motif-pine]'),
            motifDiamond: query('[data-motif-diamond]'),
            serialConnect: query('[data-serial-connect]'),
            serialDisconnect: query('[data-serial-disconnect]'),
            drawButton: query('[data-draw]'),
            stopButton: query('[data-stop]'),
            stepsPerTurn: query('[data-steps-per-turn]'),
            penRangeSteps: query('[data-pen-range-steps]'),
            msPerStep: query('[data-ms-per-step]'),
            servoUp: query('[data-servo-up]'),
            servoDown: query('[data-servo-down]'),
            invertPen: query('[data-invert-pen]'),
            saveProject: query('[data-save-project]'),
            exportSvg: query('[data-export-svg]'),
            loadProject: query('[data-load-project]'),
            loadInput: query('[data-load-input]'),
            patternInput: query('[data-pattern-input]'),
            shareProject: query('[data-share-project]'),
            storeLocal: queryOptional('[data-store-local]'),
            localPatterns: queryOptional('[data-local-patterns]'),
            loadLocal: queryOptional('[data-load-local]'),
            deleteLocal: queryOptional('[data-delete-local]'),
            appVersion: query('[data-app-version]'),
            status: query('[data-status]'),
            eggCanvas: query('[data-egg-canvas]'),
            textureCanvas: query('[data-texture-canvas]')
        }
    }
}
