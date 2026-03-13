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
