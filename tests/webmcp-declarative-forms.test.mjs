import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { WebMcpBridge } from '../src/WebMcpBridge.mjs'

/**
 * Builds a DOM fixture with all declarative WebMCP forms.
 * @returns {{ document: Document, window: Window }}
 */
function createDeclarativeFixture() {
    return parseHTML(`
        <!doctype html>
        <html>
            <body>
                <form data-webmcp-form-design>
                    <input name="seed" />
                    <input name="density" />
                    <input name="symmetry" />
                    <input name="showHorizontalLines" type="checkbox" value="true" />
                    <input name="fillPatterns" type="checkbox" value="true" />
                    <input name="regenerate" type="checkbox" value="true" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-project>
                    <textarea name="project"></textarea>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-machine>
                    <input name="action" />
                    <input name="confirm" type="checkbox" value="true" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-local>
                    <input name="action" />
                    <input name="name" />
                    <input name="id" />
                    <input name="confirm" type="checkbox" value="true" />
                    <button type="submit">submit</button>
                </form>
            </body>
        </html>
    `)
}

/**
 * Installs browser-like globals needed by bridge declarative handlers.
 * @param {Window} window
 * @returns {() => void}
 */
function installDeclarativeGlobals(window) {
    const originalNavigator = globalThis.navigator
    const originalHtmlFormElement = globalThis.HTMLFormElement
    const originalFormData = globalThis.FormData

    Object.defineProperty(globalThis, 'navigator', {
        value: {
            modelContext: {
                provideContext() {},
                registerTool() {}
            }
        },
        configurable: true,
        writable: true
    })
    Object.defineProperty(globalThis, 'HTMLFormElement', {
        value: window.HTMLFormElement,
        configurable: true,
        writable: true
    })
    Object.defineProperty(globalThis, 'FormData', {
        value: window.FormData,
        configurable: true,
        writable: true
    })

    return () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: originalNavigator,
            configurable: true,
            writable: true
        })
        Object.defineProperty(globalThis, 'HTMLFormElement', {
            value: originalHtmlFormElement,
            configurable: true,
            writable: true
        })
        Object.defineProperty(globalThis, 'FormData', {
            value: originalFormData,
            configurable: true,
            writable: true
        })
    }
}

/**
 * Dispatches a submit event and resolves the value passed to respondWith.
 * @param {HTMLFormElement} form
 * @param {Window} window
 * @returns {Promise<Record<string, unknown>>}
 */
function dispatchDeclarativeSubmit(form, window) {
    let responsePromise = null
    const event = new window.Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'respondWith', {
        value: (promise) => {
            responsePromise = promise
        },
        configurable: true
    })
    form.dispatchEvent(event)
    const fallbackPromise = form.__webMcpLastResultPromise || null
    const resolvedPromise = responsePromise || fallbackPromise
    assert.ok(resolvedPromise, 'submit should provide a response promise')
    return resolvedPromise
}

test('WebMcpBridge should parse declarative design form into setDesignSettings args', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { design: null }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
                getState: () => ({ locale: 'en' }),
                setDesignSettings: (args) => {
                    calls.design = args
                    return { message: 'design-ok', state: { seed: 123 } }
                },
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
        })
        bridge.init()

        const form = document.querySelector('[data-webmcp-form-design]')
        form.querySelector('[name="seed"]').value = '123'
        form.querySelector('[name="density"]').value = '0.55'
        form.querySelector('[name="symmetry"]').value = '12'
        form.querySelector('[name="showHorizontalLines"]').checked = true
        form.querySelector('[name="fillPatterns"]').checked = true
        form.querySelector('[name="regenerate"]').checked = true

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_apply_design')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.design, {
            seed: 123,
            symmetry: 12,
            density: 0.55,
            showHorizontalLines: true,
            fillPatterns: true,
            regenerate: true
        })
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative project form and invoke applyProjectJson', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { project: null }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
                getState: () => ({ locale: 'en' }),
                setDesignSettings: () => ({ message: 'ok' }),
                setColorSettings: () => ({ message: 'ok' }),
                setMotifSettings: () => ({ message: 'ok' }),
                setDrawConfig: () => ({ message: 'ok' }),
                rerollSeed: () => ({ message: 'ok' }),
                regeneratePattern: () => ({ message: 'ok' }),
                importSvgText: () => ({ message: 'ok' }),
                applyProjectJson: (args) => {
                    calls.project = args
                    return { message: 'project-ok', state: { projectName: 'A' } }
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
        })
        bridge.init()

        const form = document.querySelector('[data-webmcp-form-project]')
        form.querySelector('[name="project"]').value = '{"projectName":"Imported"}'

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_apply_project_json')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.project, {
            project: '{"projectName":"Imported"}'
        })
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative machine form and route action', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { draw: 0 }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
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
                localProjectsList: () => ({ message: 'ok' }),
                localProjectStore: () => ({ message: 'ok' }),
                localProjectLoad: () => ({ message: 'ok' }),
                localProjectDelete: () => ({ message: 'ok' }),
                serialConnect: () => ({ message: 'ok' }),
                serialDisconnect: () => ({ message: 'ok' }),
                serialDraw: () => {
                    calls.draw += 1
                    return { message: 'draw-ok', state: { isDrawing: true } }
                },
                serialStop: () => ({ message: 'ok' }),
                setLocale: () => ({ message: 'ok' })
            }
        })
        bridge.init()

        const form = document.querySelector('[data-webmcp-form-machine]')
        form.querySelector('[name="action"]').value = 'draw'
        form.querySelector('[name="confirm"]').checked = true

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_machine_action')
        assert.equal(response.structuredContent.ok, true)
        assert.equal(calls.draw, 1)
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative local project form and route delete action', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { deleted: null }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
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
                localProjectsList: () => ({ message: 'ok' }),
                localProjectStore: () => ({ message: 'ok' }),
                localProjectLoad: () => ({ message: 'ok' }),
                localProjectDelete: (args) => {
                    calls.deleted = args
                    return { message: 'deleted' }
                },
                serialConnect: () => ({ message: 'ok' }),
                serialDisconnect: () => ({ message: 'ok' }),
                serialDraw: () => ({ message: 'ok' }),
                serialStop: () => ({ message: 'ok' }),
                setLocale: () => ({ message: 'ok' })
            }
        })
        bridge.init()

        const form = document.querySelector('[data-webmcp-form-local]')
        form.querySelector('[name="action"]').value = 'delete'
        form.querySelector('[name="id"]').value = 'project-abc'
        form.querySelector('[name="confirm"]').checked = true

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_local_project_action')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.deleted, {
            id: 'project-abc'
        })
    } finally {
        restoreGlobals()
    }
})
