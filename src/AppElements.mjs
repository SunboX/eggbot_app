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
        const queryAll = (selector) => Array.from(root.querySelectorAll(selector))

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
            baudRate: query('[data-baud-rate]'),
            serialConnect: query('[data-serial-connect]'),
            serialDisconnect: query('[data-serial-disconnect]'),
            eggbotControlOpen: query('[data-eggbot-control-open]'),
            eggbotDialogBackdrop: query('[data-eggbot-dialog-backdrop]'),
            eggbotDialog: query('[data-eggbot-dialog]'),
            eggbotDialogClose: query('[data-eggbot-dialog-close]'),
            eggbotDialogCloseIcon: query('[data-eggbot-dialog-close-icon]'),
            eggbotDialogApply: query('[data-eggbot-dialog-apply]'),
            eggbotTabButtons: queryAll('[data-eggbot-tab-button]'),
            eggbotTabPanels: queryAll('[data-eggbot-tab-panel]'),
            drawButton: query('[data-draw]'),
            stopButton: query('[data-stop]'),
            stepsPerTurn: query('[data-steps-per-turn]'),
            penRangeSteps: query('[data-pen-range-steps]'),
            msPerStep: query('[data-ms-per-step]'),
            servoUp: query('[data-servo-up]'),
            servoDown: query('[data-servo-down]'),
            invertPen: query('[data-invert-pen]'),
            controlPenUpPercent: query('[data-control-pen-up-percent]'),
            controlPenDownPercent: query('[data-control-pen-down-percent]'),
            controlSetupActionToggle: query('[data-control-setup-action-toggle]'),
            controlSetupActionRaiseOff: query('[data-control-setup-action-raise-off]'),
            controlSpeedPenDown: query('[data-control-speed-pen-down]'),
            controlSpeedPenUp: query('[data-control-speed-pen-up]'),
            controlSpeedPenMotor: query('[data-control-speed-pen-motor]'),
            controlSpeedEggMotor: query('[data-control-speed-egg-motor]'),
            controlPenRaiseRate: query('[data-control-pen-raise-rate]'),
            controlDelayAfterRaise: query('[data-control-delay-after-raise]'),
            controlPenLowerRate: query('[data-control-pen-lower-rate]'),
            controlDelayAfterLower: query('[data-control-delay-after-lower]'),
            controlReversePenMotor: query('[data-control-reverse-pen-motor]'),
            controlReverseEggMotor: query('[data-control-reverse-egg-motor]'),
            controlWrapsAround: query('[data-control-wraps-around]'),
            controlReturnHome: query('[data-control-return-home]'),
            controlEnableEngraver: query('[data-control-enable-engraver]'),
            controlCurveSmoothing: query('[data-control-curve-smoothing]'),
            controlManualCommand: query('[data-control-manual-command]'),
            controlWalkDistance: query('[data-control-walk-distance]'),
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
