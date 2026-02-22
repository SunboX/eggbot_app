import { EggBotPathComputeTasks } from './EggBotPathComputeTasks.mjs'
import { EggBotPathWorkerClient } from './EggBotPathWorkerClient.mjs'

const LAST_PORT_STORAGE_KEY = 'eggbot.serial.lastPort.v1'

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
        if (!('serial' in navigator)) {
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
        return Number.isFinite(parsed) ? Math.max(300, parsed) : 9600
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
            return version
        } catch (error) {
            await this.#releaseConnectionResources()
            throw error
        }
    }

    /**
     * Tries to read one version line from EBB.
     * @returns {Promise<string>}
     */
    async #probeVersion() {
        try {
            const versionLine = await this.sendCommand('v', { expectResponse: true, timeoutMs: 1500 })
            return versionLine || 'Connected'
        } catch (_error) {
            return 'Connected (no version response)'
        }
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
        await this.#writeRaw(`${command}\r`)
        if (!expectResponse) return ''
        return this.#readLine(timeoutMs)
    }

    /**
     * Draws generated strokes on the connected EggBot.
     * @param {Array<{ points: Array<{u:number,v:number}> }>} strokes
     * @param {{ stepsPerTurn: number, penRangeSteps: number, msPerStep?: number, servoUp: number, servoDown: number, invertPen: boolean, penDownSpeed?: number, penUpSpeed?: number, penRaiseRate?: number, penRaiseDelayMs?: number, penLowerRate?: number, penLowerDelayMs?: number, reversePenMotor?: boolean, reverseEggMotor?: boolean, wrapAround?: boolean, returnHome?: boolean }} drawConfig
     * @param {{ onStatus?: (text: string) => void, onProgress?: (done: number, total: number) => void }} [callbacks]
     * @returns {Promise<void>}
     */
    async drawStrokes(strokes, drawConfig, callbacks = {}) {
        if (!this.isConnected) {
            throw new Error('No EggBot connected. Connect via Web Serial first.')
        }
        if (this.drawing) {
            throw new Error('A draw run is already active.')
        }

        const onStatus = callbacks.onStatus || (() => {})
        const onProgress = callbacks.onProgress || (() => {})
        const legacyMsPerStep = Math.max(0.2, Math.min(20, Number(drawConfig.msPerStep) || 1.8))
        const cfg = {
            stepsPerTurn: Math.max(100, Math.round(Number(drawConfig.stepsPerTurn) || 3200)),
            penRangeSteps: Math.max(100, Math.round(Number(drawConfig.penRangeSteps) || 1500)),
            penDownSpeed: Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penDownSpeed) || 1000 / legacyMsPerStep))),
            penUpSpeed: 0,
            servoUp: Math.max(0, Math.round(Number(drawConfig.servoUp) || 12000)),
            servoDown: Math.max(0, Math.round(Number(drawConfig.servoDown) || 17000)),
            invertPen: Boolean(drawConfig.invertPen),
            penRaiseRate: Math.max(1, Math.min(100, Math.round(Number(drawConfig.penRaiseRate) || 50))),
            penLowerRate: Math.max(1, Math.min(100, Math.round(Number(drawConfig.penLowerRate) || 20))),
            penRaiseDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penRaiseDelayMs) || 130))),
            penLowerDelayMs: Math.max(0, Math.min(5000, Math.round(Number(drawConfig.penLowerDelayMs) || 180))),
            reversePenMotor: Boolean(drawConfig.reversePenMotor),
            reverseEggMotor: Boolean(drawConfig.reverseEggMotor),
            wrapAround: drawConfig.wrapAround !== false,
            returnHome: Boolean(drawConfig.returnHome)
        }
        cfg.penUpSpeed = Math.max(10, Math.min(4000, Math.round(Number(drawConfig.penUpSpeed) || cfg.penDownSpeed)))

        this.abortDrawing = false
        this.drawing = true
        const current = { x: 0, y: 0 }
        let drawCommandsIssued = false

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
                    await this.sendCommand(`SC,11,${cfg.penRaiseRate}`)
                } catch (_error) {
                    // Ignore unsupported EBB servo-rate slots.
                }
            }
            if (Number.isFinite(Number(drawConfig.penLowerRate))) {
                try {
                    await this.sendCommand(`SC,12,${cfg.penLowerRate}`)
                } catch (_error) {
                    // Ignore unsupported EBB servo-rate slots.
                }
            }
            await this.sendCommand('EM,1,1')
            drawCommandsIssued = true
            await this.#setPen(false, cfg)

            const total = drawableStrokes.length

            for (let strokeIndex = 0; strokeIndex < total; strokeIndex += 1) {
                if (this.abortDrawing) break

                const preparedStroke = drawableStrokes[strokeIndex]
                if (!Array.isArray(preparedStroke) || preparedStroke.length < 2) continue

                onStatus(`Stroke ${strokeIndex + 1}/${total}: moving to start`)
                await this.#moveTo(preparedStroke[0], current, cfg.penUpSpeed, cfg)

                onStatus(`Stroke ${strokeIndex + 1}/${total}: pen down`)
                await this.#setPen(true, cfg)

                for (let pointIndex = 1; pointIndex < preparedStroke.length; pointIndex += 1) {
                    if (this.abortDrawing) break
                    await this.#moveTo(preparedStroke[pointIndex], current, cfg.penDownSpeed, cfg)
                }

                await this.#setPen(false, cfg)
                onProgress(strokeIndex + 1, total)
            }

            if (!this.abortDrawing && cfg.returnHome) {
                onStatus('Returning to home position...')
                await this.#moveTo({ x: 0, y: 0 }, current, cfg.penUpSpeed, cfg)
            }

            if (this.abortDrawing) {
                onStatus('Draw aborted by user.')
            } else {
                onStatus('Draw finished.')
            }
        } finally {
            if (drawCommandsIssued) {
                try {
                    await this.#setPen(false, cfg)
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
                wrapAround: cfg.wrapAround
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
     * Moves steppers to the target point.
     * @param {{x:number,y:number}} target
     * @param {{x:number,y:number}} current
     * @param {number} speedStepsPerSecond
     * @param {{ reversePenMotor: boolean, reverseEggMotor: boolean }} cfg
     * @returns {Promise<void>}
     */
    async #moveTo(target, current, speedStepsPerSecond, cfg) {
        let dx = Math.round(target.x - current.x)
        let dy = Math.round(target.y - current.y)
        if (dx === 0 && dy === 0) return

        const speed = Math.max(10, Math.min(4000, Number(speedStepsPerSecond) || 200))
        const msPerStep = 1000 / speed
        const maxChunk = 1200
        while (dx !== 0 || dy !== 0) {
            if (this.abortDrawing) return
            const scale = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxChunk))
            const stepX = Math.trunc(dx / scale)
            const stepY = Math.trunc(dy / scale)
            const chunkX = stepX === 0 ? Math.sign(dx) : stepX
            const chunkY = stepY === 0 ? Math.sign(dy) : stepY
            const durationMs = Math.max(8, Math.round(Math.max(Math.abs(chunkX), Math.abs(chunkY)) * msPerStep))
            // EggBot wiring in this app maps axis-1 to pen carriage and axis-2 to egg rotation.
            const axis1Pen = cfg.reversePenMotor ? -chunkY : chunkY
            const axis2Egg = cfg.reverseEggMotor ? -chunkX : chunkX

            await this.sendCommand(`SM,${durationMs},${axis1Pen},${axis2Egg}`)
            await EggBotSerial.#sleep(durationMs + 6)

            current.x += chunkX
            current.y += chunkY
            dx -= chunkX
            dy -= chunkY
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
        await this.sendCommand(`SP,${value}`)
        await EggBotSerial.#sleep(isDown ? cfg.penLowerDelayMs : cfg.penRaiseDelayMs)
    }

    /**
     * Promise-based timeout.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    static #sleep(ms) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, ms)
        })
    }
}
