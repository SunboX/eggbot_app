import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Imports one isolated ESP firmware installer module instance.
 * @returns {Promise<{
 *   EspInstallerTransport: typeof import('../src/EspFirmwareInstaller.mjs').EspInstallerTransport,
 *   createWindowsResetConstructors: typeof import('../src/EspFirmwareInstaller.mjs').createWindowsResetConstructors
 * }>}
 */
async function importIsolatedInstallerModule() {
    const token = `${Date.now()}-${Math.random()}`
    return import(`../src/EspFirmwareInstaller.mjs?testCase=${encodeURIComponent(token)}`)
}

test('createWindowsResetConstructors should toggle DTR and RTS together for classic reset', async () => {
    const { createWindowsResetConstructors } = await importIsolatedInstallerModule()
    const signalCalls = []
    const mockTransport = {
        device: {
            async setSignals(signals) {
                signalCalls.push(signals)
            }
        },
        async setDTR(_state) {},
        async setRTS(_state) {}
    }

    const constructors = createWindowsResetConstructors()
    const classicReset = constructors.classicReset(mockTransport, 50)
    await classicReset.reset()

    assert.deepEqual(signalCalls, [
        { dataTerminalReady: false, requestToSend: true },
        { dataTerminalReady: true, requestToSend: false },
        { dataTerminalReady: false, requestToSend: false }
    ])
})

test('EspInstallerTransport should ignore boot log noise before the first SLIP packet', async () => {
    const { EspInstallerTransport } = await importIsolatedInstallerModule()
    const transport = new EspInstallerTransport({
        getInfo() {
            return {}
        }
    })
    const packets = [
        new Uint8Array([
            0x65,
            0x74,
            0x73,
            0x20,
            0x4a,
            0x75,
            0x6c,
            0x0d,
            0x0a,
            0xc0,
            0x01,
            0x02,
            0xc0
        ])
    ]

    transport.trace = () => {}
    transport.detectPanicHandler = () => {}
    transport.inWaiting = () => 0
    transport.newRead = async () => packets.shift() || new Uint8Array(0)

    const packetIterator = transport.read(100)
    const firstPacket = await packetIterator.next()

    assert.equal(firstPacket.done, false)
    assert.deepEqual(Array.from(firstPacket.value), [0x01, 0x02])
})
