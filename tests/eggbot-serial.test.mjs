import test from 'node:test'
import assert from 'node:assert/strict'
import { EggBotSerial } from '../src/EggBotSerial.mjs'

const LAST_PORT_STORAGE_KEY = 'eggbot.serial.lastPort.v1'

/**
 * Creates a minimal localStorage mock.
 * @returns {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void, clear: () => void }}
 */
function createLocalStorageMock() {
    const data = new Map()

    return {
        getItem(key) {
            return data.has(key) ? data.get(key) : null
        },
        setItem(key, value) {
            data.set(key, String(value))
        },
        removeItem(key) {
            data.delete(key)
        },
        clear() {
            data.clear()
        }
    }
}

/**
 * Installs browser-like globals for Web Serial tests.
 * @param {{ getPorts?: () => Promise<SerialPort[]>, requestPort?: () => Promise<SerialPort> }} [overrides]
 * @returns {{ localStorage: ReturnType<typeof createLocalStorageMock>, requestPortCalls: () => number, restore: () => void }}
 */
function installBrowserMocks(overrides = {}) {
    const originalWindow = globalThis.window
    const originalNavigator = globalThis.navigator
    const localStorage = createLocalStorageMock()

    let requestPortCallCount = 0
    const serialApi = {
        getPorts: overrides.getPorts || (async () => []),
        requestPort: async () => {
            requestPortCallCount += 1
            if (!overrides.requestPort) {
                throw new Error('requestPort mock missing')
            }
            return overrides.requestPort()
        }
    }

    globalThis.window = {
        setTimeout,
        clearTimeout,
        localStorage
    }
    globalThis.navigator = {
        serial: serialApi
    }

    return {
        localStorage,
        requestPortCalls: () => requestPortCallCount,
        restore() {
            globalThis.window = originalWindow
            globalThis.navigator = originalNavigator
        }
    }
}

/**
 * Builds one serial port mock that emits a version line.
 * @param {{ usbVendorId?: number, usbProductId?: number }} [info]
 * @param {string} [versionLine]
 * @returns {SerialPort & { openCalls: number, closeCalls: number, openOptions: Record<string, any>[] }}
 */
function createMockPort(info = {}, versionLine = 'EBBv3.0') {
    const encoder = new TextEncoder()
    let chunkIndex = 0
    const chunks = [encoder.encode(`${versionLine}\r\n`)]

    const reader = {
        canceled: false,
        async read() {
            if (this.canceled) {
                return { value: undefined, done: true }
            }
            if (chunkIndex < chunks.length) {
                const value = chunks[chunkIndex]
                chunkIndex += 1
                return { value, done: false }
            }
            return { value: undefined, done: true }
        },
        async cancel() {
            this.canceled = true
        },
        releaseLock() {}
    }

    const writer = {
        async write(_bytes) {},
        releaseLock() {}
    }

    return {
        openCalls: 0,
        closeCalls: 0,
        openOptions: [],
        getInfo() {
            return {
                usbVendorId: info.usbVendorId,
                usbProductId: info.usbProductId
            }
        },
        writable: {
            getWriter() {
                return writer
            }
        },
        readable: {
            getReader() {
                return reader
            }
        },
        async open(options) {
            this.openCalls += 1
            this.openOptions.push(options)
        },
        async close() {
            this.closeCalls += 1
        }
    }
}

/**
 * Installs a minimal fast-timer window mock for draw-loop tests.
 * @returns {() => void}
 */
function installFastWindowTimers() {
    const originalWindow = globalThis.window
    globalThis.window = {
        setTimeout: (callback) => {
            queueMicrotask(callback)
            return 1
        },
        clearTimeout: () => {},
        localStorage: createLocalStorageMock()
    }
    return () => {
        globalThis.window = originalWindow
    }
}

/**
 * Creates a connected serial instance with command capture hooks.
 * @returns {{ serial: EggBotSerial, commands: string[] }}
 */
function createConnectedDrawSerial() {
    const serial = new EggBotSerial()
    const commands = []
    serial.port = /** @type {SerialPort} */ ({})
    serial.writer = /** @type {WritableStreamDefaultWriter<Uint8Array>} */ ({})
    serial.sendCommand = async (command) => {
        commands.push(command)
        return ''
    }
    return { serial, commands }
}

test('EggBotSerial.connectForDraw should use remembered granted port without chooser', async () => {
    const rememberedPort = createMockPort({ usbVendorId: 0x1234, usbProductId: 0x5678 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [rememberedPort],
        requestPort: async () => createMockPort()
    })
    mockedBrowser.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify({ usbVendorId: 0x1234, usbProductId: 0x5678 }))

    const serial = new EggBotSerial()
    try {
        const version = await serial.connectForDraw()

        assert.equal(version, 'EBBv3.0')
        assert.equal(rememberedPort.openCalls, 1)
        assert.equal(mockedBrowser.requestPortCalls(), 0)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.connectForDraw should request port when no granted ports exist', async () => {
    const requestedPort = createMockPort({ usbVendorId: 0xabcd, usbProductId: 0x1001 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [],
        requestPort: async () => requestedPort
    })

    const serial = new EggBotSerial()
    try {
        await serial.connectForDraw({ baudRate: 19200 })

        assert.equal(mockedBrowser.requestPortCalls(), 1)
        assert.equal(requestedPort.openCalls, 1)
        assert.equal(requestedPort.openOptions[0]?.baudRate, 19200)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.connectForDraw should request port when remembered match is ambiguous', async () => {
    const ambiguousPortA = createMockPort({ usbVendorId: 0x2222, usbProductId: 0x3333 })
    const ambiguousPortB = createMockPort({ usbVendorId: 0x2222, usbProductId: 0x3333 })
    const requestedPort = createMockPort({ usbVendorId: 0x9999, usbProductId: 0x0001 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [ambiguousPortA, ambiguousPortB],
        requestPort: async () => requestedPort
    })
    mockedBrowser.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify({ usbVendorId: 0x2222, usbProductId: 0x3333 }))

    const serial = new EggBotSerial()
    try {
        await serial.connectForDraw()

        assert.equal(ambiguousPortA.openCalls, 0)
        assert.equal(ambiguousPortB.openCalls, 0)
        assert.equal(mockedBrowser.requestPortCalls(), 1)
        assert.equal(requestedPort.openCalls, 1)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial should persist vendor/product hint after successful connect', async () => {
    const requestedPort = createMockPort({ usbVendorId: 0x45aa, usbProductId: 0x67bb })
    const mockedBrowser = installBrowserMocks({
        requestPort: async () => requestedPort
    })

    const serial = new EggBotSerial()
    try {
        await serial.connect()

        const rawHint = mockedBrowser.localStorage.getItem(LAST_PORT_STORAGE_KEY)
        assert.equal(rawHint, JSON.stringify({ usbVendorId: 0x45aa, usbProductId: 0x67bb }))
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.connect should open with explicit baud rate', async () => {
    const requestedPort = createMockPort({ usbVendorId: 0x45ab, usbProductId: 0x67bc })
    const mockedBrowser = installBrowserMocks({
        requestPort: async () => requestedPort
    })

    const serial = new EggBotSerial()
    try {
        await serial.connect({ baudRate: 57600 })

        assert.equal(requestedPort.openCalls, 1)
        assert.equal(requestedPort.openOptions[0]?.baudRate, 57600)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.isCurrentPort should only match the active connected port', async () => {
    const activePort = createMockPort({ usbVendorId: 0xaaaa, usbProductId: 0xbbbb })
    const otherPort = createMockPort({ usbVendorId: 0xcccc, usbProductId: 0xdddd })
    const mockedBrowser = installBrowserMocks({
        requestPort: async () => activePort
    })

    const serial = new EggBotSerial()
    try {
        await serial.connect()

        assert.equal(serial.isCurrentPort(activePort), true)
        assert.equal(serial.isCurrentPort(otherPort), false)

        await serial.disconnect()
        assert.equal(serial.isCurrentPort(activePort), false)
    } finally {
        mockedBrowser.restore()
    }
})

test('EggBotSerial.drawStrokes should preserve command ordering and progress with worker-prepared paths', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()
    const statuses = []
    const progress = []

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return {
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 48, y: 0 }
                    ]
                ]
            }
        }
    }

    try {
        await serial.drawStrokes(
            [
                {
                    points: [
                        { u: 0, v: 0.5 },
                        { u: 0.1, v: 0.5 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                msPerStep: 1,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false
            },
            {
                onStatus: (text) => statuses.push(text),
                onProgress: (done, total) => progress.push({ done, total })
            }
        )

        assert.equal(commands[0], 'SC,4,12000')
        assert.equal(commands[1], 'SC,5,17000')
        assert.equal(commands[2], 'EM,1,1')
        assert.equal(commands.some((command) => command.startsWith('SM,')), true)
        assert.equal(commands[commands.length - 1], 'EM,0,0')
        assert.deepEqual(progress, [{ done: 1, total: 1 }])
        assert.equal(statuses.includes('Draw finished.'), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial.drawStrokes should abort cleanly when stop is requested during path preprocessing', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()
    const statuses = []
    let resolvePathPrep = null

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return new Promise((resolve) => {
                resolvePathPrep = resolve
            })
        }
    }

    try {
        const drawPromise = serial.drawStrokes(
            [
                {
                    points: [
                        { u: 0, v: 0.5 },
                        { u: 0.2, v: 0.5 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                msPerStep: 1,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false
            },
            {
                onStatus: (text) => statuses.push(text)
            }
        )
        serial.stop()
        resolvePathPrep({
            strokes: [
                [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 }
                ]
            ]
        })
        await drawPromise

        assert.deepEqual(commands, [])
        assert.equal(statuses.includes('Draw aborted by user.'), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial.drawStrokes should fallback to synchronous preprocessing when path worker fails', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()
    const originalWarn = console.warn
    console.warn = () => {}

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            throw new Error('synthetic path worker failure')
        }
    }

    try {
        await serial.drawStrokes(
            [
                {
                    points: [
                        { u: 0, v: 0.5 },
                        { u: 0.12, v: 0.52 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                msPerStep: 1,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false
            }
        )

        assert.equal(serial.disablePathWorker, true)
        assert.equal(commands.some((command) => command.startsWith('SM,')), true)
        assert.equal(commands[commands.length - 1], 'EM,0,0')
    } finally {
        console.warn = originalWarn
        restoreTimers()
    }
})
