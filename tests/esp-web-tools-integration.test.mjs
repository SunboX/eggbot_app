import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('index markup should pin ESP Web Tools to the Windows-safe upstream version', async () => {
    const htmlUrl = new URL('../src/index.html', import.meta.url)
    const html = await readFile(htmlUrl, 'utf8')

    assert.match(
        html,
        /https:\/\/unpkg\.com\/esp-web-tools@10\.2\.1\/dist\/web\/install-button\.js\?module/
    )
})
