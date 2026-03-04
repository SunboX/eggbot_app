import assert from 'node:assert/strict'
import test from 'node:test'
import { EspFirmwareManifestMeta } from '../src/EspFirmwareManifestMeta.mjs'

test('EspFirmwareManifestMeta should resolve display metadata from manifest payload', () => {
    const meta = EspFirmwareManifestMeta.resolve({
        name: 'EggDuino ESP32 Firmware',
        version: '1.6a',
        builds: [{ chipFamily: 'ESP32' }]
    })

    assert.deepEqual(meta, {
        name: 'EggDuino ESP32 Firmware',
        version: '1.6a',
        chipFamily: 'ESP32'
    })
})

test('EspFirmwareManifestMeta should return null when version is missing', () => {
    const meta = EspFirmwareManifestMeta.resolve({
        name: 'EggDuino ESP32 Firmware',
        builds: [{ chipFamily: 'ESP32' }]
    })

    assert.equal(meta, null)
})

test('EspFirmwareManifestMeta should format label with chip family when available', () => {
    const label = EspFirmwareManifestMeta.formatDisplayLabel({
        name: 'EggDuino ESP32 Firmware',
        version: '1.6a',
        chipFamily: 'ESP32'
    })

    assert.equal(label, 'EggDuino ESP32 Firmware v1.6a (ESP32)')
})

test('EspFirmwareManifestMeta should format label without chip family when unavailable', () => {
    const label = EspFirmwareManifestMeta.formatDisplayLabel({
        name: 'EggDuino ESP32 Firmware',
        version: '1.6a',
        chipFamily: ''
    })

    assert.equal(label, 'EggDuino ESP32 Firmware v1.6a')
})
