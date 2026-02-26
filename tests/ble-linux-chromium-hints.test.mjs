import test from 'node:test'
import assert from 'node:assert/strict'
import { BleLinuxChromiumHints } from '../src/BleLinuxChromiumHints.mjs'

test('BleLinuxChromiumHints.shouldShowBleTroubleshooting should match Linux Chromium BLE context', () => {
    const shouldShow = BleLinuxChromiumHints.shouldShowBleTroubleshooting({
        transportKind: 'ble',
        userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    })

    assert.equal(shouldShow, true)
})

test('BleLinuxChromiumHints.shouldShowBleTroubleshooting should return false for non-BLE transport', () => {
    const shouldShow = BleLinuxChromiumHints.shouldShowBleTroubleshooting({
        transportKind: 'serial',
        userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    })

    assert.equal(shouldShow, false)
})

test('BleLinuxChromiumHints.shouldShowBleTroubleshooting should return false for Linux Firefox', () => {
    const shouldShow = BleLinuxChromiumHints.shouldShowBleTroubleshooting({
        transportKind: 'ble',
        userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0'
    })

    assert.equal(shouldShow, false)
})

test('BleLinuxChromiumHints.shouldShowBleTroubleshooting should use Chromium userAgentData brands', () => {
    const shouldShow = BleLinuxChromiumHints.shouldShowBleTroubleshooting({
        transportKind: 'ble',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        brands: [{ brand: 'Chromium', version: '124' }]
    })

    assert.equal(shouldShow, true)
})

test('BleLinuxChromiumHints.shouldShowBleTroubleshooting should ignore Android Chrome', () => {
    const shouldShow = BleLinuxChromiumHints.shouldShowBleTroubleshooting({
        transportKind: 'ble',
        userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
    })

    assert.equal(shouldShow, false)
})
