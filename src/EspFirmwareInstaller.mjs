import { ClassicReset, ESPLoader, Transport } from './vendor/esptool-js.bundle.mjs'

const ESP_FLASH_BAUD_RATE = 115200
const ESP_ROM_BAUD_RATE = 115200
const ESP32_CHIP_FAMILY = 'ESP32'
const CLASSIC_RESET_INITIAL_DELAY_MS = 100
const MANUAL_BOOT_RETRY_PATTERN = /wrong boot mode detected|download mode successfully detected|download mode/i
const SYNC_COMMAND_OPCODE = 0x08
const SYNC_COMMAND_TIMEOUT_MS = 100
const SYNC_FOLLOW_UP_REPLY_COUNT = 7
const MIN_SYNC_FOLLOW_UP_REPLY_COUNT = 6
const SYNC_RECOVERABLE_ERROR_PATTERN =
    /read timeout exceeded|no serial data received|invalid response|serial data stream stopped|packet content transfer stopped/i
const CHIP_MAGIC_READ_RETRY_COUNT = 2
const CHIP_MAGIC_READ_RETRY_DELAY_MS = 50
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
    #hasSeenSlipPacket = false

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
        let successfulSlip = this.#hasSeenSlipPacket
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

                    // ESP ROM replies can begin immediately after the previous packet terminator.
                    // Once we have decoded one valid frame, treat a leading response byte as an
                    // implicit packet start so buffered follow-up replies stay aligned.
                    if (successfulSlip && leadingNoise.length === 0 && byte === 0x01) {
                        partialPacket = new Uint8Array([byte])
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
                    // Consecutive SLIP_END bytes can appear while resynchronizing after boot noise.
                    // Treat zero-length frames as delimiters only so the next real packet stays aligned.
                    if (partialPacket.length === 0) {
                        continue
                    }
                    this.trace(`Received full packet: ${this.hexConvert(partialPacket)}`)
                    this.buffer = this.appendArray(this.buffer, readBytes.slice(byteIndex))
                    const completedPacket = partialPacket
                    partialPacket = null
                    successfulSlip = true
                    this.#hasSeenSlipPacket = true
                    yield completedPacket
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
     * @param {{
     *   fetchImpl?: typeof fetch,
     *   portRequester?: () => Promise<SerialPort>,
     *   promptManualBootRetry?: (error: Error) => Promise<boolean> | boolean,
     *   transportFactory?: (port: SerialPort) => { disconnect?: () => Promise<void> },
     *   loaderFactory?: (options: Record<string, unknown>) => { main: (mode: string) => Promise<void>, writeFlash: (options: Record<string, unknown>) => Promise<void>, after: (mode: string) => Promise<void>, _connectAttempt?: (...args: Array<unknown>) => Promise<string> },
     *   userAgent?: string
     * }} [options]
     */
    constructor(options = {}) {
        this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch?.bind(globalThis)
        this.portRequester = typeof options.portRequester === 'function' ? options.portRequester : null
        this.promptManualBootRetry =
            typeof options.promptManualBootRetry === 'function' ? options.promptManualBootRetry : null
        this.transportFactory =
            typeof options.transportFactory === 'function' ? options.transportFactory : (port) => new EspInstallerTransport(port)
        this.loaderFactory =
            typeof options.loaderFactory === 'function' ? options.loaderFactory : (loaderOptions) => new ESPLoader(loaderOptions)
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
     *   onProgress?: (update: {
     *     partIndex: number,
     *     partCount: number,
     *     written: number,
     *     total: number,
     *     percent: number,
     *     overallWritten: number,
     *     overallTotal: number,
     *     overallPercent: number
     *   }) => void
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
        const promptManualBootRetry =
            typeof options?.promptManualBootRetry === 'function' ? options.promptManualBootRetry : this.promptManualBootRetry

        try {
            await this.#runInstallAttempt({
                fileArray,
                mode: 'default_reset',
                onLog: options?.onLog,
                onProgress: options?.onProgress,
                port
            })
        } catch (error) {
            if (!this.#shouldOfferManualBootRetry(error) || typeof promptManualBootRetry !== 'function') {
                throw error
            }

            const shouldRetry = await promptManualBootRetry(error)
            if (!shouldRetry) {
                throw error
            }

            await this.#runInstallAttempt({
                fileArray,
                mode: 'no_reset',
                onLog: options?.onLog,
                onProgress: options?.onProgress,
                port
            })
        }
    }

    /**
     * Executes one flashing attempt against one selected port.
     * @param {{
     *   fileArray: Array<{ address: number, data: string }>,
     *   mode: string,
     *   onLog?: (message: string) => void,
     *   onProgress?: (update: {
     *     partIndex: number,
     *     partCount: number,
     *     written: number,
     *     total: number,
     *     percent: number,
     *     overallWritten: number,
     *     overallTotal: number,
     *     overallPercent: number
     *   }) => void,
     *   port: SerialPort
     * }} options
     * @returns {Promise<void>}
     */
    async #runInstallAttempt(options) {
        const partByteOffsets = []
        let accumulatedPartBytes = 0
        options.fileArray.forEach((file) => {
            partByteOffsets.push(accumulatedPartBytes)
            accumulatedPartBytes += file.data.length
        })
        const totalPartBytes = accumulatedPartBytes
        const transport = this.transportFactory(options.port)
        const loader = this.loaderFactory({
            transport,
            baudrate: ESP_FLASH_BAUD_RATE,
            romBaudrate: ESP_ROM_BAUD_RATE,
            terminal: new EspLoaderTerminalBridge(options?.onLog),
            enableTracing: false,
            resetConstructors: this.#resolveResetConstructors()
        })
        this.#installSyncCompatibilityWrapper(loader)
        this.#installChipMagicReadCompatibilityWrapper(loader)
        let connectFailureMessage = ''
        const originalConnectAttempt =
            loader && typeof loader._connectAttempt === 'function' ? loader._connectAttempt.bind(loader) : null
        if (originalConnectAttempt) {
            loader._connectAttempt = async (...args) => {
                const response = await originalConnectAttempt(...args)
                if (response !== 'success') {
                    connectFailureMessage = normalizeString(response) || connectFailureMessage
                }
                return response
            }
        }

        try {
            await loader.main(options.mode)
            await loader.writeFlash({
                ...DEFAULT_FLASH_OPTIONS,
                fileArray: options.fileArray,
                reportProgress: (fileIndex, written, total) => {
                    if (typeof options?.onProgress !== 'function') {
                        return
                    }
                    const currentPartBytes = options.fileArray[fileIndex]?.data.length || 0
                    const currentPartRatio = total > 0 ? Math.max(0, Math.min(1, written / total)) : 0
                    const overallWritten = (partByteOffsets[fileIndex] || 0) + currentPartBytes * currentPartRatio
                    options.onProgress({
                        partIndex: fileIndex + 1,
                        partCount: options.fileArray.length,
                        written,
                        total,
                        percent: total > 0 ? Math.max(0, Math.min(100, Math.round((written / total) * 100))) : 0,
                        overallWritten,
                        overallTotal: totalPartBytes,
                        overallPercent:
                            totalPartBytes > 0 ? Math.max(0, Math.min(100, Math.round((overallWritten / totalPartBytes) * 100))) : 0
                    })
                }
            })
            await loader.after('hard_reset')
        } catch (error) {
            throw this.#normalizeInstallError(error, connectFailureMessage)
        } finally {
            if (typeof transport?.disconnect === 'function') {
                await transport.disconnect().catch(() => {})
            }
        }
    }

    /**
     * Wraps sync to tolerate one missing trailing ROM reply after valid sync packets arrive.
     * @param {Record<string, unknown>} loader
     */
    #installSyncCompatibilityWrapper(loader) {
        if (!loader || typeof loader.sync !== 'function' || typeof loader.command !== 'function') {
            return
        }

        const syncPacket = new Uint8Array(36)
        syncPacket[0] = 0x07
        syncPacket[1] = 0x07
        syncPacket[2] = 0x12
        syncPacket[3] = 0x20
        syncPacket.fill(0x55, 4)

        loader.sync = async () => {
            if (typeof loader.debug === 'function') {
                loader.debug('Sync')
            }

            let response = await loader.command(SYNC_COMMAND_OPCODE, syncPacket, undefined, undefined, SYNC_COMMAND_TIMEOUT_MS)
            loader.syncStubDetected = response[0] === 0

            for (
                let completedFollowUpReplies = 0;
                completedFollowUpReplies < SYNC_FOLLOW_UP_REPLY_COUNT;
                completedFollowUpReplies += 1
            ) {
                try {
                    response = await loader.command()
                    loader.syncStubDetected = loader.syncStubDetected && response[0] === 0
                } catch (error) {
                    if (
                        completedFollowUpReplies >= MIN_SYNC_FOLLOW_UP_REPLY_COUNT &&
                        this.#isRecoverableSyncError(error)
                    ) {
                        if (typeof loader.debug === 'function') {
                            loader.debug(
                                `Sync tolerated missing trailing reply after ${completedFollowUpReplies} follow-up packets`
                            )
                        }
                        return response
                    }
                    throw error
                }
            }

            return response
        }
    }

    /**
     * Wraps the initial chip-detect register read to retry after one recoverable sync loss.
     * @param {Record<string, unknown>} loader
     */
    #installChipMagicReadCompatibilityWrapper(loader) {
        if (
            !loader ||
            typeof loader.readReg !== 'function' ||
            typeof loader.sync !== 'function' ||
            !Number.isFinite(Number(loader.CHIP_DETECT_MAGIC_REG_ADDR))
        ) {
            return
        }

        const chipDetectMagicRegister = Number(loader.CHIP_DETECT_MAGIC_REG_ADDR)
        const originalReadReg = loader.readReg.bind(loader)
        loader.readReg = async (registerAddress, timeout) => {
            const normalizedRegisterAddress = Number(registerAddress)
            if (normalizedRegisterAddress !== chipDetectMagicRegister) {
                return originalReadReg(registerAddress, timeout)
            }

            let lastError = null
            for (let attemptIndex = 0; attemptIndex < CHIP_MAGIC_READ_RETRY_COUNT; attemptIndex += 1) {
                try {
                    return await originalReadReg(registerAddress, timeout)
                } catch (error) {
                    lastError = error
                    const isFinalAttempt = attemptIndex >= CHIP_MAGIC_READ_RETRY_COUNT - 1
                    if (isFinalAttempt || !this.#isRecoverableSyncError(error)) {
                        throw error
                    }

                    if (typeof loader.debug === 'function') {
                        loader.debug('Retrying chip detection after recoverable read timeout')
                    }
                    await sleep(CHIP_MAGIC_READ_RETRY_DELAY_MS)
                    await loader.sync()
                }
            }

            throw lastError instanceof Error ? lastError : new Error('ESP chip detection failed.')
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
     * Normalizes one low-level install error into the most useful user-facing message.
     * @param {unknown} error
     * @param {string} connectFailureMessage
     * @returns {Error}
     */
    #normalizeInstallError(error, connectFailureMessage) {
        const normalizedConnectFailure = normalizeString(connectFailureMessage)
        const normalizedErrorMessage = normalizeString(error?.message || error)
        if (normalizedConnectFailure && /failed to connect with the device/i.test(normalizedErrorMessage)) {
            return new Error(normalizedConnectFailure)
        }
        if (error instanceof Error) {
            return error
        }
        return new Error(normalizedErrorMessage || 'ESP firmware flashing failed.')
    }

    /**
     * Returns true when manual download-mode retry should be offered.
     * @param {unknown} error
     * @returns {boolean}
     */
    #shouldOfferManualBootRetry(error) {
        return MANUAL_BOOT_RETRY_PATTERN.test(normalizeString(error?.message || error))
    }

    /**
     * Returns true when one sync failure can be treated as a missing trailing ROM reply.
     * @param {unknown} error
     * @returns {boolean}
     */
    #isRecoverableSyncError(error) {
        return SYNC_RECOVERABLE_ERROR_PATTERN.test(normalizeString(error?.message || error))
    }

    /**
     * Resolves the current browser user agent string.
     * @returns {string}
     */
    static #resolveUserAgent() {
        return normalizeString(globalThis?.navigator?.userAgent)
    }
}
