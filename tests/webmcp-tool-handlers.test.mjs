import test from 'node:test'
import assert from 'node:assert/strict'
import { WebMcpBridge } from '../src/WebMcpBridge.mjs'

/**
 * Installs navigator.modelContext mock and captures registered tools.
 * @returns {{ tools: () => any[], restore: () => void }}
 */
function installModelContextMock() {
    const originalNavigator = globalThis.navigator
    let tools = []

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            modelContext: {
                provideContext(input) {
                    tools = Array.isArray(input?.tools) ? input.tools : []
                },
                registerTool() {}
            }
        },
        configurable: true,
        writable: true
    })

    return {
        tools: () => tools,
        restore() {
            Object.defineProperty(globalThis, 'navigator', {
                value: originalNavigator,
                configurable: true,
                writable: true
            })
        }
    }
}

/**
 * Finds one tool by name.
 * @param {any[]} tools
 * @param {string} name
 * @returns {any}
 */
function pickTool(tools, name) {
    const tool = tools.find((candidate) => candidate.name === name)
    assert.ok(tool, `Missing tool ${name}`)
    return tool
}

test('WebMcpBridge should route state patch and project apply arguments', async () => {
    const navigatorMock = installModelContextMock()
    const calls = {
        design: null,
        applyProject: null
    }

    const commands = {
        getState: () => ({ locale: 'en' }),
        setDesignSettings: (args) => {
            calls.design = args
            return { message: 'design-updated', state: { seed: args.seed || 0 } }
        },
        setColorSettings: () => ({ message: 'ok' }),
        setMotifSettings: () => ({ message: 'ok' }),
        setDrawConfig: () => ({ message: 'ok' }),
        rerollSeed: () => ({ message: 'ok' }),
        regeneratePattern: () => ({ message: 'ok' }),
        importSvgText: () => ({ message: 'ok' }),
        applyProjectJson: (args) => {
            calls.applyProject = args
            return { message: 'project-applied', state: { projectName: 'Demo' } }
        },
        getProjectJson: () => ({ message: 'ok' }),
        getShareUrl: () => ({ message: 'ok' }),
        buildExportSvg: () => ({ message: 'ok' }),
        localProjectsList: () => ({ message: 'ok' }),
        localProjectStore: () => ({ message: 'ok' }),
        localProjectLoad: () => ({ message: 'ok' }),
        localProjectDelete: () => ({ message: 'ok' }),
        serialConnect: () => ({ message: 'ok' }),
        serialDisconnect: () => ({ message: 'ok' }),
        serialDraw: () => ({ message: 'ok' }),
        serialStop: () => ({ message: 'ok' }),
        setLocale: () => ({ message: 'ok' })
    }

    try {
        const bridge = new WebMcpBridge({ commands, root: { querySelector: () => null } })
        bridge.init()

        const tools = navigatorMock.tools()
        const setDesignTool = pickTool(tools, 'eggbot_set_design_settings')
        const applyProjectTool = pickTool(tools, 'eggbot_apply_project_json')

        await setDesignTool.execute({
            projectName: 'Demo Project',
            seed: 111,
            symmetry: 12,
            density: 0.64,
            regenerate: true
        })
        await applyProjectTool.execute({
            project: { projectName: 'A', seed: 99 }
        })

        assert.deepEqual(calls.design, {
            projectName: 'Demo Project',
            seed: 111,
            symmetry: 12,
            density: 0.64,
            regenerate: true
        })
        assert.deepEqual(calls.applyProject, {
            project: { projectName: 'A', seed: 99 }
        })
    } finally {
        navigatorMock.restore()
    }
})

test('WebMcpBridge should return project and svg payload shapes', async () => {
    const navigatorMock = installModelContextMock()
    const commands = {
        getState: () => ({ locale: 'en' }),
        setDesignSettings: () => ({ message: 'ok' }),
        setColorSettings: () => ({ message: 'ok' }),
        setMotifSettings: () => ({ message: 'ok' }),
        setDrawConfig: () => ({ message: 'ok' }),
        rerollSeed: () => ({ message: 'ok' }),
        regeneratePattern: () => ({ message: 'ok' }),
        importSvgText: () => ({ message: 'ok' }),
        applyProjectJson: () => ({ message: 'ok' }),
        getProjectJson: () => ({
            message: 'project-ready',
            data: {
                project: { seed: 7 },
                jsonText: '{"seed":7}',
                suggestedName: 'demo-seed-7.json'
            }
        }),
        getShareUrl: () => ({ message: 'ok' }),
        buildExportSvg: () => ({
            message: 'svg-ready',
            data: {
                svgText: '<svg></svg>',
                suggestedName: 'demo-seed-7.svg'
            }
        }),
        localProjectsList: () => ({ message: 'ok' }),
        localProjectStore: () => ({ message: 'ok' }),
        localProjectLoad: () => ({ message: 'ok' }),
        localProjectDelete: () => ({ message: 'ok' }),
        serialConnect: () => ({ message: 'ok' }),
        serialDisconnect: () => ({ message: 'ok' }),
        serialDraw: () => ({ message: 'ok' }),
        serialStop: () => ({ message: 'ok' }),
        setLocale: () => ({ message: 'ok' })
    }

    try {
        const bridge = new WebMcpBridge({ commands, root: { querySelector: () => null } })
        bridge.init()

        const tools = navigatorMock.tools()
        const projectTool = pickTool(tools, 'eggbot_get_project_json')
        const svgTool = pickTool(tools, 'eggbot_build_export_svg')

        const projectResponse = await projectTool.execute({})
        const svgResponse = await svgTool.execute({})

        assert.equal(projectResponse.structuredContent.ok, true)
        assert.equal(typeof projectResponse.structuredContent.data.project, 'object')
        assert.equal(typeof projectResponse.structuredContent.data.jsonText, 'string')
        assert.equal(typeof projectResponse.structuredContent.data.suggestedName, 'string')

        assert.equal(svgResponse.structuredContent.ok, true)
        assert.equal(typeof svgResponse.structuredContent.data.svgText, 'string')
        assert.equal(typeof svgResponse.structuredContent.data.suggestedName, 'string')
    } finally {
        navigatorMock.restore()
    }
})

test('WebMcpBridge should route local project CRUD command arguments', async () => {
    const navigatorMock = installModelContextMock()
    const calls = {
        list: 0,
        store: null,
        load: null,
        delete: null
    }

    const commands = {
        getState: () => ({ locale: 'en' }),
        setDesignSettings: () => ({ message: 'ok' }),
        setColorSettings: () => ({ message: 'ok' }),
        setMotifSettings: () => ({ message: 'ok' }),
        setDrawConfig: () => ({ message: 'ok' }),
        rerollSeed: () => ({ message: 'ok' }),
        regeneratePattern: () => ({ message: 'ok' }),
        importSvgText: () => ({ message: 'ok' }),
        applyProjectJson: () => ({ message: 'ok' }),
        getProjectJson: () => ({ message: 'ok' }),
        getShareUrl: () => ({ message: 'ok' }),
        buildExportSvg: () => ({ message: 'ok' }),
        localProjectsList: () => {
            calls.list += 1
            return { message: 'ok' }
        },
        localProjectStore: (args) => {
            calls.store = args
            return { message: 'ok' }
        },
        localProjectLoad: (args) => {
            calls.load = args
            return { message: 'ok' }
        },
        localProjectDelete: (args) => {
            calls.delete = args
            return { message: 'ok' }
        },
        serialConnect: () => ({ message: 'ok' }),
        serialDisconnect: () => ({ message: 'ok' }),
        serialDraw: () => ({ message: 'ok' }),
        serialStop: () => ({ message: 'ok' }),
        setLocale: () => ({ message: 'ok' })
    }

    try {
        const bridge = new WebMcpBridge({ commands, root: { querySelector: () => null } })
        bridge.init()

        const tools = navigatorMock.tools()
        await pickTool(tools, 'eggbot_local_projects_list').execute({})
        await pickTool(tools, 'eggbot_local_project_store').execute({ name: 'demo' })
        await pickTool(tools, 'eggbot_local_project_load').execute({ id: 'project-1' })
        await pickTool(tools, 'eggbot_local_project_delete').execute({ id: 'project-1', confirm: true })

        assert.equal(calls.list, 1)
        assert.deepEqual(calls.store, { name: 'demo' })
        assert.deepEqual(calls.load, { id: 'project-1' })
        assert.deepEqual(calls.delete, { id: 'project-1', confirm: true })
    } finally {
        navigatorMock.restore()
    }
})
