import { EggBotSerial } from './EggBotSerial.mjs'

const DEFAULT_WIFI_PORT = 1337
const DEFAULT_WIFI_PATH = '/'

/**
 * EggBot transport over WebSocket (EggDuino Wi-Fi bridge).
 */
export class EggBotWifi extends EggBotSerial {
    constructor() {
        super()
        this.socket = null
        this.socketUrl = ''
        this.pendingReadWaiters = []
        this.lineSubscribers = new Set()
        this.boundMessageHandler = (event) => this.#handleSocketMessage(event)
        this.boundCloseHandler = () => this.#handleSocketClosed()
    }

    /**
     * Returns true when WebSocket is available.
     * @returns {boolean}
     */
    static isSupported() {
        return typeof WebSocket === 'function'
    }

    /**
     * Returns one user-facing transport label.
     * @returns {string}
     */
    get connectionKindLabel() {
        return 'Wi-Fi'
    }

    /**
     * Returns true while WebSocket transport is connected.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN)
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
     * Opens one WebSocket connection.
     * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} [options]
     * @returns {Promise<string>}
     */
    async connect(options = {}) {
        this.#assertSocketSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const socketUrl = this.#resolveSocketUrl(options)
        const socket = await this.#openSocket(socketUrl)

        this.socket = socket
        this.socketUrl = socketUrl
        this.socket.addEventListener('message', this.boundMessageHandler)
        this.socket.addEventListener('close', this.boundCloseHandler)

        try {
            return await this.#probeVersion()
        } catch (error) {
            await this.disconnect()
            throw error
        }
    }

    /**
     * Opens one WebSocket connection for draw-time usage.
     * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} [options]
     * @returns {Promise<string>}
     */
    async connectForDraw(options = {}) {
        return this.connect(options)
    }

    /**
     * Wi-Fi reconnect is explicitly initiated by caller.
     * @returns {Promise<string | null>}
     */
    async reconnectIfPreviouslyConnected() {
        return null
    }

    /**
     * Returns false because Wi-Fi transport does not use Web Serial ports.
     * @returns {boolean}
     */
    isCurrentPort() {
        return false
    }

    /**
     * Closes WebSocket resources.
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.abortDrawing = true

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
        this.lineQueue = []
        this.#rejectPendingReadWaiters(new Error('Wi-Fi connection closed.'))
    }

    /**
     * Sends one EggBot command over Wi-Fi.
     * @param {string} command
     * @param {{ expectResponse?: boolean, timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async sendCommand(command, options = {}) {
        const expectResponse = Boolean(options.expectResponse)
        const timeoutMs = Number(options.timeoutMs) || 1200
        this.#writeRaw(EggBotWifi.#withCommandTerminator(command))
        if (!expectResponse) return ''
        return this.#readLine(timeoutMs)
    }

    /**
     * Throws when WebSocket is unavailable.
     */
    #assertSocketSupport() {
        if (!EggBotWifi.isSupported()) {
            throw new Error('WebSocket is not supported in this browser.')
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
     * Returns one normalized WebSocket URL.
     * @param {{ host?: string, port?: number, secure?: boolean, path?: string, url?: string }} options
     * @returns {string}
     */
    #resolveSocketUrl(options) {
        const forceSecureProtocol = EggBotWifi.#isHttpsPage()
        const explicitUrl = String(options?.url || '').trim()
        if (explicitUrl) {
            if (forceSecureProtocol && /^ws:\/\//i.test(explicitUrl)) {
                return explicitUrl.replace(/^ws:\/\//i, 'wss://')
            }
            return explicitUrl
        }

        const host = String(options?.host || '').trim()
        if (!host) {
            throw new Error('Wi-Fi host is required.')
        }

        const port = EggBotWifi.#normalizePort(options?.port)
        const secure = forceSecureProtocol || Boolean(options?.secure)
        const protocol = secure ? 'wss' : 'ws'
        const path = EggBotWifi.#normalizePath(options?.path)
        return `${protocol}://${host}:${port}${path}`
    }

    /**
     * Returns true when running in one HTTPS page context.
     * @returns {boolean}
     */
    static #isHttpsPage() {
        if (typeof window === 'undefined' || !window?.location) return false
        return String(window.location.protocol || '').trim().toLowerCase() === 'https:'
    }

    /**
     * Normalizes Wi-Fi port values.
     * @param {unknown} value
     * @returns {number}
     */
    static #normalizePort(value) {
        const parsed = Math.trunc(Number(value))
        if (!Number.isFinite(parsed)) return DEFAULT_WIFI_PORT
        return Math.max(1, Math.min(65535, parsed))
    }

    /**
     * Normalizes WebSocket path values.
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
     * Writes raw text payload to the socket.
     * @param {string} text
     */
    #writeRaw(text) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected.')
        }
        this.socket.send(text)
    }

    /**
     * Handles incoming WebSocket message payloads.
     * @param {MessageEvent} event
     */
    #handleSocketMessage(event) {
        const payload = event?.data
        if (typeof payload === 'string') {
            this.#consumeIncomingChunk(payload)
            return
        }

        if (payload instanceof ArrayBuffer) {
            const chunk = this.textDecoder.decode(new Uint8Array(payload), { stream: true })
            this.#consumeIncomingChunk(chunk)
            return
        }

        if (ArrayBuffer.isView(payload)) {
            const chunk = this.textDecoder.decode(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), {
                stream: true
            })
            this.#consumeIncomingChunk(chunk)
            return
        }

        if (typeof Blob !== 'undefined' && payload instanceof Blob) {
            payload
                .arrayBuffer()
                .then((buffer) => {
                    const chunk = this.textDecoder.decode(new Uint8Array(buffer), { stream: true })
                    this.#consumeIncomingChunk(chunk)
                })
                .catch(() => {
                    // Ignore malformed blob frames.
                })
        }
    }

    /**
     * Handles socket-close events.
     */
    #handleSocketClosed() {
        this.abortDrawing = true
        this.socket = null
        this.socketUrl = ''
        this.readBuffer = ''
        this.lineQueue = []
        this.#rejectPendingReadWaiters(new Error('Wi-Fi connection lost.'))
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
            this.#publishLine(trimmed)
            this.#enqueueLine(trimmed)
        })
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
}
