import { EggBotPathComputeTasks } from './EggBotPathComputeTasks.mjs'
import { EggBotPathWorkerClient } from './EggBotPathWorkerClient.mjs'

const LAST_PORT_STORAGE_KEY = 'eggbot.serial.lastPort.v1'
const RECONNECT_ON_LOAD_STORAGE_KEY = 'eggbot.serial.reconnectOnLoad.v1'

/**
 * Web Serial bridge for EggBot EBB command streaming.
 *
 * Command references:
 * - EM: enable/disable motors
 * - SM: stepper move with timed interpolation
 * - SP: servo pen up/down
 * - SC: servo configuration
 */
export class EggBotSerial {
    constructor() {
        this.port = null
        this.writer = null
        this.reader = null
        this.textEncoder = new TextEncoder()
        this.textDecoder = new TextDecoder()
        this.readBuffer = ''
        this.lineQueue = []
        this.pendingLineResolvers = []
        this.readLoopActive = false
        this.readLoopAbort = false
        this.drawing = false
        this.abortDrawing = false
        this.pathWorker = new EggBotPathWorkerClient()
        this.disablePathWorker = false
    }

    /**
     * Returns true when Web Serial is available.
     * @returns {boolean}
     */
    static isSupported() {
        return typeof navigator !== 'undefined' && Boolean(navigator?.serial)
    }

    /**
     * Returns one user-facing transport label.
     * @returns {string}
     */
    get connectionKindLabel() {
        return 'Web Serial'
    }

    /**
     * Returns true when a serial connection is open.
     * @returns {boolean}
     */
    get isConnected() {
        return Boolean(this.port && this.writer)
    }

    /**
     * Opens a serial connection to EBB.
     * @param {{ baudRate?: number }} [options]
     * @returns {Promise<string>}
     */
    async connect(options = {}) {
        this.#assertSerialSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const requestedPort = await navigator.serial.requestPort()
        return this.#openPortAndInitialize(requestedPort, options)
    }

    /**
     * Opens a serial connection for draw-time reconnect.
     * @param {{ baudRate?: number }} [options]
     * @returns {Promise<string>}
     */
    async connectForDraw(options = {}) {
        this.#assertSerialSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const grantedPorts = typeof navigator.serial.getPorts === 'function' ? await navigator.serial.getPorts() : []
        const reconnectPort = this.#selectReconnectPort(grantedPorts)
        if (reconnectPort) {
            return this.#openPortAndInitialize(reconnectPort, options)
        }

        const requestedPort = await navigator.serial.requestPort()
        return this.#openPortAndInitialize(requestedPort, options)
    }

    /**
     * Attempts one silent reconnect after reload when previous session was connected.
     * This never opens the serial chooser and only uses already granted ports.
     * @param {{ baudRate?: number }} [options]
     * @returns {Promise<string | null>}
     */
    async reconnectIfPreviouslyConnected(options = {}) {
        this.#assertSerialSupport()
        if (this.isConnected) {
            return 'Already connected'
        }
        if (!this.#shouldReconnectOnLoad()) {
            return null
        }

        const grantedPorts = typeof navigator.serial.getPorts === 'function' ? await navigator.serial.getPorts() : []
        const reconnectPort = this.#selectReconnectPort(grantedPorts)
        if (!reconnectPort) {
            return null
        }

        return this.#openPortAndInitialize(reconnectPort, options)
    }

    /**
     * Returns true if the provided port is the active one.
     * @param {SerialPort | null | undefined} port
     * @returns {boolean}
     */
    isCurrentPort(port) {
        return Boolean(port && this.port === port)
    }

    /**
     * Closes serial resources.
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.abortDrawing = true
        this.#persistReconnectOnLoad(false)
        await this.#releaseConnectionResources()
    }

    /**
     * Pre-initializes the draw-path worker.
     */
    warmupPathWorker() {
        if (this.disablePathWorker) return
        this.pathWorker.warmup()
    }

    /**
     * Disposes draw-path worker resources.
     */
    disposePathWorker() {
        this.pathWorker.dispose()
        this.disablePathWorker = true
    }

    /**
     * Throws if Web Serial is unavailable.
     */
    #assertSerialSupport() {
        if (!EggBotSerial.isSupported()) {
            throw new Error('Web Serial is not supported in this browser.')
        }
    }

    /**
     * Normalizes and bounds serial baud rate values.
     * @param {unknown} value
     * @returns {number}
     */
    static #normalizeBaudRate(value) {
        const parsed = Math.trunc(Number(value))
        return Number.isFinite(parsed) ? Math.max(300, parsed) : 115200
    }

    /**
     * Converts one servo speed in %/s to EBB SC,11/12 units.
     * @param {unknown} value
     * @returns {number}
     */
    static #toEbbServoRate(value) {
        const percentPerSecond = Math.max(1, Math.min(100, Math.round(Number(value) || 0)))
        return Math.max(1, percentPerSecond * 5)
    }

    /**
     * Opens and initializes one serial port.
     * @param {SerialPort} port
     * @param {{ baudRate?: number }} [options]
     * @returns {Promise<string>}
     */
    async #openPortAndInitialize(port, options = {}) {
        if (!port) {
            throw new Error('No serial port selected.')
        }

        this.port = port
        try {
            await this.port.open({
                baudRate: EggBotSerial.#normalizeBaudRate(options?.baudRate),
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none'
            })

            this.writer = this.port.writable?.getWriter?.() || null
            if (!this.writer) {
                throw new Error('Serial writer is not available.')
            }

            if (this.port.readable?.getReader) {
                this.reader = this.port.readable.getReader()
                this.readLoopAbort = false
                this.#startReadLoop()
            }

            const version = await this.#probeVersion()
            this.#savePortHint(this.port)
            this.#persistReconnectOnLoad(true)
            return version
        } catch (error) {
            await this.#releaseConnectionResources()
            throw error
        }
    }

    /**
     * Queries and normalizes one EBB firmware version response.
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async queryVersion(options = {}) {
        const timeoutMs = Number(options.timeoutMs) || 1500
        const versionLine = await this.sendCommand('v', { expectResponse: true, timeoutMs })
        return EggBotSerial.#normalizeVersionLine(versionLine) || 'Connected'
    }

    /**
     * Tries to read one version line from EBB.
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
     * Removes serial-decoding artifacts from one response line.
     * @param {unknown} value
     * @returns {string}
     */
    static #sanitizeResponseLine(value) {
        return String(value || '')
            .replace(/[\u0000-\u001F\u007F\uFFFD]/g, '')
            .trim()
    }

    /**
     * Normalizes one raw version response line into display-safe text.
     * @param {unknown} line
     * @returns {string}
     */
    static #normalizeVersionLine(line) {
        let normalized = EggBotSerial.#sanitizeResponseLine(line)
        if (!normalized) return ''

        const versionTokenMatch = /(EBB|EiBotBoard|Eggduino|Firmware)/i.exec(normalized)
        if (versionTokenMatch?.index && versionTokenMatch.index > 0) {
            const prefix = normalized.slice(0, versionTokenMatch.index)
            if (/^[^A-Za-z0-9]*$/.test(prefix)) {
                normalized = normalized.slice(versionTokenMatch.index)
            }
        }
        normalized = normalized.replace(/\s+/g, ' ').trim()
        return normalized
    }

    /**
     * Releases open reader/writer/port resources.
     * @returns {Promise<void>}
     */
    async #releaseConnectionResources() {
        this.readLoopAbort = true

        if (this.reader) {
            try {
                await this.reader.cancel()
            } catch (_error) {
                // Ignore reader cancel races.
            }
            try {
                this.reader.releaseLock()
            } catch (_error) {
                // Ignore release failures.
            }
            this.reader = null
        }

        if (this.writer) {
            try {
                this.writer.releaseLock()
            } catch (_error) {
                // Ignore release failures.
            }
            this.writer = null
        }

        if (this.port) {
            try {
                await this.port.close()
            } catch (_error) {
                // Ignore close races.
            }
            this.port = null
        }

        this.#resetReadState()
    }

    /**
     * Resets buffered line-based read state.
     */
    #resetReadState() {
        this.readBuffer = ''
        this.lineQueue = []
        this.pendingLineResolvers = []
        this.readLoopActive = false
        this.readLoopAbort = false
    }

    /**
     * Loads the persisted port hint from localStorage.
     * @returns {{ usbVendorId: number, usbProductId: number } | null}
     */
    #loadPortHint() {
        try {
            if (!window?.localStorage) return null
            const raw = window.localStorage.getItem(LAST_PORT_STORAGE_KEY)
            if (!raw) return null
            const parsed = JSON.parse(raw)
            return this.#isValidPortHint(parsed) ? parsed : null
        } catch (_error) {
            return null
        }
    }

    /**
     * Returns true when startup should attempt an automatic reconnect.
     * @returns {boolean}
     */
    #shouldReconnectOnLoad() {
        try {
            if (!window?.localStorage) return false
            return window.localStorage.getItem(RECONNECT_ON_LOAD_STORAGE_KEY) === '1'
        } catch (_error) {
            return false
        }
    }

    /**
     * Persists whether startup should auto-reconnect serial.
     * @param {boolean} enabled
     */
    #persistReconnectOnLoad(enabled) {
        try {
            if (!window?.localStorage) return
            if (enabled) {
                window.localStorage.setItem(RECONNECT_ON_LOAD_STORAGE_KEY, '1')
                return
            }
            window.localStorage.removeItem(RECONNECT_ON_LOAD_STORAGE_KEY)
        } catch (_error) {
            // Ignore localStorage write failures.
        }
    }

    /**
     * Persists USB vendor/product identifiers for the active port.
     * @param {SerialPort | null} port
     */
    #savePortHint(port) {
        try {
            if (!port?.getInfo || !window?.localStorage) return
            const info = port.getInfo()
            const hint = {
                usbVendorId: Number(info?.usbVendorId),
                usbProductId: Number(info?.usbProductId)
            }
            if (!this.#isValidPortHint(hint)) return
            window.localStorage.setItem(LAST_PORT_STORAGE_KEY, JSON.stringify(hint))
        } catch (_error) {
            // Ignore localStorage and info retrieval failures.
        }
    }

    /**
     * Selects a reconnect candidate from already granted ports.
     * @param {SerialPort[]} grantedPorts
     * @returns {SerialPort | null}
     */
    #selectReconnectPort(grantedPorts) {
        if (!Array.isArray(grantedPorts) || !grantedPorts.length) {
            return null
        }

        const hint = this.#loadPortHint()
        if (hint) {
            const matchedPorts = grantedPorts.filter((port) => this.#portMatchesHint(port, hint))
            if (matchedPorts.length === 1) {
                return matchedPorts[0]
            }
            if (matchedPorts.length > 1) {
                return null
            }
        }

        return grantedPorts.length === 1 ? grantedPorts[0] : null
    }

    /**
     * Returns true if a port matches a persisted USB hint.
     * @param {SerialPort} port
     * @param {{ usbVendorId: number, usbProductId: number }} hint
     * @returns {boolean}
     */
    #portMatchesHint(port, hint) {
        try {
            if (!port?.getInfo) return false
            const info = port.getInfo()
            return Number(info?.usbVendorId) === hint.usbVendorId && Number(info?.usbProductId) === hint.usbProductId
        } catch (_error) {
            return false
        }
    }

    /**
     * Validates a persisted USB vendor/product hint payload.
     * @param {unknown} value
     * @returns {boolean}
     */
    #isValidPortHint(value) {
        if (!value || typeof value !== 'object') return false
        const candidate = /** @type {{ usbVendorId?: unknown, usbProductId?: unknown }} */ (value)
        const vendorId = Number(candidate.usbVendorId)
        const productId = Number(candidate.usbProductId)
        return Number.isInteger(vendorId) && vendorId > 0 && Number.isInteger(productId) && productId > 0
    }

    /**
     * Requests current draw loop termination.
     */
    stop() {
        this.abortDrawing = true
    }

    /**
     * Sends one EBB command.
     * @param {string} command
     * @param {{ expectResponse?: boolean, timeoutMs?: number }} [options]
     * @returns {Promise<string>}
     */
    async sendCommand(command, options = {}) {
        const expectResponse = Boolean(options.expectResponse)
        const timeoutMs = Number(options.timeoutMs) || 1200
        const normalizedCommand = String(command || '').trim()
        await this.#writeRaw(`${command}\r`)
        if (!expectResponse) return ''
        const startedAtMs = Date.now()
        while (true) {
            const elapsedMs = Math.max(0, Date.now() - startedAtMs)
            const remainingTimeoutMs = Math.max(1, timeoutMs - elapsedMs)
            const line = EggBotSerial.#sanitizeResponseLine(await this.#readLine(remainingTimeoutMs))
            if (!line) continue
            if (line.toUpperCase() === 'OK') continue
            if (normalizedCommand && line.toLowerCase() === normalizedCommand.toLowerCase()) continue
            return line
        }
    }

    /**
     * Draws generated strokes on the connected EggBot.
     * @param {Array<{ points: Array<{u:number,v:number}> }>} strokes
     * @param {{ stepsPerTurn: number, penRangeSteps: number, msPerStep?: number, servoUp: number, servoDown: number, invertPen: boolean, penDownSpeed?: number, penUpSpeed?: number, penMotorSpeed?: number, eggMotorSpeed?: number, penRaiseRate?: number, penRaiseDelayMs?: number, penLowerRate?: number, penLowerDelayMs?: number, reversePenMotor?: boolean, reverseEggMotor?: boolean, wrapAround?: boolean, returnHome?: boolean, coordinateMode?: 'normalized-uv' | 'document-px-centered', documentWidthPx?: number, documentHeightPx?: number, stepScalingFactor?: number }} drawConfig
     * @param {{ onStatus?: (text: string) => void, onProgress?: (done: number, total: number, detail?: { completedRatio: number, remainingRatio: number, estimatedTotalMs: number, completedMs: number, remainingMs: number, elapsedMs: number }) => void }} [callbacks]
     * @returns {Promise<void>}
     */
    async drawStrokes(strokes, drawConfig, callbacks = {}) {
        if (!this.isConnected) {
            throw new Error(`No EggBot connected. Connect via ${this.connectionKindLabel} first.`)
        }
        if (this.drawing) {
            throw new Error('A draw run is already active.')
        }

        const onStatus = callbacks.onStatus || (() => {})
        const onProgress = callbacks.onProgress || (() => {})
        const cfg = {
            stepsPerTurn: Math.max(100, Math.round(Number(drawConfig.stepsPerTurn) || 3200)),
            penRangeSteps: Math.max(100, Math.round(Number(drawConfig.penRangeSteps) || 1500)),
            penDownSpeed: Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penDownSpeed) || 300))),
            penUpSpeed: 0,
            servoUp: Math.max(0, Math.round(Number(drawConfig.servoUp) || 12000)),
            servoDown: Math.max(0, Math.round(Number(drawConfig.servoDown) || 17000)),
            invertPen: Boolean(drawConfig.invertPen),
            penRaiseRate: Math.max(1, Math.min(100, Math.round(Number(drawConfig.penRaiseRate) || 50))),
            penLowerRate: Math.max(1, Math.min(100, Math.round(Number(drawConfig.penLowerRate) || 20))),
            penRaiseDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penRaiseDelayMs) || 200))),
            penLowerDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penLowerDelayMs) || 400))),
            reversePenMotor: drawConfig.reversePenMotor !== undefined ? Boolean(drawConfig.reversePenMotor) : true,
            reverseEggMotor: drawConfig.reverseEggMotor !== undefined ? Boolean(drawConfig.reverseEggMotor) : true,
            wrapAround: drawConfig.wrapAround !== false,
            returnHome: Boolean(drawConfig.returnHome),
            coordinateMode:
                String(drawConfig.coordinateMode || '').trim() === 'document-px-centered'
                    ? 'document-px-centered'
                    : 'normalized-uv',
            documentWidthPx: Math.max(1, Number(drawConfig.documentWidthPx) || 3200),
            documentHeightPx: Math.max(1, Number(drawConfig.documentHeightPx) || 800),
            stepScalingFactor: Math.max(1, Math.round(Number(drawConfig.stepScalingFactor) || 2))
        }
        cfg.penUpSpeed = Math.max(
            10,
            Math.min(4000, Math.round(Number(drawConfig.penUpSpeed) || Math.max(400, cfg.penDownSpeed)))
        )
        const profileMaxSpeed = Math.max(cfg.penDownSpeed, cfg.penUpSpeed)
        cfg.penMotorSpeed = Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penMotorSpeed) || profileMaxSpeed)))
        cfg.eggMotorSpeed = Math.max(10, Math.min(4000, Math.round(Number(drawConfig.eggMotorSpeed) || profileMaxSpeed)))

        this.abortDrawing = false
        this.drawing = true
        const current = { x: 0, y: 0 }
        let drawCommandsIssued = false
        let tailPauseSent = false
        let penStateDown = true
        const setPenState = async (isDown) => {
            if (penStateDown === isDown) return false
            await this.#setPen(isDown, cfg)
            penStateDown = isDown
            return true
        }

        try {
            onStatus('Preparing draw path...')
            const drawableStrokes = await this.#prepareDrawableStrokes(strokes, cfg, current.x)
            if (this.abortDrawing) {
                onStatus('Draw aborted by user.')
                return
            }

            onStatus('Configuring EBB...')
            await this.sendCommand(`SC,4,${cfg.servoUp}`)
            await this.sendCommand(`SC,5,${cfg.servoDown}`)
            if (Number.isFinite(Number(drawConfig.penRaiseRate))) {
                try {
                    await this.sendCommand(`SC,11,${EggBotSerial.#toEbbServoRate(cfg.penRaiseRate)}`)
                } catch (_error) {
                    // Ignore unsupported EBB servo-rate slots.
                }
            }
            if (Number.isFinite(Number(drawConfig.penLowerRate))) {
                try {
                    await this.sendCommand(`SC,12,${EggBotSerial.#toEbbServoRate(cfg.penLowerRate)}`)
                } catch (_error) {
                    // Ignore unsupported EBB servo-rate slots.
                }
            }
            await this.sendCommand('EM,1,1')
            drawCommandsIssued = true
            await setPenState(false)

            const total = drawableStrokes.length
            const estimatedTotalMs = this.#estimateDrawDurationMs(drawableStrokes, cfg, current)
            const progressStartedAtMs = Date.now()
            let completedMs = cfg.penRaiseDelayMs
            onProgress(0, total, this.#buildProgressDetail(0, total, completedMs, estimatedTotalMs, progressStartedAtMs))

            for (let strokeIndex = 0; strokeIndex < total; strokeIndex += 1) {
                if (this.abortDrawing) break

                const preparedStroke = drawableStrokes[strokeIndex]
                if (!Array.isArray(preparedStroke) || preparedStroke.length < 2) continue

                onStatus(`Stroke ${strokeIndex + 1}/${total}: moving to start`)
                await this.#moveTo(preparedStroke[0], current, cfg.penUpSpeed, cfg, (durationMs) => {
                    completedMs += durationMs
                    onProgress(
                        strokeIndex,
                        total,
                        this.#buildProgressDetail(strokeIndex, total, completedMs, estimatedTotalMs, progressStartedAtMs)
                    )
                })
                if (this.abortDrawing) break

                onStatus(`Stroke ${strokeIndex + 1}/${total}: pen down`)
                if (await setPenState(true)) {
                    completedMs += cfg.penLowerDelayMs
                }
                onProgress(
                    strokeIndex,
                    total,
                    this.#buildProgressDetail(strokeIndex, total, completedMs, estimatedTotalMs, progressStartedAtMs)
                )

                for (let pointIndex = 1; pointIndex < preparedStroke.length; pointIndex += 1) {
                    if (this.abortDrawing) break
                    await this.#moveTo(preparedStroke[pointIndex], current, cfg.penDownSpeed, cfg, (durationMs) => {
                        completedMs += durationMs
                        onProgress(
                            strokeIndex,
                            total,
                            this.#buildProgressDetail(strokeIndex, total, completedMs, estimatedTotalMs, progressStartedAtMs)
                        )
                    })
                }

                if (await setPenState(false)) {
                    completedMs += cfg.penRaiseDelayMs
                }
                onProgress(
                    strokeIndex + 1,
                    total,
                    this.#buildProgressDetail(strokeIndex + 1, total, completedMs, estimatedTotalMs, progressStartedAtMs)
                )
            }

            if (!this.abortDrawing && cfg.returnHome) {
                onStatus('Returning to home position...')
                await this.#moveTo({ x: 0, y: 0 }, current, cfg.penUpSpeed, cfg, (durationMs) => {
                    completedMs += durationMs
                    onProgress(
                        total,
                        total,
                        this.#buildProgressDetail(total, total, completedMs, estimatedTotalMs, progressStartedAtMs)
                    )
                })
            }

            if (!this.abortDrawing) {
                await this.sendCommand('SM,10,0,0')
                tailPauseSent = true
            }

            if (this.abortDrawing) {
                onStatus('Draw aborted by user.')
            } else {
                onProgress(
                    total,
                    total,
                    this.#buildProgressDetail(total, total, estimatedTotalMs, estimatedTotalMs, progressStartedAtMs)
                )
                onStatus('Draw finished.')
            }
        } finally {
            if (drawCommandsIssued) {
                try {
                    await setPenState(false)
                } catch (_error) {
                    // Ignore cleanup failures.
                }
                try {
                    if (!tailPauseSent) {
                        await this.sendCommand('SM,10,0,0')
                    }
                } catch (_error) {
                    // Ignore cleanup failures.
                }
                try {
                    await this.sendCommand('EM,0,0')
                } catch (_error) {
                    // Ignore cleanup failures.
                }
            }
            this.drawing = false
        }
    }

    /**
     * Starts the serial read loop for line-based responses.
     */
    async #startReadLoop() {
        if (this.readLoopActive || !this.reader) return
        this.readLoopActive = true

        try {
            while (!this.readLoopAbort && this.reader) {
                const { value, done } = await this.reader.read()
                if (done) break
                if (!value) continue
                this.#consumeIncomingChunk(this.textDecoder.decode(value, { stream: true }))
            }
        } catch (_error) {
            // Ignore transport read noise when closing.
        } finally {
            this.readLoopActive = false
        }
    }

    /**
     * Consumes one incoming text chunk.
     * @param {string} chunk
     */
    #consumeIncomingChunk(chunk) {
        this.readBuffer += chunk
        const lines = this.readBuffer.split(/\r\n|\n|\r/g)
        this.readBuffer = lines.pop() || ''

        lines.forEach((line) => {
            const trimmed = line.trim()
            if (!trimmed) return
            this.#enqueueLine(trimmed)
        })
    }

    /**
     * Pushes one line into queue or resolves waiters.
     * @param {string} line
     */
    #enqueueLine(line) {
        const resolver = this.pendingLineResolvers.shift()
        if (resolver) {
            resolver(line)
            return
        }
        this.lineQueue.push(line)
    }

    /**
     * Waits for the next serial line.
     * @param {number} timeoutMs
     * @returns {Promise<string>}
     */
    #readLine(timeoutMs) {
        if (this.lineQueue.length) {
            return Promise.resolve(this.lineQueue.shift() || '')
        }

        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                const index = this.pendingLineResolvers.indexOf(resolver)
                if (index >= 0) {
                    this.pendingLineResolvers.splice(index, 1)
                }
                reject(new Error('Timed out waiting for EBB response.'))
            }, timeoutMs)

            const resolver = (line) => {
                clearTimeout(timeoutId)
                resolve(line)
            }

            this.pendingLineResolvers.push(resolver)
        })
    }

    /**
     * Writes raw serial bytes.
     * @param {string} text
     * @returns {Promise<void>}
     */
    async #writeRaw(text) {
        if (!this.writer) {
            throw new Error('Serial writer is not available.')
        }
        await this.writer.write(this.textEncoder.encode(text))
    }

    /**
     * Prepares all drawable strokes with worker-first fallback behavior.
     * @param {Array<{ points: Array<{u:number,v:number}> }>} strokes
     * @param {{ stepsPerTurn: number, penRangeSteps: number, wrapAround: boolean }} cfg
     * @param {number} startX
     * @returns {Promise<Array<Array<{x:number,y:number}>>>}
     */
    async #prepareDrawableStrokes(strokes, cfg, startX) {
        const payload = {
            strokes: Array.isArray(strokes) ? strokes : [],
            drawConfig: {
                stepsPerTurn: cfg.stepsPerTurn,
                penRangeSteps: cfg.penRangeSteps,
                wrapAround: cfg.wrapAround,
                coordinateMode: cfg.coordinateMode,
                documentWidthPx: cfg.documentWidthPx,
                documentHeightPx: cfg.documentHeightPx,
                stepScalingFactor: cfg.stepScalingFactor
            },
            startX
        }

        if (!this.disablePathWorker) {
            try {
                const result = await this.pathWorker.prepareDrawStrokes(payload)
                if (this.abortDrawing) return []
                return Array.isArray(result?.strokes) ? result.strokes : []
            } catch (error) {
                this.disablePathWorker = true
                console.warn('EggBot path worker failed; falling back to main-thread preprocessing.', error)
            }
        }

        if (this.abortDrawing) return []
        const fallback = EggBotPathComputeTasks.prepareDrawStrokes(payload)
        return Array.isArray(fallback?.strokes) ? fallback.strokes : []
    }

    /**
     * Builds one normalized progress detail payload.
     * @param {number} done
     * @param {number} total
     * @param {number} completedMs
     * @param {number} estimatedTotalMs
     * @param {number} startedAtMs
     * @returns {{ completedRatio: number, remainingRatio: number, estimatedTotalMs: number, completedMs: number, remainingMs: number, elapsedMs: number }}
     */
    #buildProgressDetail(done, total, completedMs, estimatedTotalMs, startedAtMs) {
        const safeTotal = Math.max(0, Math.round(Number(total) || 0))
        const normalizedDone = Math.max(0, Math.min(safeTotal, Math.round(Number(done) || 0)))
        const normalizedEstimatedTotalMs = Math.max(0, Math.round(Number(estimatedTotalMs) || 0))
        const normalizedCompletedMs = Math.max(
            0,
            Math.min(
                normalizedEstimatedTotalMs || Math.max(0, Math.round(Number(completedMs) || 0)),
                Math.round(Number(completedMs) || 0)
            )
        )
        const fallbackRatio = safeTotal > 0 ? normalizedDone / safeTotal : 1
        const completedRatio =
            normalizedEstimatedTotalMs > 0 ? Math.min(1, normalizedCompletedMs / normalizedEstimatedTotalMs) : fallbackRatio
        const remainingRatio = Math.max(0, 1 - completedRatio)
        const remainingMs = Math.max(0, normalizedEstimatedTotalMs - normalizedCompletedMs)
        const elapsedMs = Math.max(0, Date.now() - Math.max(0, Math.round(Number(startedAtMs) || 0)))
        return {
            completedRatio,
            remainingRatio,
            estimatedTotalMs: normalizedEstimatedTotalMs,
            completedMs: normalizedCompletedMs,
            remainingMs,
            elapsedMs
        }
    }

    /**
     * Estimates total draw duration for prepared strokes.
     * @param {Array<Array<{x:number,y:number}>>} drawableStrokes
     * @param {{ penUpSpeed: number, penDownSpeed: number, penMotorSpeed: number, eggMotorSpeed: number, penRaiseDelayMs: number, penLowerDelayMs: number, returnHome: boolean }} cfg
     * @param {{x:number,y:number}} start
     * @returns {number}
     */
    #estimateDrawDurationMs(drawableStrokes, cfg, start) {
        const current = {
            x: Math.round(Number(start?.x) || 0),
            y: Math.round(Number(start?.y) || 0)
        }
        let totalMs = cfg.penRaiseDelayMs
        const preparedStrokeList = Array.isArray(drawableStrokes) ? drawableStrokes : []

        for (let strokeIndex = 0; strokeIndex < preparedStrokeList.length; strokeIndex += 1) {
            const preparedStroke = preparedStrokeList[strokeIndex]
            if (!Array.isArray(preparedStroke) || preparedStroke.length < 2) continue

            totalMs += this.#estimateMoveDurationMs(preparedStroke[0], current, cfg.penUpSpeed)
            totalMs += cfg.penLowerDelayMs

            for (let pointIndex = 1; pointIndex < preparedStroke.length; pointIndex += 1) {
                totalMs += this.#estimateMoveDurationMs(preparedStroke[pointIndex], current, cfg.penDownSpeed)
            }

            totalMs += cfg.penRaiseDelayMs
        }

        if (cfg.returnHome) {
            totalMs += this.#estimateMoveDurationMs({ x: 0, y: 0 }, current, cfg.penUpSpeed)
        }

        return Math.max(0, Math.round(totalMs))
    }

    /**
     * Resolves one move duration using Inkscape EggBot timing semantics.
     * @param {number} deltaX
     * @param {number} deltaY
     * @param {number} speedStepsPerSecond
     * @returns {number}
     */
    #resolveMoveDurationMs(deltaX, deltaY, speedStepsPerSecond) {
        const profileSpeed = Math.max(10, Math.min(4000, Number(speedStepsPerSecond) || 200))
        const distanceSteps = Math.hypot(deltaX, deltaY)
        return Math.max(1, distanceSteps > 0 ? Math.ceil((distanceSteps / profileSpeed) * 1000) : 0)
    }

    /**
     * Estimates one move duration and mutates the provided point to target.
     * @param {{x:number,y:number}} target
     * @param {{x:number,y:number}} current
     * @param {number} speedStepsPerSecond
     * @returns {number}
     */
    #estimateMoveDurationMs(target, current, speedStepsPerSecond) {
        const dx = Math.round(target.x - current.x)
        const dy = Math.round(target.y - current.y)
        if (dx === 0 && dy === 0) return 0

        const durationMs = this.#resolveMoveDurationMs(dx, dy, speedStepsPerSecond)
        current.x = Math.round(target.x)
        current.y = Math.round(target.y)
        return durationMs
    }

    /**
     * Moves steppers to the target point.
     * @param {{x:number,y:number}} target
     * @param {{x:number,y:number}} current
     * @param {number} speedStepsPerSecond
     * @param {{ reversePenMotor: boolean, reverseEggMotor: boolean }} cfg
     * @param {(durationMs: number) => void} [onChunkComplete]
     * @returns {Promise<void>}
     */
    async #moveTo(target, current, speedStepsPerSecond, cfg, onChunkComplete) {
        const dx = Math.round(target.x - current.x)
        const dy = Math.round(target.y - current.y)
        if (dx === 0 && dy === 0) return

        if (this.abortDrawing) return

        const durationMs = this.#resolveMoveDurationMs(dx, dy, speedStepsPerSecond)
        // EggBot wiring in this app maps axis-1 to pen carriage and axis-2 to egg rotation.
        const axis1Pen = cfg.reversePenMotor ? dy : -dy
        const axis2Egg = cfg.reverseEggMotor ? -dx : dx

        await this.sendCommand(`SM,${durationMs},${axis1Pen},${axis2Egg}`)
        const buttonState = String(await this.sendCommand('QB', { expectResponse: true, timeoutMs: 5000 }) || '').trim()
        if (buttonState.startsWith('1')) {
            this.abortDrawing = true
        }

        current.x = Math.round(target.x)
        current.y = Math.round(target.y)
        if (typeof onChunkComplete === 'function') {
            onChunkComplete(durationMs)
        }
    }

    /**
     * Sets pen state using SP command.
     * @param {boolean} isDown
     * @param {{ invertPen: boolean, penRaiseDelayMs: number, penLowerDelayMs: number }} cfg
     * @returns {Promise<void>}
     */
    async #setPen(isDown, cfg) {
        const value = isDown ? (cfg.invertPen ? 1 : 0) : cfg.invertPen ? 0 : 1
        const delayMs = isDown ? cfg.penLowerDelayMs : cfg.penRaiseDelayMs
        await this.sendCommand(`SP,${value},${delayMs}`)
    }
}
