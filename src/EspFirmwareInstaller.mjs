import { ClassicReset, ESPLoader, Transport } from './vendor/esptool-js.bundle.mjs'

const ESP_FLASH_BAUD_RATE = 115200
const ESP_ROM_BAUD_RATE = 115200
const ESP32_CHIP_FAMILY = 'ESP32'
const CLASSIC_RESET_INITIAL_DELAY_MS = 100
const DEFAULT_FLASH_OPTIONS = Object.freeze({
    compress: true,
    eraseAll: false,
    flashFreq: 'keep',
    flashMode: 'keep',
    flashSize: 'keep'
})
const BINARY_STRING_CHUNK_SIZE = 0x8000

/**
 * Waits for one timeout duration.
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function sleep(durationMs) {
    return new Promise((resolve) => setTimeout(resolve, durationMs))
}

/**
 * Normalizes one text-like value.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
    return String(value || '').trim()
}

/**
 * Converts firmware bytes into one binary string for esptool-js.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function encodeFirmwareBytes(bytes) {
    let output = ''
    for (let index = 0; index < bytes.length; index += BINARY_STRING_CHUNK_SIZE) {
        const chunk = bytes.subarray(index, index + BINARY_STRING_CHUNK_SIZE)
        output += String.fromCharCode(...chunk)
    }
    return output
}

/**
 * Returns true when the current user agent is Windows.
 * @param {string} userAgent
 * @returns {boolean}
 */
function isWindowsUserAgent(userAgent) {
    return /windows/i.test(normalizeString(userAgent))
}

/**
 * Reset strategy that applies DTR and RTS in one Web Serial call.
 */
class WindowsClassicReset extends ClassicReset {
    /**
     * Performs one Windows-friendly classic reset sequence.
     * @returns {Promise<void>}
     */
    async reset() {
        const device = this.transport?.device
        if (typeof device?.setSignals !== 'function') {
            await super.reset()
            return
        }

        await this.#setSignals(false, true)
        await sleep(CLASSIC_RESET_INITIAL_DELAY_MS)
        await this.#setSignals(true, false)
        await sleep(this.resetDelay)
        await this.#setSignals(false, false)
    }

    /**
     * Applies DTR and RTS together and keeps transport state aligned.
     * @param {boolean} dataTerminalReady
     * @param {boolean} requestToSend
     * @returns {Promise<void>}
     */
    async #setSignals(dataTerminalReady, requestToSend) {
        if (Object.prototype.hasOwnProperty.call(this.transport, '_DTR_state')) {
            this.transport._DTR_state = dataTerminalReady
        }
        await this.transport.device.setSignals({
            dataTerminalReady,
            requestToSend
        })
    }
}

/**
 * Creates reset overrides for Windows Web Serial adapters.
 * @returns {{ classicReset: (transport: Transport, resetDelay: number) => WindowsClassicReset }}
 */
export function createWindowsResetConstructors() {
    return {
        classicReset: (transport, resetDelay) => new WindowsClassicReset(transport, resetDelay)
    }
}

/**
 * Web Serial transport that skips boot-log bytes before the first SLIP frame.
 */
export class EspInstallerTransport extends Transport {
    /**
     * Reads SLIP packets while ignoring leading boot-log noise.
     * @param {number} timeout
     * @yields {Uint8Array}
     */
    async *read(timeout) {
        if (!this.reader) {
            this.reader = this.device.readable?.getReader()
        }

        let partialPacket = null
        let isEscaping = false
        let successfulSlip = false
        let leadingNoise = []

        while (true) {
            const waitingBytes = this.inWaiting()
            const readBytes = await this.newRead(waitingBytes > 0 ? waitingBytes : 1, timeout)
            if (!readBytes || readBytes.length === 0) {
                const message =
                    partialPacket === null
                        ? successfulSlip
                            ? 'Serial data stream stopped: Possible serial noise or corruption.'
                            : 'No serial data received.'
                        : 'Packet content transfer stopped'
                this.trace(message)
                throw new Error(message)
            }

            this.trace(`Read ${readBytes.length} bytes: ${this.hexConvert(readBytes)}`)
            let byteIndex = 0
            while (byteIndex < readBytes.length) {
                const byte = readBytes[byteIndex++]
                if (partialPacket === null) {
                    if (byte === this.SLIP_END) {
                        this.#flushLeadingNoise(leadingNoise)
                        leadingNoise = []
                        partialPacket = new Uint8Array(0)
                        continue
                    }

                    leadingNoise.push(byte)
                    continue
                }

                if (isEscaping) {
                    isEscaping = false
                    if (byte === this.SLIP_ESC_END) {
                        partialPacket = this.appendArray(partialPacket, new Uint8Array([this.SLIP_END]))
                        continue
                    }
                    if (byte === this.SLIP_ESC_ESC) {
                        partialPacket = this.appendArray(partialPacket, new Uint8Array([this.SLIP_ESC]))
                        continue
                    }

                    this.trace(`Read invalid data: ${this.hexConvert(readBytes)}`)
                    const remainingData = await this.newRead(this.inWaiting(), timeout)
                    this.trace(`Remaining data in serial buffer: ${this.hexConvert(remainingData)}`)
                    this.detectPanicHandler(new Uint8Array([...readBytes, ...(remainingData || [])]))
                    throw new Error(`Invalid SLIP escape (0xdb, 0x${byte.toString(16)})`)
                }

                if (byte === this.SLIP_ESC) {
                    isEscaping = true
                    continue
                }

                if (byte === this.SLIP_END) {
                    this.trace(`Received full packet: ${this.hexConvert(partialPacket)}`)
                    this.buffer = this.appendArray(this.buffer, readBytes.slice(byteIndex))
                    yield partialPacket
                    partialPacket = null
                    successfulSlip = true
                    continue
                }

                partialPacket = this.appendArray(partialPacket, new Uint8Array([byte]))
            }

            if (partialPacket === null) {
                this.#flushLeadingNoise(leadingNoise)
                leadingNoise = []
            }
        }
    }

    /**
     * Emits and inspects one leading-noise chunk without aborting SLIP parsing.
     * @param {number[]} bytes
     */
    #flushLeadingNoise(bytes) {
        if (!Array.isArray(bytes) || bytes.length === 0) {
            return
        }

        const noise = new Uint8Array(bytes)
        this.trace(`Read invalid data: ${this.hexConvert(noise)}`)
        this.detectPanicHandler(noise)
    }
}

/**
 * Minimal terminal bridge for esptool-js loader messages.
 */
class EspLoaderTerminalBridge {
    /**
     * @param {(message: string) => void} [onLog]
     */
    constructor(onLog) {
        this.onLog = typeof onLog === 'function' ? onLog : null
    }

    /**
     * Clears terminal output.
     */
    clean() {}

    /**
     * Writes one line of terminal output.
     * @param {string} message
     */
    writeLine(message) {
        this.#emit(message)
    }

    /**
     * Writes one terminal fragment.
     * @param {string} message
     */
    write(message) {
        this.#emit(message)
    }

    /**
     * Emits one normalized terminal message.
     * @param {string} message
     */
    #emit(message) {
        if (!this.onLog) {
            return
        }

        const normalizedMessage = normalizeString(message)
        if (normalizedMessage) {
            this.onLog(normalizedMessage)
        }
    }
}

/**
 * Flashes ESP32 firmware packages through Web Serial using esptool-js.
 */
export class EspFirmwareInstaller {
    /**
     * @param {{ fetchImpl?: typeof fetch, portRequester?: () => Promise<SerialPort>, userAgent?: string }} [options]
     */
    constructor(options = {}) {
        this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch?.bind(globalThis)
        this.portRequester = typeof options.portRequester === 'function' ? options.portRequester : null
        this.userAgent = normalizeString(options.userAgent) || EspFirmwareInstaller.#resolveUserAgent()
    }

    /**
     * Returns true when Web Serial flashing is available.
     * @param {typeof globalThis} [environment=globalThis]
     * @returns {boolean}
     */
    static isSupported(environment = globalThis) {
        return Boolean(environment?.navigator?.serial && typeof environment.navigator.serial.requestPort === 'function')
    }

    /**
     * Requests one serial port, loads the firmware package, and flashes it.
     * @param {{
     *   manifestUrl: string,
     *   onLog?: (message: string) => void,
     *   onProgress?: (update: { partIndex: number, partCount: number, written: number, total: number, percent: number }) => void
     * }} options
     * @returns {Promise<void>}
     */
    async install(options) {
        const manifestUrl = normalizeString(options?.manifestUrl)
        if (!manifestUrl) {
            throw new Error('ESP firmware manifest URL is required.')
        }

        const requestPort = this.#resolvePortRequester()
        const port = await requestPort()
        const build = await this.#loadManifestBuild(manifestUrl)
        const fileArray = await this.#loadFirmwareFiles(build.parts, manifestUrl)
        const transport = new EspInstallerTransport(port)
        const loader = new ESPLoader({
            transport,
            baudrate: ESP_FLASH_BAUD_RATE,
            romBaudrate: ESP_ROM_BAUD_RATE,
            terminal: new EspLoaderTerminalBridge(options?.onLog),
            enableTracing: false,
            resetConstructors: this.#resolveResetConstructors()
        })

        try {
            await loader.main('default_reset')
            await loader.writeFlash({
                ...DEFAULT_FLASH_OPTIONS,
                fileArray,
                reportProgress: (fileIndex, written, total) => {
                    if (typeof options?.onProgress !== 'function') {
                        return
                    }
                    options.onProgress({
                        partIndex: fileIndex + 1,
                        partCount: fileArray.length,
                        written,
                        total,
                        percent: total > 0 ? Math.max(0, Math.min(100, Math.round((written / total) * 100))) : 0
                    })
                }
            })
            await loader.after('hard_reset')
        } finally {
            await transport.disconnect().catch(() => {})
        }
    }

    /**
     * Resolves one serial-port requester bound to the active browser.
     * @returns {() => Promise<SerialPort>}
     */
    #resolvePortRequester() {
        if (this.portRequester) {
            return this.portRequester
        }

        if (!EspFirmwareInstaller.isSupported(globalThis)) {
            throw new Error('Web Serial is not supported in this browser.')
        }

        return () => globalThis.navigator.serial.requestPort()
    }

    /**
     * Loads and validates one manifest build payload.
     * @param {string} manifestUrl
     * @returns {Promise<{ chipFamily: string, parts: Array<{ path: string, offset: number }> }>}
     */
    async #loadManifestBuild(manifestUrl) {
        if (typeof this.fetchImpl !== 'function') {
            throw new Error('Fetch is not available in this browser.')
        }

        const response = await this.fetchImpl(manifestUrl, { cache: 'no-store' })
        if (!response?.ok || typeof response.json !== 'function') {
            throw new Error('ESP firmware manifest request failed.')
        }

        const manifest = await response.json()
        const build = manifest?.builds?.find((candidate) => normalizeString(candidate?.chipFamily) === ESP32_CHIP_FAMILY)
        if (!build || !Array.isArray(build.parts) || build.parts.length === 0) {
            throw new Error('ESP firmware manifest is missing one valid ESP32 build.')
        }

        return build
    }

    /**
     * Downloads each firmware binary referenced by one manifest build.
     * @param {Array<{ path?: unknown, offset?: unknown }>} parts
     * @param {string} manifestUrl
     * @returns {Promise<Array<{ address: number, data: string }>>}
     */
    async #loadFirmwareFiles(parts, manifestUrl) {
        return Promise.all(
            parts.map(async (part) => {
                const partPath = normalizeString(part?.path)
                const address = Number(part?.offset)
                if (!partPath || !Number.isFinite(address) || address < 0) {
                    throw new Error('ESP firmware manifest contains one invalid flash part.')
                }

                const partUrl = new URL(partPath, manifestUrl).toString()
                const response = await this.fetchImpl(partUrl, { cache: 'no-store' })
                if (!response?.ok || typeof response.arrayBuffer !== 'function') {
                    throw new Error(`ESP firmware binary request failed: ${partPath}`)
                }

                const bytes = new Uint8Array(await response.arrayBuffer())
                return {
                    address,
                    data: encodeFirmwareBytes(bytes)
                }
            })
        )
    }

    /**
     * Resolves reset overrides for the current operating system.
     * @returns {{ classicReset: (transport: Transport, resetDelay: number) => WindowsClassicReset } | undefined}
     */
    #resolveResetConstructors() {
        if (isWindowsUserAgent(this.userAgent)) {
            return createWindowsResetConstructors()
        }
        return undefined
    }

    /**
     * Resolves the current browser user agent string.
     * @returns {string}
     */
    static #resolveUserAgent() {
        return normalizeString(globalThis?.navigator?.userAgent)
    }
}
