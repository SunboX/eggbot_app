import test from 'node:test'
import assert from 'node:assert/strict'
import { EggBotSerial } from '../src/EggBotSerial.mjs'
import { EggBotPathComputeTasks } from '../src/EggBotPathComputeTasks.mjs'
import { SvgPatternImportWorkerParser } from '../src/workers/SvgPatternImportWorkerParser.mjs'

const LAST_PORT_STORAGE_KEY = 'eggbot.serial.lastPort.v1'
const RECONNECT_ON_LOAD_STORAGE_KEY = 'eggbot.serial.reconnectOnLoad.v1'

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
 * Builds one serial port mock that emits predefined read chunks.
 * @param {{ usbVendorId?: number, usbProductId?: number }} [info]
 * @param {Uint8Array[]} [chunks]
 * @returns {SerialPort & { openCalls: number, closeCalls: number, openOptions: Record<string, any>[] }}
 */
function createMockPortFromChunks(info = {}, chunks = []) {
    let chunkIndex = 0

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
 * Builds one serial port mock that emits a version line.
 * @param {{ usbVendorId?: number, usbProductId?: number }} [info]
 * @param {string} [versionLine]
 * @returns {SerialPort & { openCalls: number, closeCalls: number, openOptions: Record<string, any>[] }}
 */
function createMockPort(info = {}, versionLine = 'EBBv3.0') {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode(`${versionLine}\r\n`)]
    return createMockPortFromChunks(info, chunks)
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
        assert.equal(rememberedPort.openOptions[0]?.baudRate, 115200)
        assert.equal(mockedBrowser.requestPortCalls(), 0)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.connectForDraw should sanitize mojibake artifacts in version responses', async () => {
    const versionSuffix = new TextEncoder().encode('EBBv13_and_above Protocol emulated by Eggduino-Firmware V1.6a\r\n')
    const versionChunk = new Uint8Array(4 + versionSuffix.length)
    versionChunk.set([0x26, 0xa9, 0x28, 0xa9], 0)
    versionChunk.set(versionSuffix, 4)
    const requestedPort = createMockPortFromChunks({ usbVendorId: 0xfeed, usbProductId: 0xbeef }, [versionChunk])
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [],
        requestPort: async () => requestedPort
    })

    const serial = new EggBotSerial()
    try {
        const version = await serial.connectForDraw()

        assert.equal(version, 'EBBv13_and_above Protocol emulated by Eggduino-Firmware V1.6a')
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.sendCommand should ignore OK and echoed lines before returning query data', async () => {
    const restoreTimers = installFastWindowTimers()
    const serial = new EggBotSerial()
    const writes = []
    serial.port = /** @type {SerialPort} */ ({})
    serial.writer = /** @type {WritableStreamDefaultWriter<Uint8Array>} */ ({
        async write(bytes) {
            writes.push(new TextDecoder().decode(bytes))
        },
        releaseLock() {}
    })
    serial.lineQueue = ['OK', 'QB', '0']

    try {
        const response = await serial.sendCommand('QB', {
            expectResponse: true,
            timeoutMs: 500
        })

        assert.equal(response, '0')
        assert.deepEqual(writes, ['QB\r'])
    } finally {
        restoreTimers()
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

test('EggBotSerial.reconnectIfPreviouslyConnected should use remembered granted port without chooser', async () => {
    const rememberedPort = createMockPort({ usbVendorId: 0x1234, usbProductId: 0x5678 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [rememberedPort],
        requestPort: async () => createMockPort()
    })
    mockedBrowser.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify({ usbVendorId: 0x1234, usbProductId: 0x5678 }))
    mockedBrowser.localStorage.setItem(RECONNECT_ON_LOAD_STORAGE_KEY, '1')

    const serial = new EggBotSerial()
    try {
        const version = await serial.reconnectIfPreviouslyConnected()

        assert.equal(version, 'EBBv3.0')
        assert.equal(rememberedPort.openCalls, 1)
        assert.equal(mockedBrowser.requestPortCalls(), 0)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.reconnectIfPreviouslyConnected should no-op when reconnect flag is missing', async () => {
    const rememberedPort = createMockPort({ usbVendorId: 0x9876, usbProductId: 0x5432 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [rememberedPort],
        requestPort: async () => createMockPort()
    })
    mockedBrowser.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify({ usbVendorId: 0x9876, usbProductId: 0x5432 }))

    const serial = new EggBotSerial()
    try {
        const version = await serial.reconnectIfPreviouslyConnected()

        assert.equal(version, null)
        assert.equal(rememberedPort.openCalls, 0)
        assert.equal(mockedBrowser.requestPortCalls(), 0)
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.reconnectIfPreviouslyConnected should no-op when remembered match is ambiguous', async () => {
    const ambiguousPortA = createMockPort({ usbVendorId: 0x2222, usbProductId: 0x3333 })
    const ambiguousPortB = createMockPort({ usbVendorId: 0x2222, usbProductId: 0x3333 })
    const mockedBrowser = installBrowserMocks({
        getPorts: async () => [ambiguousPortA, ambiguousPortB],
        requestPort: async () => createMockPort()
    })
    mockedBrowser.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify({ usbVendorId: 0x2222, usbProductId: 0x3333 }))
    mockedBrowser.localStorage.setItem(RECONNECT_ON_LOAD_STORAGE_KEY, '1')

    const serial = new EggBotSerial()
    try {
        const version = await serial.reconnectIfPreviouslyConnected()

        assert.equal(version, null)
        assert.equal(ambiguousPortA.openCalls, 0)
        assert.equal(ambiguousPortB.openCalls, 0)
        assert.equal(mockedBrowser.requestPortCalls(), 0)
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

        assert.equal(requestedPort.openOptions[0]?.baudRate, 115200)
        const rawHint = mockedBrowser.localStorage.getItem(LAST_PORT_STORAGE_KEY)
        assert.equal(rawHint, JSON.stringify({ usbVendorId: 0x45aa, usbProductId: 0x67bb }))
        assert.equal(mockedBrowser.localStorage.getItem(RECONNECT_ON_LOAD_STORAGE_KEY), '1')
    } finally {
        await serial.disconnect()
        mockedBrowser.restore()
    }
})

test('EggBotSerial.disconnect should clear reconnect-on-load intent', async () => {
    const requestedPort = createMockPort({ usbVendorId: 0x45ac, usbProductId: 0x67bd })
    const mockedBrowser = installBrowserMocks({
        requestPort: async () => requestedPort
    })

    const serial = new EggBotSerial()
    try {
        await serial.connect()
        assert.equal(mockedBrowser.localStorage.getItem(RECONNECT_ON_LOAD_STORAGE_KEY), '1')

        await serial.disconnect()
        assert.equal(mockedBrowser.localStorage.getItem(RECONNECT_ON_LOAD_STORAGE_KEY), null)
    } finally {
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
                onProgress: (done, total, detail) => progress.push({ done, total, detail })
            }
        )

        assert.equal(commands[0], 'SC,4,12000')
        assert.equal(commands[1], 'SC,5,17000')
        assert.equal(commands[2], 'EM,1,1')
        assert.equal(commands.includes('SP,1,200'), true)
        assert.equal(commands.some((command) => command.startsWith('SM,')), true)
        assert.equal(commands.includes('QB'), true)
        assert.equal(commands.includes('SM,10,0,0'), true)
        assert.equal(commands[commands.length - 1], 'EM,0,0')
        assert.equal(progress.length > 0, true)
        assert.equal(progress[0]?.done, 0)
        assert.equal(progress[0]?.total, 1)
        const finalProgress = progress[progress.length - 1]
        assert.equal(finalProgress?.done, 1)
        assert.equal(finalProgress?.total, 1)
        assert.equal(finalProgress?.detail?.remainingRatio, 0)
        assert.equal(finalProgress?.detail?.remainingMs, 0)
        assert.equal(Number.isFinite(finalProgress?.detail?.estimatedTotalMs), true)
        assert.equal(statuses.includes('Draw finished.'), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial.drawStrokes should convert pen lift rates from percent-per-second to EBB SC units', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return {
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 10, y: 0 }
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
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false,
                penRaiseRate: 50,
                penLowerRate: 20
            }
        )

        assert.equal(commands.includes('SC,11,250'), true)
        assert.equal(commands.includes('SC,12,100'), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial.drawStrokes should use diagonal distance timing like the Inkscape EggBot extension', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return {
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 30, y: 40 }
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
                        { u: 0.1, v: 0.4 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false,
                penDownSpeed: 200,
                penUpSpeed: 200,
                penMotorSpeed: 4000,
                eggMotorSpeed: 4000
            }
        )

        assert.equal(commands.some((command) => /^SM,250,40,-30$/.test(command)), true)
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

test('EggBotSerial.drawStrokes should respect reverse motor flags, wrap mode, and return-home move', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()
    let wrapAroundPayload = null

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes(payload) {
            wrapAroundPayload = payload
            return {
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 20, y: 10 }
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
                        { u: 0.1, v: 0.4 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false,
                penDownSpeed: 400,
                penUpSpeed: 400,
                reversePenMotor: true,
                reverseEggMotor: true,
                wrapAround: false,
                returnHome: true
            }
        )

        assert.equal(wrapAroundPayload?.drawConfig?.wrapAround, false)
        assert.equal(commands.some((command) => /^SM,\d+,10,-20$/.test(command)), true)
        assert.equal(commands.some((command) => /^SM,\d+,-10,20$/.test(command)), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial.drawStrokes should keep movement timing based on diagonal distance', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return {
                strokes: [
                    [
                        { x: 0, y: 0 },
                        { x: 20, y: 10 }
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
                        { u: 0.1, v: 0.4 }
                    ]
                }
            ],
            {
                stepsPerTurn: 3200,
                penRangeSteps: 1500,
                servoUp: 12000,
                servoDown: 17000,
                invertPen: false,
                penDownSpeed: 400,
                penUpSpeed: 400,
                penMotorSpeed: 1000,
                eggMotorSpeed: 50
            }
        )

        assert.equal(commands.some((command) => /^SM,56,10,-20$/.test(command)), true)
    } finally {
        restoreTimers()
    }
})

test('EggBotSerial should emit v281-like SP/SM/QB sequence for mm-based rectangle SVG', async () => {
    const restoreTimers = installFastWindowTimers()
    const { serial, commands } = createConnectedDrawSerial()
    const svgText = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320mm" height="100mm" viewBox="0 0 320 100">
            <g transform="translate(0,-197)">
                <rect x="20.606821" y="217.98375" width="227.91998" height="63.53756" fill="none" stroke="#000000" />
            </g>
        </svg>
    `
    const parsed = SvgPatternImportWorkerParser.parse(svgText, {
        heightScale: 1,
        heightReference: 1,
        curveSmoothing: 0.2
    })
    const prepared = EggBotPathComputeTasks.prepareDrawStrokes({
        strokes: parsed.strokes,
        drawConfig: {
            coordinateMode: 'document-px-centered',
            documentWidthPx: parsed.documentWidthPx,
            documentHeightPx: parsed.documentHeightPx,
            stepScalingFactor: 2,
            wrapAround: true
        },
        startX: 0
    })

    serial.pathWorker = {
        warmup() {},
        dispose() {},
        async prepareDrawStrokes() {
            return prepared
        }
    }

    try {
        await serial.drawStrokes(parsed.strokes, {
            stepsPerTurn: 3200,
            penRangeSteps: 1500,
            servoUp: 12000,
            servoDown: 17000,
            invertPen: false,
            penDownSpeed: 300,
            penUpSpeed: 400,
            penRaiseDelayMs: 200,
            penLowerDelayMs: 400,
            reversePenMotor: true,
            reverseEggMotor: true,
            returnHome: true,
            coordinateMode: 'document-px-centered',
            documentWidthPx: parsed.documentWidthPx,
            documentHeightPx: parsed.documentHeightPx,
            stepScalingFactor: 2
        })

        const stream = commands.filter((command) => {
            return command.startsWith('EM,') || command.startsWith('SP,') || command.startsWith('SM,') || command === 'QB'
        })
        assert.deepEqual(stream, [
            'EM,1,1',
            'SP,1,200',
            'SM,1346,-110,527',
            'QB',
            'SP,0,400',
            'SM,2874,0,-862',
            'QB',
            'SM,800,240,0',
            'QB',
            'SM,2874,0,862',
            'QB',
            'SM,800,-240,0',
            'QB',
            'SP,1,200',
            'SM,1346,110,-527',
            'QB',
            'SM,10,0,0',
            'EM,0,0'
        ])
    } finally {
        restoreTimers()
    }
})
