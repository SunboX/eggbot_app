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
import { EspFirmwareInstaller } from './EspFirmwareInstaller.mjs'

/**
 * AppControllerCoreControls segment of the application controller.
 */
export class AppControllerCoreControls {
    constructor(i18n) {
        this.els = AppElements.query(document)
        this.state = AppRuntimeConfig.createDefaultState()
        this.state.strokes = []
        this.renderDebounceTimer = 0
        this.renderer2d = null
        this.fallbackRenderCanvas = null
        this.activeTextureCanvas = this.els.textureCanvas
        this.renderBackendMode = 'main'
        this.eggScene = new EggScene(this.els.eggCanvas)
        this.serial = new EggBotTransportController()
        this.patternComputeWorker = new PatternComputeWorkerClient()
        this.patternImportWorker = new PatternImportWorkerClient()
        this.patternRenderWorker = new PatternRenderWorkerClient()
        this.renderToken = 0
        this.pendingGeneratedRenderPromise = null
        this.disableComputeWorker = false
        this.disableRenderWorker = false
        this.textureCanvasTransferredToWorker = false
        this.isDrawing = false
        this.isPatternImporting = false
        this.idleTasks = new Map()
        this.hasDeferredStartupTasksScheduled = false
        this.projectArtifactsDirty = true
        this.projectArtifactsRevision = 0
        this.projectArtifactsCachedRevision = -1
        this.cachedProjectPayload = null
        this.cachedProjectShareUrl = ''
        this.pendingSavedProjectsSelectRender = null
        this.i18n = i18n
        this.importedPattern = null
        this.webMcpBridge = null
        this.activeEggBotControlTab = 'plot'
        this.setupActionTogglePenDown = false
        this.drawProgressStartedAtMs = 0
        this.drawProgressSmoother = new DrawProgressSmoother()
        this.espFlashProgressStartedAtMs = 0
        this.espFlashProgressSmoother = new DrawProgressSmoother()
        this.drawTraceOverlayCanvas = null
        this.drawTraceCompositeCanvas = null
        this.drawTraceStrokes = []
        this.drawTracePreviewActive = false
        this.drawTraceLastCompletedStrokeCount = -1
        this.drawTraceLastActiveStrokeIndex = -1
        this.pendingEggTextureSyncAnimationFrame = 0
        this.pendingPenColorDialogResolve = null
        this.textureCanvasRenderSyncHandler = null
        this.espFirmwareInstaller = new EspFirmwareInstaller()
        this.isEspFlashing = false
        this.espFlashBootHintVisible = false
        this.espFlashRetryWithoutResetPending = false
        this.espFlashManifestMeta = null
        this.espFlashManifestLoadPromise = null
        this.espFlashManifestLoadFailed = false
        this.autoGenerateOrnamentControls = [
            this.els.preset,
            this.els.seed,
            this.els.rerollSeed,
            this.els.symmetry,
            this.els.density,
            this.els.bands,
            this.els.ornamentSize,
            this.els.ornamentCount,
            this.els.ornamentDistribution,
            this.els.showHorizontalLines,
            this.els.motifDots,
            this.els.motifRays,
            this.els.motifHoneycomb,
            this.els.motifWolfTeeth,
            this.els.motifPine,
            this.els.motifDiamond
        ]
    }

    /**
     * Starts the app.
     * @returns {Promise<void>}
     */
    async init() {
        this._applyLocaleToUi()
        this._renderAppVersion()
        this._syncEspFlashManifestVersionUi()
        this._syncEspFlashInstallUi()
        this._ensureEspFlashManifestMetaLoaded()
        this._loadSettingsFromLocalStorage()
        this._syncControlsFromState()
        this._applyProjectFromUrl()
        this._bindEvents()
        this._bindSerialLifecycleEvents()
        this._initializeRenderBackend()
        window.addEventListener(
            'beforeunload',
            () => {
                this._persistSettingsToLocalStorage()
                this._disposeBackgroundWorkers()
            },
            { once: true }
        )
        this._bindTextureCanvasRenderSync()
        this._renderPattern()
        this._syncConnectionUi()
        await this._restoreSerialConnectionAfterReload()
        this._syncPatternImportUi()
        this._syncResumeUi()
        this._syncAutoGenerateOrnamentControlsUi()
        this._resetDrawProgressUi()
        this._resetEspFlashProgressUi()
        this._setEspFlashDialogStatus(this._t('machine.flashDialog.statusReady'))
        this._scheduleProjectArtifactsRefreshIdle()
    }

    /**
     * Binds the texture-canvas render completion listener to the current DOM canvas.
     */
    _bindTextureCanvasRenderSync() {
        if (!this.textureCanvasRenderSyncHandler) {
            this.textureCanvasRenderSyncHandler = () => {
                this._syncEggSceneTexture()
            }
        }
        this.els.textureCanvas.addEventListener('pattern-rendered', this.textureCanvasRenderSyncHandler)
    }

    /**
     * Resolves translated text.
     * @param {string} key
     * @param {Record<string, string | number>} [params]
     * @returns {string}
     */
    _t(key, params = {}) {
        return this.i18n.t(key, params)
    }

    /**
     * Applies static locale text to the document and selector.
     */
    _applyLocaleToUi() {
        this.i18n.applyTranslations(document)
        if (this.els.localeSelect) {
            this.els.localeSelect.value = this.i18n.locale
        }
    }

    /**
     * Renders application version in the footer.
     */
    _renderAppVersion() {
        this.els.appVersion.textContent = AppVersion.get()
    }

    /**
     * Syncs ESP flash dialog manifest version text for the current load state.
     */
    _syncEspFlashManifestVersionUi() {
        if (this.espFlashManifestMeta) {
            this.els.espFlashVersionValue.textContent = EspFirmwareManifestMeta.formatDisplayLabel(this.espFlashManifestMeta)
            return
        }
        if (this.espFlashManifestLoadPromise) {
            this.els.espFlashVersionValue.textContent = this._t('machine.flashDialog.versionLoading')
            return
        }
        if (this.espFlashManifestLoadFailed) {
            this.els.espFlashVersionValue.textContent = this._t('machine.flashDialog.versionUnavailable')
            return
        }
        this.els.espFlashVersionValue.textContent = this._t('machine.flashDialog.versionLoading')
    }

    /**
     * Syncs ESP flash dialog button labels and availability.
     */
    _syncEspFlashInstallUi() {
        const flashSupported = EspFirmwareInstaller.isSupported(globalThis)
        this.els.espFlashInstall.disabled = this.isEspFlashing || !flashSupported
        this.els.espFlashInstall.setAttribute('aria-busy', this.isEspFlashing ? 'true' : 'false')
        this.els.espFlashInstall.textContent = this.isEspFlashing
            ? this._t('machine.flashDialog.flashButtonBusy')
            : this._t('machine.flashDialog.flashButton')
        this.els.espFlashDialogClose.disabled = this.isEspFlashing
        this.els.espFlashDialogCloseIcon.disabled = this.isEspFlashing
        if (this.els.espFlashBrowserNote) {
            this.els.espFlashBrowserNote.hidden = flashSupported
        }
        if (this.els.espFlashBootHint) {
            this.els.espFlashBootHint.hidden = !this.espFlashBootHintVisible
        }
    }

    /**
     * Resolves the manifest URL from the install button configuration.
     * @returns {string}
     */
    _resolveEspFlashManifestUrl() {
        const manifestPath = String(this.els.espFlashInstall.getAttribute('manifest') || '').trim()
        if (!manifestPath) {
            return ''
        }
        try {
            return new URL(manifestPath, window.location.href).toString()
        } catch (_error) {
            return manifestPath
        }
    }

    /**
     * Ensures ESP flash manifest metadata is loaded once and cached.
     * @returns {Promise<void>}
     */
    async _ensureEspFlashManifestMetaLoaded() {
        if (this.espFlashManifestMeta || this.espFlashManifestLoadPromise) {
            return
        }
        if (typeof fetch !== 'function') {
            this.espFlashManifestLoadFailed = true
            this._syncEspFlashManifestVersionUi()
            return
        }
        const manifestUrl = this._resolveEspFlashManifestUrl()
        if (!manifestUrl) {
            this.espFlashManifestLoadFailed = true
            this._syncEspFlashManifestVersionUi()
            return
        }

        this.espFlashManifestLoadFailed = false
        this.espFlashManifestLoadPromise = this._loadEspFlashManifestMeta(manifestUrl)
            .catch(() => {
                this.espFlashManifestLoadFailed = true
            })
            .finally(() => {
                this.espFlashManifestLoadPromise = null
                this._syncEspFlashManifestVersionUi()
            })
        this._syncEspFlashManifestVersionUi()
        await this.espFlashManifestLoadPromise
    }

    /**
     * Loads one ESP flash manifest payload and stores one normalized summary.
     * @param {string} manifestUrl
     * @returns {Promise<void>}
     */
    async _loadEspFlashManifestMeta(manifestUrl) {
        const response = await fetch(manifestUrl, { cache: 'no-store' })
        if (!response?.ok || typeof response.json !== 'function') {
            throw new Error('ESP flash manifest request failed.')
        }
        const manifest = await response.json()
        const meta = EspFirmwareManifestMeta.resolve(manifest)
        if (!meta) {
            throw new Error('ESP flash manifest is missing required metadata.')
        }
        this.espFlashManifestMeta = meta
    }

    /**
     * Clears imported pattern mode and returns true if one was active.
     * @returns {boolean}
     */
    _clearImportedPattern() {
        const hadImportedPattern = Boolean(this.importedPattern)
        if (hadImportedPattern) {
            this.importedPattern = null
            this.state.resumeState = null
        }
        this._syncAutoGenerateOrnamentControlsUi()
        this._syncResumeUi()
        return hadImportedPattern
    }

    /**
     * Returns true when a paused draw checkpoint is available.
     * @returns {boolean}
     */
    _hasResumeCheckpoint() {
        return Boolean(
            this.state?.resumeState &&
                Array.isArray(this.state.resumeState.drawBatches) &&
                this.state.resumeState.drawBatches.length > 0 &&
                Number(this.state.resumeState.completedStrokes) < Number(this.state.resumeState.totalStrokes)
        )
    }

    /**
     * Clears persisted resume state.
     * @returns {boolean}
     */
    _clearResumeState() {
        if (!this.state?.resumeState) {
            this._syncResumeUi()
            return false
        }
        this.state.resumeState = null
        this._markProjectArtifactsDirty()
        this._syncResumeUi()
        return true
    }

    /**
     * Stores one normalized resume checkpoint payload.
     * @param {Record<string, any> | null} resumeState
     */
    _setResumeState(resumeState) {
        this.state.resumeState = resumeState ? { ...resumeState } : null
        this._markProjectArtifactsDirty()
        this._syncResumeUi()
    }

    /**
     * Builds a compact draw-batch snapshot for resume persistence.
     * @param {Array<{ colorIndex?: number | null, strokes: Array<{ points: Array<{u:number,v:number}> }> }>} drawBatches
     * @returns {Array<{ colorIndex: number | null, strokes: Array<{ points: Array<{u:number,v:number}> }> }>}
     */
    _cloneDrawBatchesForResume(drawBatches) {
        if (!Array.isArray(drawBatches)) return []
        return drawBatches.map((batch) => ({
            colorIndex: Number.isInteger(batch?.colorIndex) ? batch.colorIndex : null,
            strokes: Array.isArray(batch?.strokes)
                ? batch.strokes
                      .filter((stroke) => Array.isArray(stroke?.points) && stroke.points.length >= 2)
                      .map((stroke) => ({
                          points: stroke.points.map((point) => ({
                              u: Number(point?.u) || 0,
                              v: Number(point?.v) || 0
                          }))
                      }))
                : []
        }))
    }

    /**
     * Computes stroke count across draw batches.
     * @param {Array<{ strokes?: Array<unknown> }>} drawBatches
     * @returns {number}
     */
    _countDrawBatchStrokes(drawBatches) {
        if (!Array.isArray(drawBatches)) return 0
        return drawBatches.reduce((sum, batch) => {
            return sum + (Array.isArray(batch?.strokes) ? batch.strokes.length : 0)
        }, 0)
    }

    /**
     * Refreshes resume-panel controls and status text.
     */
    _syncResumeUi() {
        if (!this.els.resumeStatus || !this.els.resumeStart || !this.els.resumeClear) return
        const resumeState = this.state?.resumeState
        const total = Math.max(0, Math.trunc(Number(resumeState?.totalStrokes) || 0))
        const done = Math.max(0, Math.min(total, Math.trunc(Number(resumeState?.completedStrokes) || 0)))
        const hasCheckpoint = this._hasResumeCheckpoint()
        this.els.resumeStart.disabled = this.isDrawing || !hasCheckpoint
        this.els.resumeClear.disabled = this.isDrawing || !resumeState
        this.els.resumeStatus.removeAttribute('data-i18n')
        this.els.resumeStatus.textContent = hasCheckpoint
            ? this._t('controlDialog.resume.available', { done, total })
            : this._t('controlDialog.resume.noneAvailable')
    }

    /**
     * Writes status text and type.
     * @param {string} text
     * @param {'info' | 'success' | 'error' | 'loading'} [type='info']
     */
    _setStatus(text, type = 'info') {
        this.els.status.removeAttribute('data-i18n')
        this.els.status.textContent = text
        this.els.status.dataset.type = type
    }

    /**
     * Writes one status message inside the ESP flashing dialog.
     * @param {string} text
     * @param {'info' | 'success' | 'error' | 'loading'} [type='info']
     */
    _setEspFlashDialogStatus(text, type = 'info') {
        if (!this.els.espFlashStatus) {
            return
        }
        this.els.espFlashStatus.removeAttribute('data-i18n')
        this.els.espFlashStatus.textContent = text
        this.els.espFlashStatus.dataset.type = type
    }

    /**
     * Mirrors one flashing status to both the main status area and dialog.
     * @param {string} text
     * @param {'info' | 'success' | 'error' | 'loading'} [type='info']
     */
    _setEspFlashStatus(text, type = 'info') {
        this._setStatus(text, type)
        this._setEspFlashDialogStatus(text, type)
    }

    /**
     * Formats one ESP flash stage into one localized status string.
     * @param {unknown} stage
     * @returns {string}
     */
    _formatEspFlashStageStatus(stage) {
        const normalizedStage = String(stage || '').trim()
        if (normalizedStage === 'enteringBootloader') {
            return this._t('messages.espFlashStageEnteringBootloader')
        }
        if (normalizedStage === 'syncing') {
            return this._t('messages.espFlashStageSyncing')
        }
        if (normalizedStage === 'detectingChip') {
            return this._t('messages.espFlashStageDetectingChip')
        }
        if (normalizedStage === 'writingFirmware') {
            return this._t('messages.espFlashStageWriting')
        }
        if (normalizedStage === 'finalizing') {
            return this._t('messages.espFlashStageFinalizing')
        }
        if (normalizedStage === 'recoveringSerialTimeout') {
            return this._t('messages.espFlashRecoveringTimeout')
        }
        if (normalizedStage === 'done') {
            return this._t('messages.espFlashComplete')
        }
        return ''
    }

    /**
     * Applies one installer-reported ESP flash stage to the status UI.
     * @param {{ stage?: unknown }} update
     */
    _handleEspFlashStageUpdate(update) {
        const normalizedStage = String(update?.stage || '').trim()
        const message = this._formatEspFlashStageStatus(normalizedStage)
        if (!message) {
            return
        }
        this._setEspFlashStatus(message, normalizedStage === 'done' ? 'success' : 'loading')
    }

    /**
     * Formats one flashing failure into a localized status message.
     * @param {unknown} error
     * @returns {string}
     */
    _formatEspFlashFailedStatusMessage(error) {
        const reason = String(error?.message || error || 'Unknown error').trim()
        if (/wrong boot mode detected|download mode successfully detected|download mode/i.test(reason)) {
            return this._t('messages.espFlashConnectFailed', { message: reason })
        }
        if (/failed to connect with the device/i.test(reason)) {
            return this._t('messages.espFlashConnectFailed', { message: reason })
        }
        return this._t('messages.espFlashFailed', { message: reason })
    }

    /**
     * Returns true when the manual BOOT hint should be shown for one flash error.
     * @param {unknown} error
     * @returns {boolean}
     */
    _shouldShowEspFlashBootHint(error) {
        const reason = String(error?.message || error || '').trim()
        return /wrong boot mode detected|download mode successfully detected|download mode|failed to connect with the device|read timeout exceeded|no serial data received|invalid response|serial data stream stopped|packet content transfer stopped/i.test(
            reason
        )
    }

    /**
     * Appends Linux/Chromium BLE troubleshooting details when applicable.
     * @param {string} message
     * @param {'serial' | 'ble'} [transport=this.serial.connectionTransportKind]
     * @returns {string}
     */
    _appendBleTroubleshootingHint(message, transport = this.serial.connectionTransportKind) {
        const normalizedMessage = String(message || '')
        if (!this._shouldShowBleTroubleshootingHint(transport)) {
            return normalizedMessage
        }
        return `${normalizedMessage}\n\n${this._t('messages.bleLinuxChromiumTroubleshooting')}`
    }

    /**
     * Returns true when Linux/Chromium BLE troubleshooting details should be shown.
     * @param {unknown} transport
     * @returns {boolean}
     */
    _shouldShowBleTroubleshootingHint(transport) {
        const userAgent = typeof navigator === 'undefined' ? '' : navigator?.userAgent
        const brands = typeof navigator === 'undefined' ? [] : navigator?.userAgentData?.brands
        return BleLinuxChromiumHints.shouldShowBleTroubleshooting({
            transportKind: transport,
            userAgent,
            brands
        })
    }

    /**
     * Builds one connection-failed status message.
     * @param {unknown} error
     * @returns {string}
     */
    _formatConnectionFailedStatusMessage(error) {
        const reason = String(error?.message || error || '')
        const baseMessage = this._t('messages.serialConnectFailed', { message: reason })
        return this._appendBleTroubleshootingHint(baseMessage)
    }

    /**
     * Builds one transport-unsupported status message.
     * @param {'serial' | 'ble'} transport
     * @returns {string}
     */
    _formatTransportUnsupportedStatusMessage(transport) {
        const message = this._t('messages.transportUnsupported', {
            transport: this._formatTransportLabel(transport)
        })
        return this._appendBleTroubleshootingHint(message, transport)
    }

    /**
     * Writes manual control result text inside the EggBot popup.
     * @param {string} text
     * @param {'info' | 'success' | 'error'} [type='info']
     */
    _setManualControlResult(text, type = 'info') {
        if (!this.els.controlManualResult) return
        this.els.controlManualResult.textContent = text
        this.els.controlManualResult.dataset.type = type
        this.els.controlManualResult.hidden = false
    }

    /**
     * Clears manual control result text inside the EggBot popup.
     */
    _clearManualControlResult() {
        if (!this.els.controlManualResult) return
        this.els.controlManualResult.textContent = ''
        this.els.controlManualResult.hidden = true
        delete this.els.controlManualResult.dataset.type
    }

    /**
     * Shows draw-progress UI and initializes default values.
     */
    _startDrawProgressUi() {
        this.drawProgressStartedAtMs = Date.now()
        this.drawProgressSmoother.reset()
        this.els.drawProgress.hidden = false
        this._updateDrawProgressUi(1, null)
    }

    /**
     * Hides draw-progress UI and resets default labels.
     */
    _resetDrawProgressUi() {
        this.drawProgressStartedAtMs = 0
        this.drawProgressSmoother.reset()
        this.els.drawProgress.hidden = true
        this.els.drawProgressFill.style.width = '0%'
        this.els.drawProgressTrack.setAttribute('aria-valuenow', '0')
        this.els.drawProgressPercent.textContent = this._t('messages.drawingRemainingPercent', { percent: 100 })
        this.els.drawProgressTime.textContent = this._t('messages.drawingRemainingTime', {
            time: this._t('messages.drawingRemainingTimeUnknown')
        })
    }

    /**
     * Initializes ESP flashing progress UI for a new install attempt.
     */
    _startEspFlashProgressUi() {
        this.espFlashProgressStartedAtMs = Date.now()
        this.espFlashProgressSmoother.reset()
        if (this.els.espFlashProgress) {
            this.els.espFlashProgress.hidden = false
        }
        this._updateEspFlashProgressUi(0, null)
    }

    /**
     * Resets ESP flashing progress UI to the default idle state.
     */
    _resetEspFlashProgressUi() {
        this.espFlashProgressStartedAtMs = 0
        this.espFlashProgressSmoother.reset()
        if (
            !this.els.espFlashProgress ||
            !this.els.espFlashProgressFill ||
            !this.els.espFlashProgressTrack ||
            !this.els.espFlashProgressPercent ||
            !this.els.espFlashProgressTime
        ) {
            return
        }
        this.els.espFlashProgress.hidden = true
        this.els.espFlashProgressFill.style.width = '0%'
        this.els.espFlashProgressTrack.setAttribute('aria-valuenow', '0')
        this.els.espFlashProgressPercent.textContent = this._t('machine.flashDialog.progressPercent', { percent: 0 })
        this.els.espFlashProgressTime.textContent = this._t('machine.flashDialog.progressTime', {
            time: this._t('messages.drawingRemainingTimeUnknown')
        })
    }

    /**
     * Updates ESP flashing progress UI with completed percentage and duration.
     * @param {number} completedRatio
     * @param {number | null | undefined} remainingMs
     */
    _updateEspFlashProgressUi(completedRatio, remainingMs) {
        const normalizedCompletedRatio = Math.max(0, Math.min(1, Number(completedRatio) || 0))
        const completedPercent = Math.max(0, Math.min(100, Math.round(normalizedCompletedRatio * 100)))
        const normalizedRemainingMsFromDetail = DrawProgressTimeUtils.normalizeRemainingMs(remainingMs)
        const rawRemainingMs =
            normalizedRemainingMsFromDetail === null
                ? this._estimateEspFlashRemainingMsFromRatio(normalizedCompletedRatio)
                : normalizedRemainingMsFromDetail
        const normalizedRemainingMs = this.espFlashProgressSmoother.update(rawRemainingMs)
        if (
            !this.els.espFlashProgressFill ||
            !this.els.espFlashProgressTrack ||
            !this.els.espFlashProgressPercent ||
            !this.els.espFlashProgressTime
        ) {
            return
        }

        this.els.espFlashProgressFill.style.width = `${completedPercent}%`
        this.els.espFlashProgressTrack.setAttribute('aria-valuenow', String(completedPercent))
        this.els.espFlashProgressPercent.textContent = this._t('machine.flashDialog.progressPercent', {
            percent: completedPercent
        })
        this.els.espFlashProgressTime.textContent = this._t('machine.flashDialog.progressTime', {
            time:
                normalizedRemainingMs === null
                    ? this._t('messages.drawingRemainingTimeUnknown')
                    : this._formatDurationLabel(normalizedRemainingMs)
        })
    }

    /**
     * Estimates remaining ESP flashing duration from elapsed runtime and completion ratio.
     * @param {number} completedRatio
     * @returns {number | null}
     */
    _estimateEspFlashRemainingMsFromRatio(completedRatio) {
        if (this.espFlashProgressStartedAtMs <= 0) return null
        const normalizedCompletedRatio = Math.max(0, Math.min(1, Number(completedRatio) || 0))
        if (normalizedCompletedRatio <= 0) return null
        if (normalizedCompletedRatio >= 1) return 0

        const elapsedMs = Math.max(1, Date.now() - this.espFlashProgressStartedAtMs)
        const remainingRatio = Math.max(0, 1 - normalizedCompletedRatio)
        return Math.max(0, Math.round((elapsedMs / normalizedCompletedRatio) * remainingRatio))
    }

    /**
     * Updates draw-progress UI with remaining percentage and duration.
     * @param {number} remainingRatio
     * @param {number | null | undefined} remainingMs
     */
    _updateDrawProgressUi(remainingRatio, remainingMs) {
        const normalizedRemainingRatio = Math.max(0, Math.min(1, Number(remainingRatio) || 0))
        const completedPercent = Math.max(0, Math.min(100, Math.round((1 - normalizedRemainingRatio) * 100)))
        const remainingPercent = Math.max(0, Math.min(100, 100 - completedPercent))
        const normalizedRemainingMsFromDetail = DrawProgressTimeUtils.normalizeRemainingMs(remainingMs)
        const rawRemainingMs =
            normalizedRemainingMsFromDetail === null
                ? this._estimateRemainingMsFromRatio(normalizedRemainingRatio)
                : normalizedRemainingMsFromDetail
        const normalizedRemainingMs = this.drawProgressSmoother.update(rawRemainingMs)

        this.els.drawProgressFill.style.width = `${completedPercent}%`
        this.els.drawProgressTrack.setAttribute('aria-valuenow', String(completedPercent))
        this.els.drawProgressPercent.textContent = this._t('messages.drawingRemainingPercent', { percent: remainingPercent })
        this.els.drawProgressTime.textContent = this._t('messages.drawingRemainingTime', {
            time:
                normalizedRemainingMs === null
                    ? this._t('messages.drawingRemainingTimeUnknown')
                    : this._formatDurationLabel(normalizedRemainingMs)
        })
    }

    /**
     * Estimates remaining duration from elapsed runtime and remaining ratio.
     * @param {number} remainingRatio
     * @returns {number | null}
     */
    _estimateRemainingMsFromRatio(remainingRatio) {
        if (this.drawProgressStartedAtMs <= 0) return null
        const normalizedRemainingRatio = Math.max(0, Math.min(1, Number(remainingRatio) || 0))
        if (normalizedRemainingRatio <= 0) return 0
        if (normalizedRemainingRatio >= 1) return null

        const elapsedMs = Math.max(1, Date.now() - this.drawProgressStartedAtMs)
        const completedRatio = Math.max(0.0001, 1 - normalizedRemainingRatio)
        return Math.max(0, Math.round((elapsedMs / completedRatio) * normalizedRemainingRatio))
    }

    /**
     * Formats duration milliseconds into a compact `M:SS` or `H:MM:SS` string.
     * @param {number} durationMs
     * @returns {string}
     */
    _formatDurationLabel(durationMs) {
        const totalSeconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000))
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60
        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        }
        return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /**
     * Opens the EggBot control modal dialog.
     */
    _openEggBotControlDialog() {
        if (this._isEspFlashDialogOpen()) {
            this._closeEspFlashDialog()
        }
        this._syncEggBotDialogControlsFromState()
        this._syncEggBotControlTabUi()
        this._clearManualControlResult()
        this.els.eggbotDialogBackdrop.hidden = false
        this._syncDialogBodyScrollLock()
    }

    /**
     * Closes the EggBot control modal dialog.
     */
    _closeEggBotControlDialog() {
        this.els.eggbotDialogBackdrop.hidden = true
        this._syncDialogBodyScrollLock()
    }

    /**
     * Returns true when the EggBot control dialog is visible.
     * @returns {boolean}
     */
    _isEggBotControlDialogOpen() {
        return !this.els.eggbotDialogBackdrop.hidden
    }

    /**
     * Opens the ESP32 flashing modal dialog.
     */
    _openEspFlashDialog() {
        if (this._isEggBotControlDialogOpen()) {
            this._closeEggBotControlDialog()
        }
        this.espFlashBootHintVisible = false
        this._ensureEspFlashManifestMetaLoaded()
        this.els.espFlashDialogBackdrop.hidden = false
        this._syncDialogBodyScrollLock()
        this._syncEspFlashInstallUi()
        if (this.els.espFlashInstall instanceof HTMLElement) {
            this.els.espFlashInstall.focus()
            return
        }
        this.els.espFlashDialogClose.focus()
    }

    /**
     * Closes the ESP32 flashing modal dialog.
     */
    _closeEspFlashDialog() {
        if (this.isEspFlashing) {
            return
        }
        this.els.espFlashDialogBackdrop.hidden = true
        this._syncDialogBodyScrollLock()
    }

    /**
     * Returns true when the ESP32 flashing dialog is visible.
     * @returns {boolean}
     */
    _isEspFlashDialogOpen() {
        return !this.els.espFlashDialogBackdrop.hidden
    }

    /**
     * Runs the local ESP32 firmware flashing flow.
     * @returns {Promise<void>}
     */
    async _installEspFirmware() {
        if (this.isEspFlashing) {
            return
        }

        if (!EspFirmwareInstaller.isSupported(globalThis)) {
            this.espFlashBootHintVisible = false
            this._setEspFlashStatus(this._t('messages.espFlashUnsupported'), 'error')
            this._syncEspFlashInstallUi()
            return
        }

        const manifestUrl = this._resolveEspFlashManifestUrl()
        if (!manifestUrl) {
            this.espFlashBootHintVisible = false
            this._setEspFlashStatus(this._t('messages.espFlashFailed', { message: 'Missing firmware manifest URL.' }), 'error')
            this._syncEspFlashInstallUi()
            return
        }

        this.isEspFlashing = true
        this.espFlashBootHintVisible = false
        this._startEspFlashProgressUi()
        this._syncEspFlashInstallUi()
        this._syncConnectionUi()
        this._handleEspFlashStageUpdate({ stage: 'enteringBootloader' })
        const installMode = this.espFlashRetryWithoutResetPending ? 'no_reset' : 'default_reset'

        try {
            await this.espFirmwareInstaller.install({
                manifestUrl,
                mode: installMode,
                onStage: (update) => {
                    this._handleEspFlashStageUpdate(update)
                },
                onProgress: ({ partIndex, partCount, percent, overallPercent }) => {
                    const normalizedOverallPercent = Math.max(
                        0,
                        Math.min(
                            100,
                            Number.isFinite(Number(overallPercent))
                                ? Math.round(Number(overallPercent))
                                : Math.round((((partIndex - 1) + (Number(percent) || 0) / 100) / Math.max(1, partCount)) * 100)
                        )
                    )
                    this._updateEspFlashProgressUi(normalizedOverallPercent / 100, null)
                    this._setEspFlashStatus(
                        this._t('messages.espFlashProgress', {
                            part: partIndex,
                            total: partCount,
                            percent: normalizedOverallPercent
                        }),
                        'loading'
                    )
                }
            })
            this._updateEspFlashProgressUi(1, 0)
            this.espFlashRetryWithoutResetPending = false
            this.espFlashBootHintVisible = false
            this._setEspFlashStatus(this._t('messages.espFlashComplete'), 'success')
        } catch (error) {
            if (error?.name === 'AbortError' || error?.name === 'NotFoundError') {
                this.espFlashRetryWithoutResetPending = false
                this.espFlashBootHintVisible = false
                this._setEspFlashStatus(this._t('messages.espFlashCanceled'), 'info')
            } else {
                this.espFlashRetryWithoutResetPending = this._shouldShowEspFlashBootHint(error)
                this.espFlashBootHintVisible = this.espFlashRetryWithoutResetPending
                this._setEspFlashStatus(this._formatEspFlashFailedStatusMessage(error), 'error')
            }
        } finally {
            this.isEspFlashing = false
            this._syncEspFlashInstallUi()
            this._syncConnectionUi()
        }
    }

    /**
     * Returns true when the pen-color dialog is visible.
     * @returns {boolean}
     */
    _isPenColorDialogOpen() {
        return !this.els.penColorDialogBackdrop.hidden
    }

    /**
     * Applies body scroll lock when any EggBot modal dialog is open.
     */
    _syncDialogBodyScrollLock() {
        const shouldLockBody = this._isEggBotControlDialogOpen() || this._isEspFlashDialogOpen() || this._isPenColorDialogOpen()
        document.body.classList.toggle('eggbot-dialog-open', shouldLockBody)
    }

    /**
     * Opens pen-color confirmation dialog with one title and message.
     * @param {string} title
     * @param {string} message
     */
    _openPenColorDialog(title, message) {
        this.els.penColorDialogTitle.textContent = title
        this.els.penColorDialogMessage.textContent = message
        this.els.penColorDialogBackdrop.hidden = false
        this._syncDialogBodyScrollLock()
        this.els.penColorDialogContinue.focus()
    }

    /**
     * Closes pen-color confirmation dialog.
     */
    _closePenColorDialog() {
        this.els.penColorDialogBackdrop.hidden = true
        this._syncDialogBodyScrollLock()
    }

    /**
     * Resolves one pending pen-color confirmation dialog promise.
     * @param {boolean} shouldContinue
     */
    _resolvePendingPenColorDialog(shouldContinue) {
        const resolve = this.pendingPenColorDialogResolve
        if (!resolve) return
        this.pendingPenColorDialogResolve = null
        this._closePenColorDialog()
        resolve(Boolean(shouldContinue))
    }

    /**
     * Sets one active EggBot control tab and syncs tab UI.
     * @param {string} tab
     */
    _setEggBotControlTab(tab) {
        const nextTab = String(tab || '').trim()
        if (!EGGBOT_CONTROL_TABS.includes(nextTab)) {
            return
        }
        this.activeEggBotControlTab = nextTab
        if (this.state?.drawConfig) {
            this.state.drawConfig.activeControlTab = nextTab
            this._markProjectArtifactsDirty()
        }
        this._syncEggBotControlTabUi()
    }

    /**
     * Synchronizes EggBot control tab buttons and panels.
     */
    _syncEggBotControlTabUi() {
        const activeTab = EGGBOT_CONTROL_TABS.includes(this.activeEggBotControlTab) ? this.activeEggBotControlTab : 'plot'
        this.activeEggBotControlTab = activeTab
        this.els.eggbotTabButtons.forEach((button) => {
            const tabName = String(button?.dataset?.eggbotTab || '').trim()
            const isActive = tabName === activeTab
            button.classList.toggle('active', isActive)
            button.setAttribute('aria-selected', isActive ? 'true' : 'false')
            button.tabIndex = isActive ? 0 : -1
        })
        this.els.eggbotTabPanels.forEach((panel) => {
            const panelTabName = String(panel?.dataset?.eggbotTabPanel || '').trim()
            panel.hidden = panelTabName !== activeTab
        })
    }

    /**
     * Applies the action for the currently active EggBot control tab.
     * @returns {Promise<void>}
     */
    async _applyEggBotControlCurrentTab() {
        if (this.activeEggBotControlTab === 'plot') {
            await this._drawCurrentPattern()
            return
        }
        if (this.activeEggBotControlTab === 'setup') {
            await this._applySetupControlAction()
            return
        }
        if (this.activeEggBotControlTab === 'manual') {
            await this._applyManualControlAction()
            return
        }
        if (this.activeEggBotControlTab === 'resume') {
            await this._resumeFromCheckpoint()
            return
        }
        this._setStatus(this._t('messages.controlDialogSettingsApplied'), 'success')
    }

    /**
     * Applies setup-tab action against a connected EggBot.
     * @returns {Promise<void>}
     */
    async _applySetupControlAction() {
        if (this.isDrawing) {
            this._setStatus(this._t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        const connected = await this._ensureSerialConnectedForControl()
        if (!connected) return

        await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
        await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)

        if (this.state.drawConfig.setupApplyAction === 'raise-off') {
            await this.serial.sendCommand(`SP,${this._resolvePenCommandValue(false)}`)
            await this.serial.sendCommand('EM,0,0')
            this.setupActionTogglePenDown = false
            this._setStatus(this._t('messages.controlDialogSetupRaiseDisableApplied'), 'success')
            return
        }

        this.setupActionTogglePenDown = !this.setupActionTogglePenDown
        await this.serial.sendCommand('EM,1,1')
        await this.serial.sendCommand(`SP,${this._resolvePenCommandValue(this.setupActionTogglePenDown)}`)
        this._setStatus(
            this.setupActionTogglePenDown
                ? this._t('messages.controlDialogSetupPenDownApplied')
                : this._t('messages.controlDialogSetupPenUpApplied'),
            'success'
        )
    }

    /**
     * Applies manual-tab command against a connected EggBot.
     * @returns {Promise<void>}
     */
    async _applyManualControlAction() {
        this._clearManualControlResult()
        if (this.isDrawing) {
            this._setStatus(this._t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        const connected = await this._ensureSerialConnectedForControl()
        if (!connected) return

        const command = String(this.state.drawConfig.manualCommand || 'disable-motors').trim()
        const walkDistance = Math.max(
            -64000,
            Math.min(64000, this.constructor._parseInteger(this.state.drawConfig.manualWalkDistance, 3200))
        )

        if (command === 'disable-motors') {
            await this.serial.sendCommand('EM,0,0')
            this._setStatus(this._t('messages.controlDialogManualMotorsDisabled'), 'success')
            return
        }
        if (command === 'enable-motors') {
            await this.serial.sendCommand('EM,1,1')
            this._setStatus(this._t('messages.controlDialogManualMotorsEnabled'), 'success')
            return
        }
        if (command === 'raise-pen') {
            await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
            await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)
            await this.serial.sendCommand(`SP,${this._resolvePenCommandValue(false)}`)
            this._setStatus(this._t('messages.controlDialogManualPenRaised'), 'success')
            return
        }
        if (command === 'lower-pen') {
            await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
            await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)
            await this.serial.sendCommand(`SP,${this._resolvePenCommandValue(true)}`)
            this._setStatus(this._t('messages.controlDialogManualPenLowered'), 'success')
            return
        }
        if (command === 'walk-egg') {
            const eggMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    this.constructor._parseInteger(
                        this.state.drawConfig.eggMotorSpeed,
                        this.constructor._parseInteger(this.state.drawConfig.penUpSpeed, 400)
                    )
                )
            )
            const durationMs = Math.max(8, Math.round(Math.abs(walkDistance) * (1000 / eggMotorSpeed)))
            const logicalDistance = this.state.drawConfig.reverseEggMotor ? -walkDistance : walkDistance
            await this.serial.sendCommand(`SM,${durationMs},0,${logicalDistance}`)
            this._setStatus(this._t('messages.controlDialogManualWalkEggApplied', { steps: walkDistance }), 'success')
            return
        }
        if (command === 'walk-pen') {
            const penMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    this.constructor._parseInteger(
                        this.state.drawConfig.penMotorSpeed,
                        this.constructor._parseInteger(this.state.drawConfig.penUpSpeed, 400)
                    )
                )
            )
            const durationMs = Math.max(8, Math.round(Math.abs(walkDistance) * (1000 / penMotorSpeed)))
            const logicalDistance = this.state.drawConfig.reversePenMotor ? -walkDistance : walkDistance
            await this.serial.sendCommand(`SM,${durationMs},${logicalDistance},0`)
            this._setStatus(this._t('messages.controlDialogManualWalkPenApplied', { steps: walkDistance }), 'success')
            return
        }
        if (command === 'query-version') {
            const response = await this.serial.queryVersion({ timeoutMs: 1500 })
            const resultMessage = this._t('messages.controlDialogManualVersionResult', { version: response || 'Connected' })
            this._setStatus(resultMessage, 'info')
            this._setManualControlResult(resultMessage, 'info')
            return
        }
        this._setStatus(this._t('messages.controlDialogManualUnknownCommand'), 'error')
    }

    /**
     * Connects serial when needed for setup/manual dialog actions.
     * @returns {Promise<boolean>}
     */
    async _ensureSerialConnectedForControl() {
        if (this.serial.isConnected) {
            return true
        }

        const transport = this.serial.connectionTransportKind
        if (!this.serial.isTransportSupported(transport)) {
            this._setStatus(this._formatTransportUnsupportedStatusMessage(transport), 'error')
            this._syncConnectionUi()
            return false
        }

        try {
            this._setStatus(this._t('messages.connectingBeforeManualControl'), 'loading')
            const version = await this.serial.connectForDraw(this._buildTransportConnectOptions())
            this._setStatus(this._t('messages.eggbotConnected', { version }), 'success')
            this._syncConnectionUi()
            return true
        } catch (error) {
            this._setStatus(this._formatConnectionFailedStatusMessage(error), 'error')
            this._syncConnectionUi()
            return false
        }
    }

    /**
     * Resolves SP command value for pen state.
     * @param {boolean} isDown
     * @returns {number}
     */
    _resolvePenCommandValue(isDown) {
        const invertPen = Boolean(this.state.drawConfig.invertPen)
        return isDown ? (invertPen ? 1 : 0) : invertPen ? 0 : 1
    }

    /**
     * Applies plus/minus spinner steps for one numeric control.
     * @param {MouseEvent} event
     */
    _applyControlStepperAdjustment(event) {
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-spin-step]') : null
        if (!target) return
        const targetId = String(target.dataset.spinTarget || '').trim()
        if (!targetId) return

        const input = document.getElementById(targetId)
        if (!(input instanceof HTMLInputElement)) return

        const direction = this.constructor._parseFloat(target.dataset.spinDirection, 1)
        const step = Math.abs(this.constructor._parseFloat(input.step, 1)) || 1
        const min = input.min === '' ? Number.NEGATIVE_INFINITY : this.constructor._parseFloat(input.min, Number.NEGATIVE_INFINITY)
        const max = input.max === '' ? Number.POSITIVE_INFINITY : this.constructor._parseFloat(input.max, Number.POSITIVE_INFINITY)
        const current = this.constructor._parseFloat(input.value, 0)
        const next = Math.max(min, Math.min(max, current + direction * step))
        const precision = this.constructor._resolveStepPrecision(step)
        input.value = precision > 0 ? next.toFixed(precision) : String(Math.round(next))
        input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    /**
     * Syncs derived draw-config controls shown in the EggBot control dialog.
     */
}
