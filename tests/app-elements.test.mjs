import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseHTML } from 'linkedom'
import { AppElements } from '../src/AppElements.mjs'

test('AppElements should expose EggBot manual result element from index markup', async () => {
    const htmlUrl = new URL('../src/index.html', import.meta.url)
    const html = await readFile(htmlUrl, 'utf8')
    const { document } = parseHTML(html)
    const elements = AppElements.query(document)

    assert.ok(elements.controlManualResult)
    assert.equal(elements.controlManualResult.getAttribute('data-control-manual-result'), '')
    assert.ok(elements.penColorDialogBackdrop)
    assert.ok(elements.penColorDialog)
    assert.ok(elements.penColorDialogTitle)
    assert.ok(elements.penColorDialogMessage)
    assert.ok(elements.penColorDialogContinue)
    assert.ok(elements.penColorDialogCancel)
    assert.ok(elements.connectionTransport)
    assert.ok(elements.machineBaudRateRow)
    assert.ok(elements.machineWifiOptions)
    assert.ok(elements.wifiHost)
    assert.ok(elements.wifiPort)
    assert.equal(elements.wifiSecure, null)
    assert.ok(elements.resumeStatus)
    assert.ok(elements.resumeStart)
    assert.ok(elements.resumeClear)
})
