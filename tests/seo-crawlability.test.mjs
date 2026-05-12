// SPDX-FileCopyrightText: 2026 André Fiedler
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { parseHTML } from 'linkedom'

const root = new URL('../', import.meta.url)
const siteOrigin = 'https://eggbot.app'
const importantRoutes = ['/', '/patterns', '/draw', '/connection']

/**
 * Reads the app index markup.
 * @returns {Promise<string>}
 */
async function readIndexHtml() {
    return readFile(new URL('src/index.html', root), 'utf8')
}

/**
 * Finds an unused local TCP port.
 * @returns {Promise<number>}
 */
async function findFreePort() {
    const probe = createServer()
    probe.listen(0, '127.0.0.1')
    await once(probe, 'listening')
    const address = probe.address()
    await new Promise((resolve) => probe.close(resolve))
    return typeof address === 'object' && address ? address.port : 0
}

/**
 * Starts the local app server for HTTP assertions.
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
async function startAppServer() {
    const port = await findFreePort()
    const child = spawn(process.execPath, ['src/server.mjs'], {
        cwd: new URL('../', import.meta.url),
        env: {
            ...process.env,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
        output += chunk
    })
    child.stderr.on('data', (chunk) => {
        output += chunk
    })

    const deadline = Date.now() + 5000
    while (!output.includes(`http://localhost:${port}/`)) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited early with ${child.exitCode}: ${output}`)
        }
        if (Date.now() > deadline) {
            child.kill('SIGTERM')
            throw new Error(`Timed out waiting for server start: ${output}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
            if (child.exitCode !== null) return
            child.kill('SIGTERM')
            await once(child, 'exit')
        }
    }
}

test('index html should expose search metadata without noindex', async () => {
    const html = await readIndexHtml()
    const { document } = parseHTML(html)

    assert.equal(document.querySelector('title')?.textContent.trim(), 'EggBot App - Sorbian Egg Pattern Generator')
    assert.equal(
        document.querySelector('meta[name="description"]')?.getAttribute('content'),
        'Design Sorbian-style egg decorations, preview them in 3D, export SVG files, and draw them with an EggBot.'
    )
    assert.equal(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), `${siteOrigin}/`)
    assert.equal(document.querySelector('meta[property="og:url"]')?.getAttribute('content'), `${siteOrigin}/`)
    assert.equal(document.querySelector('meta[name="robots"]'), null)
    assert.doesNotMatch(html, /noindex/i)
})

test('index html should use normal internal links for important app URLs', async () => {
    const html = await readIndexHtml()
    const { document } = parseHTML(html)

    importantRoutes.forEach((route) => {
        assert.ok(document.querySelector(`a[href="${route}"]`), `missing normal internal link for ${route}`)
    })
})

test('robots txt and sitemap should allow crawling important public URLs', async () => {
    const [robots, sitemap] = await Promise.all([
        readFile(new URL('src/robots.txt', root), 'utf8'),
        readFile(new URL('src/sitemap.xml', root), 'utf8')
    ])

    assert.match(robots, /^User-agent: \*/m)
    assert.match(robots, /^Allow: \/$/m)
    assert.match(robots, /^Allow: \/assets\//m)
    assert.doesNotMatch(robots, /^Disallow: \/$/m)
    assert.match(robots, new RegExp(`^Sitemap: ${siteOrigin.replace(/\./g, '\\.')}/sitemap\\.xml$`, 'm'))

    importantRoutes.forEach((route) => {
        assert.match(sitemap, new RegExp(`<loc>${siteOrigin}${route === '/' ? '/' : route}</loc>`))
    })
})

test('local server should return 200 for important pages and crawl assets', async () => {
    const server = await startAppServer()
    test.after(async () => {
        await server.close()
    })

    const paths = [...importantRoutes, '/robots.txt', '/sitemap.xml', '/assets/eggbot-icon.svg', '/style.css']
    for (const path of paths) {
        const response = await fetch(`${server.baseUrl}${path}`)
        assert.equal(response.status, 200, `${path} should return HTTP 200`)

        if (!importantRoutes.includes(path)) continue

        const html = await response.text()
        const canonicalPath = path === '/' ? '/' : path
        assert.match(html, new RegExp(`<link rel="canonical" href="${siteOrigin}${canonicalPath}" />`))
    }
})
