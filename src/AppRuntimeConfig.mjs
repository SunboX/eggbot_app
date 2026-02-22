/**
 * Runtime defaults and preset mappings.
 */
export class AppRuntimeConfig {
    static #palette = ['#8b1f1a', '#1f3f8b', '#c78916', '#4c7f3b', '#2f2f2f', '#7a1f4f']

    /**
     * Creates a default app state object.
     * @returns {Record<string, any>}
     */
    static createDefaultState() {
        return {
            projectName: 'Sorbische Komposition',
            seed: 20260412,
            preset: 'traditional-mix',
            symmetry: 8,
            density: 0.58,
            bands: 6,
            ornamentSize: 1,
            ornamentCount: 1,
            ornamentDistribution: 1,
            lineWidth: 1.8,
            importHeightScale: 0.85,
            showHorizontalLines: true,
            baseColor: '#efe7ce',
            palette: AppRuntimeConfig.#palette.slice(0, 4),
            motifs: {
                dots: true,
                rays: true,
                honeycomb: true,
                wolfTeeth: true,
                pineBranch: false,
                diamonds: true
            },
            drawConfig: {
                baudRate: 9600,
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                msPerStep: 1.8,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false,
                penUpPercent: 35,
                penDownPercent: 60,
                penDownSpeed: 200,
                penUpSpeed: 200,
                penMotorSpeed: 4000,
                eggMotorSpeed: 4000,
                penRaiseRate: 50,
                penRaiseDelayMs: 200,
                penLowerRate: 20,
                penLowerDelayMs: 400,
                reversePenMotor: false,
                reverseEggMotor: false,
                wrapAround: true,
                returnHome: false,
                engraverEnabled: false,
                curveSmoothing: 0.2,
                setupApplyAction: 'toggle',
                manualCommand: 'disable-motors',
                manualWalkDistance: 3200,
                activeControlTab: 'plot'
            }
        }
    }

    /**
     * Returns defaults for motif selections by preset id.
     * @param {string} preset
     * @returns {Record<string, boolean>}
     */
    static presetMotifs(preset) {
        const map = {
            'traditional-mix': {
                dots: true,
                rays: true,
                honeycomb: true,
                wolfTeeth: true,
                pineBranch: true,
                diamonds: true
            },
            punkte: {
                dots: true,
                rays: false,
                honeycomb: false,
                wolfTeeth: false,
                pineBranch: false,
                diamonds: false
            },
            strahlen: {
                dots: false,
                rays: true,
                honeycomb: false,
                wolfTeeth: true,
                pineBranch: false,
                diamonds: false
            },
            wabe: {
                dots: false,
                rays: false,
                honeycomb: true,
                wolfTeeth: false,
                pineBranch: false,
                diamonds: true
            },
            wolfszaehne: {
                dots: false,
                rays: false,
                honeycomb: false,
                wolfTeeth: true,
                pineBranch: false,
                diamonds: false
            },
            kiefernzweig: {
                dots: true,
                rays: false,
                honeycomb: false,
                wolfTeeth: false,
                pineBranch: true,
                diamonds: false
            },
            'feder-raute': {
                dots: false,
                rays: false,
                honeycomb: false,
                wolfTeeth: true,
                pineBranch: false,
                diamonds: true
            }
        }
        return map[preset] ? { ...map[preset] } : { ...map['traditional-mix'] }
    }

    /**
     * Returns the baseline palette to grow the color list.
     * @returns {string[]}
     */
    static getDefaultPalette() {
        return [...AppRuntimeConfig.#palette]
    }
}
