import { EggBotSerial } from './EggBotSerial.mjs'

const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const BLE_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const BLE_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

/**
 * EggBot transport over Web Bluetooth (EggDuino BLE UART profile).
 */
export class EggBotBle extends EggBotSerial {
    constructor() {
        super()
        this.device = null
        this.server = null
        this.service = null
        this.rxCharacteristic = null
        this.txCharacteristic = null
        this.pendingReadWaiters = []
        this.lineSubscribers = new Set()
        this.debugLoggingEnabled = false
        this.boundNotificationHandler = (event) => this.#handleNotification(event)
        this.boundGattDisconnectHandler = () => this.#handleGattDisconnected()
    }

    /**
     * Returns true when Web Bluetooth is available.
     * @returns {boolean}
     */
    static isSupported() {
        return typeof navigator !== 'undefined' && Boolean(navigator?.bluetooth)
    }

    /**
     * Returns one user-facing transport label.
     * @returns {string}
     */
    get connectionKindLabel() {
        return 'Web Bluetooth'
    }

    /**
     * Returns true while BLE transport is connected.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.server && this.server.connected && this.rxCharacteristic && this.txCharacteristic)
    }

    /**
     * Registers one parsed-line listener.
     * @param {(line: string) => void} callback
     */
    onLine(callback) {
        if (typeof callback === 'function') {
            this.lineSubscribers.add(callback)
        }
    }

    /**
     * Unregisters one parsed-line listener.
     * @param {(line: string) => void} callback
     */
    offLine(callback) {
        this.lineSubscribers.delete(callback)
    }

    /**
     * Opens one BLE connection.
     * @param {{ debugScan?: boolean, debugLog?: boolean }} [options]
     * @returns {Promise<string>}
     */
    async connect(options = {}) {
        this.#assertBleSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const connectOptions = EggBotBle.#normalizeConnectOptions(options)
        this.debugLoggingEnabled = connectOptions.debugLog
        const requestDeviceOptions = EggBotBle.#buildRequestDeviceOptions(connectOptions.debugScan)

        let stage = 'request'
        try {
            this.#logDebug('Requesting BLE device.', {
                debugScan: connectOptions.debugScan,
                serviceUuid: BLE_SERVICE_UUID
            })
            this.device = await navigator.bluetooth.requestDevice(requestDeviceOptions)
            if (!this.device) {
                throw new Error('No BLE device selected.')
            }
            this.#logDebug('BLE device selected.', EggBotBle.#describeDevice(this.device))
            this.device.addEventListener('gattserverdisconnected', this.boundGattDisconnectHandler)

            stage = 'gatt'
            this.server = await this.device.gatt.connect()
            this.#logDebug('Connected to BLE GATT server.')

            stage = 'service'
            this.service = await this.server.getPrimaryService(BLE_SERVICE_UUID)
            this.#logDebug('Resolved BLE primary service.', {
                serviceUuid: BLE_SERVICE_UUID
            })

            stage = 'chars'
            this.rxCharacteristic = await this.service.getCharacteristic(BLE_RX_UUID)
            this.txCharacteristic = await this.service.getCharacteristic(BLE_TX_UUID)
            this.#logDebug('Resolved BLE characteristics.', {
                rxUuid: BLE_RX_UUID,
                txUuid: BLE_TX_UUID
            })

            stage = 'notify'
            this.txCharacteristic.addEventListener('characteristicvaluechanged', this.boundNotificationHandler)
            await this.txCharacteristic.startNotifications()
            this.#logDebug('BLE notifications started.')

            const version = await this.#probeVersion()
            this.#logDebug('BLE version probe completed.', { version })
            return version
        } catch (error) {
            this.#logDebug('BLE connection failed.', {
                stage,
                message: String(error?.message || error || 'Unknown BLE error')
            })
            await this.#cleanupConnection()
            throw this.#buildStageError(stage, error)
        }
    }

    /**
     * Opens one BLE connection for draw-time usage.
     * @param {{ debugScan?: boolean, debugLog?: boolean }} [options]
     * @returns {Promise<string>}
     */
    async connectForDraw(options = {}) {
        return this.connect(options)
    }

    /**
     * BLE reconnect is always user-initiated; no automatic reconnect is attempted.
     * @returns {Promise<string | null>}
     */
    async reconnectIfPreviouslyConnected() {
        return null
    }

    /**
     * Returns false because BLE transport does not use Web Serial ports.
     * @returns {boolean}
     */
    isCurrentPort() {
        return false
    }

    /**
     * Closes BLE resources.
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.abortDrawing = true
        this.#logDebug('Disconnect requested.')
        await this.#cleanupConnection()
    }

    /**
     * Sends one EggBot command over BLE.
     * @param {string} command
     * @param {{ expectResponse?: boolean, timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async sendCommand(command, options = {}) {
        const expectResponse = Boolean(options.expectResponse)
        const timeoutMs = Number(options.timeoutMs) || 1200
        await this.#writeRaw(EggBotBle.#withCommandTerminator(command))
        if (!expectResponse) return ''
        return this.#readLine(timeoutMs)
    }

    /**
     * Throws when Web Bluetooth is unavailable.
     */
    #assertBleSupport() {
        if (!EggBotBle.isSupported()) {
            throw new Error('Web Bluetooth is not supported in this browser.')
        }
    }

    /**
     * Appends CR command terminator when missing.
     * @param {unknown} value
     * @returns {string}
     */
    static #withCommandTerminator(value) {
        const normalized = String(value || '')
        return normalized.endsWith('\r') ? normalized : `${normalized}\r`
    }

    /**
     * Normalizes connection debug options.
     * @param {{ debugScan?: boolean, debugLog?: boolean }} options
     * @returns {{ debugScan: boolean, debugLog: boolean }}
     */
    static #normalizeConnectOptions(options) {
        const debugScan = Boolean(options?.debugScan)
        const debugLog = Boolean(options?.debugLog) || debugScan
        return { debugScan, debugLog }
    }

    /**
     * Builds Web Bluetooth chooser options.
     * @param {boolean} debugScan
     * @returns {{ acceptAllDevices?: boolean, filters?: Array<{ services: string[] }>, optionalServices: string[] }}
     */
    static #buildRequestDeviceOptions(debugScan) {
        if (debugScan) {
            return {
                acceptAllDevices: true,
                optionalServices: [BLE_SERVICE_UUID]
            }
        }
        return {
            filters: [{ services: [BLE_SERVICE_UUID] }],
            optionalServices: [BLE_SERVICE_UUID]
        }
    }

    /**
     * Extracts one compact BLE device description for debug logs.
     * @param {BluetoothDevice | null | undefined} device
     * @returns {{ id: string, name: string, hasGatt: boolean }}
     */
    static #describeDevice(device) {
        return {
            id: String(device?.id || ''),
            name: String(device?.name || ''),
            hasGatt: Boolean(device?.gatt)
        }
    }

    /**
     * Builds one stage-aware connection error.
     * @param {'request' | 'gatt' | 'service' | 'chars' | 'notify'} stage
     * @param {unknown} error
     * @returns {Error}
     */
    #buildStageError(stage, error) {
        const reason = String(error?.message || error || 'Unknown BLE error')
        return new Error(`BLE ${stage} failed: ${reason}`)
    }

    /**
     * Probes firmware version and tolerates missing response.
     * @returns {Promise<string>}
     */
    async #probeVersion() {
        try {
            return await this.queryVersion({ timeoutMs: 1500 })
        } catch (_error) {
            return 'Connected (no version response)'
        }
    }

    /**
     * Handles BLE notification payloads.
     * @param {Event} event
     */
    #handleNotification(event) {
        const valueView = event?.target?.value
        if (!valueView) return
        const bytes = new Uint8Array(valueView.buffer, valueView.byteOffset, valueView.byteLength)
        const chunk = this.textDecoder.decode(bytes, { stream: true })
        this.#consumeIncomingChunk(chunk)
    }

    /**
     * Handles GATT disconnect events.
     */
    #handleGattDisconnected() {
        this.#logDebug('BLE GATT disconnected by peer/browser.')
        this.abortDrawing = true
        this.#clearConnectionState()
        this.#rejectPendingReadWaiters(new Error('BLE connection lost.'))
    }

    /**
     * Writes raw BLE payload bytes.
     * @param {string} text
     * @returns {Promise<void>}
     */
    async #writeRaw(text) {
        if (!this.rxCharacteristic) {
            throw new Error('BLE write characteristic is not available.')
        }

        const payload = this.textEncoder.encode(text)
        this.#logDebug('Writing BLE payload.', {
            byteLength: payload.byteLength,
            text
        })
        if (typeof this.rxCharacteristic.writeValueWithoutResponse === 'function') {
            await this.rxCharacteristic.writeValueWithoutResponse(payload)
            return
        }
        if (typeof this.rxCharacteristic.writeValueWithResponse === 'function') {
            await this.rxCharacteristic.writeValueWithResponse(payload)
            return
        }
        if (typeof this.rxCharacteristic.writeValue === 'function') {
            await this.rxCharacteristic.writeValue(payload)
            return
        }
        throw new Error('BLE write API is not available for this characteristic.')
    }

    /**
     * Consumes one incoming text chunk and emits parsed lines.
     * @param {string} chunk
     */
    #consumeIncomingChunk(chunk) {
        this.readBuffer += String(chunk || '')
        const lines = this.readBuffer.split(/\r\n|\n|\r/g)
        this.readBuffer = lines.pop() || ''

        lines.forEach((line) => {
            const trimmed = line.trim()
            if (!trimmed) return
            this.#logDebug('Received BLE line.', { line: trimmed })
            this.#publishLine(trimmed)
            this.#enqueueLine(trimmed)
        })
    }

    /**
     * Writes one BLE debug log entry when enabled.
     * @param {string} message
     * @param {Record<string, unknown>} [data]
     */
    #logDebug(message, data = {}) {
        if (!this.debugLoggingEnabled) return
        if (Object.keys(data).length) {
            console.debug('[EggBotBle]', message, data)
            return
        }
        console.debug('[EggBotBle]', message)
    }

    /**
     * Notifies line subscribers.
     * @param {string} line
     */
    #publishLine(line) {
        this.lineSubscribers.forEach((listener) => {
            try {
                listener(line)
            } catch (_error) {
                // Ignore listener-side errors.
            }
        })
    }

    /**
     * Queues one parsed line or resolves one waiter.
     * @param {string} line
     */
    #enqueueLine(line) {
        const waiter = this.pendingReadWaiters.shift()
        if (waiter) {
            window.clearTimeout(waiter.timeoutId)
            waiter.resolve(line)
            return
        }
        this.lineQueue.push(line)
    }

    /**
     * Waits for one parsed line.
     * @param {number} timeoutMs
     * @returns {Promise<string>}
     */
    #readLine(timeoutMs) {
        if (this.lineQueue.length) {
            return Promise.resolve(this.lineQueue.shift() || '')
        }

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                const index = this.pendingReadWaiters.findIndex((entry) => entry.resolve === resolve)
                if (index >= 0) {
                    this.pendingReadWaiters.splice(index, 1)
                }
                reject(new Error('Timed out waiting for EBB response.'))
            }, timeoutMs)

            this.pendingReadWaiters.push({ resolve, reject, timeoutId })
        })
    }

    /**
     * Rejects all pending read waiters.
     * @param {Error} error
     */
    #rejectPendingReadWaiters(error) {
        this.pendingReadWaiters.splice(0).forEach((entry) => {
            window.clearTimeout(entry.timeoutId)
            entry.reject(error)
        })
    }

    /**
     * Clears all transient read and connection state.
     */
    #clearConnectionState() {
        this.device = null
        this.server = null
        this.service = null
        this.rxCharacteristic = null
        this.txCharacteristic = null
        this.debugLoggingEnabled = false
        this.readBuffer = ''
        this.lineQueue = []
    }

    /**
     * Closes BLE resources and clears internal state.
     * @returns {Promise<void>}
     */
    async #cleanupConnection() {
        if (this.txCharacteristic) {
            try {
                if (typeof this.txCharacteristic.removeEventListener === 'function') {
                    this.txCharacteristic.removeEventListener('characteristicvaluechanged', this.boundNotificationHandler)
                }
            } catch (_error) {
                // Ignore listener cleanup races.
            }
            try {
                if (typeof this.txCharacteristic.stopNotifications === 'function') {
                    await this.txCharacteristic.stopNotifications()
                }
            } catch (_error) {
                // Ignore notification shutdown races.
            }
        }

        if (this.device) {
            try {
                this.device.removeEventListener('gattserverdisconnected', this.boundGattDisconnectHandler)
            } catch (_error) {
                // Ignore listener cleanup races.
            }
        }

        if (this.server?.connected) {
            try {
                this.server.disconnect()
            } catch (_error) {
                // Ignore disconnect races.
            }
        }

        this.#clearConnectionState()
        this.#rejectPendingReadWaiters(new Error('BLE connection closed.'))
    }
}
