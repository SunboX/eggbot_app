import assert from 'node:assert/strict'
import test from 'node:test'
import { WebModelContextBootstrap } from '../src/WebModelContextBootstrap.mjs'

/**
 * Imports one isolated bootstrap module instance.
 * @returns {Promise<{ WebModelContextBootstrap: typeof import('../src/WebModelContextBootstrap.mjs').WebModelContextBootstrap }>}
 */
async function importIsolatedBootstrapModule() {
    const token = `${Date.now()}-${Math.random()}`
    return import(`../src/WebModelContextBootstrap.mjs?testCase=${encodeURIComponent(token)}`)
}

/**
 * Builds one minimal runtime-like environment object for bootstrap tests.
 * @param {{ hostname?: string, search?: string, hasNativeModelContext?: boolean }} [options]
 * @returns {{
 *   location: { hostname: string, search: string },
 *   navigator: Record<string, unknown>,
 *   window: Record<string, unknown>,
 *   document?: Record<string, unknown>
 * }}
 */
function createEnvironment(options = {}) {
    const hostname = String(options.hostname || 'eggbot.app')
    const search = String(options.search || '')
    const navigator = options.hasNativeModelContext ? { modelContext: {} } : {}

    return {
        location: {
            hostname,
            search
        },
        navigator,
        window: {}
    }
}

test('WebModelContextBootstrap should not auto-load the fallback bridge on the public site', () => {
    const environment = createEnvironment()

    assert.equal(WebModelContextBootstrap.shouldLoadPolyfill(environment), false)
})

test('WebModelContextBootstrap should load the self-contained IIFE polyfill script after explicit opt-in', async () => {
    const { WebModelContextBootstrap: IsolatedBootstrap } = await importIsolatedBootstrapModule()
    const appendedScripts = []
    const environment = createEnvironment({
        hostname: 'localhost',
        search: '?webmcp=1'
    })

    const target = {
        appendChild(node) {
            appendedScripts.push(node)
            environment.navigator.modelContext = {}
            queueMicrotask(() => node.onload?.())
            return node
        }
    }

    environment.document = {
        head: target,
        body: target,
        documentElement: target,
        createElement(tagName) {
            return {
                tagName,
                dataset: {},
                async: true,
                src: '',
                onload: null,
                onerror: null
            }
        }
    }

    const loaded = await IsolatedBootstrap.ensure(environment)

    assert.equal(loaded, true)
    assert.equal(appendedScripts.length, 1)
    assert.equal(appendedScripts[0].src, '/node_modules/@mcp-b/global/dist/index.iife.js')
})

test('WebModelContextBootstrap should keep the fallback bridge disabled on localhost without explicit opt-in', () => {
    const environment = createEnvironment({
        hostname: 'localhost'
    })

    assert.equal(WebModelContextBootstrap.shouldLoadPolyfill(environment), false)
})

test('WebModelContextBootstrap should allow explicit opt-in through the query string', () => {
    const environment = createEnvironment({
        search: '?webmcp=1'
    })

    assert.equal(WebModelContextBootstrap.shouldLoadPolyfill(environment), true)
})

test('WebModelContextBootstrap should prefer native navigator.modelContext when it already exists', () => {
    const environment = createEnvironment({
        hostname: 'localhost',
        search: '?webmcp=1',
        hasNativeModelContext: true
    })

    assert.equal(WebModelContextBootstrap.shouldLoadPolyfill(environment), false)
})
