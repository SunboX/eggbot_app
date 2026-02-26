import test from 'node:test'
import assert from 'node:assert/strict'
import { EggBotBle } from '../src/EggBotBle.mjs'
import { EggBotWifi } from '../src/EggBotWifi.mjs'

const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'

/**
 * Installs browser-like timer + localStorage mocks.
 * @param {{ protocol?: string }} [options]
 * @returns {() => void}
 */
function installBrowserWindow(options = {}) {
    const originalWindow = globalThis.window
    const localStorageData = new Map()
    const protocol = String(options?.protocol || 'http:').trim() || 'http:'

    globalThis.window = {
        setTimeout,
        clearTimeout,
        location: {
            protocol
        },
        localStorage: {
            getItem(key) {
                return localStorageData.has(key) ? localStorageData.get(key) : null
            },
            setItem(key, value) {
                localStorageData.set(key, String(value))
            },
            removeItem(key) {
                localStorageData.delete(key)
            }
        }
    }

    return () => {
        globalThis.window = originalWindow
    }
}

/**
 * Builds one EventTarget-like helper.
 * @returns {{ addEventListener: (type: string, handler: Function) => void, removeEventListener: (type: string, handler: Function) => void, emit: (type: string, event?: Record<string, any>) => void }}
 */
function createEventDispatcher() {
    const listeners = new Map()
    return {
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set())
            }
            listeners.get(type).add(handler)
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler)
        },
        emit(type, event = {}) {
            listeners.get(type)?.forEach((handler) => {
                handler({ type, ...event })
            })
        }
    }
}

/**
 * Builds one WebSocket mock class.
 * @returns {{ MockSocket: typeof WebSocket & { instances: any[] } }}
 */
function createWebSocketMock() {
    class MockSocket {
        static instances = []

        constructor(url) {
            this.url = url
            this.readyState = MockSocket.CONNECTING
            this.binaryType = 'blob'
            this.sent = []
            this.events = createEventDispatcher()
            MockSocket.instances.push(this)
            queueMicrotask(() => {
                this.readyState = MockSocket.OPEN
                this.events.emit('open')
            })
        }

        addEventListener(type, handler) {
            this.events.addEventListener(type, handler)
        }

        removeEventListener(type, handler) {
            this.events.removeEventListener(type, handler)
        }

        send(payload) {
            this.sent.push(payload)
            if (payload === 'v\r') {
                queueMicrotask(() => {
                    this.emitMessage('EBBv13.0\r\n')
                })
            }
        }

        close() {
            this.readyState = MockSocket.CLOSED
            this.events.emit('close')
        }

        emitMessage(data) {
            this.events.emit('message', { data })
        }
    }

    MockSocket.CONNECTING = 0
    MockSocket.OPEN = 1
    MockSocket.CLOSING = 2
    MockSocket.CLOSED = 3

    return { MockSocket }
}

/**
 * Installs navigator.bluetooth mock for BLE transport tests.
 * @param {{ requestDevice: (options?: Record<string, any>) => Promise<any> }} overrides
 * @returns {() => void}
 */
function installBluetoothNavigator(overrides) {
    const originalNavigator = globalThis.navigator
    globalThis.navigator = {
        bluetooth: {
            requestDevice: overrides.requestDevice
        }
    }

    return () => {
        globalThis.navigator = originalNavigator
    }
}

test('EggBotWifi should parse fragmented websocket response lines', async () => {
    const restoreWindow = installBrowserWindow()
    const originalWebSocket = globalThis.WebSocket
    const { MockSocket } = createWebSocketMock()
    globalThis.WebSocket = MockSocket

    const wifi = new EggBotWifi()
    try {
        await wifi.connect({ host: '192.168.1.42', port: 1337 })
        const socket = MockSocket.instances[0]
        assert.ok(socket)

        const pending = wifi.sendCommand('v', { expectResponse: true, timeoutMs: 1000 })
        socket.emitMessage('EBBv')
        socket.emitMessage('13.0\r\n')

        const response = await pending
        assert.equal(response, 'EBBv13.0')
        assert.equal(socket.sent[socket.sent.length - 1], 'v\r')
    } finally {
        await wifi.disconnect()
        globalThis.WebSocket = originalWebSocket
        restoreWindow()
    }
})

test('EggBotWifi should use secure websocket on https pages', async () => {
    const restoreWindow = installBrowserWindow({ protocol: 'https:' })
    const originalWebSocket = globalThis.WebSocket
    const { MockSocket } = createWebSocketMock()
    globalThis.WebSocket = MockSocket

    const wifi = new EggBotWifi()
    try {
        await wifi.connect({ host: '192.168.1.42', port: 1337, secure: false })
        const socket = MockSocket.instances[0]
        assert.ok(socket)
        assert.equal(socket.url, 'wss://192.168.1.42:1337/')
    } finally {
        await wifi.disconnect()
        globalThis.WebSocket = originalWebSocket
        restoreWindow()
    }
})

test('EggBotBle.connect should request filtered BLE service by default', async () => {
    const restoreWindow = installBrowserWindow()
    let requestOptions = null
    const restoreNavigator = installBluetoothNavigator({
        requestDevice: async (options = {}) => {
            requestOptions = options
            throw new Error('stop')
        }
    })

    const ble = new EggBotBle()
    try {
        await assert.rejects(() => ble.connect(), /BLE request failed: stop/)
        assert.deepEqual(requestOptions, {
            filters: [{ services: [BLE_SERVICE_UUID] }],
            optionalServices: [BLE_SERVICE_UUID]
        })
    } finally {
        await ble.disconnect().catch(() => {})
        restoreNavigator()
        restoreWindow()
    }
})

test('EggBotBle.connect should use accept-all chooser in debug scan mode', async () => {
    const restoreWindow = installBrowserWindow()
    let requestOptions = null
    const restoreNavigator = installBluetoothNavigator({
        requestDevice: async (options = {}) => {
            requestOptions = options
            throw new Error('stop')
        }
    })

    const ble = new EggBotBle()
    try {
        await assert.rejects(() => ble.connect({ debugScan: true }), /BLE request failed: stop/)
        assert.deepEqual(requestOptions, {
            acceptAllDevices: true,
            optionalServices: [BLE_SERVICE_UUID]
        })
    } finally {
        await ble.disconnect().catch(() => {})
        restoreNavigator()
        restoreWindow()
    }
})

test('EggBotBle should expose stage in request failure errors', async () => {
    const restoreWindow = installBrowserWindow()
    const restoreNavigator = installBluetoothNavigator({
        requestDevice: async () => {
            throw new Error('User cancelled')
        }
    })

    const ble = new EggBotBle()
    try {
        await assert.rejects(() => ble.connect(), /BLE request failed: User cancelled/)
    } finally {
        await ble.disconnect().catch(() => {})
        restoreNavigator()
        restoreWindow()
    }
})

test('EggBotBle should decode notification line fragments for expectResponse reads', async () => {
    const restoreWindow = installBrowserWindow()

    const txEvents = createEventDispatcher()
    let txNotificationHandler = null

    const txCharacteristic = {
        addEventListener(type, handler) {
            if (type === 'characteristicvaluechanged') {
                txNotificationHandler = handler
            }
            txEvents.addEventListener(type, handler)
        },
        removeEventListener(type, handler) {
            txEvents.removeEventListener(type, handler)
        },
        async startNotifications() {},
        async stopNotifications() {}
    }

    const rxCharacteristic = {
        writes: [],
        async writeValueWithoutResponse(bytes) {
            this.writes.push(new Uint8Array(bytes))
            const text = new TextDecoder().decode(bytes)
            if (text === 'v\r' && typeof txNotificationHandler === 'function') {
                const versionChunk = new TextEncoder().encode('EBBv13.0\r\n')
                queueMicrotask(() => {
                    txNotificationHandler({ target: { value: new DataView(versionChunk.buffer) } })
                })
            }
        }
    }

    const service = {
        async getCharacteristic(uuid) {
            if (String(uuid).toLowerCase().includes('0002')) {
                return rxCharacteristic
            }
            return txCharacteristic
        }
    }

    const gattServer = {
        connected: true,
        async getPrimaryService() {
            return service
        },
        disconnect() {
            this.connected = false
        }
    }

    const deviceEvents = createEventDispatcher()
    const device = {
        gatt: {
            async connect() {
                return gattServer
            }
        },
        addEventListener(type, handler) {
            deviceEvents.addEventListener(type, handler)
        },
        removeEventListener(type, handler) {
            deviceEvents.removeEventListener(type, handler)
        }
    }

    const restoreNavigator = installBluetoothNavigator({
        requestDevice: async () => device
    })

    const ble = new EggBotBle()
    try {
        await ble.connect()
        const pending = ble.sendCommand('v', { expectResponse: true, timeoutMs: 1000 })
        const response = await pending
        assert.equal(response, 'EBBv13.0')
        assert.equal(new TextDecoder().decode(rxCharacteristic.writes[rxCharacteristic.writes.length - 1]), 'v\r')
    } finally {
        await ble.disconnect().catch(() => {})
        restoreNavigator()
        restoreWindow()
    }
})
