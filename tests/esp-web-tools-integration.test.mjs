import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseHTML } from 'linkedom'

test('index markup should use the local ESP flasher button instead of external ESP Web Tools', async () => {
    const htmlUrl = new URL('../src/index.html', import.meta.url)
    const html = await readFile(htmlUrl, 'utf8')
    const { document } = parseHTML(html)

    assert.equal(document.querySelector('[data-esp-flash-install]')?.tagName, 'BUTTON')
    assert.equal(document.querySelector('esp-web-install-button'), null)
    assert.doesNotMatch(html, /esp-web-tools@/)
})
