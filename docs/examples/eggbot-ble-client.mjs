const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const BLE_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const BLE_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

/**
 * EggDuino BLE command client with queued command handling.
 */
class EggBotBleClient {
    constructor() {
        this.device = null
        this.server = null
        this.service = null
        this.rxCharacteristic = null
        this.txCharacteristic = null
        this.textEncoder = new TextEncoder()
        this.textDecoder = new TextDecoder()
        this.readBuffer = ''
        this.commandQueue = []
        this.activeCommand = null
        this.lineListeners = new Set()
        this.boundNotificationHandler = (event) => this.#handleNotification(event)
        this.boundDisconnectHandler = () => this.#handleDisconnect()
    }

    /**
     * Returns true when one BLE link is active.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.server && this.server.connected && this.rxCharacteristic && this.txCharacteristic)
    }

    /**
     * Opens one BLE connection.
     * @returns {Promise<void>}
     */
    async connectEggDuino() {
        this.#assertSupport()
        if (this.isConnected) {
            return
        }

        let stage = 'request'
        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [BLE_SERVICE_UUID] }],
                optionalServices: [BLE_SERVICE_UUID]
            })
            if (!this.device) {
                throw new Error('No BLE device selected.')
            }
            this.device.addEventListener('gattserverdisconnected', this.boundDisconnectHandler)

            stage = 'gatt'
            this.server = await this.device.gatt.connect()

            stage = 'service'
            this.service = await this.server.getPrimaryService(BLE_SERVICE_UUID)

            stage = 'chars'
            this.rxCharacteristic = await this.service.getCharacteristic(BLE_RX_UUID)
            this.txCharacteristic = await this.service.getCharacteristic(BLE_TX_UUID)

            stage = 'notify'
            this.txCharacteristic.addEventListener('characteristicvaluechanged', this.boundNotificationHandler)
            await this.txCharacteristic.startNotifications()
        } catch (error) {
            await this.disconnectEggDuino()
            throw this.#buildConnectionError(stage, error)
        }
    }

    /**
     * Closes BLE resources.
     * @returns {Promise<void>}
     */
    async disconnectEggDuino() {
        if (this.txCharacteristic) {
            try {
                this.txCharacteristic.removeEventListener('characteristicvaluechanged', this.boundNotificationHandler)
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
                this.device.removeEventListener('gattserverdisconnected', this.boundDisconnectHandler)
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

        this.device = null
        this.server = null
        this.service = null
        this.rxCharacteristic = null
        this.txCharacteristic = null
        this.readBuffer = ''
        this.#rejectAllCommands(new Error('EggBot disconnected'))
    }

    /**
     * Sends one EggBot command and resolves on first response line.
     * @param {string} command
     * @returns {Promise<string>}
     */
    async sendEggBotCommand(command) {
        return this.#enqueueCommand({
            command,
            timeoutMs: 1200,
            mode: 'line'
        })
    }

    /**
     * Sends one EggBot command and resolves after trailing OK.
     * @param {string} command
     * @param {number} [timeoutMs=1200]
     * @returns {Promise<string[]>}
     */
    async sendEggBotCommandExpectOk(command, timeoutMs = 1200) {
        return this.#enqueueCommand({
            command,
            timeoutMs,
            mode: 'expect-ok'
        })
    }

    /**
     * Registers one parsed line listener.
     * @param {(line: string) => void} callback
     */
    onLine(callback) {
        if (typeof callback === 'function') {
            this.lineListeners.add(callback)
        }
    }

    /**
     * Unregisters one parsed line listener.
     * @param {(line: string) => void} callback
     */
    offLine(callback) {
        this.lineListeners.delete(callback)
    }

    /**
     * Throws when Web Bluetooth is unavailable.
     */
    #assertSupport() {
        if (typeof navigator === 'undefined' || !navigator.bluetooth) {
            throw new Error('Web Bluetooth is not supported in this browser.')
        }
    }

    /**
     * Builds one stage-aware connection error.
     * @param {'request' | 'gatt' | 'service' | 'chars' | 'notify'} stage
     * @param {unknown} error
     * @returns {Error}
     */
    #buildConnectionError(stage, error) {
        const reason = String(error?.message || error || 'Unknown BLE error')
        return new Error(`BLE ${stage} failed: ${reason}`)
    }

    /**
     * Queues one outgoing command.
     * @param {{ command: string, timeoutMs: number, mode: 'line' | 'expect-ok' }} request
     * @returns {Promise<string | string[]>}
     */
    #enqueueCommand(request) {
        if (!this.isConnected) {
            throw new Error('EggBot is not connected.')
        }

        return new Promise((resolve, reject) => {
            this.commandQueue.push({
                mode: request.mode,
                timeoutMs: Math.max(1, Math.trunc(Number(request.timeoutMs) || 1200)),
                commandText: EggBotBleClient.#withCommandTerminator(request.command),
                lines: [],
                resolve,
                reject,
                timeoutId: 0
            })
            this.#drainCommandQueue()
        })
    }

    /**
     * Sends next queued command when idle.
     */
    #drainCommandQueue() {
        if (this.activeCommand || !this.commandQueue.length) {
            return
        }

        this.activeCommand = this.commandQueue.shift()
        this.activeCommand.timeoutId = window.setTimeout(() => {
            const command = this.activeCommand
            if (!command) return
            this.activeCommand = null
            command.reject(new Error('EggBot response timeout'))
            this.#drainCommandQueue()
        }, this.activeCommand.timeoutMs)

        this.#writeRaw(this.activeCommand.commandText).catch((error) => {
            const command = this.activeCommand
            this.activeCommand = null
            if (command) {
                window.clearTimeout(command.timeoutId)
                command.reject(error)
            }
            this.#drainCommandQueue()
        })
    }

    /**
     * Writes one raw command payload.
     * @param {string} command
     * @returns {Promise<void>}
     */
    async #writeRaw(command) {
        if (!this.rxCharacteristic) {
            throw new Error('BLE RX characteristic is not available.')
        }

        const payload = this.textEncoder.encode(command)
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
     * Handles BLE notification payloads.
     * @param {Event} event
     */
    #handleNotification(event) {
        const valueView = event?.target?.value
        if (!valueView) return
        const bytes = new Uint8Array(valueView.buffer, valueView.byteOffset, valueView.byteLength)
        const chunk = this.textDecoder.decode(bytes, { stream: true })
        this.#consumeChunk(chunk)
    }

    /**
     * Handles device disconnect events.
     */
    #handleDisconnect() {
        this.device = null
        this.server = null
        this.service = null
        this.rxCharacteristic = null
        this.txCharacteristic = null
        this.readBuffer = ''
        this.#rejectAllCommands(new Error('EggBot disconnected'))
    }

    /**
     * Consumes one incoming chunk and emits line events.
     * @param {string} chunk
     */
    #consumeChunk(chunk) {
        this.readBuffer += String(chunk || '')
        const lines = this.readBuffer.split(/\r\n|\n|\r/g)
        this.readBuffer = lines.pop() || ''

        lines.forEach((line) => {
            const trimmed = line.trim()
            if (!trimmed) return
            this.#emitLine(trimmed)
            this.#handleLine(trimmed)
        })
    }

    /**
     * Emits one parsed line to listeners.
     * @param {string} line
     */
    #emitLine(line) {
        this.lineListeners.forEach((listener) => {
            try {
                listener(line)
            } catch (_error) {
                // Ignore listener-side errors.
            }
        })
    }

    /**
     * Routes one parsed line to the active command.
     * @param {string} line
     */
    #handleLine(line) {
        const command = this.activeCommand
        if (!command) return

        if (command.mode === 'line') {
            this.activeCommand = null
            window.clearTimeout(command.timeoutId)
            command.resolve(line)
            this.#drainCommandQueue()
            return
        }

        const normalized = line.toLowerCase()
        if (normalized === 'ok') {
            this.activeCommand = null
            window.clearTimeout(command.timeoutId)
            command.resolve([...command.lines])
            this.#drainCommandQueue()
            return
        }

        if (normalized.includes('unknown cmd')) {
            this.activeCommand = null
            window.clearTimeout(command.timeoutId)
            const payload = command.lines.concat(line)
            const error = new Error(payload.join('\n') || 'unknown CMD')
            error.payload = payload
            command.reject(error)
            this.#drainCommandQueue()
            return
        }

        command.lines.push(line)
    }

    /**
     * Rejects active and queued commands.
     * @param {Error} error
     */
    #rejectAllCommands(error) {
        if (this.activeCommand) {
            window.clearTimeout(this.activeCommand.timeoutId)
            this.activeCommand.reject(error)
            this.activeCommand = null
        }

        while (this.commandQueue.length) {
            const command = this.commandQueue.shift()
            command.reject(error)
        }
    }

    /**
     * Appends CR command terminator when missing.
     * @param {unknown} command
     * @returns {string}
     */
    static #withCommandTerminator(command) {
        const text = String(command || '')
        return text.endsWith('\r') ? text : `${text}\r`
    }
}

const client = new EggBotBleClient()

/**
 * Opens EggDuino BLE connection.
 * @returns {Promise<void>}
 */
export async function connectEggDuino() {
    await client.connectEggDuino()
}

/**
 * Closes EggDuino BLE connection.
 * @returns {Promise<void>}
 */
export async function disconnectEggDuino() {
    await client.disconnectEggDuino()
}

/**
 * Sends one EggBot command and resolves on first response line.
 * @param {string} command
 * @returns {Promise<string>}
 */
export async function sendEggBotCommand(command) {
    return client.sendEggBotCommand(command)
}

/**
 * Sends one EggBot command and resolves once trailing OK is received.
 * @param {string} command
 * @param {number} [timeoutMs]
 * @returns {Promise<string[]>}
 */
export async function sendEggBotCommandExpectOk(command, timeoutMs) {
    return client.sendEggBotCommandExpectOk(command, timeoutMs)
}

/**
 * Subscribes to parsed response lines.
 * @param {(line: string) => void} callback
 */
export function onLine(callback) {
    client.onLine(callback)
}

/**
 * Unsubscribes from parsed response lines.
 * @param {(line: string) => void} callback
 */
export function offLine(callback) {
    client.offLine(callback)
}
