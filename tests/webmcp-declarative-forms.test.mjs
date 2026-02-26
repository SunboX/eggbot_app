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
                <form data-webmcp-form-get-state>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-design>
                    <input name="projectName" />
                    <input name="seed" />
                    <input name="density" />
                    <input name="symmetry" />
                    <input name="showHorizontalLines" type="checkbox" value="true" />
                    <input name="fillPatterns" type="checkbox" value="true" />
                    <input name="regenerate" type="checkbox" value="true" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-color>
                    <input name="baseColor" />
                    <input name="colorCount" />
                    <input name="palette1" />
                    <input name="palette2" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-motifs>
                    <input name="dots" />
                    <input name="rays" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-draw-config>
                    <input name="connectionTransport" />
                    <input name="wifiSecure" />
                    <input name="printColorMode" />
                    <input name="manualWalkDistance" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-reroll-seed>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-regenerate>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-import-svg>
                    <textarea name="svgText"></textarea>
                    <input name="fileName" />
                    <input name="importHeightScale" />
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-project>
                    <textarea name="project"></textarea>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-get-project-json>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-get-share-url>
                    <button type="submit">submit</button>
                </form>
                <form data-webmcp-form-build-export-svg>
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
                <form data-webmcp-form-locale>
                    <select name="locale">
                        <option value="en">en</option>
                        <option value="de">de</option>
                    </select>
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

test('WebMcpBridge should parse declarative color form into setColorSettings args', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { colors: null }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
                getState: () => ({ locale: 'en' }),
                setDesignSettings: () => ({ message: 'ok' }),
                setColorSettings: (args) => {
                    calls.colors = args
                    return { message: 'colors-ok', state: { paletteSize: 2 } }
                },
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

        const form = document.querySelector('[data-webmcp-form-color]')
        form.querySelector('[name="baseColor"]').value = '#fefefe'
        form.querySelector('[name="colorCount"]').value = '2'
        form.querySelector('[name="palette1"]').value = '#111111'
        form.querySelector('[name="palette2"]').value = '#222222'

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_apply_color')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.colors, {
            baseColor: '#fefefe',
            colorCount: 2,
            palette: ['#111111', '#222222']
        })
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative draw-config form into setDrawConfig args', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { config: null }

    try {
        const bridge = new WebMcpBridge({
            root: document,
            commands: {
                getState: () => ({ locale: 'en' }),
                setDesignSettings: () => ({ message: 'ok' }),
                setColorSettings: () => ({ message: 'ok' }),
                setMotifSettings: () => ({ message: 'ok' }),
                setDrawConfig: (args) => {
                    calls.config = args
                    return { message: 'draw-config-ok', state: { connectionTransport: 'ble' } }
                },
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

        const form = document.querySelector('[data-webmcp-form-draw-config]')
        form.querySelector('[name="connectionTransport"]').value = 'ble'
        form.querySelector('[name="wifiSecure"]').value = 'false'
        form.querySelector('[name="printColorMode"]').value = 'single'
        form.querySelector('[name="manualWalkDistance"]').value = '2400'

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_apply_draw_config')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.config, {
            connectionTransport: 'ble',
            wifiSecure: false,
            printColorMode: 'single',
            manualWalkDistance: 2400
        })
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative import-svg form and invoke importSvgText', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { importSvg: null }

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
                importSvgText: (args) => {
                    calls.importSvg = args
                    return { message: 'import-ok' }
                },
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

        const form = document.querySelector('[data-webmcp-form-import-svg]')
        form.querySelector('[name="svgText"]').value = '<svg></svg>'
        form.querySelector('[name="fileName"]').value = 'demo.svg'
        form.querySelector('[name="importHeightScale"]').value = '1.25'

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_import_svg_text')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.importSvg, {
            svgText: '<svg></svg>',
            fileName: 'demo.svg',
            importHeightScale: 1.25
        })
    } finally {
        restoreGlobals()
    }
})

test('WebMcpBridge should parse declarative locale form and invoke setLocale', async () => {
    const { document, window } = createDeclarativeFixture()
    const restoreGlobals = installDeclarativeGlobals(window)
    const calls = { locale: null }

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
                serialDraw: () => ({ message: 'ok' }),
                serialStop: () => ({ message: 'ok' }),
                setLocale: (args) => {
                    calls.locale = args
                    return { message: 'locale-ok', state: { locale: 'de' } }
                }
            }
        })
        bridge.init()

        const form = document.querySelector('[data-webmcp-form-locale]')
        form.querySelector('[name="locale"] option[value="de"]').setAttribute('selected', 'selected')

        const response = await dispatchDeclarativeSubmit(form, window)
        assert.equal(response.structuredContent.action, 'eggbot_form_set_locale')
        assert.equal(response.structuredContent.ok, true)
        assert.deepEqual(calls.locale, { locale: 'de' })
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
