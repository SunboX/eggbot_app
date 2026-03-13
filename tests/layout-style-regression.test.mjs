import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/**
 * Reads one repo stylesheet as text.
 * @param {string} relativePath
 * @returns {Promise<string>}
 */
async function readStylesheet(relativePath) {
    return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * Returns one simple CSS rule block for the provided selector.
 * @param {string} stylesheet
 * @param {string} selector
 * @returns {string}
 */
function extractRuleBlock(stylesheet, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rulePattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm')
    return rulePattern.exec(stylesheet)?.[1] || ''
}

test('layout styles should let panels shrink and wrap long status tokens', async () => {
    const layoutStyles = await readStylesheet('src/styles/10-layout.css')
    const panelRule = extractRuleBlock(layoutStyles, '.panel')
    const statusRule = extractRuleBlock(layoutStyles, '.status')

    assert.match(panelRule, /min-width:\s*0\b/)
    assert.match(statusRule, /overflow-wrap:\s*anywhere\b/)
})
