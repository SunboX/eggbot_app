import assert from 'node:assert/strict'
import test from 'node:test'
import { Transport } from '../src/vendor/esptool-js.bundle.mjs'

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

test('EspInstallerTransport should ignore duplicate SLIP delimiters after boot noise', async () => {
    const { EspInstallerTransport } = await importIsolatedInstallerModule()
    const transport = new EspInstallerTransport({
        getInfo() {
            return {}
        }
    })
    const packets = [
        new Uint8Array([
            0x77,
            0x61,
            0x69,
            0x74,
            0x69,
            0x6e,
            0x67,
            0x20,
            0x66,
            0x6f,
            0x72,
            0x20,
            0x64,
            0x6f,
            0x77,
            0x6e,
            0x6c,
            0x6f,
            0x61,
            0x64,
            0x0d,
            0x0a,
            0xc0,
            0xc0,
            0x01,
            0x08,
            0x04,
            0x00,
            0x12,
            0x20,
            0x55,
            0x55,
            0x00,
            0x00,
            0x00,
            0x00,
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
    assert.deepEqual(Array.from(firstPacket.value), [0x01, 0x08, 0x04, 0x00, 0x12, 0x20, 0x55, 0x55, 0x00, 0x00, 0x00, 0x00])
})

test('EspInstallerTransport should accept a follow-up packet that starts without an extra SLIP delimiter', async () => {
    const { EspInstallerTransport } = await importIsolatedInstallerModule()
    const transport = new EspInstallerTransport({
        getInfo() {
            return {}
        }
    })

    transport.trace = () => {}
    transport.detectPanicHandler = () => {}
    transport.buffer = new Uint8Array([
        0xc0,
        0x01,
        0x08,
        0x04,
        0x00,
        0x12,
        0x20,
        0x55,
        0x55,
        0x00,
        0x00,
        0x00,
        0x00,
        0xc0,
        0x01,
        0x0a,
        0x04,
        0x00,
        0x83,
        0x1d,
        0xf0,
        0x00,
        0x00,
        0x00,
        0x00,
        0xc0
    ])
    transport.inWaiting = () => transport.buffer.length
    transport.newRead = async (count) => {
        const output = transport.buffer.slice(0, count)
        transport.buffer = transport.buffer.slice(count)
        return output
    }

    const firstPacket = await transport.read(100).next()
    const secondPacket = await transport.read(100).next()

    assert.equal(firstPacket.done, false)
    assert.deepEqual(Array.from(firstPacket.value), [0x01, 0x08, 0x04, 0x00, 0x12, 0x20, 0x55, 0x55, 0x00, 0x00, 0x00, 0x00])
    assert.equal(secondPacket.done, false)
    assert.deepEqual(Array.from(secondPacket.value), [0x01, 0x0a, 0x04, 0x00, 0x83, 0x1d, 0xf0, 0x00, 0x00, 0x00, 0x00])
})

test('EspFirmwareInstaller should use the stock esptool-js transport on macOS by default', async () => {
    const { EspFirmwareInstaller, EspInstallerTransport } = await importIsolatedInstallerModule()
    const installer = new EspFirmwareInstaller({
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    })

    const transport = installer.transportFactory({
        getInfo() {
            return {}
        }
    })

    assert.ok(transport instanceof Transport)
    assert.equal(transport instanceof EspInstallerTransport, false)
})

test('EspFirmwareInstaller should keep the boot-log-tolerant transport on Windows by default', async () => {
    const { EspFirmwareInstaller, EspInstallerTransport } = await importIsolatedInstallerModule()
    const installer = new EspFirmwareInstaller({
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    })

    const transport = installer.transportFactory({
        getInfo() {
            return {}
        }
    })

    assert.ok(transport instanceof EspInstallerTransport)
})

test('EspFirmwareInstaller should keep the stock loader connect flow on macOS', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let disconnectCalls = 0

    const installer = new EspFirmwareInstaller({
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {
                    disconnectCalls += 1
                }
            }
        },
        loaderFactory(options) {
            let originalSync = null
            let originalConnectAttempt = null
            let originalReadReg = null
            const loader = {
                transport: options.transport,
                debug() {},
                async sync() {
                    return [0x55555555, new Uint8Array([0, 0, 0, 0])]
                },
                async _connectAttempt() {
                    await this.sync()
                    return 'success'
                },
                async readReg() {
                    return 0x00f01d83
                },
                async main() {
                    assert.equal(this.sync, originalSync)
                    assert.equal(this._connectAttempt, originalConnectAttempt)
                    assert.equal(this.readReg, originalReadReg)
                    const response = await this._connectAttempt('default_reset')
                    assert.equal(response, 'success')
                    assert.equal(await this.readReg(0x40001000), 0x00f01d83)
                },
                async writeFlash() {},
                async after() {}
            }

            originalSync = loader.sync
            originalConnectAttempt = loader._connectAttempt
            originalReadReg = loader.readReg
            return loader
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(disconnectCalls, 1)
})

test('EspFirmwareInstaller should retry without reset after wrong boot mode when manual boot is confirmed', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    const requestedPorts = []
    const disconnectCalls = []
    const loaderModes = []
    const promptCalls = []
    let loaderAttempt = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            const port = { id: requestedPorts.length + 1 }
            requestedPorts.push(port)
            return port
        },
        transportFactory(port) {
            return {
                port,
                async disconnect() {
                    disconnectCalls.push(port.id)
                }
            }
        },
        loaderFactory() {
            loaderAttempt += 1
            return {
                async _connectAttempt(mode) {
                    loaderModes.push(`${mode}:connect`)
                    if (loaderAttempt === 1) {
                        return 'Wrong boot mode detected (0x13). This chip needs to be in download mode.'
                    }
                    return 'success'
                },
                async main(mode) {
                    loaderModes.push(mode)
                    if (loaderAttempt === 1) {
                        await this._connectAttempt(mode)
                        throw new Error('Failed to connect with the device')
                    }
                },
                async writeFlash() {},
                async after() {}
            }
        },
        async promptManualBootRetry(error) {
            promptCalls.push(error.message)
            return true
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.deepEqual(loaderModes, ['default_reset', 'default_reset:connect', 'no_reset'])
    assert.deepEqual(requestedPorts.map((port) => port.id), [1])
    assert.deepEqual(disconnectCalls, [1, 1])
    assert.equal(promptCalls.length, 1)
    assert.match(promptCalls[0], /Wrong boot mode detected/)
})

test('EspFirmwareInstaller should stop repeated connect retries when transport trace shows normal firmware boot logs', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    const loaderModes = []
    const promptCalls = []
    let loaderAttempt = 0
    let firstAttemptConnectCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                traceLog:
                    'boot:0x13 (SPI_FAST_FLASH_BOOT)\r\nentry 0x400805e4\r\nAP aktiv: EggBot_D8CBB0 / http://192.168.4.1\r\n',
                async disconnect() {}
            }
        },
        loaderFactory(options) {
            loaderAttempt += 1
            return {
                transport: options.transport,
                async _connectAttempt(mode) {
                    loaderModes.push(`${mode}:connect`)
                    if (loaderAttempt === 1) {
                        firstAttemptConnectCalls += 1
                        return 'Read timeout exceeded'
                    }
                    return 'success'
                },
                async main(mode) {
                    loaderModes.push(mode)
                    if (loaderAttempt === 1) {
                        for (let index = 0; index < 7; index += 1) {
                            await this._connectAttempt(mode)
                        }
                        throw new Error('Failed to connect with the device')
                    }
                },
                async writeFlash() {},
                async after() {}
            }
        },
        async promptManualBootRetry(error) {
            promptCalls.push(error.message)
            return true
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(firstAttemptConnectCalls, 1)
    assert.deepEqual(loaderModes, ['default_reset', 'default_reset:connect', 'no_reset'])
    assert.equal(promptCalls.length, 1)
    assert.match(promptCalls[0], /Wrong boot mode detected/)
})

test('EspFirmwareInstaller should tolerate one missing trailing sync reply after download mode responds', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncCommandCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {}
            }
        },
        loaderFactory() {
            return {
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        syncCommandCalls += 1
                        return [0x55552012, new Uint8Array([0, 0, 0, 0])]
                    }

                    syncCommandCalls += 1
                    if (syncCommandCalls <= 7) {
                        return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                    }

                    throw new Error('Read timeout exceeded')
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
    assert.equal(syncCommandCalls, 8)
})

test('EspFirmwareInstaller should continue sync after one recoverable idle gap before trailing replies arrive', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncCommandCalls = 0

    const delayedFollowUpReplies = [
        new Error('Serial data stream stopped: Possible serial noise or corruption.'),
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])]
    ]

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {}
            }
        },
        loaderFactory() {
            return {
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        syncCommandCalls += 1
                        return [0x55552012, new Uint8Array([0, 0, 0, 0])]
                    }

                    syncCommandCalls += 1
                    const nextReply = delayedFollowUpReplies.shift()
                    if (nextReply instanceof Error) {
                        throw nextReply
                    }
                    return nextReply || [0x20120707, new Uint8Array([0, 0, 0, 0])]
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
    assert.equal(syncCommandCalls, 9)
})

test('EspFirmwareInstaller should tolerate sync when only five follow-up replies arrive', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncCommandCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {},
                async flushInput() {}
            }
        },
        loaderFactory(options) {
            return {
                transport: options.transport,
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        syncCommandCalls += 1
                        return [0x55555555, new Uint8Array([0, 0, 0, 0])]
                    }

                    syncCommandCalls += 1
                    if (syncCommandCalls <= 6) {
                        return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                    }

                    throw new Error('Read timeout exceeded')
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
    assert.equal(syncCommandCalls, 7)
})

test('EspFirmwareInstaller should use an extended timeout for the initial sync command', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncCommandCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {},
                async flushInput() {}
            }
        },
        loaderFactory(options) {
            return {
                transport: options.transport,
                debug() {},
                async command(opCode, _data, _chk, _waitResponse, timeout) {
                    if (opCode === 8) {
                        syncCommandCalls += 1
                        if (timeout < 2000) {
                            throw new Error('Read timeout exceeded')
                        }

                        return [0x55555555, new Uint8Array([0, 0, 0, 0])]
                    }

                    syncCommandCalls += 1
                    if (syncCommandCalls <= 4) {
                        return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                    }

                    throw new Error('Read timeout exceeded')
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
    assert.equal(syncCommandCalls, 5)
})

test('EspFirmwareInstaller should continue sync after two recoverable idle gaps and three follow-up replies', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncCommandCalls = 0

    const delayedFollowUpReplies = [
        new Error('Serial data stream stopped: Possible serial noise or corruption.'),
        new Error('Serial data stream stopped: Possible serial noise or corruption.'),
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        [0x20120707, new Uint8Array([0, 0, 0, 0])],
        new Error('Read timeout exceeded')
    ]

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {},
                async flushInput() {}
            }
        },
        loaderFactory(options) {
            return {
                transport: options.transport,
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        syncCommandCalls += 1
                        return [0x55555555, new Uint8Array([0, 0, 0, 0])]
                    }

                    syncCommandCalls += 1
                    const nextReply = delayedFollowUpReplies.shift()
                    if (nextReply instanceof Error) {
                        throw nextReply
                    }

                    return nextReply || [0x20120707, new Uint8Array([0, 0, 0, 0])]
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
    assert.equal(syncCommandCalls, 7)
})

test('EspFirmwareInstaller should preserve bytes consumed by connect boot-log sniff before sync starts', async () => {
    const { EspFirmwareInstaller, EspInstallerTransport } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0

    const packetBody = new Uint8Array([0x01, 0x08, 0x04, 0x00, 0x55, 0x55, 0x55, 0x55, 0x00, 0x00, 0x00, 0x00])
    const packet = new Uint8Array([0xc0, ...packetBody, 0xc0])
    const packetQueue = [packet, packet, packet, packet]

    const mockReader = {
        closed: Promise.resolve(false),
        async read() {
            if (packetQueue.length > 0) {
                return {
                    done: false,
                    value: packetQueue.shift()
                }
            }

            return new Promise(() => {})
        },
        async cancel() {},
        releaseLock() {}
    }

    const mockPort = {
        readable: {
            locked: false,
            getReader() {
                return mockReader
            }
        },
        writable: {
            locked: false,
            getWriter() {
                return {
                    async write() {},
                    async close() {},
                    releaseLock() {}
                }
            }
        },
        getInfo() {
            return {}
        },
        async open() {},
        async close() {},
        async setSignals() {}
    }

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return mockPort
        },
        transportFactory(port) {
            const transport = new EspInstallerTransport(port)
            transport.trace = () => {}
            transport.detectPanicHandler = () => {}
            return transport
        },
        loaderFactory(options) {
            const DEFAULT_TIMEOUT = 3000

            return {
                transport: options.transport,
                DEFAULT_TIMEOUT,
                debug() {},
                async readPacket(op = null, timeout = DEFAULT_TIMEOUT) {
                    for (let index = 0; index < 100; index += 1) {
                        const { value: packetValue } = await this.transport.read(timeout).next()
                        if (!packetValue || packetValue.length < 8) {
                            continue
                        }

                        const resp = packetValue[0]
                        if (resp !== 1) {
                            continue
                        }

                        const opRet = packetValue[1]
                        const value =
                            packetValue[4] |
                            (packetValue[5] << 8) |
                            (packetValue[6] << 16) |
                            (packetValue[7] << 24)
                        const data = packetValue.slice(8)
                        if (op === null || opRet === op) {
                            return [value >>> 0, data]
                        }
                    }

                    throw new Error('invalid response')
                },
                async command(op = null, data = new Uint8Array(0), _chk = 0, waitResponse = true, timeout = DEFAULT_TIMEOUT) {
                    if (op !== null) {
                        const packetBytes = new Uint8Array(8 + data.length)
                        packetBytes[1] = op
                        packetBytes[2] = data.length & 0xff
                        packetBytes[3] = (data.length >> 8) & 0xff
                        await this.transport.write(packetBytes)
                    }

                    if (!waitResponse) {
                        return [0, new Uint8Array(0)]
                    }

                    return this.readPacket(op, timeout)
                },
                async sync() {
                    const cmd = new Uint8Array(36)
                    cmd[0] = 0x07
                    cmd[1] = 0x07
                    cmd[2] = 0x12
                    cmd[3] = 0x20
                    cmd.fill(0x55, 4)

                    let response = await this.command(0x08, cmd, undefined, undefined, 100)
                    this.syncStubDetected = response[0] === 0
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                        this.syncStubDetected = this.syncStubDetected && response[0] === 0
                    }
                    return response
                },
                async _connectAttempt() {
                    const waitingBytes = this.transport.inWaiting()
                    await this.transport.newRead(waitingBytes > 0 ? waitingBytes : 1, this.DEFAULT_TIMEOUT)

                    try {
                        await this.sync()
                        return 'success'
                    } catch (_error) {
                        return 'sync failed'
                    }
                },
                async main() {
                    const response = await this._connectAttempt()
                    if (response !== 'success') {
                        throw new Error(response)
                    }
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
})

test('EspFirmwareInstaller should flush stale sync replies before chip detection continues', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let flushInputCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {},
                async flushInput() {
                    flushInputCalls += 1
                }
            }
        },
        loaderFactory(options) {
            return {
                transport: options.transport,
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        return [0x55552012, new Uint8Array([0, 0, 0, 0])]
                    }
                    return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {},
                async after() {}
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(flushInputCalls, 1)
})

test('EspFirmwareInstaller should refresh the active reader directly after sync without awaiting a hanging flushInput', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let flushInputCalls = 0
    let cancelCalls = 0
    let releaseLockCalls = 0
    let getReaderCalls = 0
    const replacementReader = {
        async cancel() {},
        releaseLock() {}
    }

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                buffer: new Uint8Array([0x01, 0x02, 0x03]),
                reader: {
                    async cancel() {
                        cancelCalls += 1
                    },
                    releaseLock() {
                        releaseLockCalls += 1
                    }
                },
                device: {
                    readable: {
                        getReader() {
                            getReaderCalls += 1
                            return replacementReader
                        }
                    }
                },
                async disconnect() {},
                async flushInput() {
                    flushInputCalls += 1
                    return new Promise(() => {})
                }
            }
        },
        loaderFactory(options) {
            return {
                transport: options.transport,
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        return [0x55552012, new Uint8Array([0, 0, 0, 0])]
                    }
                    return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async main() {
                    await this.sync()
                },
                async writeFlash() {},
                async after() {}
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(flushInputCalls, 0)
    assert.equal(cancelCalls, 1)
    assert.equal(releaseLockCalls, 1)
    assert.equal(getReaderCalls, 1)
})

test('EspFirmwareInstaller should retry chip detection after one recoverable readReg timeout', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    let writeFlashCalls = 0
    let afterCalls = 0
    let syncOpcodeCalls = 0
    let readRegCalls = 0

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [{ path: 'firmware.bin', offset: 65536 }]
                                }
                            ]
                        }
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([0xe9, 0, 0, 0]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {}
            }
        },
        loaderFactory() {
            return {
                CHIP_DETECT_MAGIC_REG_ADDR: 0x40001000,
                debug() {},
                async command(opCode) {
                    if (opCode === 8) {
                        syncOpcodeCalls += 1
                        return [0x55552012, new Uint8Array([0, 0, 0, 0])]
                    }

                    return [0x20120707, new Uint8Array([0, 0, 0, 0])]
                },
                async sync() {
                    let response = await this.command(8)
                    for (let index = 0; index < 7; index += 1) {
                        response = await this.command()
                    }
                    return response
                },
                async readReg(address) {
                    readRegCalls += 1
                    if (address === this.CHIP_DETECT_MAGIC_REG_ADDR && readRegCalls === 1) {
                        throw new Error('Read timeout exceeded')
                    }
                    return 0x00f01d83
                },
                async main() {
                    await this.sync()
                    await this.readReg(this.CHIP_DETECT_MAGIC_REG_ADDR)
                },
                async writeFlash() {
                    writeFlashCalls += 1
                },
                async after() {
                    afterCalls += 1
                }
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json'
    })

    assert.equal(syncOpcodeCalls, 2)
    assert.equal(readRegCalls, 2)
    assert.equal(writeFlashCalls, 1)
    assert.equal(afterCalls, 1)
})

test('EspFirmwareInstaller should report overall flashing progress across all firmware parts', async () => {
    const { EspFirmwareInstaller } = await importIsolatedInstallerModule()
    const progressUpdates = []

    const installer = new EspFirmwareInstaller({
        fetchImpl: async (url) => {
            if (String(url).endsWith('/manifest.json')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            builds: [
                                {
                                    chipFamily: 'ESP32',
                                    parts: [
                                        { path: 'bootloader.bin', offset: 4096 },
                                        { path: 'firmware.bin', offset: 65536 }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }

            if (String(url).endsWith('/bootloader.bin')) {
                return {
                    ok: true,
                    async arrayBuffer() {
                        return new Uint8Array([1, 2, 3, 4]).buffer
                    }
                }
            }

            return {
                ok: true,
                async arrayBuffer() {
                    return new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer
                }
            }
        },
        async portRequester() {
            return { id: 1 }
        },
        transportFactory() {
            return {
                async disconnect() {}
            }
        },
        loaderFactory() {
            return {
                async main() {},
                async writeFlash(options) {
                    options.reportProgress(0, 0, 2)
                    options.reportProgress(0, 2, 2)
                    options.reportProgress(1, 0, 6)
                    options.reportProgress(1, 3, 6)
                    options.reportProgress(1, 6, 6)
                },
                async after() {}
            }
        }
    })

    await installer.install({
        manifestUrl: 'https://example.com/firmware/manifest.json',
        onProgress: (update) => progressUpdates.push(update)
    })

    assert.deepEqual(
        progressUpdates.map((update) => update.overallPercent),
        [0, 25, 25, 63, 100]
    )
    assert.equal(progressUpdates[progressUpdates.length - 1]?.overallTotal, 16)
})
