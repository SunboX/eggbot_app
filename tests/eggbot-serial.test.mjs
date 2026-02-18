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
 * @returns {SerialPort & { openCalls: number, closeCalls: number }}
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
        async open(_options) {
            this.openCalls += 1
        },
        async close() {
            this.closeCalls += 1
        }
    }
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
        await serial.connectForDraw()

        assert.equal(mockedBrowser.requestPortCalls(), 1)
        assert.equal(requestedPort.openCalls, 1)
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
