import { EggBotBle } from './EggBotBle.mjs'
import { EggBotSerial } from './EggBotSerial.mjs'

const TRANSPORTS = ['serial', 'ble']

/**
 * Multi-transport EggBot connection controller.
 */
export class EggBotTransportController {
    constructor() {
        this.transportKind = 'serial'
        this.serial = new EggBotSerial()
        this.ble = new EggBotBle()
    }

    /**
     * Returns current transport kind.
     * @returns {'serial' | 'ble'}
     */
    get connectionTransportKind() {
        return EggBotTransportController.#normalizeTransportKind(this.transportKind)
    }

    /**
     * Returns one active transport instance.
     * @returns {EggBotSerial | EggBotBle}
     */
    get #activeTransport() {
        const kind = this.connectionTransportKind
        if (kind === 'ble') return this.ble
        return this.serial
    }

    /**
     * Returns true while the active transport is connected.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.#activeTransport?.isConnected)
    }

    /**
     * Returns one active transport label.
     * @returns {string}
     */
    get connectionKindLabel() {
        return this.#activeTransport.connectionKindLabel
    }

    /**
     * Returns active draw abort flag.
     * @returns {boolean}
     */
    get abortDrawing() {
        return Boolean(this.#activeTransport.abortDrawing)
    }

    /**
     * Selects transport kind without side effects.
     * @param {unknown} kind
     */
    setTransportKind(kind) {
        this.transportKind = EggBotTransportController.#normalizeTransportKind(kind)
    }

    /**
     * Switches active transport and disconnects previous transport when needed.
     * @param {unknown} kind
     * @returns {Promise<boolean>}
     */
    async switchTransportKind(kind) {
        const nextKind = EggBotTransportController.#normalizeTransportKind(kind)
        const currentKind = this.connectionTransportKind
        if (nextKind === currentKind) {
            return false
        }

        const currentTransport = this.#activeTransport
        if (currentTransport.isConnected) {
            await currentTransport.disconnect()
        }

        this.transportKind = nextKind
        return true
    }

    /**
     * Returns true when one transport kind is supported.
     * @param {unknown} kind
     * @returns {boolean}
     */
    isTransportSupported(kind) {
        const normalized = EggBotTransportController.#normalizeTransportKind(kind)
        if (normalized === 'ble') return EggBotBle.isSupported()
        return typeof navigator !== 'undefined' && Boolean(navigator?.serial)
    }

    /**
     * Opens the active transport connection.
     * @param {Record<string, any>} [options]
     * @returns {Promise<string>}
     */
    async connect(options = {}) {
        return this.#activeTransport.connect(options)
    }

    /**
     * Opens/reopens transport at draw-time.
     * @param {Record<string, any>} [options]
     * @returns {Promise<string>}
     */
    async connectForDraw(options = {}) {
        return this.#activeTransport.connectForDraw(options)
    }

    /**
     * Attempts reconnect only when active transport supports this behavior.
     * @param {Record<string, any>} [options]
     * @returns {Promise<string | null>}
     */
    async reconnectIfPreviouslyConnected(options = {}) {
        if (this.connectionTransportKind !== 'serial') {
            return null
        }
        return this.#activeTransport.reconnectIfPreviouslyConnected(options)
    }

    /**
     * Closes active transport resources.
     * @returns {Promise<void>}
     */
    async disconnect() {
        await this.#activeTransport.disconnect()
    }

    /**
     * Closes all transport resources.
     * @returns {Promise<void>}
     */
    async disconnectAll() {
        const transports = [this.serial, this.ble]
        for (let index = 0; index < transports.length; index += 1) {
            const transport = transports[index]
            try {
                await transport.disconnect()
            } catch (_error) {
                // Ignore best-effort shutdown failures.
            }
        }
    }

    /**
     * Returns true when the provided serial port matches the active serial transport.
     * @param {SerialPort | null | undefined} port
     * @returns {boolean}
     */
    isCurrentPort(port) {
        if (this.connectionTransportKind !== 'serial') {
            return false
        }
        return this.serial.isCurrentPort(port)
    }

    /**
     * Sends stop request to all transports.
     */
    stop() {
        this.serial.stop()
        this.ble.stop()
    }

    /**
     * Sends one command over active transport.
     * @param {string} command
     * @param {{ expectResponse?: boolean, timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async sendCommand(command, options = {}) {
        return this.#activeTransport.sendCommand(command, options)
    }

    /**
     * Queries active transport version response.
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async queryVersion(options = {}) {
        return this.#activeTransport.queryVersion(options)
    }

    /**
     * Starts one draw run over active transport.
     * @param {Array<{ points: Array<{u:number,v:number}> }>} strokes
     * @param {Record<string, any>} drawConfig
     * @param {{ onStatus?: (text: string) => void, onProgress?: (done: number, total: number, detail?: Record<string, number>) => void }} [callbacks]
     * @returns {Promise<void>}
     */
    async drawStrokes(strokes, drawConfig, callbacks = {}) {
        await this.#activeTransport.drawStrokes(strokes, drawConfig, callbacks)
    }

    /**
     * Warms up active path worker.
     */
    warmupPathWorker() {
        this.#activeTransport.warmupPathWorker()
    }

    /**
     * Disposes all path worker instances.
     */
    disposePathWorker() {
        this.serial.disposePathWorker()
        this.ble.disposePathWorker()
    }

    /**
     * Normalizes transport mode values.
     * @param {unknown} value
     * @returns {'serial' | 'ble'}
     */
    static #normalizeTransportKind(value) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
        return TRANSPORTS.includes(normalized) ? normalized : 'serial'
    }
}
