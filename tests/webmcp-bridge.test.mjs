import test from 'node:test'
import assert from 'node:assert/strict'
import { WebMcpBridge } from '../src/WebMcpBridge.mjs'

const IMPERATIVE_TOOL_NAMES = [
    'eggbot_get_state',
    'eggbot_set_design_settings',
    'eggbot_set_color_settings',
    'eggbot_set_motif_settings',
    'eggbot_set_draw_config',
    'eggbot_reroll_seed',
    'eggbot_regenerate_pattern',
    'eggbot_import_svg_text',
    'eggbot_apply_project_json',
    'eggbot_get_project_json',
    'eggbot_get_share_url',
    'eggbot_build_export_svg',
    'eggbot_local_projects_list',
    'eggbot_local_project_store',
    'eggbot_local_project_load',
    'eggbot_local_project_delete',
    'eggbot_serial_connect',
    'eggbot_serial_disconnect',
    'eggbot_serial_draw',
    'eggbot_serial_stop',
    'eggbot_set_locale'
]

const DECLARATIVE_ALIAS_NAMES = [
    'eggbot_form_apply_design',
    'eggbot_form_apply_project_json',
    'eggbot_form_machine_action',
    'eggbot_form_local_project_action'
]

/**
 * Creates basic command callbacks for bridge tests.
 * @returns {{ commands: Record<string, (...args: any[]) => any>, connectCalls: () => number }}
 */
function createCommandMocks() {
    let connectCallCount = 0
    const defaultResult = {
        message: 'ok',
        data: { source: 'test' },
        state: { locale: 'en' }
    }

    return {
        commands: {
            getState: () => ({ locale: 'en', strokesCount: 0 }),
            setDesignSettings: () => defaultResult,
            setColorSettings: () => defaultResult,
            setMotifSettings: () => defaultResult,
            setDrawConfig: () => defaultResult,
            rerollSeed: () => defaultResult,
            regeneratePattern: () => defaultResult,
            importSvgText: () => defaultResult,
            applyProjectJson: () => defaultResult,
            getProjectJson: () => defaultResult,
            getShareUrl: () => defaultResult,
            buildExportSvg: () => defaultResult,
            localProjectsList: () => defaultResult,
            localProjectStore: () => defaultResult,
            localProjectLoad: () => defaultResult,
            localProjectDelete: () => defaultResult,
            serialConnect: () => {
                connectCallCount += 1
                return defaultResult
            },
            serialDisconnect: () => defaultResult,
            serialDraw: () => defaultResult,
            serialStop: () => defaultResult,
            setLocale: () => defaultResult
        },
        connectCalls: () => connectCallCount
    }
}

/**
 * Installs a minimal navigator.modelContext mock.
 * @returns {{ restore: () => void, imperativeTools: () => any[], aliasTools: () => any[] }}
 */
function installModelContextMock() {
    const originalNavigator = globalThis.navigator
    let capturedImperativeTools = []
    const capturedAliasTools = []

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            modelContext: {
                provideContext(input) {
                    capturedImperativeTools = Array.isArray(input?.tools) ? input.tools : []
                },
                registerTool(tool) {
                    capturedAliasTools.push(tool)
                }
            }
        },
        configurable: true,
        writable: true
    })

    return {
        imperativeTools: () => capturedImperativeTools,
        aliasTools: () => capturedAliasTools,
        restore() {
            Object.defineProperty(globalThis, 'navigator', {
                value: originalNavigator,
                configurable: true,
                writable: true
            })
        }
    }
}

test('WebMcpBridge should register imperative and declarative alias tools', () => {
    const navigatorMock = installModelContextMock()
    const commandMocks = createCommandMocks()

    try {
        const bridge = new WebMcpBridge({
            commands: commandMocks.commands,
            root: { querySelector: () => null }
        })
        const initialized = bridge.init()
        const imperativeTools = navigatorMock.imperativeTools()
        const aliasTools = navigatorMock.aliasTools()

        assert.equal(initialized, true)
        assert.equal(imperativeTools.length, IMPERATIVE_TOOL_NAMES.length)
        assert.equal(aliasTools.length, DECLARATIVE_ALIAS_NAMES.length)
        assert.deepEqual(
            imperativeTools.map((tool) => tool.name),
            IMPERATIVE_TOOL_NAMES
        )
        assert.deepEqual(
            aliasTools.map((tool) => tool.name),
            DECLARATIVE_ALIAS_NAMES
        )
    } finally {
        navigatorMock.restore()
    }
})

test('WebMcpBridge should reject dangerous tools when confirm is missing', async () => {
    const navigatorMock = installModelContextMock()
    const commandMocks = createCommandMocks()

    try {
        const bridge = new WebMcpBridge({
            commands: commandMocks.commands,
            root: { querySelector: () => null }
        })
        bridge.init()

        const serialConnectTool = navigatorMock
            .imperativeTools()
            .find((tool) => tool.name === 'eggbot_serial_connect')
        assert.ok(serialConnectTool)

        const rejected = await serialConnectTool.execute({})
        assert.equal(rejected.isError, true)
        assert.equal(rejected.structuredContent.ok, false)
        assert.match(String(rejected.content?.[0]?.text || ''), /confirmation required/i)
        assert.equal(commandMocks.connectCalls(), 0)

        const accepted = await serialConnectTool.execute({ confirm: true })
        assert.equal(accepted.isError, false)
        assert.equal(accepted.structuredContent.ok, true)
        assert.equal(commandMocks.connectCalls(), 1)
    } finally {
        navigatorMock.restore()
    }
})

test('WebMcpBridge should return structured response contract', async () => {
    const navigatorMock = installModelContextMock()
    const commandMocks = createCommandMocks()

    try {
        const bridge = new WebMcpBridge({
            commands: commandMocks.commands,
            root: { querySelector: () => null }
        })
        bridge.init()

        const localeTool = navigatorMock
            .imperativeTools()
            .find((tool) => tool.name === 'eggbot_set_locale')
        assert.ok(localeTool)

        const response = await localeTool.execute({ locale: 'de' })
        assert.equal(typeof response, 'object')
        assert.ok(Array.isArray(response.content))
        assert.equal(typeof response.content[0].text, 'string')
        assert.equal(response.structuredContent.action, 'eggbot_set_locale')
        assert.equal(typeof response.structuredContent.ok, 'boolean')
        assert.equal(typeof response.structuredContent.message, 'string')
    } finally {
        navigatorMock.restore()
    }
})

test('WebMcpBridge should expose printColorMode in draw-config schema', () => {
    const navigatorMock = installModelContextMock()
    const commandMocks = createCommandMocks()

    try {
        const bridge = new WebMcpBridge({
            commands: commandMocks.commands,
            root: { querySelector: () => null }
        })
        bridge.init()

        const drawConfigTool = navigatorMock
            .imperativeTools()
            .find((tool) => tool.name === 'eggbot_set_draw_config')
        assert.ok(drawConfigTool)
        assert.equal(drawConfigTool.inputSchema?.properties?.printColorMode?.type, 'string')
        assert.deepEqual(drawConfigTool.inputSchema?.properties?.printColorMode?.enum, ['single', 'per-color'])
    } finally {
        navigatorMock.restore()
    }
})
