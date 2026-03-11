import {
    AppElements,
    AppRuntimeConfig,
    AppVersion,
    EspFirmwareManifestMeta,
    ImportedPatternScaleUtils,
    ImportedPreviewStrokeUtils,
    PatternGenerator,
    PatternRenderer2D,
    PatternStrokeScaleUtils,
    PatternSvgExportUtils,
    EggScene,
    EggBotTransportController,
    BleLinuxChromiumHints,
    ProjectFilenameUtils,
    ProjectIoUtils,
    ProjectUrlUtils,
    DrawProgressSmoother,
    DrawProgressTimeUtils,
    DrawTraceOverlayRenderer,
    DrawTraceStrokeUtils,
    ImportedRenderSyncUtils,
    PatternComputeWorkerClient,
    PatternImportWorkerClient,
    PatternRenderWorkerClient,
    PatternImportControlUtils,
    PatternImportRuntimeGuards,
    WebMcpBridge,
    IdleScheduler,
    SvgProjectNameUtils,
    FileInputPromptUtils,
    LOCAL_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    IMPORT_HEIGHT_REFERENCE,
    SVG_EXPORT_WIDTH,
    SVG_EXPORT_HEIGHT,
    IDLE_TIMEOUT_STARTUP_LOCAL_PROJECTS_MS,
    IDLE_TIMEOUT_STARTUP_WEBMCP_MS,
    IDLE_TIMEOUT_STARTUP_WORKERS_MS,
    IDLE_TIMEOUT_PROJECT_ARTIFACTS_MS,
    IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS,
    IDLE_TIMEOUT_SETTINGS_PERSIST_MS,
    LOCAL_PROJECT_RENDER_IDLE_CHUNK_SIZE,
    LOCAL_PROJECT_RENDER_IDLE_THRESHOLD,
    EGGBOT_CONTROL_TABS,
    EGGBOT_TRANSPORTS,
    SERVO_VALUE_MIN,
    SERVO_VALUE_MAX
} from './AppControllerShared.mjs'
import { AppControllerRender } from './AppControllerRender.mjs'
import { ColorPaletteUtils } from './ColorPaletteUtils.mjs'

/**
 * AppControllerDraw segment of the application controller.
 */
export class AppControllerDraw extends AppControllerRender {
    async _renderWithMainThreadRenderer(input, useFallbackCanvas) {
        this._ensureMainThreadRenderer(useFallbackCanvas)
        const rendererCanvas = this.renderer2d.canvas
        const proxyImportedEvents = rendererCanvas !== this.els.textureCanvas
        const importedSvgText = String(input.importedSvgText || '').trim()
        const usesImportedSvgRaster = Boolean(
            importedSvgText &&
                (input.preferImportedSvgRaster === true || !Array.isArray(input.strokes) || !input.strokes.length)
        )

        if (usesImportedSvgRaster) {
            await new Promise((resolve, reject) => {
                const onRendered = () => {
                    cleanup()
                    if (proxyImportedEvents) {
                        this.els.textureCanvas.dispatchEvent(new Event('pattern-rendered'))
                    }
                    resolve()
                }
                const onFailed = (event) => {
                    cleanup()
                    const reason = String(event?.detail?.reason || 'image-load-error')
                    if (proxyImportedEvents) {
                        this.els.textureCanvas.dispatchEvent(
                            new CustomEvent('pattern-render-failed', { detail: { reason } })
                        )
                    }
                    const error = new Error('preview-render-failed')
                    error.code = reason
                    reject(error)
                }
                const cleanup = () => {
                    rendererCanvas.removeEventListener('pattern-rendered', onRendered)
                    rendererCanvas.removeEventListener('pattern-render-failed', onFailed)
                }
                rendererCanvas.addEventListener('pattern-rendered', onRendered, { once: true })
                rendererCanvas.addEventListener('pattern-render-failed', onFailed, { once: true })
                this.renderer2d.render(input)
            })
            return { dispatchImportedRenderedEvent: false }
        }

        this.renderer2d.render(input)
        if (proxyImportedEvents && importedSvgText) {
            this.els.textureCanvas.dispatchEvent(new Event('pattern-rendered'))
        }
        return {
            dispatchImportedRenderedEvent: false
        }
    }

    /**
     * Renders imported SVG preview and waits for async image completion.
     * @returns {Promise<void>}
     */
    async _renderImportedPreviewAndWait() {
        return new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                cleanup()
                reject(new Error('preview-timeout'))
            }, 25_000)
            const onRendered = () => {
                cleanup()
                resolve()
            }
            const onFailed = () => {
                cleanup()
                reject(new Error('preview-render-failed'))
            }
            const cleanup = () => {
                window.clearTimeout(timeoutId)
                this.els.textureCanvas.removeEventListener('pattern-rendered', onRendered)
                this.els.textureCanvas.removeEventListener('pattern-render-failed', onFailed)
            }
            this.els.textureCanvas.addEventListener('pattern-rendered', onRendered, { once: true })
            this.els.textureCanvas.addEventListener('pattern-render-failed', onFailed, { once: true })
            try {
                this._renderPattern({ skipImportedStatus: true })
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Schedules a delayed render for slider/input changes.
     */
    _scheduleRender() {
        if (this.state.resumeState) {
            this.state.resumeState = null
            this._syncResumeUi()
        }
        this._markProjectArtifactsDirty()
        clearTimeout(this.renderDebounceTimer)
        this.renderDebounceTimer = window.setTimeout(() => {
            this._renderPattern()
        }, 60)
    }

    /**
     * Randomizes seed and syncs input.
     */
    _rerollSeed() {
        this.state.seed = Math.floor(Math.random() * 2147483646) + 1
        this.els.seed.value = String(this.state.seed)
        this._markProjectArtifactsDirty()
    }

    /**
     * Syncs all controls from the current state.
     */
    _syncControlsFromState() {
        if (!String(this.state.projectName || '').trim()) {
            this.state.projectName = this._t('project.defaultName')
        }
        this.els.projectName.value = this.state.projectName
        this.els.preset.value = this.state.preset
        this.els.seed.value = String(this.state.seed)
        this.els.symmetry.value = String(this.state.symmetry)
        this.els.symmetryLabel.textContent = String(this.state.symmetry)
        this.els.density.value = String(this.state.density)
        this.els.densityLabel.textContent = this.state.density.toFixed(2)
        this.els.bands.value = String(this.state.bands)
        this.els.bandsLabel.textContent = String(this.state.bands)
        this.state.ornamentSize = Math.max(0.5, Math.min(2, this.constructor._parseFloat(this.state.ornamentSize, 1)))
        this.els.ornamentSize.value = String(this.state.ornamentSize)
        this.els.ornamentSizeLabel.textContent = this.state.ornamentSize.toFixed(2)
        this.state.ornamentCount = Math.max(0.5, Math.min(2, this.constructor._parseFloat(this.state.ornamentCount, 1)))
        this.els.ornamentCount.value = String(this.state.ornamentCount)
        this.els.ornamentCountLabel.textContent = this.state.ornamentCount.toFixed(2)
        this.state.ornamentDistribution = Math.max(
            0.6,
            Math.min(1.6, this.constructor._parseFloat(this.state.ornamentDistribution, 1))
        )
        this.els.ornamentDistribution.value = String(this.state.ornamentDistribution)
        this.els.ornamentDistributionLabel.textContent = this.state.ornamentDistribution.toFixed(2)
        this.els.lineWidth.value = String(this.state.lineWidth)
        this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
        this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(
            this.constructor._parseFloat(this.state.importHeightScale, 1)
        )
        this.els.importHeightScale.value = String(this.state.importHeightScale)
        this.els.importHeightScaleLabel.textContent = this.state.importHeightScale.toFixed(2)
        this.els.showHorizontalLines.checked = this.state.showHorizontalLines !== false
        this.state.fillPatterns = this.state.fillPatterns !== false
        this.els.fillPatterns.checked = this.state.fillPatterns
        this.els.baseColor.value = this.state.baseColor
        this._normalizePaletteLength(this.state.palette.length)
        this.els.colorCount.value = String(this.state.palette.length)
        this._syncMotifControls()
        this._renderPaletteControls()
        const requestedTransport = this._resolveConnectionTransportKind()
        if (this.serial.isConnected && requestedTransport !== this.serial.connectionTransportKind) {
            this.state.drawConfig.connectionTransport = this.serial.connectionTransportKind
        } else {
            this.state.drawConfig.connectionTransport = requestedTransport
            this.serial.setTransportKind(this.state.drawConfig.connectionTransport)
        }
        this.els.connectionTransport.value = this.state.drawConfig.connectionTransport
        this.state.drawConfig.baudRate = this._resolveSerialBaudRate()
        this.els.baudRate.value = String(this.state.drawConfig.baudRate)
        this.state.drawConfig.wifiHost = this._resolveWifiHost()
        this.state.drawConfig.wifiPort = this._resolveWifiPort()
        this.state.drawConfig.wifiSecure = this.constructor._parseBoolean(this.state?.drawConfig?.wifiSecure, false)
        this.els.wifiHost.value = this.state.drawConfig.wifiHost
        this.els.wifiPort.value = String(this.state.drawConfig.wifiPort)
        if (this.els.wifiSecure) {
            this.els.wifiSecure.checked = this.state.drawConfig.wifiSecure
        }
        this._syncConnectionTransportUi()
        this.els.stepsPerTurn.value = String(this.state.drawConfig.stepsPerTurn)
        this.els.penRangeSteps.value = String(this.state.drawConfig.penRangeSteps)
        this.state.drawConfig.msPerStep = Math.max(
            0.2,
            Math.min(20, this.constructor._parseFloat(this.state.drawConfig.msPerStep, 1.8))
        )
        this.els.msPerStep.value = this.state.drawConfig.msPerStep.toFixed(2)
        this.els.servoUp.value = String(this.state.drawConfig.servoUp)
        this.els.servoDown.value = String(this.state.drawConfig.servoDown)
        this.els.invertPen.checked = Boolean(this.state.drawConfig.invertPen)
        this._syncEggBotDialogControlsFromState()
        const requestedTab = String(this.state?.drawConfig?.activeControlTab || this.activeEggBotControlTab || 'plot')
        this.activeEggBotControlTab = EGGBOT_CONTROL_TABS.includes(requestedTab) ? requestedTab : 'plot'
        this._syncEggBotControlTabUi()
        this._syncResumeUi()
    }

    /**
     * Syncs motif checkbox states.
     */
    _syncMotifControls() {
        this.els.motifDots.checked = Boolean(this.state.motifs.dots)
        this.els.motifRays.checked = Boolean(this.state.motifs.rays)
        this.els.motifHoneycomb.checked = Boolean(this.state.motifs.honeycomb)
        this.els.motifWolfTeeth.checked = Boolean(this.state.motifs.wolfTeeth)
        this.els.motifPine.checked = Boolean(this.state.motifs.pineBranch)
        this.els.motifDiamond.checked = Boolean(this.state.motifs.diamonds)
    }

    /**
     * Rebuilds dynamic palette controls.
     */
    _renderPaletteControls() {
        this.els.paletteList.innerHTML = ''
        this.state.palette.forEach((color, index) => {
            const wrapper = document.createElement('label')
            wrapper.className = 'palette-item'
            wrapper.textContent = this._t('colors.colorLabel', { index: index + 1 })
            const input = document.createElement('input')
            input.type = 'color'
            input.value = color
            input.dataset.index = String(index)
            input.addEventListener('input', () => {
                const targetIndex = this.constructor._parseInteger(input.dataset.index, index)
                this.state.palette[targetIndex] = input.value
                this._normalizePaletteLength(this.state.palette.length)
                this._renderPaletteControls()
                this._scheduleRender()
            })
            wrapper.appendChild(input)
            this.els.paletteList.appendChild(wrapper)
        })
    }

    /**
     * Ensures the palette array matches requested length.
     * @param {number} desiredCount
     */
    _normalizePaletteLength(desiredCount) {
        const count = Math.max(1, Math.min(6, desiredCount))
        this.state.palette = ColorPaletteUtils.sanitizeFeaturePalette({
            baseColor: this.state.baseColor,
            palette: this.state.palette,
            desiredCount: count
        })
    }

    /**
     * Resolves the validated serial baud rate from draw configuration.
     * @returns {number}
     */
    _resolveSerialBaudRate() {
        return Math.max(300, this.constructor._parseInteger(this.state?.drawConfig?.baudRate, 115200))
    }

    /**
     * Resolves one validated transport mode from draw configuration.
     * @returns {'serial' | 'ble'}
     */
    _resolveConnectionTransportKind() {
        const requested = String(this.state?.drawConfig?.connectionTransport || '')
            .trim()
            .toLowerCase()
        return EGGBOT_TRANSPORTS.includes(requested) ? requested : 'serial'
    }

    /**
     * Resolves one validated Wi-Fi host from draw configuration.
     * @returns {string}
     */
    _resolveWifiHost() {
        return String(this.state?.drawConfig?.wifiHost || '').trim()
    }

    /**
     * Resolves one validated Wi-Fi port from draw configuration.
     * @returns {number}
     */
    _resolveWifiPort() {
        return Math.max(1, Math.min(65535, this.constructor._parseInteger(this.state?.drawConfig?.wifiPort, 1337)))
    }

    /**
     * Resolves one boolean URL query flag.
     * Empty values are treated as enabled (`?flag` => true).
     * @param {string[]} names
     * @param {boolean} fallback
     * @returns {boolean}
     */
    _resolveUrlBooleanFlag(names, fallback) {
        if (typeof window === 'undefined' || !window.location) return fallback
        const searchParams = new URLSearchParams(window.location.search || '')
        for (let index = 0; index < names.length; index += 1) {
            const name = names[index]
            if (!searchParams.has(name)) continue
            const rawValue = searchParams.get(name)
            if (rawValue === null || rawValue.trim() === '') {
                return true
            }
            return this.constructor._parseBoolean(rawValue, fallback)
        }
        return fallback
    }

    /**
     * Resolves BLE connection debug options from URL query flags.
     * Supported flags:
     * - `bleDebugScan=1`: use accept-all BLE chooser mode.
     * - `bleDebugLog=1`: enable BLE debug logging.
     * @returns {{ debugScan: boolean, debugLog: boolean }}
     */
    _resolveBleConnectDebugOptions() {
        const debugScan = this._resolveUrlBooleanFlag(['bleDebugScan', 'ble_debug_scan'], false)
        const debugLog = this._resolveUrlBooleanFlag(['bleDebugLog', 'ble_debug_log'], debugScan)
        return { debugScan, debugLog }
    }

    /**
     * Resolves transport-specific connection options.
     * @returns {{ baudRate?: number, debugScan?: boolean, debugLog?: boolean }}
     */
    _buildTransportConnectOptions() {
        const transport = this.serial.connectionTransportKind
        if (transport === 'ble') {
            return this._resolveBleConnectDebugOptions()
        }
        return {
            baudRate: this._resolveSerialBaudRate()
        }
    }

    /**
     * Updates transport-specific machine controls and labels.
     */
    _syncConnectionTransportUi() {
        const transport = this.serial.connectionTransportKind
        this.els.machineBaudRateRow.hidden = transport !== 'serial'
        this.els.machineWifiOptions.hidden = true
        this.els.connectionTransport.value = transport

        const connectLabel = `${this._t('machine.connect')} ${this._formatTransportLabel(transport)}`
        this.els.serialConnect.textContent = connectLabel
    }

    /**
     * Switches active transport and keeps UI/state in sync.
     * @param {string} requestedTransport
     * @returns {Promise<void>}
     */
    async _switchConnectionTransport(requestedTransport) {
        const normalizedTransport = EGGBOT_TRANSPORTS.includes(requestedTransport) ? requestedTransport : 'serial'
        await this.serial.switchTransportKind(normalizedTransport)
        this.state.drawConfig.connectionTransport = normalizedTransport
        this._markProjectArtifactsDirty()
        this._syncConnectionTransportUi()

        if (!this.serial.isTransportSupported(normalizedTransport)) {
            this._setStatus(this._formatTransportUnsupportedStatusMessage(normalizedTransport), 'error')
        } else {
            this._setStatus(
                this._t('messages.transportSwitched', {
                    transport: this._formatTransportLabel(normalizedTransport)
                }),
                'info'
            )
        }

        this._syncConnectionUi()
    }

    /**
     * Formats one localized transport label.
     * @param {'serial' | 'ble'} transport
     * @returns {string}
     */
    _formatTransportLabel(transport) {
        if (transport === 'ble') return this._t('machine.transportBle')
        return this._t('machine.transportSerial')
    }

    /**
     * Builds one ordered batch list based on current print color mode.
     * @param {Array<{ colorIndex?: number, points: Array<{u:number,v:number}> }>} strokes
     * @returns {Array<{ colorIndex: number | null, strokes: Array<{ colorIndex?: number, points: Array<{u:number,v:number}> }> }>}
     */
    _buildDrawColorBatches(strokes) {
        const sourceStrokes = Array.isArray(strokes) ? strokes : []
        if (this.importedPattern && this._isInkscapeSvgCompatModeEnabled()) {
            return [{ colorIndex: null, strokes: sourceStrokes }]
        }
        const colorMode = this.constructor._normalizePrintColorMode(this.state?.drawConfig?.printColorMode)
        if (colorMode !== 'per-color') {
            return [{ colorIndex: null, strokes: sourceStrokes }]
        }

        const byColor = new Map()
        sourceStrokes.forEach((stroke) => {
            const colorIndex = this._resolveStrokeColorIndex(stroke)
            if (!byColor.has(colorIndex)) {
                byColor.set(colorIndex, [])
            }
            byColor.get(colorIndex).push(stroke)
        })

        return Array.from(byColor.keys())
            .sort((a, b) => a - b)
            .map((colorIndex) => ({
                colorIndex,
                strokes: byColor.get(colorIndex) || []
            }))
    }

    /**
     * Resolves one bounded stroke color index for palette lookup.
     * @param {{ colorIndex?: number } | null | undefined} stroke
     * @returns {number}
     */
    _resolveStrokeColorIndex(stroke) {
        const paletteSize = Array.isArray(this.state?.palette) ? this.state.palette.length : 0
        const fallbackColorIndex = 0
        const parsed = Math.trunc(Number(stroke?.colorIndex))
        const normalized = Number.isFinite(parsed) ? parsed : fallbackColorIndex
        if (paletteSize <= 0) {
            return Math.max(0, normalized)
        }
        return Math.max(0, Math.min(paletteSize - 1, normalized))
    }

    /**
     * Returns a user-facing color label for pen-change prompts.
     * @param {number} colorIndex
     * @returns {string}
     */
    _formatDrawColorLabel(colorIndex) {
        const normalizedIndex = this._resolveStrokeColorIndex({ colorIndex })
        const label = this._t('colors.colorLabel', { index: normalizedIndex + 1 })
        const colorHex = String(this.state?.palette?.[normalizedIndex] || '')
            .trim()
            .toUpperCase()
        return colorHex ? `${label} (${colorHex})` : label
    }

    /**
     * Asks the user to insert or change pen color before continuing.
     * @param {number} batchIndex
     * @param {number} colorIndex
     * @returns {Promise<boolean>}
     */
    async _confirmDrawColorBatchReady(batchIndex, colorIndex) {
        const colorLabel = this._formatDrawColorLabel(colorIndex)
        const isFirstBatch = batchIndex === 0
        const statusKey = isFirstBatch ? 'messages.waitingForPenColorStart' : 'messages.waitingForPenColorChange'
        const titleKey = isFirstBatch ? 'messages.penColorDialogTitleStart' : 'messages.penColorDialogTitleChange'
        const message = this._t(statusKey, { color: colorLabel })
        this._setStatus(message, 'info')
        if (this.pendingPenColorDialogResolve) {
            this._resolvePendingPenColorDialog(false)
        }
        return new Promise((resolve) => {
            this.pendingPenColorDialogResolve = resolve
            this._openPenColorDialog(this._t(titleKey), message)
        })
    }

    /**
     * Restores a previous serial connection after page reload when possible.
     * @returns {Promise<void>}
     */
    async _restoreSerialConnectionAfterReload() {
        if (this.serial.connectionTransportKind !== 'serial') {
            this._syncConnectionUi()
            return
        }
        if (!this.serial.isTransportSupported('serial')) {
            this._syncConnectionUi()
            return
        }

        try {
            const version = await this.serial.reconnectIfPreviouslyConnected(this._buildTransportConnectOptions())
            if (!version) return
            this._setStatus(this._t('messages.eggbotConnected', { version }), 'success')
        } catch (error) {
            this._setStatus(this._formatConnectionFailedStatusMessage(error), 'error')
        } finally {
            this._syncConnectionUi()
        }
    }

    /**
     * Opens Web Serial and refreshes UI.
     * @returns {Promise<void>}
     */
    async _connectSerial() {
        const transport = this.serial.connectionTransportKind
        if (!this.serial.isTransportSupported(transport)) {
            this._setStatus(this._formatTransportUnsupportedStatusMessage(transport), 'error')
            this._syncConnectionUi()
            return
        }

        try {
            const version = await this.serial.connect(this._buildTransportConnectOptions())
            this._setStatus(this._t('messages.eggbotConnected', { version }), 'success')
            this._syncConnectionUi()
        } catch (error) {
            this._setStatus(this._formatConnectionFailedStatusMessage(error), 'error')
            this._syncConnectionUi()
        }
    }

    /**
     * Disconnects serial resources.
     * @returns {Promise<void>}
     */
    async _disconnectSerial() {
        try {
            await this.serial.disconnect()
            this._setStatus(this._t('messages.eggbotDisconnected'), 'info')
        } catch (error) {
            this._setStatus(this._t('messages.disconnectFailed', { message: error.message }), 'error')
        }
        this._syncConnectionUi()
    }

    /**
     * Resolves imported stroke coordinate mode.
     * @returns {'normalized-uv' | 'document-px-centered'}
     */
    _resolveImportedPatternCoordinateMode() {
        if (String(this.importedPattern?.coordinateMode || '').trim() === 'normalized-uv') {
            return 'normalized-uv'
        }
        return 'document-px-centered'
    }

    /**
     * Returns whether imported preview/draw mapping should use document-centered scaling.
     * @returns {boolean}
     */
    _usesDocumentCenteredImportedMapping() {
        return (
            Boolean(this.importedPattern) &&
            !this._isInkscapeSvgCompatModeEnabled() &&
            this._resolveImportedPatternCoordinateMode() === 'document-px-centered'
        )
    }

    /**
     * Resolves draw-coordinate conversion mode for serial plotting.
     * External imported SVGs use v281-style document-centered pixel coordinates.
     * @returns {{ coordinateMode: 'normalized-uv' | 'document-px-centered', documentWidthPx?: number, documentHeightPx?: number, stepScalingFactor?: number }}
     */
    _resolveDrawCoordinateConfig() {
        if (!this.importedPattern || !this._usesDocumentCenteredImportedMapping()) {
            return {
                coordinateMode: 'normalized-uv'
            }
        }
        return {
            coordinateMode: 'document-px-centered',
            documentWidthPx: Math.max(1, Number(this.importedPattern.documentWidthPx) || 3200),
            documentHeightPx: Math.max(1, Number(this.importedPattern.documentHeightPx) || 800),
            stepScalingFactor: 2
        }
    }

    /**
     * Executes a draw run for current strokes.
     * @param {{ resume?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async _drawCurrentPattern(options = {}) {
        const resumeMode = options?.resume === true
        if (this.isDrawing) {
            return
        }
        if (
            !resumeMode &&
            PatternImportRuntimeGuards.isDrawStartBlocked({
                isPatternImporting: this.isPatternImporting
            })
        ) {
            this._setStatus(this._t('messages.drawBlockedWhileImporting'), 'info')
            return
        }

        if (!resumeMode && !(await this._ensureRenderedStrokesReady())) {
            this._setStatus(this._t('messages.noPatternToDraw'), 'error')
            return
        }

        const resumeStateSource = this.state?.resumeState
        const drawSourceStrokes = !resumeMode && this.importedPattern ? this._buildRenderedStrokes() : this.state.strokes
        if (!resumeMode && this.importedPattern) {
            this.state.strokes = Array.isArray(drawSourceStrokes) ? drawSourceStrokes : []
        }
        const drawBatches = resumeMode
            ? this._cloneDrawBatchesForResume(resumeStateSource?.drawBatches)
            : this._buildDrawColorBatches(drawSourceStrokes)
        const totalStrokes = drawBatches.reduce((sum, batch) => sum + (Array.isArray(batch.strokes) ? batch.strokes.length : 0), 0)
        if (totalStrokes <= 0) {
            this._setStatus(resumeMode ? this._t('messages.resumeUnavailable') : this._t('messages.noPatternToDraw'), 'error')
            return
        }

        let startBatchIndex = 0
        let startStrokeIndex = 0
        let completedStrokes = 0
        if (resumeMode) {
            if (!this._hasResumeCheckpoint()) {
                this._setStatus(this._t('messages.resumeUnavailable'), 'error')
                return
            }
            startBatchIndex = Math.max(
                0,
                Math.min(drawBatches.length - 1, Math.trunc(Number(resumeStateSource?.nextBatchIndex) || 0))
            )
            startStrokeIndex = Math.max(
                0,
                Math.min(
                    Array.isArray(drawBatches[startBatchIndex]?.strokes) ? drawBatches[startBatchIndex].strokes.length : 0,
                    Math.trunc(Number(resumeStateSource?.nextStrokeIndex) || 0)
                )
            )
            for (let index = 0; index < startBatchIndex; index += 1) {
                completedStrokes += Array.isArray(drawBatches[index]?.strokes) ? drawBatches[index].strokes.length : 0
            }
            completedStrokes += startStrokeIndex
            this._setStatus(this._t('messages.resumeStarted', { done: completedStrokes, total: totalStrokes }), 'info')
        } else {
            const coordinateConfig = this._resolveDrawCoordinateConfig()
            this._setResumeState({
                status: 'ready',
                updatedAt: new Date().toISOString(),
                totalStrokes,
                completedStrokes: 0,
                nextBatchIndex: 0,
                nextStrokeIndex: 0,
                coordinateMode: coordinateConfig.coordinateMode,
                documentWidthPx: coordinateConfig.documentWidthPx ?? null,
                documentHeightPx: coordinateConfig.documentHeightPx ?? null,
                stepScalingFactor: coordinateConfig.stepScalingFactor ?? 2,
                drawBatches: this._cloneDrawBatchesForResume(drawBatches)
            })
        }

        const drawStrokeSequence = []
        for (let batchIndex = startBatchIndex; batchIndex < drawBatches.length; batchIndex += 1) {
            const batch = drawBatches[batchIndex]
            if (!Array.isArray(batch?.strokes) || batch.strokes.length <= 0) continue
            const batchStartOffset = batchIndex === startBatchIndex ? startStrokeIndex : 0
            drawStrokeSequence.push(...batch.strokes.slice(batchStartOffset))
        }
        const tracePreviewScales =
            this._usesDocumentCenteredImportedMapping()
                ? ImportedPatternScaleUtils.resolveDrawAreaPreviewScales({
                      documentWidthPx: this.importedPattern.documentWidthPx,
                      documentHeightPx: this.importedPattern.documentHeightPx,
                      stepsPerTurn: this.state?.drawConfig?.stepsPerTurn,
                      penRangeSteps: this.state?.drawConfig?.penRangeSteps,
                      stepScalingFactor: this._resolveDrawCoordinateConfig().stepScalingFactor
                  })
                : null
        const drawTracePreviewStrokes = DrawTraceStrokeUtils.buildPreviewAlignedStrokes({
            strokes: drawStrokeSequence,
            importedPatternActive: Boolean(this.importedPattern),
            isInkscapeCompatMode: this._isInkscapeSvgCompatModeEnabled(),
            previewScaleU: tracePreviewScales?.uScale,
            previewScaleV: tracePreviewScales?.vScale
        })

        let connectingBeforeDraw = false
        let drawCanceledByUser = false
        let drawAbortedByStop = false
        this.isDrawing = true
        this.eggScene.setAutoRotationEnabled(false)
        this._syncConnectionUi()
        this._startDrawTracePreview(drawTracePreviewStrokes)

        try {
            if (!this.serial.isConnected) {
                const transport = this.serial.connectionTransportKind
                if (!this.serial.isTransportSupported(transport)) {
                    throw new Error(this._formatTransportUnsupportedStatusMessage(transport))
                }
                connectingBeforeDraw = true
                this._setStatus(this._t('messages.connectingBeforeDraw'), 'loading')
                const version = await this.serial.connectForDraw(this._buildTransportConnectOptions())
                connectingBeforeDraw = false
                this._setStatus(this._t('messages.eggbotConnected', { version }), 'success')
                this._syncConnectionUi()
            }

            let lastProgressDone = -1
            let lastProgressTotal = -1
            let drawProgressStarted = false

            const coordinateConfig = resumeMode
                ? {
                      coordinateMode:
                          String(resumeStateSource?.coordinateMode || '').trim() === 'document-px-centered'
                              ? 'document-px-centered'
                              : 'normalized-uv',
                      documentWidthPx: Number(resumeStateSource?.documentWidthPx) || undefined,
                      documentHeightPx: Number(resumeStateSource?.documentHeightPx) || undefined,
                      stepScalingFactor: Number(resumeStateSource?.stepScalingFactor) || 2
                  }
                : this._resolveDrawCoordinateConfig()

            for (let batchIndex = startBatchIndex; batchIndex < drawBatches.length; batchIndex += 1) {
                const batch = drawBatches[batchIndex]
                if (!Array.isArray(batch?.strokes) || batch.strokes.length <= 0) continue
                const batchStartOffset = batchIndex === startBatchIndex ? startStrokeIndex : 0
                const batchStrokes = batch.strokes.slice(batchStartOffset)
                if (!batchStrokes.length) continue

                if (Number.isInteger(batch.colorIndex)) {
                    const confirmed = await this._confirmDrawColorBatchReady(batchIndex, batch.colorIndex)
                    if (!confirmed) {
                        if (this.serial.abortDrawing) {
                            drawAbortedByStop = true
                        } else {
                            drawCanceledByUser = true
                        }
                        break
                    }
                }

                if (!drawProgressStarted) {
                    this._startDrawProgressUi()
                    drawProgressStarted = true
                }

                const batchStrokeCount = batchStrokes.length
                const batchCompletedBase = completedStrokes
                const batchDrawConfig = {
                    ...this.state.drawConfig,
                    ...coordinateConfig,
                    returnHome: Boolean(this.state.drawConfig.returnHome) && batchIndex === drawBatches.length - 1
                }

                await this.serial.drawStrokes(batchStrokes, batchDrawConfig, {
                    onStatus: (text) => this._setStatus(text, 'info'),
                    onProgress: (done, _total, detail) => {
                        const normalizedDone = Math.max(0, Math.min(batchStrokeCount, Math.round(Number(done) || 0)))
                        const globalDone = Math.max(0, Math.min(totalStrokes, batchCompletedBase + normalizedDone))
                        if (globalDone !== lastProgressDone || totalStrokes !== lastProgressTotal) {
                            lastProgressDone = globalDone
                            lastProgressTotal = totalStrokes
                            this._setStatus(this._t('messages.drawingProgress', { done: globalDone, total: totalStrokes }), 'info')
                        }
                        this._updateDrawTracePreview(globalDone, totalStrokes)
                        const fallbackRemainingRatio = totalStrokes > 0 ? Math.max(0, 1 - globalDone / totalStrokes) : 0
                        const remainingRatio =
                            drawBatches.length === 1 && Number.isFinite(Number(detail?.remainingRatio))
                                ? Math.max(0, Math.min(1, Number(detail.remainingRatio)))
                                : fallbackRemainingRatio
                        const remainingMs =
                            drawBatches.length === 1 && Number.isFinite(Number(detail?.remainingMs))
                                ? Math.max(0, Number(detail.remainingMs))
                                : null
                        this._updateDrawProgressUi(remainingRatio, remainingMs)
                        const currentResumeState = this.state?.resumeState
                        if (currentResumeState) {
                            this._setResumeState({
                                ...currentResumeState,
                                status: 'paused',
                                updatedAt: new Date().toISOString(),
                                completedStrokes: globalDone,
                                nextBatchIndex: batchIndex,
                                nextStrokeIndex: batchStartOffset + normalizedDone
                            })
                        }
                    }
                })

                if (this.serial.abortDrawing) {
                    drawAbortedByStop = true
                    break
                }

                completedStrokes += batchStrokeCount
                const currentResumeState = this.state?.resumeState
                if (currentResumeState) {
                    this._setResumeState({
                        ...currentResumeState,
                        status: 'paused',
                        updatedAt: new Date().toISOString(),
                        completedStrokes,
                        nextBatchIndex: Math.min(drawBatches.length - 1, batchIndex + 1),
                        nextStrokeIndex: 0
                    })
                }
            }

            if (drawCanceledByUser) {
                this._setStatus(this._t('messages.drawCanceledByUser'), 'info')
            } else if (!drawAbortedByStop) {
                this._clearResumeState()
                this._setStatus(this._t('messages.drawCompleted'), 'success')
            }
        } catch (error) {
            if (connectingBeforeDraw) {
                this._setStatus(this._formatConnectionFailedStatusMessage(error), 'error')
            } else if (drawCanceledByUser) {
                this._setStatus(this._t('messages.drawCanceledByUser'), 'info')
            } else {
                this._setStatus(this._t('messages.drawFailed', { message: error.message }), 'error')
            }
        } finally {
            this._resolvePendingPenColorDialog(false)
            this._closePenColorDialog()
            this._stopDrawTracePreview()
            this.eggScene.setAutoRotationEnabled(true)
            this.isDrawing = false
            this._resetDrawProgressUi()
            this._syncConnectionUi()
            this._syncResumeUi()
        }
    }

    /**
     * Resumes drawing from the last checkpoint, if available.
     * @returns {Promise<void>}
     */
    async _resumeFromCheckpoint() {
        if (!this._hasResumeCheckpoint()) {
            this._setStatus(this._t('messages.resumeUnavailable'), 'error')
            return
        }
        await this._drawCurrentPattern({ resume: true })
    }

    /**
     * Syncs machine control button enabled states.
     */
    _syncConnectionUi() {
        const transport = this.serial.connectionTransportKind
        const transportSupported = this.serial.isTransportSupported(transport)
        const connected = this.serial.isConnected
        const drawStartBlocked = PatternImportRuntimeGuards.isDrawStartBlocked({
            isPatternImporting: this.isPatternImporting
        })
        this.els.connectionTransport.disabled = connected || this.isDrawing
        this._syncConnectionTransportUi()
        this.els.serialConnect.disabled = connected || this.isDrawing || !transportSupported
        this.els.serialDisconnect.disabled = !connected || this.isDrawing
        this.els.espFlashOpen.disabled = connected || this.isDrawing
        this.els.drawButton.disabled = this.isDrawing || !transportSupported || drawStartBlocked
        this.els.stopButton.disabled = !this.isDrawing || !connected
        this._syncPatternImportUi()
        this._syncResumeUi()
    }

    /**
     * Syncs pattern import loading controls.
     */
    _syncPatternImportUi() {
        const isInteractionBlocked = PatternImportRuntimeGuards.isImportInteractionBlocked({
            isPatternImporting: this.isPatternImporting,
            isDrawing: this.isDrawing
        })
        this.els.loadPattern.disabled = isInteractionBlocked
        this.els.loadPattern.setAttribute('aria-busy', this.isPatternImporting ? 'true' : 'false')
        this.els.status.setAttribute('aria-busy', this.isPatternImporting ? 'true' : 'false')
    }

    /**
     * Resolves parse options for imported SVG handling.
     * @returns {{ maxColors: number, heightScale: number, heightReference: number, curveSmoothing: number }}
     */
    _resolveImportedPatternParseOptions() {
        return {
            maxColors: 6,
            // Keep imported source strokes unscaled; runtime paths apply scale from controls.
            heightScale: 1,
            heightReference: IMPORT_HEIGHT_REFERENCE,
            curveSmoothing: Math.max(0, Math.min(2, Number(this.state?.drawConfig?.curveSmoothing) || 0.2))
        }
    }

    /**
     * Resolves and stores parse-time height scale metadata.
     * @returns {number}
     */
    _resolveImportedPatternStoredHeightScale() {
        return 1
    }

    /**
     * Applies shared status mapping for imported-pattern parse/render failures.
     * @param {unknown} error
     */
    _setImportedPatternErrorStatus(error) {
        if (error?.message === 'no-drawable-geometry') {
            this._setStatus(this._t('messages.noDrawableGeometry'), 'error')
            return
        }
        if (error?.message === 'invalid-svg') {
            this._setStatus(this._t('messages.invalidSvgFile'), 'error')
            return
        }
        if (error?.message === 'preview-timeout' || error?.message === 'preview-render-failed') {
            this._setStatus(this._t('messages.previewPreparationFailed'), 'error')
            return
        }
        this._setStatus(this._t('messages.patternImportFailed', { message: String(error?.message || error) }), 'error')
    }

    /**
     * Re-parses the active imported SVG using current import mode settings.
     * @returns {Promise<void>}
     */
}
