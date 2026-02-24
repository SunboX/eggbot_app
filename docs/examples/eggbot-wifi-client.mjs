const DEFAULT_WIFI_PORT = 1337
const DEFAULT_WIFI_PATH = '/'

/**
 * EggDuino Wi-Fi command client with queued command handling.
 */
class EggBotWifiClient {
    constructor() {
        this.socket = null
        this.socketUrl = ''
        this.textDecoder = new TextDecoder()
        this.readBuffer = ''
        this.commandQueue = []
        this.activeCommand = null
        this.lineListeners = new Set()
        this.boundMessageHandler = (event) => this.#handleMessage(event)
        this.boundCloseHandler = () => this.#handleClose()
    }

    /**
     * Returns true when one Wi-Fi link is active.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN)
    }

    /**
     * Opens one Wi-Fi socket connection.
     * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} [options]
     * @returns {Promise<void>}
     */
    async connectEggDuinoWifi(options = {}) {
        this.#assertSupport()
        if (this.isConnected) {
            return
        }

        const socketUrl = this.#resolveSocketUrl(options)
        const socket = await this.#openSocket(socketUrl)

        this.socket = socket
        this.socketUrl = socketUrl
        this.socket.addEventListener('message', this.boundMessageHandler)
        this.socket.addEventListener('close', this.boundCloseHandler)
    }

    /**
     * Closes Wi-Fi resources.
     * @returns {Promise<void>}
     */
    async disconnectEggDuinoWifi() {
        if (this.socket) {
            try {
                this.socket.removeEventListener('message', this.boundMessageHandler)
                this.socket.removeEventListener('close', this.boundCloseHandler)
            } catch (_error) {
                // Ignore listener cleanup races.
            }

            if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
                try {
                    this.socket.close()
                } catch (_error) {
                    // Ignore close races.
                }
            }
        }

        this.socket = null
        this.socketUrl = ''
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
     * Throws when WebSocket is unavailable.
     */
    #assertSupport() {
        if (typeof WebSocket !== 'function') {
            throw new Error('WebSocket is not supported in this browser.')
        }
    }

    /**
     * Returns one normalized socket URL.
     * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} options
     * @returns {string}
     */
    #resolveSocketUrl(options) {
        const explicitUrl = String(options?.url || '').trim()
        if (explicitUrl) {
            return explicitUrl
        }

        const host = String(options?.host || '').trim()
        if (!host) {
            throw new Error('Wi-Fi host is required.')
        }

        const port = EggBotWifiClient.#normalizePort(options?.port)
        const secure = Boolean(options?.secure)
        const protocol = secure ? 'wss' : 'ws'
        const path = EggBotWifiClient.#normalizePath(options?.path)
        return `${protocol}://${host}:${port}${path}`
    }

    /**
     * Normalizes one socket port value.
     * @param {unknown} value
     * @returns {number}
     */
    static #normalizePort(value) {
        const parsed = Math.trunc(Number(value))
        if (!Number.isFinite(parsed)) return DEFAULT_WIFI_PORT
        return Math.max(1, Math.min(65535, parsed))
    }

    /**
     * Normalizes one socket path value.
     * @param {unknown} value
     * @returns {string}
     */
    static #normalizePath(value) {
        const text = String(value || '').trim()
        if (!text) return DEFAULT_WIFI_PATH
        return text.startsWith('/') ? text : `/${text}`
    }

    /**
     * Opens one WebSocket and waits for open.
     * @param {string} socketUrl
     * @returns {Promise<WebSocket>}
     */
    #openSocket(socketUrl) {
        return new Promise((resolve, reject) => {
            let socket = null
            try {
                socket = new WebSocket(socketUrl)
            } catch (error) {
                reject(new Error(`WebSocket open failed: ${String(error?.message || error)}`))
                return
            }

            socket.binaryType = 'arraybuffer'

            const cleanup = () => {
                socket.removeEventListener('open', onOpen)
                socket.removeEventListener('error', onError)
                socket.removeEventListener('close', onClose)
            }

            const onOpen = () => {
                cleanup()
                resolve(socket)
            }

            const onError = () => {
                cleanup()
                reject(new Error(`WebSocket open failed: ${socketUrl}`))
            }

            const onClose = () => {
                cleanup()
                reject(new Error(`WebSocket closed before open: ${socketUrl}`))
            }

            socket.addEventListener('open', onOpen)
            socket.addEventListener('error', onError)
            socket.addEventListener('close', onClose)
        })
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
                commandText: EggBotWifiClient.#withCommandTerminator(request.command),
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

        try {
            this.#writeRaw(this.activeCommand.commandText)
        } catch (error) {
            const command = this.activeCommand
            this.activeCommand = null
            if (command) {
                window.clearTimeout(command.timeoutId)
                command.reject(error)
            }
            this.#drainCommandQueue()
        }
    }

    /**
     * Writes one raw payload to socket.
     * @param {string} command
     */
    #writeRaw(command) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected.')
        }
        this.socket.send(command)
    }

    /**
     * Handles incoming socket messages.
     * @param {MessageEvent} event
     */
    #handleMessage(event) {
        const payload = event?.data
        if (typeof payload === 'string') {
            this.#consumeChunk(payload)
            return
        }

        if (payload instanceof ArrayBuffer) {
            const chunk = this.textDecoder.decode(new Uint8Array(payload), { stream: true })
            this.#consumeChunk(chunk)
            return
        }

        if (ArrayBuffer.isView(payload)) {
            const chunk = this.textDecoder.decode(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), {
                stream: true
            })
            this.#consumeChunk(chunk)
            return
        }

        if (typeof Blob !== 'undefined' && payload instanceof Blob) {
            payload
                .arrayBuffer()
                .then((buffer) => {
                    const chunk = this.textDecoder.decode(new Uint8Array(buffer), { stream: true })
                    this.#consumeChunk(chunk)
                })
                .catch(() => {
                    // Ignore malformed blob frames.
                })
        }
    }

    /**
     * Handles socket-close events.
     */
    #handleClose() {
        this.socket = null
        this.socketUrl = ''
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

const client = new EggBotWifiClient()

/**
 * Opens EggDuino Wi-Fi connection.
 * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} options
 * @returns {Promise<void>}
 */
export async function connectEggDuinoWifi(options = {}) {
    await client.connectEggDuinoWifi(options)
}

/**
 * Closes EggDuino Wi-Fi connection.
 * @returns {Promise<void>}
 */
export async function disconnectEggDuinoWifi() {
    await client.disconnectEggDuinoWifi()
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
