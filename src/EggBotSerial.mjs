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
     * @returns {Promise<string>}
     */
    async connect() {
        this.#assertSerialSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const requestedPort = await navigator.serial.requestPort()
        return this.#openPortAndInitialize(requestedPort)
    }

    /**
     * Opens a serial connection for draw-time reconnect.
     * @returns {Promise<string>}
     */
    async connectForDraw() {
        this.#assertSerialSupport()
        if (this.isConnected) {
            return 'Already connected'
        }

        const grantedPorts = typeof navigator.serial.getPorts === 'function' ? await navigator.serial.getPorts() : []
        const reconnectPort = this.#selectReconnectPort(grantedPorts)
        if (reconnectPort) {
            return this.#openPortAndInitialize(reconnectPort)
        }

        const requestedPort = await navigator.serial.requestPort()
        return this.#openPortAndInitialize(requestedPort)
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
     * Throws if Web Serial is unavailable.
     */
    #assertSerialSupport() {
        if (!('serial' in navigator)) {
            throw new Error('Web Serial is not supported in this browser.')
        }
    }

    /**
     * Opens and initializes one serial port.
     * @param {SerialPort} port
     * @returns {Promise<string>}
     */
    async #openPortAndInitialize(port) {
        if (!port) {
            throw new Error('No serial port selected.')
        }

        this.port = port
        try {
            await this.port.open({
                baudRate: 9600,
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
     * @param {{ stepsPerTurn: number, penRangeSteps: number, msPerStep: number, servoUp: number, servoDown: number, invertPen: boolean }} drawConfig
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
        const cfg = {
            stepsPerTurn: Math.max(100, Math.round(Number(drawConfig.stepsPerTurn) || 3200)),
            penRangeSteps: Math.max(100, Math.round(Number(drawConfig.penRangeSteps) || 1500)),
            msPerStep: Math.max(0.2, Math.min(20, Number(drawConfig.msPerStep) || 1.8)),
            servoUp: Math.max(0, Math.round(Number(drawConfig.servoUp) || 12000)),
            servoDown: Math.max(0, Math.round(Number(drawConfig.servoDown) || 17000)),
            invertPen: Boolean(drawConfig.invertPen)
        }

        this.abortDrawing = false
        this.drawing = true
        onStatus('Configuring EBB...')

        const current = { x: 0, y: 0 }

        try {
            await this.sendCommand(`SC,4,${cfg.servoUp}`)
            await this.sendCommand(`SC,5,${cfg.servoDown}`)
            await this.sendCommand('EM,1,1')
            await this.#setPen(false, cfg)

            const drawableStrokes = strokes.filter((stroke) => Array.isArray(stroke?.points) && stroke.points.length > 1)
            const total = drawableStrokes.length

            for (let strokeIndex = 0; strokeIndex < total; strokeIndex += 1) {
                if (this.abortDrawing) break

                const stroke = drawableStrokes[strokeIndex]
                const scaled = this.#unwrapAndScaleStroke(stroke.points, cfg)
                const aligned = this.#alignStrokeXToCurrent(scaled, current.x, cfg.stepsPerTurn)

                if (aligned.length < 2) continue

                onStatus(`Stroke ${strokeIndex + 1}/${total}: moving to start`)
                await this.#moveTo(aligned[0], current, cfg)

                onStatus(`Stroke ${strokeIndex + 1}/${total}: pen down`)
                await this.#setPen(true, cfg)

                for (let pointIndex = 1; pointIndex < aligned.length; pointIndex += 1) {
                    if (this.abortDrawing) break
                    await this.#moveTo(aligned[pointIndex], current, cfg)
                }

                await this.#setPen(false, cfg)
                onProgress(strokeIndex + 1, total)
            }

            if (this.abortDrawing) {
                onStatus('Draw aborted by user.')
            } else {
                onStatus('Draw finished.')
            }
        } finally {
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
     * Converts wrapped UV points to step coordinates.
     * @param {Array<{u:number,v:number}>} points
     * @param {{ stepsPerTurn: number, penRangeSteps: number }} cfg
     * @returns {Array<{x:number,y:number}>}
     */
    #unwrapAndScaleStroke(points, cfg) {
        if (!points.length) return []

        const unwrapped = [
            {
                u: points[0].u,
                v: points[0].v
            }
        ]

        for (let index = 1; index < points.length; index += 1) {
            const prev = unwrapped[index - 1]
            const current = points[index]
            const options = [current.u - 1, current.u, current.u + 1]
            let selected = options[0]
            let distance = Math.abs(options[0] - prev.u)
            for (let optionIndex = 1; optionIndex < options.length; optionIndex += 1) {
                const candidate = options[optionIndex]
                const candidateDistance = Math.abs(candidate - prev.u)
                if (candidateDistance < distance) {
                    distance = candidateDistance
                    selected = candidate
                }
            }
            unwrapped.push({
                u: selected,
                v: current.v
            })
        }

        const maxY = cfg.penRangeSteps / 2
        return unwrapped.map((point) => ({
            x: Math.round(point.u * cfg.stepsPerTurn),
            y: Math.max(-maxY, Math.min(maxY, Math.round((0.5 - point.v) * cfg.penRangeSteps)))
        }))
    }

    /**
     * Aligns a stroke along X to minimize travel from current position.
     * @param {Array<{x:number,y:number}>} points
     * @param {number} currentX
     * @param {number} stepsPerTurn
     * @returns {Array<{x:number,y:number}>}
     */
    #alignStrokeXToCurrent(points, currentX, stepsPerTurn) {
        if (!points.length) return []
        const shiftTurns = Math.round((currentX - points[0].x) / stepsPerTurn)
        const shift = shiftTurns * stepsPerTurn
        return points.map((point) => ({
            x: point.x + shift,
            y: point.y
        }))
    }

    /**
     * Moves steppers to the target point.
     * @param {{x:number,y:number}} target
     * @param {{x:number,y:number}} current
     * @param {{ msPerStep: number }} cfg
     * @returns {Promise<void>}
     */
    async #moveTo(target, current, cfg) {
        let dx = Math.round(target.x - current.x)
        let dy = Math.round(target.y - current.y)
        if (dx === 0 && dy === 0) return

        const maxChunk = 1200
        while (dx !== 0 || dy !== 0) {
            if (this.abortDrawing) return
            const scale = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxChunk))
            const stepX = Math.trunc(dx / scale)
            const stepY = Math.trunc(dy / scale)
            const chunkX = stepX === 0 ? Math.sign(dx) : stepX
            const chunkY = stepY === 0 ? Math.sign(dy) : stepY
            const durationMs = Math.max(8, Math.round(Math.max(Math.abs(chunkX), Math.abs(chunkY)) * cfg.msPerStep))

            await this.sendCommand(`SM,${durationMs},${chunkX},${chunkY}`)
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
     * @param {{ invertPen: boolean }} cfg
     * @returns {Promise<void>}
     */
    async #setPen(isDown, cfg) {
        const value = isDown ? (cfg.invertPen ? 1 : 0) : cfg.invertPen ? 0 : 1
        await this.sendCommand(`SP,${value}`)
        await EggBotSerial.#sleep(isDown ? 180 : 130)
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
