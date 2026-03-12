import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

/**
 * Resolves one firmware file URL relative to repo root.
 * @param {string} fileName
 * @returns {URL}
 */
function firmwareFileUrl(fileName) {
    return new URL(`../firmware/${fileName}`, import.meta.url)
}

test('ESP firmware manifest should define required ESP32 parts', async () => {
    const manifestText = await readFile(firmwareFileUrl('manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestText)

    assert.equal(manifest.name, 'EggDuino ESP32 Firmware')
    assert.equal(manifest.new_install_improv_wait_time, 0)
    assert.ok(Array.isArray(manifest.builds))
    assert.ok(manifest.builds.length > 0)
    assert.equal(manifest.builds[0].chipFamily, 'ESP32')
    assert.ok(Array.isArray(manifest.builds[0].parts))

    const parts = manifest.builds[0].parts
    assert.deepEqual(
        parts.map((part) => part.path),
        ['bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin']
    )
    assert.deepEqual(
        parts.map((part) => part.offset),
        [4096, 32768, 57344, 65536]
    )
})

test('ESP firmware folder should include all binaries referenced by manifest', async () => {
    const requiredFiles = ['bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin']
    for (const fileName of requiredFiles) {
        await access(firmwareFileUrl(fileName))
    }
})
