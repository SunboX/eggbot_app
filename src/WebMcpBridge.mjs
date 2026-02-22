/**
 * @typedef {{ message?: string, data?: Record<string, unknown>, state?: Record<string, unknown> }} WebMcpCommandResult
 */
/**
 * @typedef {{
 * getState: () => Promise<Record<string, unknown>> | Record<string, unknown>,
 * setDesignSettings: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * setColorSettings: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * setMotifSettings: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * setDrawConfig: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * rerollSeed: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * regeneratePattern: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * importSvgText: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * applyProjectJson: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * getProjectJson: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * getShareUrl: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * buildExportSvg: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * localProjectsList: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * localProjectStore: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * localProjectLoad: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * localProjectDelete: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * serialConnect: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * serialDisconnect: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * serialDraw: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * serialStop: () => Promise<WebMcpCommandResult> | WebMcpCommandResult,
 * setLocale: (args: Record<string, unknown>) => Promise<WebMcpCommandResult> | WebMcpCommandResult
 * }} WebMcpBridgeCommands
 */
/**
 * @typedef {{
 * commands: WebMcpBridgeCommands,
 * root?: Document
 * }} WebMcpBridgeOptions
 */
/**
 * @typedef {{
 * name: string,
 * description: string,
 * inputSchema: Record<string, unknown>,
 * execute: (args?: Record<string, unknown>) => Promise<Record<string, unknown>>
 * }} WebMcpToolDescriptor
 */
const TOOL_ACTIONS = {
    getState: 'eggbot_get_state',
    setDesignSettings: 'eggbot_set_design_settings',
    setColorSettings: 'eggbot_set_color_settings',
    setMotifSettings: 'eggbot_set_motif_settings',
    setDrawConfig: 'eggbot_set_draw_config',
    rerollSeed: 'eggbot_reroll_seed',
    regeneratePattern: 'eggbot_regenerate_pattern',
    importSvgText: 'eggbot_import_svg_text',
    applyProjectJson: 'eggbot_apply_project_json',
    getProjectJson: 'eggbot_get_project_json',
    getShareUrl: 'eggbot_get_share_url',
    buildExportSvg: 'eggbot_build_export_svg',
    localProjectsList: 'eggbot_local_projects_list',
    localProjectStore: 'eggbot_local_project_store',
    localProjectLoad: 'eggbot_local_project_load',
    localProjectDelete: 'eggbot_local_project_delete',
    serialConnect: 'eggbot_serial_connect',
    serialDisconnect: 'eggbot_serial_disconnect',
    serialDraw: 'eggbot_serial_draw',
    serialStop: 'eggbot_serial_stop',
    setLocale: 'eggbot_set_locale'
}

const DECLARATIVE_TOOL_ACTIONS = {
    applyDesign: 'eggbot_form_apply_design',
    applyProjectJson: 'eggbot_form_apply_project_json',
    machineAction: 'eggbot_form_machine_action',
    localProjectAction: 'eggbot_form_local_project_action'
}

/**
 * WebMCP registration, imperative tool handling, and declarative form adapters.
 */
export class WebMcpBridge {
    /**
     * @type {WebMcpBridgeCommands}
     */
    #commands
    /**
     * @type {Document}
     */
    #root
    /**
     * @param {WebMcpBridgeOptions} options
     */
    constructor(options) {
        if (!options || typeof options !== 'object') {
            throw new Error('WebMcpBridge requires options.')
        }
        if (!options.commands || typeof options.commands !== 'object') {
            throw new Error('WebMcpBridge requires command callbacks.')
        }
        this.#commands = options.commands
        this.#root = options.root || document
    }

    /**
     * Initializes WebMCP tools and declarative form submit adapters.
     * @returns {boolean}
     */
    init() {
        this.#bindDeclarativeFormSubmitHandlers()
        const modelContext = this.#resolveModelContext()
        if (!modelContext || typeof modelContext.provideContext !== 'function') {
            return false
        }
        modelContext.provideContext({
            tools: this.#buildImperativeToolDescriptors()
        })
        this.#registerDeclarativeAliasTools(modelContext)
        return true
    }

    /**
     * Registers alias tools that mirror the declarative form actions.
     * This keeps the tools callable in non-native declarative runtimes.
     * @param {Record<string, unknown>} modelContext
     */
    #registerDeclarativeAliasTools(modelContext) {
        if (typeof modelContext.registerTool !== 'function') {
            return
        }
        this.#buildDeclarativeAliasToolDescriptors().forEach((tool) => {
            try {
                modelContext.registerTool(tool)
            } catch (error) {
                if (!WebMcpBridge.#isToolNameCollisionError(error)) {
                    throw error
                }
            }
        })
    }

    /**
     * Resolves navigator.modelContext when available.
     * @returns {Record<string, unknown> | null}
     */
    #resolveModelContext() {
        if (typeof navigator === 'undefined' || !navigator) {
            return null
        }
        return navigator.modelContext && typeof navigator.modelContext === 'object' ? navigator.modelContext : null
    }

    /**
     * Returns imperative tool descriptors for all app-level operations.
     * @returns {WebMcpToolDescriptor[]}
     */
    #buildImperativeToolDescriptors() {
        return [
            {
                name: TOOL_ACTIONS.getState,
                description: 'Return the current full EggBot app state snapshot.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#executeGetState()
            },
            {
                name: TOOL_ACTIONS.setDesignSettings,
                description: 'Patch design controls such as seed, density, symmetry, and regenerate options.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        seed: { type: 'integer' },
                        preset: { type: 'string' },
                        symmetry: { type: 'integer' },
                        density: { type: 'number' },
                        bands: { type: 'integer' },
                        ornamentSize: { type: 'number' },
                        ornamentCount: { type: 'number' },
                        ornamentDistribution: { type: 'number' },
                        lineWidth: { type: 'number' },
                        importHeightScale: { type: 'number' },
                        showHorizontalLines: { type: 'boolean' },
                        fillPatterns: { type: 'boolean' },
                        rerollSeed: { type: 'boolean' },
                        regenerate: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#executeSetDesignSettings(args, TOOL_ACTIONS.setDesignSettings)
            },
            {
                name: TOOL_ACTIONS.setColorSettings,
                description: 'Patch base color and palette values.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        baseColor: { type: 'string' },
                        palette: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 1,
                            maxItems: 6
                        }
                    },
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.setColorSettings, () =>
                    this.#commands.setColorSettings(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.setMotifSettings,
                description: 'Patch motif toggles for generated ornaments.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        dots: { type: 'boolean' },
                        rays: { type: 'boolean' },
                        honeycomb: { type: 'boolean' },
                        wolfTeeth: { type: 'boolean' },
                        pineBranch: { type: 'boolean' },
                        diamonds: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.setMotifSettings, () =>
                    this.#commands.setMotifSettings(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.setDrawConfig,
                description: 'Patch EggBot draw mapping settings.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        baudRate: { type: 'integer' },
                        stepsPerTurn: { type: 'integer' },
                        penRangeSteps: { type: 'integer' },
                        msPerStep: { type: 'number' },
                        servoUp: { type: 'integer' },
                        servoDown: { type: 'integer' },
                        invertPen: { type: 'boolean' },
                        penUpPercent: { type: 'number' },
                        penDownPercent: { type: 'number' },
                        penDownSpeed: { type: 'integer' },
                        penUpSpeed: { type: 'integer' },
                        penMotorSpeed: { type: 'integer' },
                        eggMotorSpeed: { type: 'integer' },
                        penRaiseRate: { type: 'integer' },
                        penRaiseDelayMs: { type: 'integer' },
                        penLowerRate: { type: 'integer' },
                        penLowerDelayMs: { type: 'integer' },
                        reversePenMotor: { type: 'boolean' },
                        reverseEggMotor: { type: 'boolean' },
                        wrapAround: { type: 'boolean' },
                        returnHome: { type: 'boolean' },
                        printColorMode: { type: 'string', enum: ['single', 'per-color'] },
                        engraverEnabled: { type: 'boolean' },
                        curveSmoothing: { type: 'number' },
                        setupApplyAction: { type: 'string' },
                        manualCommand: { type: 'string' },
                        manualWalkDistance: { type: 'integer' },
                        activeControlTab: { type: 'string' }
                    },
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.setDrawConfig, () =>
                    this.#commands.setDrawConfig(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.rerollSeed,
                description: 'Generate a new seed value and re-render the pattern.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.rerollSeed, () => this.#commands.rerollSeed())
            },
            {
                name: TOOL_ACTIONS.regeneratePattern,
                description: 'Re-render pattern output using the current state.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.regeneratePattern, () => this.#commands.regeneratePattern())
            },
            {
                name: TOOL_ACTIONS.importSvgText,
                description: 'Import a pattern from raw SVG text.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        svgText: { type: 'string' },
                        fileName: { type: 'string' },
                        importHeightScale: { type: 'number' }
                    },
                    required: ['svgText'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.importSvgText, () =>
                    this.#commands.importSvgText(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.applyProjectJson,
                description: 'Apply project JSON content to app state.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        project: {}
                    },
                    required: ['project'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.applyProjectJson, () =>
                    this.#commands.applyProjectJson(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.getProjectJson,
                description: 'Return a normalized project payload and suggested filename.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.getProjectJson, () => this.#commands.getProjectJson())
            },
            {
                name: TOOL_ACTIONS.getShareUrl,
                description: 'Return a share URL embedding current project state.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.getShareUrl, () => this.#commands.getShareUrl())
            },
            {
                name: TOOL_ACTIONS.buildExportSvg,
                description: 'Return SVG export text and suggested filename for current pattern.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.buildExportSvg, () => this.#commands.buildExportSvg())
            },
            {
                name: TOOL_ACTIONS.localProjectsList,
                description: 'List locally stored project entries.',
                inputSchema: WebMcpBridge.#emptyObjectSchema(),
                execute: async () => this.#runCommand(TOOL_ACTIONS.localProjectsList, () => this.#commands.localProjectsList())
            },
            {
                name: TOOL_ACTIONS.localProjectStore,
                description: 'Store current project to browser local storage.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' }
                    },
                    required: ['name'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.localProjectStore, () =>
                    this.#commands.localProjectStore(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.localProjectLoad,
                description: 'Load one local project entry by id.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }
                    },
                    required: ['id'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.localProjectLoad, () =>
                    this.#commands.localProjectLoad(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.localProjectDelete,
                description: 'Delete one local project entry by id. Requires confirmation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        confirm: { type: 'boolean' }
                    },
                    required: ['id', 'confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runDangerousCommand(
                    TOOL_ACTIONS.localProjectDelete,
                    WebMcpBridge.#toObjectArgs(args),
                    () => this.#commands.localProjectDelete(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: TOOL_ACTIONS.serialConnect,
                description: 'Connect EggBot USB serial. Requires confirmation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        confirm: { type: 'boolean' }
                    },
                    required: ['confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runDangerousCommand(
                    TOOL_ACTIONS.serialConnect,
                    WebMcpBridge.#toObjectArgs(args),
                    () => this.#commands.serialConnect()
                )
            },
            {
                name: TOOL_ACTIONS.serialDisconnect,
                description: 'Disconnect EggBot USB serial. Requires confirmation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        confirm: { type: 'boolean' }
                    },
                    required: ['confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runDangerousCommand(
                    TOOL_ACTIONS.serialDisconnect,
                    WebMcpBridge.#toObjectArgs(args),
                    () => this.#commands.serialDisconnect()
                )
            },
            {
                name: TOOL_ACTIONS.serialDraw,
                description: 'Start drawing current pattern on EggBot. Requires confirmation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        confirm: { type: 'boolean' }
                    },
                    required: ['confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runDangerousCommand(
                    TOOL_ACTIONS.serialDraw,
                    WebMcpBridge.#toObjectArgs(args),
                    () => this.#commands.serialDraw()
                )
            },
            {
                name: TOOL_ACTIONS.serialStop,
                description: 'Stop active EggBot drawing process. Requires confirmation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        confirm: { type: 'boolean' }
                    },
                    required: ['confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runDangerousCommand(
                    TOOL_ACTIONS.serialStop,
                    WebMcpBridge.#toObjectArgs(args),
                    () => this.#commands.serialStop()
                )
            },
            {
                name: TOOL_ACTIONS.setLocale,
                description: 'Set application locale and refresh localized UI text.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        locale: { type: 'string', enum: ['en', 'de'] }
                    },
                    required: ['locale'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(TOOL_ACTIONS.setLocale, () =>
                    this.#commands.setLocale(WebMcpBridge.#toObjectArgs(args))
                )
            }
        ]
    }

    /**
     * Builds imperative aliases for declarative form actions.
     * @returns {WebMcpToolDescriptor[]}
     */
    #buildDeclarativeAliasToolDescriptors() {
        return [
            {
                name: DECLARATIVE_TOOL_ACTIONS.applyDesign,
                description: 'Declarative alias: apply design settings patch.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        seed: { type: 'integer' },
                        preset: { type: 'string' },
                        symmetry: { type: 'integer' },
                        density: { type: 'number' },
                        bands: { type: 'integer' },
                        ornamentSize: { type: 'number' },
                        ornamentCount: { type: 'number' },
                        ornamentDistribution: { type: 'number' },
                        lineWidth: { type: 'number' },
                        importHeightScale: { type: 'number' },
                        showHorizontalLines: { type: 'boolean' },
                        fillPatterns: { type: 'boolean' },
                        rerollSeed: { type: 'boolean' },
                        regenerate: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#executeSetDesignSettings(args, DECLARATIVE_TOOL_ACTIONS.applyDesign)
            },
            {
                name: DECLARATIVE_TOOL_ACTIONS.applyProjectJson,
                description: 'Declarative alias: apply project JSON payload.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        project: {}
                    },
                    required: ['project'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#runCommand(DECLARATIVE_TOOL_ACTIONS.applyProjectJson, () =>
                    this.#commands.applyProjectJson(WebMcpBridge.#toObjectArgs(args))
                )
            },
            {
                name: DECLARATIVE_TOOL_ACTIONS.machineAction,
                description: 'Declarative alias: run EggBot machine action.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['connect', 'disconnect', 'draw', 'stop']
                        },
                        confirm: { type: 'boolean' }
                    },
                    required: ['action', 'confirm'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#executeDeclarativeMachineAction(WebMcpBridge.#toObjectArgs(args))
            },
            {
                name: DECLARATIVE_TOOL_ACTIONS.localProjectAction,
                description: 'Declarative alias: run local project operation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['list', 'store', 'load', 'delete']
                        },
                        name: { type: 'string' },
                        id: { type: 'string' },
                        confirm: { type: 'boolean' }
                    },
                    required: ['action'],
                    additionalProperties: false
                },
                execute: async (args = {}) => this.#executeDeclarativeLocalProjectAction(WebMcpBridge.#toObjectArgs(args))
            }
        ]
    }

    /**
     * Executes the state snapshot command.
     * @returns {Promise<Record<string, unknown>>}
     */
    async #executeGetState() {
        try {
            const state = await this.#commands.getState()
            return this.#buildSuccessResponse(TOOL_ACTIONS.getState, 'State snapshot ready.', undefined, state)
        } catch (error) {
            return this.#buildErrorResponse(TOOL_ACTIONS.getState, WebMcpBridge.#toErrorMessage(error))
        }
    }

    /**
     * Executes set-design command and shared declarative alias.
     * @param {Record<string, unknown>} args
     * @param {string} action
     * @returns {Promise<Record<string, unknown>>}
     */
    async #executeSetDesignSettings(args, action) {
        return this.#runCommand(action, () => this.#commands.setDesignSettings(WebMcpBridge.#toObjectArgs(args)))
    }

    /**
     * Runs declarative machine action alias.
     * @param {Record<string, unknown>} args
     * @returns {Promise<Record<string, unknown>>}
     */
    async #executeDeclarativeMachineAction(args) {
        const action = String(args.action || '').trim().toLowerCase()
        switch (action) {
            case 'connect':
                return this.#runDangerousCommand(DECLARATIVE_TOOL_ACTIONS.machineAction, args, () => this.#commands.serialConnect())
            case 'disconnect':
                return this.#runDangerousCommand(DECLARATIVE_TOOL_ACTIONS.machineAction, args, () =>
                    this.#commands.serialDisconnect()
                )
            case 'draw':
                return this.#runDangerousCommand(DECLARATIVE_TOOL_ACTIONS.machineAction, args, () => this.#commands.serialDraw())
            case 'stop':
                return this.#runDangerousCommand(DECLARATIVE_TOOL_ACTIONS.machineAction, args, () => this.#commands.serialStop())
            default:
                return this.#buildErrorResponse(
                    DECLARATIVE_TOOL_ACTIONS.machineAction,
                    'Invalid machine action. Use connect, disconnect, draw, or stop.'
                )
        }
    }

    /**
     * Runs declarative local project action alias.
     * @param {Record<string, unknown>} args
     * @returns {Promise<Record<string, unknown>>}
     */
    async #executeDeclarativeLocalProjectAction(args) {
        const action = String(args.action || '').trim().toLowerCase()
        switch (action) {
            case 'list':
                return this.#runCommand(DECLARATIVE_TOOL_ACTIONS.localProjectAction, () => this.#commands.localProjectsList())
            case 'store':
                return this.#runCommand(DECLARATIVE_TOOL_ACTIONS.localProjectAction, () =>
                    this.#commands.localProjectStore({ name: String(args.name || '') })
                )
            case 'load':
                return this.#runCommand(DECLARATIVE_TOOL_ACTIONS.localProjectAction, () =>
                    this.#commands.localProjectLoad({ id: String(args.id || '') })
                )
            case 'delete':
                return this.#runDangerousCommand(DECLARATIVE_TOOL_ACTIONS.localProjectAction, args, () =>
                    this.#commands.localProjectDelete({ id: String(args.id || '') })
                )
            default:
                return this.#buildErrorResponse(
                    DECLARATIVE_TOOL_ACTIONS.localProjectAction,
                    'Invalid local project action. Use list, store, load, or delete.'
                )
        }
    }

    /**
     * Runs one command callback and always returns a normalized tool response.
     * @param {string} action
     * @param {() => Promise<WebMcpCommandResult | string | undefined> | WebMcpCommandResult | string | undefined} callback
     * @returns {Promise<Record<string, unknown>>}
     */
    async #runCommand(action, callback) {
        try {
            const rawResult = await callback()
            const normalizedResult = WebMcpBridge.#normalizeCommandResult(rawResult)
            return this.#buildSuccessResponse(action, normalizedResult.message, normalizedResult.data, normalizedResult.state)
        } catch (error) {
            return this.#buildErrorResponse(action, WebMcpBridge.#toErrorMessage(error))
        }
    }

    /**
     * Runs one dangerous command and enforces explicit confirmation.
     * @param {string} action
     * @param {Record<string, unknown>} args
     * @param {() => Promise<WebMcpCommandResult | string | undefined> | WebMcpCommandResult | string | undefined} callback
     * @returns {Promise<Record<string, unknown>>}
     */
    async #runDangerousCommand(action, args, callback) {
        if (!WebMcpBridge.#isConfirmed(args.confirm)) {
            return this.#buildErrorResponse(action, 'Confirmation required. Pass { "confirm": true }.', {
                requiresConfirmation: true
            })
        }
        return this.#runCommand(action, callback)
    }

    /**
     * Builds a successful tool response payload.
     * @param {string} action
     * @param {string} message
     * @param {Record<string, unknown> | undefined} data
     * @param {Record<string, unknown> | undefined} state
     * @returns {Record<string, unknown>}
     */
    #buildSuccessResponse(action, message, data, state) {
        return WebMcpBridge.#buildResponse({
            ok: true,
            action,
            message,
            data,
            state
        })
    }

    /**
     * Builds an error tool response payload.
     * @param {string} action
     * @param {string} message
     * @param {Record<string, unknown>} [data]
     * @returns {Record<string, unknown>}
     */
    #buildErrorResponse(action, message, data = {}) {
        return WebMcpBridge.#buildResponse({
            ok: false,
            action,
            message,
            data,
            isError: true
        })
    }

    /**
     * Binds declarative form submit handlers to command callbacks.
     */
    #bindDeclarativeFormSubmitHandlers() {
        const designForm = this.#root.querySelector('[data-webmcp-form-design]')
        if (WebMcpBridge.#isFormElement(designForm)) {
            this.#attachSubmitHandler(designForm, () => this.#handleDesignDeclarativeSubmit(designForm))
        }

        const projectForm = this.#root.querySelector('[data-webmcp-form-project]')
        if (WebMcpBridge.#isFormElement(projectForm)) {
            this.#attachSubmitHandler(projectForm, () => this.#handleProjectDeclarativeSubmit(projectForm))
        }

        const machineForm = this.#root.querySelector('[data-webmcp-form-machine]')
        if (WebMcpBridge.#isFormElement(machineForm)) {
            this.#attachSubmitHandler(machineForm, () => this.#handleMachineDeclarativeSubmit(machineForm))
        }

        const localForm = this.#root.querySelector('[data-webmcp-form-local]')
        if (WebMcpBridge.#isFormElement(localForm)) {
            this.#attachSubmitHandler(localForm, () => this.#handleLocalDeclarativeSubmit(localForm))
        }
    }

    /**
     * Attaches one declarative submit handler and forwards the result via respondWith when available.
     * @param {HTMLFormElement} form
     * @param {() => Promise<Record<string, unknown>>} callback
     */
    #attachSubmitHandler(form, callback) {
        form.addEventListener('submit', (event) => {
            event.preventDefault()
            const resultPromise = callback().catch((error) => {
                return this.#buildErrorResponse('declarative_submit', WebMcpBridge.#toErrorMessage(error))
            })
            form.__webMcpLastResultPromise = resultPromise

            if (typeof event.respondWith === 'function') {
                event.respondWith(resultPromise)
            } else {
                resultPromise.catch(() => {})
            }
        })
    }

    /**
     * Handles declarative design form submissions.
     * @param {HTMLFormElement} form
     * @returns {Promise<Record<string, unknown>>}
     */
    async #handleDesignDeclarativeSubmit(form) {
        const formData = WebMcpBridge.#createFormData(form)
        const args = {}

        const maybeSeed = WebMcpBridge.#toOptionalInt(formData.get('seed'))
        if (maybeSeed !== undefined) args.seed = maybeSeed
        const maybePreset = WebMcpBridge.#toOptionalString(formData.get('preset'))
        if (maybePreset) args.preset = maybePreset
        const maybeSymmetry = WebMcpBridge.#toOptionalInt(formData.get('symmetry'))
        if (maybeSymmetry !== undefined) args.symmetry = maybeSymmetry
        const maybeDensity = WebMcpBridge.#toOptionalNumber(formData.get('density'))
        if (maybeDensity !== undefined) args.density = maybeDensity
        const maybeBands = WebMcpBridge.#toOptionalInt(formData.get('bands'))
        if (maybeBands !== undefined) args.bands = maybeBands
        const maybeOrnamentSize = WebMcpBridge.#toOptionalNumber(formData.get('ornamentSize'))
        if (maybeOrnamentSize !== undefined) args.ornamentSize = maybeOrnamentSize
        const maybeOrnamentCount = WebMcpBridge.#toOptionalNumber(formData.get('ornamentCount'))
        if (maybeOrnamentCount !== undefined) args.ornamentCount = maybeOrnamentCount
        const maybeOrnamentDistribution = WebMcpBridge.#toOptionalNumber(formData.get('ornamentDistribution'))
        if (maybeOrnamentDistribution !== undefined) args.ornamentDistribution = maybeOrnamentDistribution
        const maybeLineWidth = WebMcpBridge.#toOptionalNumber(formData.get('lineWidth'))
        if (maybeLineWidth !== undefined) args.lineWidth = maybeLineWidth
        const maybeImportHeightScale = WebMcpBridge.#toOptionalNumber(formData.get('importHeightScale'))
        if (maybeImportHeightScale !== undefined) args.importHeightScale = maybeImportHeightScale

        if (formData.has('showHorizontalLines')) {
            args.showHorizontalLines = WebMcpBridge.#isTruthy(formData.get('showHorizontalLines'))
        }
        if (formData.has('fillPatterns')) {
            args.fillPatterns = WebMcpBridge.#isTruthy(formData.get('fillPatterns'))
        }
        if (formData.has('rerollSeed')) {
            args.rerollSeed = WebMcpBridge.#isTruthy(formData.get('rerollSeed'))
        }
        if (formData.has('regenerate')) {
            args.regenerate = WebMcpBridge.#isTruthy(formData.get('regenerate'))
        }

        return this.#executeSetDesignSettings(args, DECLARATIVE_TOOL_ACTIONS.applyDesign)
    }

    /**
     * Handles declarative project form submissions.
     * @param {HTMLFormElement} form
     * @returns {Promise<Record<string, unknown>>}
     */
    async #handleProjectDeclarativeSubmit(form) {
        const formData = WebMcpBridge.#createFormData(form)
        const project = String(formData.get('project') || '').trim()
        return this.#runCommand(DECLARATIVE_TOOL_ACTIONS.applyProjectJson, () =>
            this.#commands.applyProjectJson({ project })
        )
    }

    /**
     * Handles declarative machine form submissions.
     * @param {HTMLFormElement} form
     * @returns {Promise<Record<string, unknown>>}
     */
    async #handleMachineDeclarativeSubmit(form) {
        const formData = WebMcpBridge.#createFormData(form)
        return this.#executeDeclarativeMachineAction({
            action: String(formData.get('action') || ''),
            confirm: WebMcpBridge.#isTruthy(formData.get('confirm'))
        })
    }

    /**
     * Handles declarative local project form submissions.
     * @param {HTMLFormElement} form
     * @returns {Promise<Record<string, unknown>>}
     */
    async #handleLocalDeclarativeSubmit(form) {
        const formData = WebMcpBridge.#createFormData(form)
        return this.#executeDeclarativeLocalProjectAction({
            action: String(formData.get('action') || ''),
            name: String(formData.get('name') || ''),
            id: String(formData.get('id') || ''),
            confirm: WebMcpBridge.#isTruthy(formData.get('confirm'))
        })
    }

    /**
     * Builds an empty object schema.
     * @returns {Record<string, unknown>}
     */
    static #emptyObjectSchema() {
        return {
            type: 'object',
            properties: {},
            additionalProperties: false
        }
    }

    /**
     * Returns true when user explicitly confirmed a dangerous action.
     * @param {unknown} value
     * @returns {boolean}
     */
    static #isConfirmed(value) {
        return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true'
    }

    /**
     * Returns true when the value is truthy in form-friendly string form.
     * @param {unknown} value
     * @returns {boolean}
     */
    static #isTruthy(value) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
        return ['1', 'true', 'yes', 'on'].includes(normalized)
    }

    /**
     * Converts unknown to an object argument map.
     * @param {unknown} value
     * @returns {Record<string, unknown>}
     */
    static #toObjectArgs(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    }

    /**
     * Converts unknown to an optional number.
     * @param {FormDataEntryValue | null} value
     * @returns {number | undefined}
     */
    static #toOptionalNumber(value) {
        const raw = String(value || '').trim()
        if (!raw) return undefined
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : undefined
    }

    /**
     * Converts unknown to an optional integer.
     * @param {FormDataEntryValue | null} value
     * @returns {number | undefined}
     */
    static #toOptionalInt(value) {
        const raw = String(value || '').trim()
        if (!raw) return undefined
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? parsed : undefined
    }

    /**
     * Converts unknown to optional trimmed text.
     * @param {FormDataEntryValue | null} value
     * @returns {string | undefined}
     */
    static #toOptionalString(value) {
        const normalized = String(value || '').trim()
        return normalized || undefined
    }

    /**
     * Normalizes command callback return values.
     * @param {unknown} result
     * @returns {{ message: string, data?: Record<string, unknown>, state?: Record<string, unknown> }}
     */
    static #normalizeCommandResult(result) {
        if (typeof result === 'string') {
            return { message: result || 'OK' }
        }
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return { message: 'OK' }
        }

        const candidate = /** @type {{ message?: unknown, data?: unknown, state?: unknown }} */ (result)
        const message = String(candidate.message || 'OK')
        const data = candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data) ? candidate.data : undefined
        const state =
            candidate.state && typeof candidate.state === 'object' && !Array.isArray(candidate.state)
                ? candidate.state
                : undefined
        return { message, data, state }
    }

    /**
     * Converts unknown error values into readable messages.
     * @param {unknown} error
     * @returns {string}
     */
    static #toErrorMessage(error) {
        if (error && typeof error === 'object' && 'message' in error) {
            return String(error.message || 'Unknown error')
        }
        return String(error || 'Unknown error')
    }

    /**
     * Builds one normalized WebMCP tool response.
     * @param {{ ok: boolean, action: string, message: string, data?: Record<string, unknown>, state?: Record<string, unknown>, isError?: boolean }} input
     * @returns {Record<string, unknown>}
     */
    static #buildResponse(input) {
        const message = String(input.message || '')
        const structuredContent = {
            ok: Boolean(input.ok),
            action: String(input.action || ''),
            message
        }
        if (input.data && typeof input.data === 'object') {
            structuredContent.data = input.data
        }
        if (input.state && typeof input.state === 'object') {
            structuredContent.state = input.state
        }

        return {
            content: [{ type: 'text', text: message }],
            structuredContent,
            isError: Boolean(input.isError)
        }
    }

    /**
     * Returns true when the error appears to be a duplicate tool-name registration collision.
     * @param {unknown} error
     * @returns {boolean}
     */
    static #isToolNameCollisionError(error) {
        const message = WebMcpBridge.#toErrorMessage(error).toLowerCase()
        return message.includes('collision') || message.includes('already registered') || message.includes('duplicate')
    }

    /**
     * Creates form data from a form element with a fallback for test runtimes.
     * @param {HTMLFormElement} form
     * @returns {FormData}
     */
    static #createFormData(form) {
        try {
            return new FormData(form)
        } catch (_error) {
            const data = new FormData()
            const fields = form.querySelectorAll('input, select, textarea')
            fields.forEach((field) => {
                const name = String(field.getAttribute('name') || '').trim()
                if (!name) return
                const tagName = String(field.tagName || '').toLowerCase()
                const fieldType = String(field.getAttribute('type') || '').toLowerCase()
                if ((fieldType === 'checkbox' || fieldType === 'radio') && !field.checked) return

                if (tagName === 'select' && field.multiple) {
                    Array.from(field.options || []).forEach((option) => {
                        if (!option.selected) return
                        data.append(name, String(option.value || option.textContent || ''))
                    })
                    return
                }

                data.append(name, String(field.value || ''))
            })
            return data
        }
    }

    /**
     * Returns true for native form elements in browser-like environments.
     * @param {unknown} value
     * @returns {boolean}
     */
    static #isFormElement(value) {
        if (typeof HTMLFormElement !== 'undefined' && value instanceof HTMLFormElement) {
            return true
        }
        return Boolean(
            value &&
                typeof value === 'object' &&
                typeof value.addEventListener === 'function' &&
                typeof value.dispatchEvent === 'function' &&
                String(value.tagName || '').toLowerCase() === 'form'
        )
    }
}
