import { AppElements } from './AppElements.mjs'
import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'
import { AppVersion } from './AppVersion.mjs'
import { ImportedPatternScaleUtils } from './ImportedPatternScaleUtils.mjs'
import { PatternGenerator } from './PatternGenerator.mjs'
import { PatternRenderer2D } from './PatternRenderer2D.mjs'
import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'
import { PatternSvgExportUtils } from './PatternSvgExportUtils.mjs'
import { EggScene } from './EggScene.mjs'
import { EggBotSerial } from './EggBotSerial.mjs'
import { ProjectFilenameUtils } from './ProjectFilenameUtils.mjs'
import { ProjectIoUtils } from './ProjectIoUtils.mjs'
import { ProjectUrlUtils } from './ProjectUrlUtils.mjs'
import { I18n } from './I18n.mjs'
import { PatternComputeWorkerClient } from './PatternComputeWorkerClient.mjs'
import { PatternImportWorkerClient } from './PatternImportWorkerClient.mjs'
import { PatternRenderWorkerClient } from './PatternRenderWorkerClient.mjs'
import { PatternImportControlUtils } from './PatternImportControlUtils.mjs'
import { WebMcpBridge } from './WebMcpBridge.mjs'
import { IdleScheduler } from './IdleScheduler.mjs'
import { SvgProjectNameUtils } from './SvgProjectNameUtils.mjs'
const LOCAL_STORAGE_KEY = 'eggbot.savedProjects.v1'
const SETTINGS_STORAGE_KEY = 'eggbot.settings.v1'
const IMPORT_HEIGHT_REFERENCE = 800
const SVG_EXPORT_WIDTH = 2048
const SVG_EXPORT_HEIGHT = 1024
const IDLE_TIMEOUT_STARTUP_LOCAL_PROJECTS_MS = 500
const IDLE_TIMEOUT_STARTUP_WEBMCP_MS = 900
const IDLE_TIMEOUT_STARTUP_WORKERS_MS = 1500
const IDLE_TIMEOUT_PROJECT_ARTIFACTS_MS = 1000
const IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS = 800
const IDLE_TIMEOUT_SETTINGS_PERSIST_MS = 450
const LOCAL_PROJECT_RENDER_IDLE_CHUNK_SIZE = 30
const LOCAL_PROJECT_RENDER_IDLE_THRESHOLD = 100
const EGGBOT_CONTROL_TABS = ['plot', 'setup', 'timing', 'options', 'manual', 'resume', 'layers', 'advanced']
const SERVO_VALUE_MIN = 5000
const SERVO_VALUE_MAX = 25000
/**
 * App orchestration for controls, rendering, persistence, and EggBot drawing.
 */
class AppController {
    /**
     * @param {I18n} i18n
     */
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
        this.serial = new EggBotSerial()
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
        this.pendingPenColorDialogResolve = null
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
        this.#applyLocaleToUi()
        this.#renderAppVersion()
        this.#loadSettingsFromLocalStorage()
        this.#syncControlsFromState()
        this.#applyProjectFromUrl()
        this.#bindEvents()
        this.#bindSerialLifecycleEvents()
        this.#initializeRenderBackend()
        window.addEventListener(
            'beforeunload',
            () => {
                this.#persistSettingsToLocalStorage()
                this.#disposeBackgroundWorkers()
            },
            { once: true }
        )
        this.els.textureCanvas.addEventListener('pattern-rendered', () =>
            this.eggScene.updateTexture(this.#resolveActiveTextureCanvas())
        )
        this.#renderPattern()
        this.#syncConnectionUi()
        this.#syncPatternImportUi()
        this.#syncAutoGenerateOrnamentControlsUi()
        this.#resetDrawProgressUi()
        this.#scheduleProjectArtifactsRefreshIdle()
    }
    /**
     * Resolves translated text.
     * @param {string} key
     * @param {Record<string, string | number>} [params]
     * @returns {string}
     */
    #t(key, params = {}) {
        return this.i18n.t(key, params)
    }
    /**
     * Applies static locale text to the document and selector.
     */
    #applyLocaleToUi() {
        this.i18n.applyTranslations(document)
        if (this.els.localeSelect) {
            this.els.localeSelect.value = this.i18n.locale
        }
    }
    /**
     * Renders application version in the footer.
     */
    #renderAppVersion() {
        this.els.appVersion.textContent = AppVersion.get()
    }
    /**
     * Clears imported pattern mode and returns true if one was active.
     * @returns {boolean}
     */
    #clearImportedPattern() {
        const hadImportedPattern = Boolean(this.importedPattern)
        if (hadImportedPattern) {
            this.importedPattern = null
        }
        this.#syncAutoGenerateOrnamentControlsUi()
        return hadImportedPattern
    }
    /**
     * Writes status text and type.
     * @param {string} text
     * @param {'info' | 'success' | 'error' | 'loading'} [type='info']
     */
    #setStatus(text, type = 'info') {
        this.els.status.removeAttribute('data-i18n')
        this.els.status.textContent = text
        this.els.status.dataset.type = type
    }

    /**
     * Writes manual control result text inside the EggBot popup.
     * @param {string} text
     * @param {'info' | 'success' | 'error'} [type='info']
     */
    #setManualControlResult(text, type = 'info') {
        if (!this.els.controlManualResult) return
        this.els.controlManualResult.textContent = text
        this.els.controlManualResult.dataset.type = type
        this.els.controlManualResult.hidden = false
    }

    /**
     * Clears manual control result text inside the EggBot popup.
     */
    #clearManualControlResult() {
        if (!this.els.controlManualResult) return
        this.els.controlManualResult.textContent = ''
        this.els.controlManualResult.hidden = true
        delete this.els.controlManualResult.dataset.type
    }

    /**
     * Shows draw-progress UI and initializes default values.
     */
    #startDrawProgressUi() {
        this.drawProgressStartedAtMs = Date.now()
        this.els.drawProgress.hidden = false
        this.#updateDrawProgressUi(1, null)
    }

    /**
     * Hides draw-progress UI and resets default labels.
     */
    #resetDrawProgressUi() {
        this.drawProgressStartedAtMs = 0
        this.els.drawProgress.hidden = true
        this.els.drawProgressFill.style.width = '0%'
        this.els.drawProgressTrack.setAttribute('aria-valuenow', '0')
        this.els.drawProgressPercent.textContent = this.#t('messages.drawingRemainingPercent', { percent: 100 })
        this.els.drawProgressTime.textContent = this.#t('messages.drawingRemainingTime', {
            time: this.#t('messages.drawingRemainingTimeUnknown')
        })
    }

    /**
     * Updates draw-progress UI with remaining percentage and duration.
     * @param {number} remainingRatio
     * @param {number | null | undefined} remainingMs
     */
    #updateDrawProgressUi(remainingRatio, remainingMs) {
        const normalizedRemainingRatio = Math.max(0, Math.min(1, Number(remainingRatio) || 0))
        const completedPercent = Math.max(0, Math.min(100, Math.round((1 - normalizedRemainingRatio) * 100)))
        const remainingPercent = Math.max(0, Math.min(100, 100 - completedPercent))
        const normalizedRemainingMs = Number.isFinite(Number(remainingMs))
            ? Math.max(0, Math.round(Number(remainingMs)))
            : this.#estimateRemainingMsFromRatio(normalizedRemainingRatio)

        this.els.drawProgressFill.style.width = `${completedPercent}%`
        this.els.drawProgressTrack.setAttribute('aria-valuenow', String(completedPercent))
        this.els.drawProgressPercent.textContent = this.#t('messages.drawingRemainingPercent', { percent: remainingPercent })
        this.els.drawProgressTime.textContent = this.#t('messages.drawingRemainingTime', {
            time:
                normalizedRemainingMs === null
                    ? this.#t('messages.drawingRemainingTimeUnknown')
                    : this.#formatDurationLabel(normalizedRemainingMs)
        })
    }

    /**
     * Estimates remaining duration from elapsed runtime and remaining ratio.
     * @param {number} remainingRatio
     * @returns {number | null}
     */
    #estimateRemainingMsFromRatio(remainingRatio) {
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
    #formatDurationLabel(durationMs) {
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
    #openEggBotControlDialog() {
        this.#syncEggBotDialogControlsFromState()
        this.#syncEggBotControlTabUi()
        this.#clearManualControlResult()
        this.els.eggbotDialogBackdrop.hidden = false
        this.#syncDialogBodyScrollLock()
    }

    /**
     * Closes the EggBot control modal dialog.
     */
    #closeEggBotControlDialog() {
        this.els.eggbotDialogBackdrop.hidden = true
        this.#syncDialogBodyScrollLock()
    }

    /**
     * Returns true when the EggBot control dialog is visible.
     * @returns {boolean}
     */
    #isEggBotControlDialogOpen() {
        return !this.els.eggbotDialogBackdrop.hidden
    }

    /**
     * Returns true when the pen-color dialog is visible.
     * @returns {boolean}
     */
    #isPenColorDialogOpen() {
        return !this.els.penColorDialogBackdrop.hidden
    }

    /**
     * Applies body scroll lock when any EggBot modal dialog is open.
     */
    #syncDialogBodyScrollLock() {
        const shouldLockBody = this.#isEggBotControlDialogOpen() || this.#isPenColorDialogOpen()
        document.body.classList.toggle('eggbot-dialog-open', shouldLockBody)
    }

    /**
     * Opens pen-color confirmation dialog with one title and message.
     * @param {string} title
     * @param {string} message
     */
    #openPenColorDialog(title, message) {
        this.els.penColorDialogTitle.textContent = title
        this.els.penColorDialogMessage.textContent = message
        this.els.penColorDialogBackdrop.hidden = false
        this.#syncDialogBodyScrollLock()
        this.els.penColorDialogContinue.focus()
    }

    /**
     * Closes pen-color confirmation dialog.
     */
    #closePenColorDialog() {
        this.els.penColorDialogBackdrop.hidden = true
        this.#syncDialogBodyScrollLock()
    }

    /**
     * Resolves one pending pen-color confirmation dialog promise.
     * @param {boolean} shouldContinue
     */
    #resolvePendingPenColorDialog(shouldContinue) {
        const resolve = this.pendingPenColorDialogResolve
        if (!resolve) return
        this.pendingPenColorDialogResolve = null
        this.#closePenColorDialog()
        resolve(Boolean(shouldContinue))
    }

    /**
     * Sets one active EggBot control tab and syncs tab UI.
     * @param {string} tab
     */
    #setEggBotControlTab(tab) {
        const nextTab = String(tab || '').trim()
        if (!EGGBOT_CONTROL_TABS.includes(nextTab)) {
            return
        }
        this.activeEggBotControlTab = nextTab
        if (this.state?.drawConfig) {
            this.state.drawConfig.activeControlTab = nextTab
            this.#markProjectArtifactsDirty()
        }
        this.#syncEggBotControlTabUi()
    }

    /**
     * Synchronizes EggBot control tab buttons and panels.
     */
    #syncEggBotControlTabUi() {
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
    async #applyEggBotControlCurrentTab() {
        if (this.activeEggBotControlTab === 'plot') {
            await this.#drawCurrentPattern()
            return
        }
        if (this.activeEggBotControlTab === 'setup') {
            await this.#applySetupControlAction()
            return
        }
        if (this.activeEggBotControlTab === 'manual') {
            await this.#applyManualControlAction()
            return
        }
        this.#setStatus(this.#t('messages.controlDialogSettingsApplied'), 'success')
    }

    /**
     * Applies setup-tab action against a connected EggBot.
     * @returns {Promise<void>}
     */
    async #applySetupControlAction() {
        if (this.isDrawing) {
            this.#setStatus(this.#t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        const connected = await this.#ensureSerialConnectedForControl()
        if (!connected) return

        await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
        await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)

        if (this.state.drawConfig.setupApplyAction === 'raise-off') {
            await this.serial.sendCommand(`SP,${this.#resolvePenCommandValue(false)}`)
            await this.serial.sendCommand('EM,0,0')
            this.setupActionTogglePenDown = false
            this.#setStatus(this.#t('messages.controlDialogSetupRaiseDisableApplied'), 'success')
            return
        }

        this.setupActionTogglePenDown = !this.setupActionTogglePenDown
        await this.serial.sendCommand('EM,1,1')
        await this.serial.sendCommand(`SP,${this.#resolvePenCommandValue(this.setupActionTogglePenDown)}`)
        this.#setStatus(
            this.setupActionTogglePenDown
                ? this.#t('messages.controlDialogSetupPenDownApplied')
                : this.#t('messages.controlDialogSetupPenUpApplied'),
            'success'
        )
    }

    /**
     * Applies manual-tab command against a connected EggBot.
     * @returns {Promise<void>}
     */
    async #applyManualControlAction() {
        this.#clearManualControlResult()
        if (this.isDrawing) {
            this.#setStatus(this.#t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        const connected = await this.#ensureSerialConnectedForControl()
        if (!connected) return

        const command = String(this.state.drawConfig.manualCommand || 'disable-motors').trim()
        const walkDistance = Math.max(
            -64000,
            Math.min(64000, AppController.#parseInteger(this.state.drawConfig.manualWalkDistance, 3200))
        )

        if (command === 'disable-motors') {
            await this.serial.sendCommand('EM,0,0')
            this.#setStatus(this.#t('messages.controlDialogManualMotorsDisabled'), 'success')
            return
        }
        if (command === 'enable-motors') {
            await this.serial.sendCommand('EM,1,1')
            this.#setStatus(this.#t('messages.controlDialogManualMotorsEnabled'), 'success')
            return
        }
        if (command === 'raise-pen') {
            await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
            await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)
            await this.serial.sendCommand(`SP,${this.#resolvePenCommandValue(false)}`)
            this.#setStatus(this.#t('messages.controlDialogManualPenRaised'), 'success')
            return
        }
        if (command === 'lower-pen') {
            await this.serial.sendCommand(`SC,4,${Math.round(this.state.drawConfig.servoUp)}`)
            await this.serial.sendCommand(`SC,5,${Math.round(this.state.drawConfig.servoDown)}`)
            await this.serial.sendCommand(`SP,${this.#resolvePenCommandValue(true)}`)
            this.#setStatus(this.#t('messages.controlDialogManualPenLowered'), 'success')
            return
        }
        if (command === 'walk-egg') {
            const eggMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    AppController.#parseInteger(
                        this.state.drawConfig.eggMotorSpeed,
                        AppController.#parseInteger(this.state.drawConfig.penUpSpeed, 200)
                    )
                )
            )
            const durationMs = Math.max(8, Math.round(Math.abs(walkDistance) * (1000 / eggMotorSpeed)))
            const logicalDistance = this.state.drawConfig.reverseEggMotor ? -walkDistance : walkDistance
            await this.serial.sendCommand(`SM,${durationMs},0,${logicalDistance}`)
            this.#setStatus(this.#t('messages.controlDialogManualWalkEggApplied', { steps: walkDistance }), 'success')
            return
        }
        if (command === 'walk-pen') {
            const penMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    AppController.#parseInteger(
                        this.state.drawConfig.penMotorSpeed,
                        AppController.#parseInteger(this.state.drawConfig.penUpSpeed, 200)
                    )
                )
            )
            const durationMs = Math.max(8, Math.round(Math.abs(walkDistance) * (1000 / penMotorSpeed)))
            const logicalDistance = this.state.drawConfig.reversePenMotor ? -walkDistance : walkDistance
            await this.serial.sendCommand(`SM,${durationMs},${logicalDistance},0`)
            this.#setStatus(this.#t('messages.controlDialogManualWalkPenApplied', { steps: walkDistance }), 'success')
            return
        }
        if (command === 'query-version') {
            const response = await this.serial.sendCommand('v', { expectResponse: true, timeoutMs: 1500 })
            const resultMessage = this.#t('messages.controlDialogManualVersionResult', { version: response || 'Connected' })
            this.#setStatus(resultMessage, 'info')
            this.#setManualControlResult(resultMessage, 'info')
            return
        }
        this.#setStatus(this.#t('messages.controlDialogManualUnknownCommand'), 'error')
    }

    /**
     * Connects serial when needed for setup/manual dialog actions.
     * @returns {Promise<boolean>}
     */
    async #ensureSerialConnectedForControl() {
        if (this.serial.isConnected) {
            return true
        }

        try {
            this.#setStatus(this.#t('messages.connectingBeforeManualControl'), 'loading')
            const version = await this.serial.connectForDraw({ baudRate: this.#resolveSerialBaudRate() })
            this.#setStatus(this.#t('messages.eggbotConnected', { version }), 'success')
            this.#syncConnectionUi()
            return true
        } catch (error) {
            this.#setStatus(this.#t('messages.serialConnectFailed', { message: error.message }), 'error')
            this.#syncConnectionUi()
            return false
        }
    }

    /**
     * Resolves SP command value for pen state.
     * @param {boolean} isDown
     * @returns {number}
     */
    #resolvePenCommandValue(isDown) {
        const invertPen = Boolean(this.state.drawConfig.invertPen)
        return isDown ? (invertPen ? 1 : 0) : invertPen ? 0 : 1
    }

    /**
     * Applies plus/minus spinner steps for one numeric control.
     * @param {MouseEvent} event
     */
    #applyControlStepperAdjustment(event) {
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-spin-step]') : null
        if (!target) return
        const targetId = String(target.dataset.spinTarget || '').trim()
        if (!targetId) return

        const input = document.getElementById(targetId)
        if (!(input instanceof HTMLInputElement)) return

        const direction = AppController.#parseFloat(target.dataset.spinDirection, 1)
        const step = Math.abs(AppController.#parseFloat(input.step, 1)) || 1
        const min = input.min === '' ? Number.NEGATIVE_INFINITY : AppController.#parseFloat(input.min, Number.NEGATIVE_INFINITY)
        const max = input.max === '' ? Number.POSITIVE_INFINITY : AppController.#parseFloat(input.max, Number.POSITIVE_INFINITY)
        const current = AppController.#parseFloat(input.value, 0)
        const next = Math.max(min, Math.min(max, current + direction * step))
        const precision = AppController.#resolveStepPrecision(step)
        input.value = precision > 0 ? next.toFixed(precision) : String(Math.round(next))
        input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    /**
     * Syncs derived draw-config controls shown in the EggBot control dialog.
     */
    #syncEggBotDialogControlsFromState() {
        const currentServoUp = Math.max(0, AppController.#parseInteger(this.state.drawConfig.servoUp, 12000))
        const currentServoDown = Math.max(0, AppController.#parseInteger(this.state.drawConfig.servoDown, 17000))
        const penUpPercent = Math.max(
            0,
            Math.min(100, AppController.#parseFloat(this.state.drawConfig.penUpPercent, AppController.#servoValueToPercent(currentServoUp)))
        )
        const penDownPercent = Math.max(
            0,
            Math.min(
                100,
                AppController.#parseFloat(this.state.drawConfig.penDownPercent, AppController.#servoValueToPercent(currentServoDown))
            )
        )
        this.state.drawConfig.penUpPercent = penUpPercent
        this.state.drawConfig.penDownPercent = penDownPercent
        this.els.controlPenUpPercent.value = String(Math.round(penUpPercent))
        this.els.controlPenDownPercent.value = String(Math.round(penDownPercent))

        const fallbackSpeed = Math.max(10, Math.min(4000, Math.round(1000 / Math.max(0.2, this.state.drawConfig.msPerStep || 1.8))))
        const penDownSpeed = Math.max(10, Math.min(4000, AppController.#parseInteger(this.state.drawConfig.penDownSpeed, fallbackSpeed)))
        const penUpSpeed = Math.max(10, Math.min(4000, AppController.#parseInteger(this.state.drawConfig.penUpSpeed, penDownSpeed)))
        const penMotorSpeed = Math.max(10, Math.min(4000, AppController.#parseInteger(this.state.drawConfig.penMotorSpeed, 4000)))
        const eggMotorSpeed = Math.max(10, Math.min(4000, AppController.#parseInteger(this.state.drawConfig.eggMotorSpeed, 4000)))
        this.state.drawConfig.penDownSpeed = penDownSpeed
        this.state.drawConfig.penUpSpeed = penUpSpeed
        this.state.drawConfig.penMotorSpeed = penMotorSpeed
        this.state.drawConfig.eggMotorSpeed = eggMotorSpeed
        this.els.controlSpeedPenDown.value = String(penDownSpeed)
        this.els.controlSpeedPenUp.value = String(penUpSpeed)
        this.els.controlSpeedPenMotor.value = String(penMotorSpeed)
        this.els.controlSpeedEggMotor.value = String(eggMotorSpeed)

        this.state.drawConfig.penRaiseRate = Math.max(
            1,
            Math.min(100, AppController.#parseInteger(this.state.drawConfig.penRaiseRate, 50))
        )
        this.state.drawConfig.penLowerRate = Math.max(
            1,
            Math.min(100, AppController.#parseInteger(this.state.drawConfig.penLowerRate, 20))
        )
        this.state.drawConfig.penRaiseDelayMs = Math.max(
            0,
            Math.min(5000, AppController.#parseInteger(this.state.drawConfig.penRaiseDelayMs, 200))
        )
        this.state.drawConfig.penLowerDelayMs = Math.max(
            0,
            Math.min(5000, AppController.#parseInteger(this.state.drawConfig.penLowerDelayMs, 400))
        )
        this.els.controlPenRaiseRate.value = String(this.state.drawConfig.penRaiseRate)
        this.els.controlPenLowerRate.value = String(this.state.drawConfig.penLowerRate)
        this.els.controlDelayAfterRaise.value = String(this.state.drawConfig.penRaiseDelayMs)
        this.els.controlDelayAfterLower.value = String(this.state.drawConfig.penLowerDelayMs)

        this.state.drawConfig.reversePenMotor = Boolean(this.state.drawConfig.reversePenMotor)
        this.state.drawConfig.reverseEggMotor = Boolean(this.state.drawConfig.reverseEggMotor)
        this.state.drawConfig.wrapAround = this.state.drawConfig.wrapAround !== false
        this.state.drawConfig.returnHome = Boolean(this.state.drawConfig.returnHome)
        this.state.drawConfig.printColorMode = AppController.#normalizePrintColorMode(this.state.drawConfig.printColorMode)
        this.state.drawConfig.engraverEnabled = Boolean(this.state.drawConfig.engraverEnabled)
        this.state.drawConfig.curveSmoothing = Math.max(
            0,
            Math.min(2, AppController.#parseFloat(this.state.drawConfig.curveSmoothing, 0.2))
        )
        this.els.controlReversePenMotor.checked = this.state.drawConfig.reversePenMotor
        this.els.controlReverseEggMotor.checked = this.state.drawConfig.reverseEggMotor
        this.els.controlWrapsAround.checked = this.state.drawConfig.wrapAround
        this.els.controlReturnHome.checked = this.state.drawConfig.returnHome
        this.els.controlPrintColorModeSingle.checked = this.state.drawConfig.printColorMode === 'single'
        this.els.controlPrintColorModePerColor.checked = this.state.drawConfig.printColorMode === 'per-color'
        this.els.controlEnableEngraver.checked = this.state.drawConfig.engraverEnabled
        this.els.controlCurveSmoothing.value = this.state.drawConfig.curveSmoothing.toFixed(2)

        this.state.drawConfig.setupApplyAction = this.state.drawConfig.setupApplyAction === 'raise-off' ? 'raise-off' : 'toggle'
        this.els.controlSetupActionToggle.checked = this.state.drawConfig.setupApplyAction === 'toggle'
        this.els.controlSetupActionRaiseOff.checked = this.state.drawConfig.setupApplyAction === 'raise-off'

        const supportedCommands = [
            'disable-motors',
            'enable-motors',
            'raise-pen',
            'lower-pen',
            'walk-egg',
            'walk-pen',
            'query-version'
        ]
        const manualCommand = String(this.state.drawConfig.manualCommand || 'disable-motors')
        this.state.drawConfig.manualCommand = supportedCommands.includes(manualCommand) ? manualCommand : 'disable-motors'
        this.state.drawConfig.manualWalkDistance = Math.max(
            -64000,
            Math.min(64000, AppController.#parseInteger(this.state.drawConfig.manualWalkDistance, 3200))
        )
        this.els.controlManualCommand.value = this.state.drawConfig.manualCommand
        this.els.controlWalkDistance.value = String(this.state.drawConfig.manualWalkDistance)
    }

    /**
     * Converts one pen position percent (0-100) into a servo value.
     * @param {number} percent
     * @returns {number}
     */
    static #percentToServoValue(percent) {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0))
        const span = SERVO_VALUE_MAX - SERVO_VALUE_MIN
        return Math.round(SERVO_VALUE_MIN + (clamped / 100) * span)
    }

    /**
     * Converts one servo value into a pen position percentage.
     * @param {number} value
     * @returns {number}
     */
    static #servoValueToPercent(value) {
        const span = SERVO_VALUE_MAX - SERVO_VALUE_MIN
        if (span <= 0) return 0
        const normalized = ((Number(value) || SERVO_VALUE_MIN) - SERVO_VALUE_MIN) / span
        return Math.max(0, Math.min(100, normalized * 100))
    }

    /**
     * Schedules one deferred startup pass after first visible render.
     */
    #scheduleDeferredStartupTasks() {
        if (this.hasDeferredStartupTasksScheduled) return
        this.hasDeferredStartupTasksScheduled = true
        this.#scheduleIdleTask(
            'startup-local-projects',
            () => this.#refreshSavedProjectsSelect('', { preferIdle: true }),
            IDLE_TIMEOUT_STARTUP_LOCAL_PROJECTS_MS
        )
        this.#scheduleIdleTask('startup-webmcp', () => this.#initWebMcpBridge(), IDLE_TIMEOUT_STARTUP_WEBMCP_MS)
        this.#scheduleIdleTask('startup-workers', () => this.#warmupBackgroundWorkers(), IDLE_TIMEOUT_STARTUP_WORKERS_MS)
    }

    /**
     * Warms background workers so the first real task starts faster.
     */
    #warmupBackgroundWorkers() {
        try {
            this.patternComputeWorker.warmup()
        } catch (error) {
            console.warn('Pattern compute worker warmup failed:', error)
        }
        try {
            this.patternImportWorker.warmup()
        } catch (error) {
            console.warn('Pattern import worker warmup failed:', error)
        }
        if (!this.disableRenderWorker && this.renderBackendMode === 'worker') {
            try {
                this.patternRenderWorker.warmup()
            } catch (error) {
                console.warn('Pattern render worker warmup failed:', error)
            }
        }
        try {
            this.serial.warmupPathWorker()
        } catch (error) {
            console.warn('EggBot path worker warmup failed:', error)
        }
    }

    /**
     * Initializes texture render backend with worker-first fallback.
     */
    #initializeRenderBackend() {
        if (this.disableRenderWorker) {
            this.renderBackendMode = 'main'
            this.#ensureMainThreadRenderer(false)
            return
        }
        if (!PatternRenderWorkerClient.isSupported(this.els.textureCanvas)) {
            this.disableRenderWorker = true
            this.renderBackendMode = 'main'
            this.#ensureMainThreadRenderer(false)
            return
        }
        try {
            this.patternRenderWorker.init(this.els.textureCanvas)
            this.textureCanvasTransferredToWorker = true
            this.activeTextureCanvas = this.els.textureCanvas
            this.renderBackendMode = 'worker'
        } catch (error) {
            this.disableRenderWorker = true
            this.renderBackendMode = 'main'
            console.warn('Pattern render worker unavailable; falling back to main-thread renderer.', error)
            this.#ensureMainThreadRenderer(false)
        }
    }

    /**
     * Creates a main-thread renderer instance on DOM or detached fallback canvas.
     * @param {boolean} useFallbackCanvas
     */
    #ensureMainThreadRenderer(useFallbackCanvas) {
        const targetCanvas = this.#resolveMainThreadRenderCanvas(useFallbackCanvas)
        if (this.renderer2d?.canvas === targetCanvas) {
            this.activeTextureCanvas = targetCanvas
            return
        }
        this.renderer2d = new PatternRenderer2D(targetCanvas)
        this.activeTextureCanvas = targetCanvas
    }

    /**
     * Resolves the canvas used for main-thread texture rendering.
     * @param {boolean} useFallbackCanvas
     * @returns {HTMLCanvasElement}
     */
    #resolveMainThreadRenderCanvas(useFallbackCanvas) {
        if (!useFallbackCanvas) {
            return this.els.textureCanvas
        }
        if (!this.fallbackRenderCanvas) {
            this.fallbackRenderCanvas = document.createElement('canvas')
            this.fallbackRenderCanvas.width = this.els.textureCanvas.width
            this.fallbackRenderCanvas.height = this.els.textureCanvas.height
        }
        return this.fallbackRenderCanvas
    }

    /**
     * Switches to permanent main-thread render mode after worker failure.
     */
    #switchToMainThreadRenderBackend() {
        this.disableRenderWorker = true
        this.renderBackendMode = 'main'
        try {
            this.patternRenderWorker.dispose()
        } catch (_error) {
            // Ignore disposal races.
        }
        this.#ensureMainThreadRenderer(this.textureCanvasTransferredToWorker)
    }

    /**
     * Returns the currently active texture canvas for 3D updates.
     * @returns {HTMLCanvasElement}
     */
    #resolveActiveTextureCanvas() {
        return this.activeTextureCanvas || this.els.textureCanvas
    }

    /**
     * Schedules one named idle task and replaces any previous one with the same name.
     * @param {string} name
     * @param {(deadline: { didTimeout: boolean, timeRemaining: () => number }) => void} callback
     * @param {number} timeoutMs
     */
    #scheduleIdleTask(name, callback, timeoutMs) {
        this.#cancelIdleTask(name)
        let handle = null
        handle = IdleScheduler.schedule((deadline) => {
            if (this.idleTasks.get(name) !== handle) return
            this.idleTasks.delete(name)
            callback(deadline)
        }, { timeout: timeoutMs })
        this.idleTasks.set(name, handle)
    }

    /**
     * Cancels one pending named idle task.
     * @param {string} name
     */
    #cancelIdleTask(name) {
        const handle = this.idleTasks.get(name)
        if (!handle) return
        handle.cancel()
        this.idleTasks.delete(name)
    }

    /**
     * Cancels all pending idle tasks.
     */
    #cancelAllIdleTasks() {
        this.idleTasks.forEach((handle) => handle.cancel())
        this.idleTasks.clear()
    }

    /**
     * Marks project export/share artifacts as stale and schedules idle refresh.
     */
    #markProjectArtifactsDirty() {
        this.projectArtifactsRevision += 1
        this.projectArtifactsDirty = true
        this.#scheduleProjectArtifactsRefreshIdle()
        this.#scheduleSettingsPersistIdle()
    }

    /**
     * Schedules one idle save for current project settings.
     */
    #scheduleSettingsPersistIdle() {
        const revision = this.projectArtifactsRevision
        this.#scheduleIdleTask(
            'settings-persist',
            () => {
                if (revision !== this.projectArtifactsRevision) {
                    this.#scheduleSettingsPersistIdle()
                    return
                }
                this.#persistSettingsToLocalStorage()
            },
            IDLE_TIMEOUT_SETTINGS_PERSIST_MS
        )
    }

    /**
     * Persists current settings payload into localStorage.
     */
    #persistSettingsToLocalStorage() {
        try {
            if (!window?.localStorage) return
            const payload = ProjectIoUtils.buildProjectPayload(this.state)
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
        } catch (error) {
            console.warn('Failed to save settings to localStorage.', error)
        }
    }

    /**
     * Schedules idle refresh for cached project artifacts.
     */
    #scheduleProjectArtifactsRefreshIdle() {
        const revision = this.projectArtifactsRevision
        this.#scheduleIdleTask(
            'project-artifacts-refresh',
            () => {
                if (revision !== this.projectArtifactsRevision) {
                    this.#scheduleProjectArtifactsRefreshIdle()
                    return
                }
                this.#refreshProjectArtifactsCache(revision)
            },
            IDLE_TIMEOUT_PROJECT_ARTIFACTS_MS
        )
    }

    /**
     * Rebuilds cached project payload and share URL.
     * @param {number} revision
     */
    #refreshProjectArtifactsCache(revision) {
        const payload = ProjectIoUtils.buildProjectPayload(this.state)
        this.cachedProjectPayload = payload
        this.cachedProjectShareUrl = this.#buildProjectShareUrlFromPayload(payload)
        this.projectArtifactsCachedRevision = revision
        this.projectArtifactsDirty = false
    }

    /**
     * Returns the latest normalized project payload with sync fallback.
     * @returns {Record<string, any>}
     */
    #getProjectPayload() {
        if (
            !this.projectArtifactsDirty &&
            this.cachedProjectPayload &&
            this.projectArtifactsCachedRevision === this.projectArtifactsRevision
        ) {
            return this.cachedProjectPayload
        }
        this.#cancelIdleTask('project-artifacts-refresh')
        this.#refreshProjectArtifactsCache(this.projectArtifactsRevision)
        return this.cachedProjectPayload
    }

    /**
     * Returns cached share URL with sync fallback.
     * @returns {string}
     */
    #getShareUrlCached() {
        if (
            !this.projectArtifactsDirty &&
            this.cachedProjectShareUrl &&
            this.projectArtifactsCachedRevision === this.projectArtifactsRevision
        ) {
            return this.cachedProjectShareUrl
        }
        const payload = this.#getProjectPayload()
        this.cachedProjectShareUrl = this.#buildProjectShareUrlFromPayload(payload)
        return this.cachedProjectShareUrl
    }

    /**
     * Builds share URL using a prebuilt project payload.
     * @param {Record<string, any>} payload
     * @returns {string}
     */
    #buildProjectShareUrlFromPayload(payload) {
        const encoded = ProjectUrlUtils.encodeProjectPayloadParam(payload)
        const url = new URL(window.location.href)
        url.searchParams.set(ProjectUrlUtils.PROJECT_PARAM, encoded)
        return url.toString()
    }

    /**
     * Initializes WebMCP bridge registration with app command callbacks.
     */
    #initWebMcpBridge() {
        if (this.webMcpBridge) return
        try {
            this.webMcpBridge = new WebMcpBridge({
                commands: this.#createWebMcpCommands(),
                root: document
            })
            this.webMcpBridge.init()
        } catch (error) {
            console.error('WebMCP initialization failed:', error)
        }
    }

    /**
     * Builds command callbacks consumed by `WebMcpBridge`.
     * @returns {Record<string, (...args: any[]) => Promise<Record<string, any>> | Record<string, any>>}
     */
    #createWebMcpCommands() {
        return {
            getState: () => this.#webMcpGetState(),
            setDesignSettings: (args) => this.#webMcpSetDesignSettings(args),
            setColorSettings: (args) => this.#webMcpSetColorSettings(args),
            setMotifSettings: (args) => this.#webMcpSetMotifSettings(args),
            setDrawConfig: (args) => this.#webMcpSetDrawConfig(args),
            rerollSeed: () => this.#webMcpRerollSeed(),
            regeneratePattern: () => this.#webMcpRegeneratePattern(),
            importSvgText: (args) => this.#webMcpImportSvgText(args),
            applyProjectJson: (args) => this.#webMcpApplyProjectJson(args),
            getProjectJson: () => this.#webMcpGetProjectJson(),
            getShareUrl: () => this.#webMcpGetShareUrl(),
            buildExportSvg: () => this.#webMcpBuildExportSvg(),
            localProjectsList: () => this.#webMcpLocalProjectsList(),
            localProjectStore: (args) => this.#webMcpLocalProjectStore(args),
            localProjectLoad: (args) => this.#webMcpLocalProjectLoad(args),
            localProjectDelete: (args) => this.#webMcpLocalProjectDelete(args),
            serialConnect: () => this.#webMcpSerialConnect(),
            serialDisconnect: () => this.#webMcpSerialDisconnect(),
            serialDraw: () => this.#webMcpSerialDraw(),
            serialStop: () => this.#webMcpSerialStop(),
            setLocale: (args) => this.#webMcpSetLocale(args)
        }
    }

    /**
     * Loads last saved settings snapshot from localStorage, when available.
     */
    #loadSettingsFromLocalStorage() {
        try {
            if (!window?.localStorage) return
            const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
            this.#clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(parsed)
            this.state.strokes = []
            this.#markProjectArtifactsDirty()
        } catch (error) {
            console.warn('Failed to load settings from localStorage.', error)
        }
    }

    /**
     * Applies URL-embedded project if present.
     */
    #applyProjectFromUrl() {
        try {
            const source = ProjectUrlUtils.resolveProjectSource(new URLSearchParams(window.location.search))
            if (!source.kind || !source.value) return
            const payload = ProjectUrlUtils.decodeEmbeddedProjectParam(source.value)
            this.#clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(payload)
            this.state.strokes = []
            this.#markProjectArtifactsDirty()
            this.#syncControlsFromState()
            this.#setStatus(this.#t('messages.loadedFromSharedUrl'), 'success')
        } catch (error) {
            this.#setStatus(this.#t('messages.loadSharedFailed', { message: error.message }), 'error')
        }
    }
    /**
     * Binds UI event listeners.
     */
    #bindEvents() {
        this.els.localeSelect.addEventListener('change', () => {
            this.#handleLocaleChange(this.els.localeSelect.value)
        })
        this.els.projectName.addEventListener('input', () => {
            this.state.projectName = this.els.projectName.value.trim() || this.#t('project.defaultName')
            this.#markProjectArtifactsDirty()
        })
        this.els.preset.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.preset = this.els.preset.value
            this.state.motifs = AppRuntimeConfig.presetMotifs(this.state.preset)
            this.#syncMotifControls()
            this.#scheduleRender()
        })
        this.els.seed.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.seed = AppController.#parseInteger(this.els.seed.value, this.state.seed)
            this.#scheduleRender()
        })
        this.els.rerollSeed.addEventListener('click', () => {
            this.#clearImportedPattern()
            this.#rerollSeed()
            this.#renderPattern()
        })
        this.els.regenerate.addEventListener('click', () => {
            this.#clearImportedPattern()
            this.#rerollSeed()
            this.#renderPattern()
        })
        this.els.symmetry.addEventListener('input', () => {
            this.#clearImportedPattern()
            this.state.symmetry = AppController.#parseInteger(this.els.symmetry.value, this.state.symmetry)
            this.els.symmetryLabel.textContent = String(this.state.symmetry)
            this.#scheduleRender()
        })
        this.els.density.addEventListener('input', () => {
            this.#clearImportedPattern()
            this.state.density = AppController.#parseFloat(this.els.density.value, this.state.density)
            this.els.densityLabel.textContent = this.state.density.toFixed(2)
            this.#scheduleRender()
        })
        this.els.bands.addEventListener('input', () => {
            this.#clearImportedPattern()
            this.state.bands = AppController.#parseInteger(this.els.bands.value, this.state.bands)
            this.els.bandsLabel.textContent = String(this.state.bands)
            this.#scheduleRender()
        })
        this.els.ornamentSize.addEventListener('input', () => {
            this.#clearImportedPattern()
            const nextValue = AppController.#parseFloat(this.els.ornamentSize.value, this.state.ornamentSize)
            this.state.ornamentSize = Math.max(0.5, Math.min(2, nextValue))
            this.els.ornamentSizeLabel.textContent = this.state.ornamentSize.toFixed(2)
            this.#scheduleRender()
        })
        this.els.ornamentCount.addEventListener('input', () => {
            this.#clearImportedPattern()
            const nextValue = AppController.#parseFloat(this.els.ornamentCount.value, this.state.ornamentCount)
            this.state.ornamentCount = Math.max(0.5, Math.min(2, nextValue))
            this.els.ornamentCountLabel.textContent = this.state.ornamentCount.toFixed(2)
            this.#scheduleRender()
        })
        this.els.ornamentDistribution.addEventListener('input', () => {
            this.#clearImportedPattern()
            const nextValue = AppController.#parseFloat(
                this.els.ornamentDistribution.value,
                this.state.ornamentDistribution
            )
            this.state.ornamentDistribution = Math.max(0.6, Math.min(1.6, nextValue))
            this.els.ornamentDistributionLabel.textContent = this.state.ornamentDistribution.toFixed(2)
            this.#scheduleRender()
        })
        this.els.lineWidth.addEventListener('input', () => {
            this.state.lineWidth = AppController.#parseFloat(this.els.lineWidth.value, this.state.lineWidth)
            this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
            this.#scheduleRender()
        })
        this.els.importHeightScale.addEventListener('input', () => {
            const nextValue = AppController.#parseFloat(this.els.importHeightScale.value, this.state.importHeightScale)
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(nextValue)
            this.els.importHeightScaleLabel.textContent = this.state.importHeightScale.toFixed(2)
            this.#scheduleRender()
        })
        this.els.importHeightScale.addEventListener('change', async () => {
            if (!this.importedPattern?.svgText || this.isPatternImporting) return
            clearTimeout(this.renderDebounceTimer)
            this.isPatternImporting = true
            this.#syncPatternImportUi()
            this.#setStatus(this.#t('messages.patternImportParsing', { name: this.importedPattern.name }), 'loading')
            try {
                const parsed = await this.#parseImportedPattern(this.importedPattern.svgText)
                if (!this.importedPattern) return
                this.importedPattern.strokes = parsed.strokes
                this.importedPattern.heightRatio = parsed.heightRatio
                this.importedPattern.heightScale = this.state.importHeightScale
                this.#setStatus(this.#t('messages.patternImportPreparingPreview', { name: this.importedPattern.name }), 'loading')
                await this.#renderImportedPreviewAndWait()
                this.#setStatus(
                    this.#t('messages.patternImported', {
                        name: this.importedPattern.name,
                        count: this.state.strokes.length
                    }),
                    'success'
                )
            } catch (error) {
                if (error?.message === 'no-drawable-geometry') {
                    this.#setStatus(this.#t('messages.noDrawableGeometry'), 'error')
                } else if (error?.message === 'invalid-svg') {
                    this.#setStatus(this.#t('messages.invalidSvgFile'), 'error')
                } else if (error?.message === 'preview-timeout' || error?.message === 'preview-render-failed') {
                    this.#setStatus(this.#t('messages.previewPreparationFailed'), 'error')
                } else {
                    this.#setStatus(this.#t('messages.patternImportFailed', { message: error.message }), 'error')
                }
            } finally {
                this.isPatternImporting = false
                this.#syncPatternImportUi()
            }
        })
        this.els.showHorizontalLines.addEventListener('change', () => {
            this.state.showHorizontalLines = this.els.showHorizontalLines.checked
            this.#scheduleRender()
        })
        this.els.fillPatterns.addEventListener('change', () => {
            this.state.fillPatterns = this.els.fillPatterns.checked
            this.#scheduleRender()
        })
        this.els.baseColor.addEventListener('input', () => {
            this.state.baseColor = this.els.baseColor.value
            this.#scheduleRender()
        })
        this.els.colorCount.addEventListener('change', () => {
            this.#normalizePaletteLength(AppController.#parseInteger(this.els.colorCount.value, this.state.palette.length))
            this.#renderPaletteControls()
            this.#scheduleRender()
        })
        this.els.motifDots.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.dots = this.els.motifDots.checked
            this.#scheduleRender()
        })
        this.els.motifRays.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.rays = this.els.motifRays.checked
            this.#scheduleRender()
        })
        this.els.motifHoneycomb.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.honeycomb = this.els.motifHoneycomb.checked
            this.#scheduleRender()
        })
        this.els.motifWolfTeeth.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.wolfTeeth = this.els.motifWolfTeeth.checked
            this.#scheduleRender()
        })
        this.els.motifPine.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.pineBranch = this.els.motifPine.checked
            this.#scheduleRender()
        })
        this.els.motifDiamond.addEventListener('change', () => {
            this.#clearImportedPattern()
            this.state.motifs.diamonds = this.els.motifDiamond.checked
            this.#scheduleRender()
        })
        this.els.baudRate.addEventListener('change', () => {
            this.state.drawConfig.baudRate = Math.max(
                300,
                AppController.#parseInteger(this.els.baudRate.value, this.state.drawConfig.baudRate)
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.stepsPerTurn.addEventListener('change', () => {
            this.state.drawConfig.stepsPerTurn = Math.max(
                100,
                AppController.#parseInteger(this.els.stepsPerTurn.value, this.state.drawConfig.stepsPerTurn)
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.penRangeSteps.addEventListener('change', () => {
            this.state.drawConfig.penRangeSteps = Math.max(
                100,
                AppController.#parseInteger(this.els.penRangeSteps.value, this.state.drawConfig.penRangeSteps)
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.msPerStep.addEventListener('change', () => {
            this.state.drawConfig.msPerStep = AppController.#parseFloat(
                this.els.msPerStep.value,
                this.state.drawConfig.msPerStep
            )
            const derivedSpeed = Math.max(
                10,
                Math.min(4000, Math.round(1000 / Math.max(0.2, this.state.drawConfig.msPerStep || 1.8)))
            )
            this.state.drawConfig.penDownSpeed = derivedSpeed
            this.state.drawConfig.penUpSpeed = derivedSpeed
            this.els.controlSpeedPenDown.value = String(derivedSpeed)
            this.els.controlSpeedPenUp.value = String(derivedSpeed)
            this.#markProjectArtifactsDirty()
        })
        this.els.servoUp.addEventListener('change', () => {
            this.state.drawConfig.servoUp = AppController.#parseInteger(
                this.els.servoUp.value,
                this.state.drawConfig.servoUp
            )
            this.state.drawConfig.penUpPercent = AppController.#servoValueToPercent(this.state.drawConfig.servoUp)
            this.els.controlPenUpPercent.value = String(Math.round(this.state.drawConfig.penUpPercent))
            this.#markProjectArtifactsDirty()
        })
        this.els.servoDown.addEventListener('change', () => {
            this.state.drawConfig.servoDown = AppController.#parseInteger(
                this.els.servoDown.value,
                this.state.drawConfig.servoDown
            )
            this.state.drawConfig.penDownPercent = AppController.#servoValueToPercent(this.state.drawConfig.servoDown)
            this.els.controlPenDownPercent.value = String(Math.round(this.state.drawConfig.penDownPercent))
            this.#markProjectArtifactsDirty()
        })
        this.els.invertPen.addEventListener('change', () => {
            this.state.drawConfig.invertPen = this.els.invertPen.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPenUpPercent.addEventListener('change', () => {
            this.state.drawConfig.penUpPercent = Math.max(
                0,
                Math.min(100, AppController.#parseFloat(this.els.controlPenUpPercent.value, this.state.drawConfig.penUpPercent))
            )
            this.state.drawConfig.servoUp = AppController.#percentToServoValue(this.state.drawConfig.penUpPercent)
            this.els.servoUp.value = String(this.state.drawConfig.servoUp)
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPenDownPercent.addEventListener('change', () => {
            this.state.drawConfig.penDownPercent = Math.max(
                0,
                Math.min(
                    100,
                    AppController.#parseFloat(this.els.controlPenDownPercent.value, this.state.drawConfig.penDownPercent)
                )
            )
            this.state.drawConfig.servoDown = AppController.#percentToServoValue(this.state.drawConfig.penDownPercent)
            this.els.servoDown.value = String(this.state.drawConfig.servoDown)
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenDown.addEventListener('change', () => {
            this.state.drawConfig.penDownSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(this.els.controlSpeedPenDown.value, this.state.drawConfig.penDownSpeed))
            )
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, 1000 / this.state.drawConfig.penDownSpeed))
            this.els.msPerStep.value = this.state.drawConfig.msPerStep.toFixed(2)
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenUp.addEventListener('change', () => {
            this.state.drawConfig.penUpSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(this.els.controlSpeedPenUp.value, this.state.drawConfig.penUpSpeed))
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenMotor.addEventListener('change', () => {
            this.state.drawConfig.penMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    AppController.#parseInteger(this.els.controlSpeedPenMotor.value, this.state.drawConfig.penMotorSpeed)
                )
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSpeedEggMotor.addEventListener('change', () => {
            this.state.drawConfig.eggMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    AppController.#parseInteger(this.els.controlSpeedEggMotor.value, this.state.drawConfig.eggMotorSpeed)
                )
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPenRaiseRate.addEventListener('change', () => {
            this.state.drawConfig.penRaiseRate = Math.max(
                1,
                Math.min(100, AppController.#parseInteger(this.els.controlPenRaiseRate.value, this.state.drawConfig.penRaiseRate))
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlDelayAfterRaise.addEventListener('change', () => {
            this.state.drawConfig.penRaiseDelayMs = Math.max(
                0,
                Math.min(
                    5000,
                    AppController.#parseInteger(this.els.controlDelayAfterRaise.value, this.state.drawConfig.penRaiseDelayMs)
                )
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPenLowerRate.addEventListener('change', () => {
            this.state.drawConfig.penLowerRate = Math.max(
                1,
                Math.min(100, AppController.#parseInteger(this.els.controlPenLowerRate.value, this.state.drawConfig.penLowerRate))
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlDelayAfterLower.addEventListener('change', () => {
            this.state.drawConfig.penLowerDelayMs = Math.max(
                0,
                Math.min(
                    5000,
                    AppController.#parseInteger(this.els.controlDelayAfterLower.value, this.state.drawConfig.penLowerDelayMs)
                )
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlReversePenMotor.addEventListener('change', () => {
            this.state.drawConfig.reversePenMotor = this.els.controlReversePenMotor.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlReverseEggMotor.addEventListener('change', () => {
            this.state.drawConfig.reverseEggMotor = this.els.controlReverseEggMotor.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlWrapsAround.addEventListener('change', () => {
            this.state.drawConfig.wrapAround = this.els.controlWrapsAround.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlReturnHome.addEventListener('change', () => {
            this.state.drawConfig.returnHome = this.els.controlReturnHome.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPrintColorModeSingle.addEventListener('change', () => {
            if (!this.els.controlPrintColorModeSingle.checked) return
            this.state.drawConfig.printColorMode = 'single'
            this.#markProjectArtifactsDirty()
        })
        this.els.controlPrintColorModePerColor.addEventListener('change', () => {
            if (!this.els.controlPrintColorModePerColor.checked) return
            this.state.drawConfig.printColorMode = 'per-color'
            this.#markProjectArtifactsDirty()
        })
        this.els.controlEnableEngraver.addEventListener('change', () => {
            this.state.drawConfig.engraverEnabled = this.els.controlEnableEngraver.checked
            this.#markProjectArtifactsDirty()
        })
        this.els.controlCurveSmoothing.addEventListener('change', () => {
            this.state.drawConfig.curveSmoothing = Math.max(
                0,
                Math.min(2, AppController.#parseFloat(this.els.controlCurveSmoothing.value, this.state.drawConfig.curveSmoothing))
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSetupActionToggle.addEventListener('change', () => {
            if (!this.els.controlSetupActionToggle.checked) return
            this.state.drawConfig.setupApplyAction = 'toggle'
            this.#markProjectArtifactsDirty()
        })
        this.els.controlSetupActionRaiseOff.addEventListener('change', () => {
            if (!this.els.controlSetupActionRaiseOff.checked) return
            this.state.drawConfig.setupApplyAction = 'raise-off'
            this.#markProjectArtifactsDirty()
        })
        this.els.controlManualCommand.addEventListener('change', () => {
            const nextCommand = String(this.els.controlManualCommand.value || '').trim()
            const supportedCommands = [
                'disable-motors',
                'enable-motors',
                'raise-pen',
                'lower-pen',
                'walk-egg',
                'walk-pen',
                'query-version'
            ]
            this.state.drawConfig.manualCommand = supportedCommands.includes(nextCommand) ? nextCommand : 'disable-motors'
            this.#clearManualControlResult()
            this.#markProjectArtifactsDirty()
        })
        this.els.controlWalkDistance.addEventListener('change', () => {
            this.state.drawConfig.manualWalkDistance = Math.max(
                -64000,
                Math.min(64000, AppController.#parseInteger(this.els.controlWalkDistance.value, this.state.drawConfig.manualWalkDistance))
            )
            this.#markProjectArtifactsDirty()
        })
        this.els.eggbotControlOpen.addEventListener('click', () => this.#openEggBotControlDialog())
        this.els.eggbotDialogClose.addEventListener('click', () => this.#closeEggBotControlDialog())
        this.els.eggbotDialogCloseIcon.addEventListener('click', () => this.#closeEggBotControlDialog())
        this.els.eggbotDialogBackdrop.addEventListener('click', (event) => {
            if (event.target !== this.els.eggbotDialogBackdrop) return
            this.#closeEggBotControlDialog()
        })
        this.els.penColorDialogBackdrop.addEventListener('click', (event) => {
            if (event.target !== this.els.penColorDialogBackdrop) return
            this.#resolvePendingPenColorDialog(false)
        })
        this.els.penColorDialogClose.addEventListener('click', () => this.#resolvePendingPenColorDialog(false))
        this.els.penColorDialogCancel.addEventListener('click', () => this.#resolvePendingPenColorDialog(false))
        this.els.penColorDialogContinue.addEventListener('click', () => this.#resolvePendingPenColorDialog(true))
        this.els.eggbotDialog.addEventListener('click', (event) => this.#applyControlStepperAdjustment(event))
        this.els.eggbotDialogApply.addEventListener('click', () => {
            this.#applyEggBotControlCurrentTab().catch((error) => {
                this.#setStatus(this.#t('messages.controlDialogApplyFailed', { message: error.message }), 'error')
            })
        })
        this.els.eggbotTabButtons.forEach((button) => {
            button.addEventListener('click', () => this.#setEggBotControlTab(button.dataset.eggbotTab || 'plot'))
        })
        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return
            if (this.#isPenColorDialogOpen()) {
                this.#resolvePendingPenColorDialog(false)
                return
            }
            if (this.#isEggBotControlDialogOpen()) {
                this.#closeEggBotControlDialog()
            }
        })
        this.els.serialConnect.addEventListener('click', () => this.#connectSerial())
        this.els.serialDisconnect.addEventListener('click', () => this.#disconnectSerial())
        this.els.drawButton.addEventListener('click', () => this.#drawCurrentPattern())
        this.els.loadPattern.addEventListener('click', () => this.#loadPatternFromFile())
        this.els.stopButton.addEventListener('click', () => {
            this.serial.stop()
            this.#resolvePendingPenColorDialog(false)
            this.#setStatus(this.#t('messages.stopRequested'), 'info')
        })
        this.els.saveProject.addEventListener('click', () => this.#saveProjectToFile())
        this.els.exportSvg.addEventListener('click', () => this.#exportPatternToSvg())
        this.els.loadProject.addEventListener('click', () => this.#loadProjectFromFile())
        this.els.shareProject.addEventListener('click', () => this.#shareProjectUrl())
        if (this.els.storeLocal) {
            this.els.storeLocal.addEventListener('click', () => this.#storeProjectLocally())
        }
        if (this.els.localPatterns) {
            this.els.localPatterns.addEventListener('focus', () => this.#flushPendingSavedProjectsSelectRender())
            this.els.localPatterns.addEventListener('pointerdown', () => this.#flushPendingSavedProjectsSelectRender())
        }
        if (this.els.loadLocal) {
            this.els.loadLocal.addEventListener('click', () => this.#loadSelectedLocalProject())
        }
        if (this.els.deleteLocal) {
            this.els.deleteLocal.addEventListener('click', () => this.#deleteSelectedLocalProject())
        }
    }

    /**
     * Binds Web Serial lifecycle listeners.
     */
    #bindSerialLifecycleEvents() {
        if (!('serial' in navigator) || typeof navigator.serial?.addEventListener !== 'function') {
            return
        }

        navigator.serial.addEventListener('disconnect', (event) => {
            this.#handleSerialDisconnect(event)
        })
    }

    /**
     * Disposes all background worker resources.
     */
    #disposeBackgroundWorkers() {
        this.#cancelAllIdleTasks()
        this.pendingSavedProjectsSelectRender = null
        this.patternComputeWorker.dispose()
        this.patternImportWorker.dispose()
        this.patternRenderWorker.dispose()
        this.serial.disposePathWorker()
    }

    /**
     * Handles browser-level serial disconnect events for the active port.
     * @param {SerialConnectionEvent} event
     * @returns {Promise<void>}
     */
    async #handleSerialDisconnect(event) {
        const disconnectedPort = event?.port || null
        if (!this.serial.isCurrentPort(disconnectedPort)) {
            return
        }

        try {
            await this.serial.disconnect()
            this.isDrawing = false
            this.#setStatus(this.#t('messages.eggbotDisconnected'), 'info')
        } catch (error) {
            this.#setStatus(this.#t('messages.disconnectFailed', { message: error.message }), 'error')
        } finally {
            this.#resetDrawProgressUi()
            this.#syncConnectionUi()
        }
    }
    /**
     * Applies locale change and refreshes dynamic UI fragments.
     * @param {string} locale
     */
    #handleLocaleChange(locale) {
        this.i18n.setLocale(locale)
        this.#applyLocaleToUi()
        this.#renderPaletteControls()
        if (!this.isDrawing) {
            this.#resetDrawProgressUi()
        }
        const selectedLocalProjectId = this.els.localPatterns ? this.els.localPatterns.value : ''
        this.#refreshSavedProjectsSelect(selectedLocalProjectId, { preferIdle: false })
    }

    /**
     * Resolves currently active render height ratio.
     * @returns {number}
     */
    #resolveActiveRenderHeightRatio() {
        if (!this.importedPattern) {
            return PatternStrokeScaleUtils.clampRatio(this.state.importHeightScale)
        }
        return ImportedPatternScaleUtils.resolvePreviewHeightRatio({
            parsedHeightRatio: this.importedPattern.heightRatio,
            parsedHeightScale: this.importedPattern.heightScale,
            activeHeightScale: this.state.importHeightScale
        })
    }

    /**
     * Builds one worker-safe snapshot of generation settings.
     * @returns {Record<string, any>}
     */
    #buildGeneratedPatternWorkerState() {
        return {
            seed: this.state.seed,
            preset: this.state.preset,
            symmetry: this.state.symmetry,
            density: this.state.density,
            bands: this.state.bands,
            ornamentSize: this.state.ornamentSize,
            ornamentCount: this.state.ornamentCount,
            ornamentDistribution: this.state.ornamentDistribution,
            showHorizontalLines: this.state.showHorizontalLines,
            fillPatterns: this.state.fillPatterns,
            palette: Array.isArray(this.state.palette) ? [...this.state.palette] : [],
            motifs: {
                dots: Boolean(this.state?.motifs?.dots),
                rays: Boolean(this.state?.motifs?.rays),
                honeycomb: Boolean(this.state?.motifs?.honeycomb),
                wolfTeeth: Boolean(this.state?.motifs?.wolfTeeth),
                pineBranch: Boolean(this.state?.motifs?.pineBranch),
                diamonds: Boolean(this.state?.motifs?.diamonds)
            }
        }
    }

    /**
     * Builds the final stroke list that preview, draw, and export all share.
     * @returns {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>}
     */
    #buildRenderedStrokes() {
        const activeHeightRatio = this.#resolveActiveRenderHeightRatio()
        if (this.importedPattern) {
            const sourceHeightRatio = PatternStrokeScaleUtils.clampRatio(this.importedPattern.heightRatio)
            return PatternStrokeScaleUtils.rescaleStrokes(this.importedPattern.strokes, sourceHeightRatio, activeHeightRatio)
        }
        const generated = PatternGenerator.generate(this.state)
        return PatternStrokeScaleUtils.rescaleStrokes(generated, 1, activeHeightRatio)
    }

    /**
     * Builds one render-safe stroke list based on fill visibility settings.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>} strokes
     * @returns {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>}
     */
    #buildRenderInputStrokes(strokes) {
        const source = Array.isArray(strokes) ? strokes : []
        if (this.state.fillPatterns !== false) {
            return source
        }
        return source.map((stroke) => {
            if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) {
                return stroke
            }
            return {
                ...stroke,
                // Keep geometry unchanged while forcing transparent fill in any backend.
                fillAlpha: 0
            }
        })
    }

    /**
     * Regenerates the pattern and updates 2D/3D output.
     * @param {{ skipImportedStatus?: boolean }} [options]
     */
    #renderPattern(options = {}) {
        const skipImportedStatus = Boolean(options.skipImportedStatus)
        const importedSvgText = this.importedPattern ? String(this.importedPattern.svgText || '') : ''
        const importedSvgHeightRatio = this.#resolveActiveRenderHeightRatio()
        this.renderToken += 1
        const token = this.renderToken

        if (this.importedPattern || this.disableComputeWorker) {
            this.pendingGeneratedRenderPromise = null
            this.state.strokes = this.#buildRenderedStrokes()
            void this.#renderComputedPattern({
                token,
                importedSvgText,
                importedSvgHeightRatio,
                skipImportedStatus
            })
            return
        }

        const pending = this.#renderGeneratedPatternWithWorker({
            token,
            importedSvgText,
            importedSvgHeightRatio,
            skipImportedStatus
        })
        this.pendingGeneratedRenderPromise = pending
        pending.finally(() => {
            if (this.pendingGeneratedRenderPromise === pending) {
                this.pendingGeneratedRenderPromise = null
            }
        })
    }

    /**
     * Renders generated strokes through worker thread and ignores stale responses.
     * @param {{ token: number, importedSvgText: string, importedSvgHeightRatio: number, skipImportedStatus: boolean }} config
     * @returns {Promise<void>}
     */
    async #renderGeneratedPatternWithWorker(config) {
        try {
            const result = await this.patternComputeWorker.computeGeneratedRenderedStrokes({
                state: this.#buildGeneratedPatternWorkerState(),
                activeHeightRatio: config.importedSvgHeightRatio
            })
            if (config.token !== this.renderToken) return
            this.state.strokes = Array.isArray(result?.strokes) ? result.strokes : []
        } catch (error) {
            this.disableComputeWorker = true
            console.error('Pattern compute worker failed; falling back to main-thread compute.', error)
            if (config.token !== this.renderToken) return
            this.state.strokes = this.#buildRenderedStrokes()
        }

        if (config.token !== this.renderToken) return
        await this.#renderComputedPattern(config)
    }

    /**
     * Renders current stroke state into 2D + 3D output and updates status.
     * @param {{ token: number, importedSvgText: string, importedSvgHeightRatio: number, skipImportedStatus: boolean }} config
     * @returns {Promise<void>}
     */
    async #renderComputedPattern(config) {
        if (config.token !== this.renderToken) return
        const renderInput = {
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth,
            fillPatterns: this.state.fillPatterns,
            palette: this.state.palette,
            strokes: this.#buildRenderInputStrokes(this.state.strokes),
            importedSvgText: config.importedSvgText,
            importedSvgHeightRatio: config.importedSvgHeightRatio
        }

        try {
            const renderResult = await this.#renderTextureFrame(renderInput, config.token)
            if (renderResult?.stale || config.token !== this.renderToken) return
            if (!config.importedSvgText) {
                this.eggScene.updateTexture(this.#resolveActiveTextureCanvas())
            } else if (renderResult?.dispatchImportedRenderedEvent) {
                this.els.textureCanvas.dispatchEvent(new Event('pattern-rendered'))
            }
        } catch (error) {
            console.error('Pattern render failed.', error)
            if (config.importedSvgText && config.token === this.renderToken) {
                const reason = String(error?.code || error?.message || 'render-error')
                this.els.textureCanvas.dispatchEvent(new CustomEvent('pattern-render-failed', { detail: { reason } }))
            }
            return
        }

        this.#scheduleDeferredStartupTasks()
        if (config.skipImportedStatus) return
        if (this.importedPattern) {
            this.#setStatus(
                this.#t('messages.patternImported', {
                    name: this.importedPattern.name,
                    count: this.state.strokes.length
                }),
                'success'
            )
            return
        }
        this.#setStatus(this.#t('messages.patternGenerated', { count: this.state.strokes.length, seed: this.state.seed }), 'success')
    }

    /**
     * Renders one texture frame with worker-first fallback behavior.
     * @param {{ baseColor: string, lineWidth: number, fillPatterns?: boolean, palette: string[], strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, importedSvgText?: string, importedSvgHeightRatio?: number }} input
     * @param {number} token
     * @returns {Promise<{ stale?: boolean, dispatchImportedRenderedEvent?: boolean }>}
     */
    async #renderTextureFrame(input, token) {
        if (this.renderBackendMode === 'worker' && !this.disableRenderWorker) {
            try {
                const result = await this.patternRenderWorker.render(input, token)
                if (result?.stale || Number(result?.token) !== Number(token)) {
                    return { stale: true }
                }
                this.activeTextureCanvas = this.els.textureCanvas
                return {
                    dispatchImportedRenderedEvent: Boolean(input.importedSvgText)
                }
            } catch (error) {
                if (error?.code === 'imported-svg-raster-unsupported' && input.importedSvgText) {
                    console.warn('Render worker cannot rasterize imported SVG in this runtime. Using main-thread fallback for this render.')
                    return this.#renderWithMainThreadRenderer(input, this.textureCanvasTransferredToWorker)
                }
                console.warn('Render worker failed; switching to main-thread renderer.', error)
                this.#switchToMainThreadRenderBackend()
            }
        }

        return this.#renderWithMainThreadRenderer(input, this.textureCanvasTransferredToWorker)
    }

    /**
     * Renders one frame on main thread and proxies imported render events when needed.
     * @param {{ baseColor: string, lineWidth: number, fillPatterns?: boolean, palette: string[], strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, importedSvgText?: string, importedSvgHeightRatio?: number }} input
     * @param {boolean} useFallbackCanvas
     * @returns {Promise<{ dispatchImportedRenderedEvent: boolean }>}
     */
    async #renderWithMainThreadRenderer(input, useFallbackCanvas) {
        this.#ensureMainThreadRenderer(useFallbackCanvas)
        const rendererCanvas = this.renderer2d.canvas
        const proxyImportedEvents = rendererCanvas !== this.els.textureCanvas
        const importedSvgText = String(input.importedSvgText || '').trim()
        const hasImportedFallbackRaster = Boolean(importedSvgText && (!Array.isArray(input.strokes) || !input.strokes.length))

        if (hasImportedFallbackRaster) {
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
    async #renderImportedPreviewAndWait() {
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
                this.#renderPattern({ skipImportedStatus: true })
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }
    /**
     * Schedules a delayed render for slider/input changes.
     */
    #scheduleRender() {
        this.#markProjectArtifactsDirty()
        clearTimeout(this.renderDebounceTimer)
        this.renderDebounceTimer = window.setTimeout(() => {
            this.#renderPattern()
        }, 60)
    }
    /**
     * Randomizes seed and syncs input.
     */
    #rerollSeed() {
        this.state.seed = Math.floor(Math.random() * 2147483646) + 1
        this.els.seed.value = String(this.state.seed)
        this.#markProjectArtifactsDirty()
    }
    /**
     * Syncs all controls from the current state.
     */
    #syncControlsFromState() {
        if (!String(this.state.projectName || '').trim()) {
            this.state.projectName = this.#t('project.defaultName')
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
        this.state.ornamentSize = Math.max(0.5, Math.min(2, AppController.#parseFloat(this.state.ornamentSize, 1)))
        this.els.ornamentSize.value = String(this.state.ornamentSize)
        this.els.ornamentSizeLabel.textContent = this.state.ornamentSize.toFixed(2)
        this.state.ornamentCount = Math.max(0.5, Math.min(2, AppController.#parseFloat(this.state.ornamentCount, 1)))
        this.els.ornamentCount.value = String(this.state.ornamentCount)
        this.els.ornamentCountLabel.textContent = this.state.ornamentCount.toFixed(2)
        this.state.ornamentDistribution = Math.max(
            0.6,
            Math.min(1.6, AppController.#parseFloat(this.state.ornamentDistribution, 1))
        )
        this.els.ornamentDistribution.value = String(this.state.ornamentDistribution)
        this.els.ornamentDistributionLabel.textContent = this.state.ornamentDistribution.toFixed(2)
        this.els.lineWidth.value = String(this.state.lineWidth)
        this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
        this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(
            AppController.#parseFloat(this.state.importHeightScale, 0.85)
        )
        this.els.importHeightScale.value = String(this.state.importHeightScale)
        this.els.importHeightScaleLabel.textContent = this.state.importHeightScale.toFixed(2)
        this.els.showHorizontalLines.checked = this.state.showHorizontalLines !== false
        this.state.fillPatterns = this.state.fillPatterns !== false
        this.els.fillPatterns.checked = this.state.fillPatterns
        this.els.baseColor.value = this.state.baseColor
        this.#normalizePaletteLength(this.state.palette.length)
        this.els.colorCount.value = String(this.state.palette.length)
        this.#syncMotifControls()
        this.#renderPaletteControls()
        this.state.drawConfig.baudRate = this.#resolveSerialBaudRate()
        this.els.baudRate.value = String(this.state.drawConfig.baudRate)
        this.els.stepsPerTurn.value = String(this.state.drawConfig.stepsPerTurn)
        this.els.penRangeSteps.value = String(this.state.drawConfig.penRangeSteps)
        this.state.drawConfig.msPerStep = Math.max(
            0.2,
            Math.min(20, AppController.#parseFloat(this.state.drawConfig.msPerStep, 1.8))
        )
        this.els.msPerStep.value = this.state.drawConfig.msPerStep.toFixed(2)
        this.els.servoUp.value = String(this.state.drawConfig.servoUp)
        this.els.servoDown.value = String(this.state.drawConfig.servoDown)
        this.els.invertPen.checked = Boolean(this.state.drawConfig.invertPen)
        this.#syncEggBotDialogControlsFromState()
        const requestedTab = String(this.state?.drawConfig?.activeControlTab || this.activeEggBotControlTab || 'plot')
        this.activeEggBotControlTab = EGGBOT_CONTROL_TABS.includes(requestedTab) ? requestedTab : 'plot'
        this.#syncEggBotControlTabUi()
    }
    /**
     * Syncs motif checkbox states.
     */
    #syncMotifControls() {
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
    #renderPaletteControls() {
        this.els.paletteList.innerHTML = ''
        this.state.palette.forEach((color, index) => {
            const wrapper = document.createElement('label')
            wrapper.className = 'palette-item'
            wrapper.textContent = this.#t('colors.colorLabel', { index: index + 1 })
            const input = document.createElement('input')
            input.type = 'color'
            input.value = color
            input.dataset.index = String(index)
            input.addEventListener('input', () => {
                const targetIndex = AppController.#parseInteger(input.dataset.index, index)
                this.state.palette[targetIndex] = input.value
                this.#scheduleRender()
            })
            wrapper.appendChild(input)
            this.els.paletteList.appendChild(wrapper)
        })
    }
    /**
     * Ensures the palette array matches requested length.
     * @param {number} desiredCount
     */
    #normalizePaletteLength(desiredCount) {
        const defaultPalette = AppRuntimeConfig.getDefaultPalette()
        const count = Math.max(1, Math.min(6, desiredCount))
        while (this.state.palette.length < count) {
            this.state.palette.push(defaultPalette[this.state.palette.length % defaultPalette.length])
        }
        this.state.palette = this.state.palette.slice(0, count)
    }

    /**
     * Resolves the validated serial baud rate from draw configuration.
     * @returns {number}
     */
    #resolveSerialBaudRate() {
        return Math.max(300, AppController.#parseInteger(this.state?.drawConfig?.baudRate, 115200))
    }

    /**
     * Builds one ordered batch list based on current print color mode.
     * @param {Array<{ colorIndex?: number, points: Array<{u:number,v:number}> }>} strokes
     * @returns {Array<{ colorIndex: number | null, strokes: Array<{ colorIndex?: number, points: Array<{u:number,v:number}> }> }>}
     */
    #buildDrawColorBatches(strokes) {
        const sourceStrokes = Array.isArray(strokes) ? strokes : []
        const colorMode = AppController.#normalizePrintColorMode(this.state?.drawConfig?.printColorMode)
        if (colorMode !== 'per-color') {
            return [{ colorIndex: null, strokes: sourceStrokes }]
        }

        const byColor = new Map()
        sourceStrokes.forEach((stroke) => {
            const colorIndex = this.#resolveStrokeColorIndex(stroke)
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
    #resolveStrokeColorIndex(stroke) {
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
    #formatDrawColorLabel(colorIndex) {
        const normalizedIndex = this.#resolveStrokeColorIndex({ colorIndex })
        const label = this.#t('colors.colorLabel', { index: normalizedIndex + 1 })
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
    async #confirmDrawColorBatchReady(batchIndex, colorIndex) {
        const colorLabel = this.#formatDrawColorLabel(colorIndex)
        const isFirstBatch = batchIndex === 0
        const statusKey = isFirstBatch ? 'messages.waitingForPenColorStart' : 'messages.waitingForPenColorChange'
        const titleKey = isFirstBatch ? 'messages.penColorDialogTitleStart' : 'messages.penColorDialogTitleChange'
        const message = this.#t(statusKey, { color: colorLabel })
        this.#setStatus(message, 'info')
        if (this.pendingPenColorDialogResolve) {
            this.#resolvePendingPenColorDialog(false)
        }
        return new Promise((resolve) => {
            this.pendingPenColorDialogResolve = resolve
            this.#openPenColorDialog(this.#t(titleKey), message)
        })
    }

    /**
     * Opens Web Serial and refreshes UI.
     * @returns {Promise<void>}
     */
    async #connectSerial() {
        try {
            const version = await this.serial.connect({ baudRate: this.#resolveSerialBaudRate() })
            this.#setStatus(this.#t('messages.eggbotConnected', { version }), 'success')
            this.#syncConnectionUi()
        } catch (error) {
            this.#setStatus(this.#t('messages.serialConnectFailed', { message: error.message }), 'error')
            this.#syncConnectionUi()
        }
    }
    /**
     * Disconnects serial resources.
     * @returns {Promise<void>}
     */
    async #disconnectSerial() {
        try {
            await this.serial.disconnect()
            this.#setStatus(this.#t('messages.eggbotDisconnected'), 'info')
        } catch (error) {
            this.#setStatus(this.#t('messages.disconnectFailed', { message: error.message }), 'error')
        }
        this.#syncConnectionUi()
    }
    /**
     * Executes a draw run for current strokes.
     * @returns {Promise<void>}
     */
    async #drawCurrentPattern() {
        if (!(await this.#ensureRenderedStrokesReady())) {
            this.#setStatus(this.#t('messages.noPatternToDraw'), 'error')
            return
        }
        if (this.isDrawing) {
            return
        }

        const drawBatches = this.#buildDrawColorBatches(this.state.strokes)
        const totalStrokes = drawBatches.reduce((sum, batch) => sum + (Array.isArray(batch.strokes) ? batch.strokes.length : 0), 0)
        if (totalStrokes <= 0) {
            this.#setStatus(this.#t('messages.noPatternToDraw'), 'error')
            return
        }

        let connectingBeforeDraw = false
        let drawCanceledByUser = false
        let drawAbortedByStop = false
        this.isDrawing = true
        this.#syncConnectionUi()

        try {
            if (!this.serial.isConnected) {
                connectingBeforeDraw = true
                this.#setStatus(this.#t('messages.connectingBeforeDraw'), 'loading')
                const version = await this.serial.connectForDraw({ baudRate: this.#resolveSerialBaudRate() })
                connectingBeforeDraw = false
                this.#setStatus(this.#t('messages.eggbotConnected', { version }), 'success')
                this.#syncConnectionUi()
            }

            let lastProgressDone = -1
            let lastProgressTotal = -1
            let completedStrokes = 0
            let drawProgressStarted = false

            for (let batchIndex = 0; batchIndex < drawBatches.length; batchIndex += 1) {
                const batch = drawBatches[batchIndex]
                if (!Array.isArray(batch?.strokes) || batch.strokes.length <= 0) continue

                if (Number.isInteger(batch.colorIndex)) {
                    const confirmed = await this.#confirmDrawColorBatchReady(batchIndex, batch.colorIndex)
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
                    this.#startDrawProgressUi()
                    drawProgressStarted = true
                }

                const batchStrokeCount = batch.strokes.length
                const batchDrawConfig = {
                    ...this.state.drawConfig,
                    returnHome: Boolean(this.state.drawConfig.returnHome) && batchIndex === drawBatches.length - 1
                }

                await this.serial.drawStrokes(batch.strokes, batchDrawConfig, {
                    onStatus: (text) => this.#setStatus(text, 'info'),
                    onProgress: (done, _total, detail) => {
                        const normalizedDone = Math.max(0, Math.min(batchStrokeCount, Math.round(Number(done) || 0)))
                        const globalDone = Math.max(0, Math.min(totalStrokes, completedStrokes + normalizedDone))
                        if (globalDone !== lastProgressDone || totalStrokes !== lastProgressTotal) {
                            lastProgressDone = globalDone
                            lastProgressTotal = totalStrokes
                            this.#setStatus(this.#t('messages.drawingProgress', { done: globalDone, total: totalStrokes }), 'info')
                        }
                        const fallbackRemainingRatio = totalStrokes > 0 ? Math.max(0, 1 - globalDone / totalStrokes) : 0
                        const remainingRatio =
                            drawBatches.length === 1 && Number.isFinite(Number(detail?.remainingRatio))
                                ? Math.max(0, Math.min(1, Number(detail.remainingRatio)))
                                : fallbackRemainingRatio
                        const remainingMs =
                            drawBatches.length === 1 && Number.isFinite(Number(detail?.remainingMs))
                                ? Math.max(0, Number(detail.remainingMs))
                                : null
                        this.#updateDrawProgressUi(remainingRatio, remainingMs)
                    }
                })

                if (this.serial.abortDrawing) {
                    drawAbortedByStop = true
                    break
                }

                completedStrokes += batchStrokeCount
            }

            if (drawCanceledByUser) {
                this.#setStatus(this.#t('messages.drawCanceledByUser'), 'info')
            } else if (!drawAbortedByStop) {
                this.#setStatus(this.#t('messages.drawCompleted'), 'success')
            }
        } catch (error) {
            if (connectingBeforeDraw) {
                this.#setStatus(this.#t('messages.serialConnectFailed', { message: error.message }), 'error')
            } else if (drawCanceledByUser) {
                this.#setStatus(this.#t('messages.drawCanceledByUser'), 'info')
            } else {
                this.#setStatus(this.#t('messages.drawFailed', { message: error.message }), 'error')
            }
        } finally {
            this.#resolvePendingPenColorDialog(false)
            this.#closePenColorDialog()
            this.isDrawing = false
            this.#resetDrawProgressUi()
            this.#syncConnectionUi()
        }
    }
    /**
     * Syncs machine control button enabled states.
     */
    #syncConnectionUi() {
        const serialSupported = 'serial' in navigator
        const connected = this.serial.isConnected
        this.els.serialConnect.disabled = connected || this.isDrawing || !serialSupported
        this.els.serialDisconnect.disabled = !connected || this.isDrawing
        this.els.drawButton.disabled = this.isDrawing || !serialSupported
        this.els.stopButton.disabled = !this.isDrawing || !connected
    }
    /**
     * Syncs pattern import loading controls.
     */
    #syncPatternImportUi() {
        this.els.loadPattern.disabled = this.isPatternImporting
        this.els.loadPattern.setAttribute('aria-busy', this.isPatternImporting ? 'true' : 'false')
        this.els.status.setAttribute('aria-busy', this.isPatternImporting ? 'true' : 'false')
    }
    /**
     * Enables/disables auto-generated ornament controls for imported SVG mode.
     */
    #syncAutoGenerateOrnamentControlsUi() {
        const disableAutoGenerateOrnaments = Boolean(this.importedPattern)
        PatternImportControlUtils.setAutoGenerateOrnamentControlsDisabled(
            this.autoGenerateOrnamentControls,
            disableAutoGenerateOrnaments
        )
    }
    /**
     * Parses imported SVG in worker thread.
     * @param {string} svgText
     * @returns {Promise<{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio?: number }>}
     */
    async #parseImportedPattern(svgText) {
        return this.patternImportWorker.parse(svgText, {
            maxColors: 6,
            heightScale: this.state.importHeightScale,
            heightReference: IMPORT_HEIGHT_REFERENCE
        })
    }
    /**
     * Imports an SVG pattern file and switches render mode to imported strokes.
     * @returns {Promise<void>}
     */
    async #loadPatternFromFile() {
        let fileName = 'unknown.svg'
        try {
            if (this.isPatternImporting) return
            const file = await this.#promptForPatternFile()
            if (!file) {
                this.#setStatus(this.#t('messages.patternImportCanceled'), 'info')
                return
            }
            fileName = String(file.name || 'unknown.svg')
            this.isPatternImporting = true
            this.#syncPatternImportUi()
            this.#setStatus(this.#t('messages.patternImportReading', { name: fileName }), 'loading')
            const svgText = await file.text()
            this.#setStatus(this.#t('messages.patternImportParsing', { name: fileName }), 'loading')
            const parsed = await this.#parseImportedPattern(svgText)
            const importedProjectName =
                SvgProjectNameUtils.resolveProjectName(svgText, fileName) || this.#t('project.defaultName')
            this.state.projectName = importedProjectName
            this.els.projectName.value = importedProjectName
            this.importedPattern = {
                name: importedProjectName,
                strokes: parsed.strokes,
                svgText,
                heightRatio: parsed.heightRatio,
                heightScale: this.state.importHeightScale
            }
            this.#syncAutoGenerateOrnamentControlsUi()
            if (parsed.palette.length) {
                this.#normalizePaletteLength(Math.max(1, Math.min(6, parsed.palette.length)))
                parsed.palette.slice(0, this.state.palette.length).forEach((color, index) => {
                    this.state.palette[index] = color
                })
            }
            if (parsed.baseColor) {
                this.state.baseColor = parsed.baseColor
                this.els.baseColor.value = parsed.baseColor
            }
            this.els.colorCount.value = String(this.state.palette.length)
            this.#renderPaletteControls()
            this.#markProjectArtifactsDirty()
            this.#setStatus(this.#t('messages.patternImportPreparingPreview', { name: fileName }), 'loading')
            await this.#renderImportedPreviewAndWait()
            this.#setStatus(
                this.#t('messages.patternImported', {
                    name: importedProjectName,
                    count: this.state.strokes.length
                }),
                'success'
            )
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus(this.#t('messages.patternImportCanceled'), 'info')
                return
            }
            if (error?.message === 'no-drawable-geometry') {
                this.#setStatus(this.#t('messages.noDrawableGeometry'), 'error')
                return
            }
            if (error?.message === 'invalid-svg') {
                this.#setStatus(this.#t('messages.invalidSvgFile'), 'error')
                return
            }
            if (error?.message === 'preview-timeout' || error?.message === 'preview-render-failed') {
                this.#setStatus(this.#t('messages.previewPreparationFailed'), 'error')
                return
            }
            this.#setStatus(this.#t('messages.patternImportFailed', { message: error.message }), 'error')
        } finally {
            this.isPatternImporting = false
            this.#syncPatternImportUi()
        }
    }
    /**
     * Prompts for an SVG pattern file.
     * @returns {Promise<File | null>}
     */
    async #promptForPatternFile() {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: this.#t('messages.patternFileDescription'),
                        accept: { 'image/svg+xml': ['.svg'] }
                    }
                ]
            })
            return handle ? handle.getFile() : null
        }
        return new Promise((resolve) => {
            const input = this.els.patternInput
            const onChange = () => {
                cleanup()
                resolve(input.files?.[0] ?? null)
            }
            const onFocus = () => {
                window.setTimeout(() => {
                    cleanup()
                    resolve(null)
                }, 0)
            }
            const cleanup = () => {
                input.removeEventListener('change', onChange)
                window.removeEventListener('focus', onFocus)
            }
            input.value = ''
            input.addEventListener('change', onChange)
            window.addEventListener('focus', onFocus, { once: true })
            input.click()
        })
    }
    /**
     * Saves current project JSON to file.
     * @returns {Promise<void>}
     */
    async #saveProjectToFile() {
        const payload = this.#getProjectPayload()
        const contents = JSON.stringify(payload, null, 2)
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this.#t('project.defaultFileStem'),
            this.state.seed,
            'json'
        )
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: this.#t('messages.projectJsonDescription'),
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this.#setStatus(this.#t('messages.projectSaved', { name: handle.name || suggestedName }), 'success')
                return
            }
            const blob = new Blob([contents], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = suggestedName
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 0)
            this.#setStatus(this.#t('messages.projectDownloaded', { name: suggestedName }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus(this.#t('messages.saveCanceled'), 'info')
                return
            }
            this.#setStatus(this.#t('messages.saveFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Ensures a current rendered stroke set exists, including pending async worker runs.
     * @returns {Promise<boolean>}
     */
    async #ensureRenderedStrokesReady() {
        if (this.pendingGeneratedRenderPromise) {
            try {
                await this.pendingGeneratedRenderPromise
            } catch (error) {
                console.error('Generated render task failed while waiting for strokes.', error)
            }
        }
        if (!this.state.strokes.length) {
            this.#renderPattern({ skipImportedStatus: true })
            if (this.pendingGeneratedRenderPromise) {
                try {
                    await this.pendingGeneratedRenderPromise
                } catch (error) {
                    console.error('Generated render task failed while rebuilding strokes.', error)
                }
            }
        }
        return this.state.strokes.length > 0
    }

    /**
     * Builds SVG export content and default filename for current state.
     * @returns {Promise<{ contents: string, suggestedName: string }>}
     */
    async #buildSvgExportData() {
        const fileStem = ProjectFilenameUtils.buildFileStem(
            this.state.projectName,
            this.#t('project.defaultFileStem'),
            this.state.seed
        )
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this.#t('project.defaultFileStem'),
            this.state.seed,
            'svg'
        )
        const editorName = String(document?.title || 'eggbot-app').trim() || 'eggbot-app'
        const editorUrl = String(window?.location?.href || '').trim()
        const metadataTitle = String(this.state.projectName || this.#t('project.defaultFileStem')).trim() || 'Sorbian egg composition'
        const metadataDate = new Date().toISOString()
        const browserLanguage = typeof navigator !== 'undefined' ? String(navigator.language || '').trim() : ''
        const metadataLanguage = String(this.i18n?.locale || browserLanguage || 'en').trim() || 'en'
        const metadataRights = 'Copyright 2026 André Fiedler'
        const version = String(AppVersion.get() || '').trim() || '0.0.0'
        const svgInput = {
            strokes: this.state.strokes,
            palette: this.state.palette,
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth * 2.4,
            fillPatterns: this.state.fillPatterns,
            width: SVG_EXPORT_WIDTH,
            height: SVG_EXPORT_HEIGHT,
            editorName,
            editorUrl,
            metadata: {
                title: metadataTitle,
                date: metadataDate,
                creator: editorName,
                rights: metadataRights,
                publisher: editorName,
                identifier: `${fileStem}-${version}`,
                source: editorUrl || editorName,
                relation: editorUrl || editorName,
                language: metadataLanguage,
                keywords: ['sorbian', 'eggbot', 'ornament', `version-${version}`],
                coverage: `${SVG_EXPORT_WIDTH}x${SVG_EXPORT_HEIGHT}px`,
                description: `Generated with ${editorName} using eggbot-app ${version}`,
                contributors: [editorName]
            }
        }
        let contents = ''
        try {
            const result = await this.patternComputeWorker.buildExportSvg({ svgInput })
            contents = String(result?.contents || '')
        } catch (error) {
            console.warn('SVG export worker build failed; falling back to main-thread build.', error)
            contents = ''
        }
        if (!contents) {
            contents = PatternSvgExportUtils.buildSvg(svgInput)
        }
        return { contents, suggestedName }
    }

    /**
     * Exports the visible pattern as an SVG file.
     * @returns {Promise<void>}
     */
    async #exportPatternToSvg() {
        if (!(await this.#ensureRenderedStrokesReady())) {
            this.#setStatus(this.#t('messages.noPatternToDraw'), 'error')
            return
        }
        const { contents, suggestedName } = await this.#buildSvgExportData()

        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: this.#t('messages.svgFileDescription'),
                            accept: { 'image/svg+xml': ['.svg'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this.#setStatus(this.#t('messages.svgExported', { name: handle.name || suggestedName }), 'success')
                return
            }

            const blob = new Blob([contents], { type: 'image/svg+xml;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = suggestedName
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 0)
            this.#setStatus(this.#t('messages.svgDownloaded', { name: suggestedName }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus(this.#t('messages.svgExportCanceled'), 'info')
                return
            }
            this.#setStatus(this.#t('messages.svgExportFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Loads a project JSON file.
     * @returns {Promise<void>}
     */
    async #loadProjectFromFile() {
        try {
            const file = await this.#promptForProjectFile()
            if (!file) {
                this.#setStatus(this.#t('messages.loadCanceled'), 'info')
                return
            }
            const rawText = await file.text()
            const rawProject = JSON.parse(rawText)
            this.#clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(rawProject)
            this.state.strokes = []
            this.#markProjectArtifactsDirty()
            this.#syncControlsFromState()
            this.#renderPattern({ skipImportedStatus: true })
            await this.#ensureRenderedStrokesReady()
            this.#setStatus(this.#t('messages.loadedProject', { name: file.name }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus(this.#t('messages.loadCanceled'), 'info')
                return
            }
            this.#setStatus(this.#t('messages.loadFailed', { message: error.message }), 'error')
        }
    }
    /**
     * Prompts user for a project file.
     * @returns {Promise<File | null>}
     */
    async #promptForProjectFile() {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: this.#t('messages.projectJsonDescription'),
                        accept: { 'application/json': ['.json'] }
                    }
                ]
            })
            return handle ? handle.getFile() : null
        }
        return new Promise((resolve) => {
            const input = this.els.loadInput
            const onChange = () => {
                cleanup()
                resolve(input.files?.[0] ?? null)
            }
            const onFocus = () => {
                window.setTimeout(() => {
                    cleanup()
                    resolve(null)
                }, 0)
            }
            const cleanup = () => {
                input.removeEventListener('change', onChange)
                window.removeEventListener('focus', onFocus)
            }
            input.value = ''
            input.addEventListener('change', onChange)
            window.addEventListener('focus', onFocus, { once: true })
            input.click()
        })
    }
    /**
     * Shares current project as URL parameter.
     * @returns {Promise<void>}
     */
    async #shareProjectUrl() {
        try {
            const shareUrl = this.#getShareUrlCached()
            if (navigator.share) {
                await navigator.share({
                    title: this.state.projectName,
                    url: shareUrl
                })
                this.#setStatus(this.#t('messages.projectUrlShared'), 'success')
                return
            }
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl)
                this.#setStatus(this.#t('messages.projectUrlCopied'), 'success')
                return
            }
            window.prompt(this.#t('messages.copyProjectUrlPrompt'), shareUrl)
            this.#setStatus(this.#t('messages.projectUrlReady'), 'info')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus(this.#t('messages.shareCanceled'), 'info')
                return
            }
            this.#setStatus(this.#t('messages.shareFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Builds the current share URL with embedded project payload.
     * @returns {string}
     */
    #buildProjectShareUrl() {
        return this.#getShareUrlCached()
    }
    /**
     * Stores current project payload in localStorage.
     */
    #storeProjectLocally() {
        const name = window.prompt(
            this.#t('messages.storeProjectPrompt'),
            this.state.projectName || this.#t('project.defaultPatternName')
        )
        if (!name) {
            this.#setStatus(this.#t('messages.storeCanceled'), 'info')
            return
        }
        const entry = this.#storeProjectLocallyByName(name)
        this.#refreshSavedProjectsSelect(entry.id, { preferIdle: false })
        this.#setStatus(this.#t('messages.storedLocalProject', { name }), 'success')
    }
    /**
     * Loads selected local project.
     */
    #loadSelectedLocalProject() {
        if (!this.els.localPatterns) return
        this.#flushPendingSavedProjectsSelectRender()
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus(this.#t('messages.noLocalProjectSelected'), 'info')
            return
        }
        try {
            const entry = this.#loadLocalProjectById(selectedId)
            this.#setStatus(this.#t('messages.loadedLocalProject', { name: entry.name }), 'success')
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                this.#setStatus(this.#t('messages.localProjectNotFound'), 'error')
                this.#refreshSavedProjectsSelect('', { preferIdle: false })
                return
            }
            this.#setStatus(this.#t('messages.localLoadFailed', { message: error?.message || String(error) }), 'error')
        }
    }
    /**
     * Deletes the selected local project.
     */
    #deleteSelectedLocalProject() {
        if (!this.els.localPatterns) return
        this.#flushPendingSavedProjectsSelectRender()
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus(this.#t('messages.noLocalProjectSelectedForDelete'), 'info')
            return
        }
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this.#setStatus(this.#t('messages.localProjectNotFound'), 'error')
            this.#refreshSavedProjectsSelect('', { preferIdle: false })
            return
        }
        const confirmed = window.confirm(this.#t('messages.deleteLocalProjectConfirm', { name: entry.name }))
        if (!confirmed) {
            this.#setStatus(this.#t('messages.deleteCanceled'), 'info')
            return
        }
        this.#deleteLocalProjectById(selectedId)
        this.#refreshSavedProjectsSelect('', { preferIdle: false })
        this.#setStatus(this.#t('messages.deletedLocalProject', { name: entry.name }), 'success')
    }

    /**
     * Stores current project payload in localStorage under the provided name.
     * @param {string} rawName
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    #storeProjectLocallyByName(rawName) {
        const name = String(rawName || '').trim() || this.state.projectName || this.#t('project.defaultPatternName')
        const entries = this.#loadSavedProjects()
        const payload = this.#getProjectPayload()
        const entry = {
            id: `pattern-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            updatedAt: new Date().toISOString(),
            payload
        }
        entries.push(entry)
        this.#saveSavedProjects(entries)
        return entry
    }

    /**
     * Loads one local project entry by id and applies it to app state.
     * @param {string} projectId
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    #loadLocalProjectById(projectId) {
        const selectedId = String(projectId || '').trim()
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            throw new Error('local-project-not-found')
        }
        this.#clearImportedPattern()
        this.state = ProjectIoUtils.normalizeProjectState(entry.payload)
        this.state.strokes = []
        this.#markProjectArtifactsDirty()
        this.#syncControlsFromState()
        this.#renderPattern()
        return entry
    }

    /**
     * Deletes one local project entry by id.
     * @param {string} projectId
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    #deleteLocalProjectById(projectId) {
        const selectedId = String(projectId || '').trim()
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            throw new Error('local-project-not-found')
        }
        const filtered = entries.filter((candidate) => candidate.id !== selectedId)
        this.#saveSavedProjects(filtered)
        return entry
    }
    /**
     * Loads localStorage entries.
     * @returns {Array<{id: string, name: string, updatedAt: string, payload: Record<string, any>}>}
     */
    #loadSavedProjects() {
        try {
            const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
            if (!raw) return []
            const parsed = JSON.parse(raw)
            if (!Array.isArray(parsed)) return []
            return parsed.filter((entry) => {
                return (
                    entry &&
                    typeof entry === 'object' &&
                    typeof entry.id === 'string' &&
                    typeof entry.name === 'string' &&
                    typeof entry.updatedAt === 'string' &&
                    entry.payload &&
                    typeof entry.payload === 'object'
                )
            })
        } catch (_error) {
            return []
        }
    }
    /**
     * Saves local project entries.
     * @param {Array<{id: string, name: string, updatedAt: string, payload: Record<string, any>}>} entries
     */
    #saveSavedProjects(entries) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries.slice(-120)))
    }
    /**
     * Refreshes local project select options.
     * @param {string} [preferredId]
     * @param {{ preferIdle?: boolean }} [options]
     */
    #refreshSavedProjectsSelect(preferredId = '', options = {}) {
        if (!this.els.localPatterns) return
        const preferIdle = options?.preferIdle !== false
        const entries = this.#loadSavedProjects().sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt)
        })
        this.#cancelIdleTask('saved-projects-select-render')
        this.pendingSavedProjectsSelectRender = null
        this.els.localPatterns.innerHTML = ''
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = entries.length
            ? this.#t('local.choosePlaceholder')
            : this.#t('local.nonePlaceholder')
        this.els.localPatterns.appendChild(placeholder)

        if (!entries.length) {
            this.els.localPatterns.value = ''
            return
        }

        const shouldRenderInIdle = preferIdle && entries.length >= LOCAL_PROJECT_RENDER_IDLE_THRESHOLD
        if (!shouldRenderInIdle) {
            this.#renderSavedProjectsSelectOptionsSync(entries, preferredId)
            return
        }

        this.pendingSavedProjectsSelectRender = {
            entries,
            preferredId: String(preferredId || ''),
            nextIndex: 0
        }
        this.#scheduleIdleTask(
            'saved-projects-select-render',
            (deadline) => this.#continueSavedProjectsSelectRender(deadline),
            IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS
        )
    }

    /**
     * Flushes a pending chunked local-project select render synchronously.
     */
    #flushPendingSavedProjectsSelectRender() {
        if (!this.pendingSavedProjectsSelectRender || !this.els.localPatterns) return
        this.#cancelIdleTask('saved-projects-select-render')
        while (this.pendingSavedProjectsSelectRender) {
            this.#continueSavedProjectsSelectRender({
                didTimeout: false,
                timeRemaining: () => Number.POSITIVE_INFINITY
            })
        }
    }

    /**
     * Continues idle chunk rendering for local project options.
     * @param {{ didTimeout: boolean, timeRemaining: () => number }} deadline
     */
    #continueSavedProjectsSelectRender(deadline) {
        if (!this.pendingSavedProjectsSelectRender || !this.els.localPatterns) return
        const state = this.pendingSavedProjectsSelectRender
        const fragment = document.createDocumentFragment()
        let renderedInThisPass = 0
        while (state.nextIndex < state.entries.length) {
            if (renderedInThisPass >= LOCAL_PROJECT_RENDER_IDLE_CHUNK_SIZE) {
                break
            }
            if (!deadline.didTimeout && deadline.timeRemaining() <= 1) {
                break
            }
            fragment.appendChild(this.#buildSavedProjectsSelectOption(state.entries[state.nextIndex]))
            state.nextIndex += 1
            renderedInThisPass += 1
        }
        this.els.localPatterns.appendChild(fragment)

        if (state.nextIndex >= state.entries.length) {
            const preferredId = state.preferredId
            this.pendingSavedProjectsSelectRender = null
            if (preferredId) {
                this.els.localPatterns.value = preferredId
            } else {
                this.els.localPatterns.value = ''
            }
            return
        }

        this.#scheduleIdleTask(
            'saved-projects-select-render',
            (nextDeadline) => this.#continueSavedProjectsSelectRender(nextDeadline),
            IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS
        )
    }

    /**
     * Renders all local project options synchronously.
     * @param {Array<{id: string, name: string, updatedAt: string, payload: Record<string, any>}>} entries
     * @param {string} preferredId
     */
    #renderSavedProjectsSelectOptionsSync(entries, preferredId) {
        const fragment = document.createDocumentFragment()
        entries.forEach((entry) => {
            fragment.appendChild(this.#buildSavedProjectsSelectOption(entry))
        })
        this.els.localPatterns.appendChild(fragment)
        if (preferredId) {
            this.els.localPatterns.value = preferredId
            return
        }
        this.els.localPatterns.value = ''
    }

    /**
     * Builds one local project select option.
     * @param {{ id: string, name: string, updatedAt: string }} entry
     * @returns {HTMLOptionElement}
     */
    #buildSavedProjectsSelectOption(entry) {
        const option = document.createElement('option')
        option.value = entry.id
        option.textContent = this.#t('local.entryLabel', {
            name: entry.name,
            updatedAt: new Date(entry.updatedAt).toLocaleString(this.i18n.locale)
        })
        return option
    }

    /**
     * Returns a normalized snapshot for WebMCP tools.
     * @returns {Record<string, any>}
     */
    #webMcpStateSnapshot() {
        const project = this.#getProjectPayload()
        return {
            ...project,
            strokesCount: Array.isArray(this.state.strokes) ? this.state.strokes.length : 0,
            serialConnected: Boolean(this.serial?.isConnected),
            isDrawing: Boolean(this.isDrawing),
            importedPatternActive: Boolean(this.importedPattern),
            importedPatternName: this.importedPattern ? String(this.importedPattern.name || '') : '',
            locale: this.i18n.locale,
            appVersion: AppVersion.get()
        }
    }

    /**
     * Reads current state for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpGetState() {
        return this.#webMcpStateSnapshot()
    }

    /**
     * Applies design setting patches from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpSetDesignSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false
        let didMutateState = false
        const shouldRerollSeed = AppController.#parseBoolean(patch.rerollSeed, false)
        const shouldRegenerate = AppController.#parseBoolean(patch.regenerate, false)
        const hasGenerationPatch =
            Object.hasOwn(patch, 'preset') ||
            Object.hasOwn(patch, 'seed') ||
            Object.hasOwn(patch, 'symmetry') ||
            Object.hasOwn(patch, 'density') ||
            Object.hasOwn(patch, 'bands') ||
            Object.hasOwn(patch, 'ornamentSize') ||
            Object.hasOwn(patch, 'ornamentCount') ||
            Object.hasOwn(patch, 'ornamentDistribution')

        if (hasGenerationPatch) {
            this.#clearImportedPattern()
        }

        if (Object.hasOwn(patch, 'preset')) {
            this.state.preset = String(patch.preset || this.state.preset)
            this.state.motifs = AppRuntimeConfig.presetMotifs(this.state.preset)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'seed')) {
            this.state.seed = AppController.#parseInteger(patch.seed, this.state.seed)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'symmetry')) {
            this.state.symmetry = Math.max(2, Math.min(24, AppController.#parseInteger(patch.symmetry, this.state.symmetry)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'density')) {
            this.state.density = Math.max(0.05, Math.min(1, AppController.#parseFloat(patch.density, this.state.density)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'bands')) {
            this.state.bands = Math.max(1, Math.min(16, AppController.#parseInteger(patch.bands, this.state.bands)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentSize')) {
            const nextValue = AppController.#parseFloat(patch.ornamentSize, this.state.ornamentSize)
            this.state.ornamentSize = Math.max(0.5, Math.min(2, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentCount')) {
            const nextValue = AppController.#parseFloat(patch.ornamentCount, this.state.ornamentCount)
            this.state.ornamentCount = Math.max(0.5, Math.min(2, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentDistribution')) {
            const nextValue = AppController.#parseFloat(patch.ornamentDistribution, this.state.ornamentDistribution)
            this.state.ornamentDistribution = Math.max(0.6, Math.min(1.6, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'lineWidth')) {
            this.state.lineWidth = Math.max(0.5, Math.min(4, AppController.#parseFloat(patch.lineWidth, this.state.lineWidth)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'importHeightScale')) {
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(
                AppController.#parseFloat(patch.importHeightScale, this.state.importHeightScale)
            )
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'showHorizontalLines')) {
            this.state.showHorizontalLines = AppController.#parseBoolean(patch.showHorizontalLines, this.state.showHorizontalLines)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'fillPatterns')) {
            this.state.fillPatterns = AppController.#parseBoolean(patch.fillPatterns, this.state.fillPatterns)
            shouldRender = true
            didMutateState = true
        }

        if (shouldRerollSeed) {
            this.#clearImportedPattern()
            this.#rerollSeed()
            shouldRender = true
        }
        if (shouldRegenerate) {
            shouldRender = true
        }

        if (didMutateState && !shouldRerollSeed) {
            this.#markProjectArtifactsDirty()
        }
        this.#syncControlsFromState()
        if (shouldRender) {
            this.#renderPattern()
        }

        return {
            message: 'Design settings updated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Applies color settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpSetColorSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false

        if (Object.hasOwn(patch, 'baseColor')) {
            this.state.baseColor = String(patch.baseColor || this.state.baseColor)
            shouldRender = true
        }
        if (Array.isArray(patch.palette) && patch.palette.length) {
            const normalizedPalette = patch.palette
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .slice(0, 6)
            if (normalizedPalette.length) {
                this.state.palette = normalizedPalette
                this.#normalizePaletteLength(normalizedPalette.length)
                shouldRender = true
            }
        }

        if (shouldRender) {
            this.#markProjectArtifactsDirty()
        }
        this.#syncControlsFromState()
        if (shouldRender) {
            this.#renderPattern()
        }

        return {
            message: 'Color settings updated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Applies motif toggle settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpSetMotifSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false
        const motifPatchKeys = ['dots', 'rays', 'honeycomb', 'wolfTeeth', 'pineBranch', 'diamonds']
        if (motifPatchKeys.some((key) => Object.hasOwn(patch, key))) {
            this.#clearImportedPattern()
        }

        if (Object.hasOwn(patch, 'dots')) {
            this.state.motifs.dots = AppController.#parseBoolean(patch.dots, this.state.motifs.dots)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'rays')) {
            this.state.motifs.rays = AppController.#parseBoolean(patch.rays, this.state.motifs.rays)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'honeycomb')) {
            this.state.motifs.honeycomb = AppController.#parseBoolean(patch.honeycomb, this.state.motifs.honeycomb)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'wolfTeeth')) {
            this.state.motifs.wolfTeeth = AppController.#parseBoolean(patch.wolfTeeth, this.state.motifs.wolfTeeth)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'pineBranch')) {
            this.state.motifs.pineBranch = AppController.#parseBoolean(patch.pineBranch, this.state.motifs.pineBranch)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'diamonds')) {
            this.state.motifs.diamonds = AppController.#parseBoolean(patch.diamonds, this.state.motifs.diamonds)
            shouldRender = true
        }

        if (shouldRender) {
            this.#markProjectArtifactsDirty()
        }
        this.#syncControlsFromState()
        if (shouldRender) {
            this.#renderPattern()
        }

        return {
            message: 'Motif settings updated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Applies draw configuration settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpSetDrawConfig(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let didMutateState = false

        if (Object.hasOwn(patch, 'baudRate')) {
            this.state.drawConfig.baudRate = Math.max(
                300,
                AppController.#parseInteger(patch.baudRate, this.state.drawConfig.baudRate)
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'stepsPerTurn')) {
            this.state.drawConfig.stepsPerTurn = Math.max(
                100,
                AppController.#parseInteger(patch.stepsPerTurn, this.state.drawConfig.stepsPerTurn)
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRangeSteps')) {
            this.state.drawConfig.penRangeSteps = Math.max(
                100,
                AppController.#parseInteger(patch.penRangeSteps, this.state.drawConfig.penRangeSteps)
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'msPerStep')) {
            const nextValue = AppController.#parseFloat(patch.msPerStep, this.state.drawConfig.msPerStep)
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, nextValue))
            const derivedSpeed = Math.max(10, Math.min(4000, Math.round(1000 / this.state.drawConfig.msPerStep)))
            this.state.drawConfig.penDownSpeed = derivedSpeed
            this.state.drawConfig.penUpSpeed = derivedSpeed
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'servoUp')) {
            this.state.drawConfig.servoUp = Math.max(0, AppController.#parseInteger(patch.servoUp, this.state.drawConfig.servoUp))
            this.state.drawConfig.penUpPercent = AppController.#servoValueToPercent(this.state.drawConfig.servoUp)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'servoDown')) {
            this.state.drawConfig.servoDown = Math.max(
                0,
                AppController.#parseInteger(patch.servoDown, this.state.drawConfig.servoDown)
            )
            this.state.drawConfig.penDownPercent = AppController.#servoValueToPercent(this.state.drawConfig.servoDown)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'invertPen')) {
            this.state.drawConfig.invertPen = AppController.#parseBoolean(patch.invertPen, this.state.drawConfig.invertPen)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penUpPercent')) {
            this.state.drawConfig.penUpPercent = Math.max(
                0,
                Math.min(100, AppController.#parseFloat(patch.penUpPercent, this.state.drawConfig.penUpPercent))
            )
            this.state.drawConfig.servoUp = AppController.#percentToServoValue(this.state.drawConfig.penUpPercent)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penDownPercent')) {
            this.state.drawConfig.penDownPercent = Math.max(
                0,
                Math.min(100, AppController.#parseFloat(patch.penDownPercent, this.state.drawConfig.penDownPercent))
            )
            this.state.drawConfig.servoDown = AppController.#percentToServoValue(this.state.drawConfig.penDownPercent)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penDownSpeed')) {
            this.state.drawConfig.penDownSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(patch.penDownSpeed, this.state.drawConfig.penDownSpeed))
            )
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, 1000 / this.state.drawConfig.penDownSpeed))
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penUpSpeed')) {
            this.state.drawConfig.penUpSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(patch.penUpSpeed, this.state.drawConfig.penUpSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penMotorSpeed')) {
            this.state.drawConfig.penMotorSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(patch.penMotorSpeed, this.state.drawConfig.penMotorSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'eggMotorSpeed')) {
            this.state.drawConfig.eggMotorSpeed = Math.max(
                10,
                Math.min(4000, AppController.#parseInteger(patch.eggMotorSpeed, this.state.drawConfig.eggMotorSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRaiseRate')) {
            this.state.drawConfig.penRaiseRate = Math.max(
                1,
                Math.min(100, AppController.#parseInteger(patch.penRaiseRate, this.state.drawConfig.penRaiseRate))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRaiseDelayMs')) {
            this.state.drawConfig.penRaiseDelayMs = Math.max(
                0,
                Math.min(5000, AppController.#parseInteger(patch.penRaiseDelayMs, this.state.drawConfig.penRaiseDelayMs))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penLowerRate')) {
            this.state.drawConfig.penLowerRate = Math.max(
                1,
                Math.min(100, AppController.#parseInteger(patch.penLowerRate, this.state.drawConfig.penLowerRate))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penLowerDelayMs')) {
            this.state.drawConfig.penLowerDelayMs = Math.max(
                0,
                Math.min(5000, AppController.#parseInteger(patch.penLowerDelayMs, this.state.drawConfig.penLowerDelayMs))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'reversePenMotor')) {
            this.state.drawConfig.reversePenMotor = AppController.#parseBoolean(
                patch.reversePenMotor,
                this.state.drawConfig.reversePenMotor
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'reverseEggMotor')) {
            this.state.drawConfig.reverseEggMotor = AppController.#parseBoolean(
                patch.reverseEggMotor,
                this.state.drawConfig.reverseEggMotor
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'wrapAround')) {
            this.state.drawConfig.wrapAround = AppController.#parseBoolean(patch.wrapAround, this.state.drawConfig.wrapAround)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'returnHome')) {
            this.state.drawConfig.returnHome = AppController.#parseBoolean(patch.returnHome, this.state.drawConfig.returnHome)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'printColorMode')) {
            this.state.drawConfig.printColorMode = AppController.#normalizePrintColorMode(patch.printColorMode)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'engraverEnabled')) {
            this.state.drawConfig.engraverEnabled = AppController.#parseBoolean(
                patch.engraverEnabled,
                this.state.drawConfig.engraverEnabled
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'curveSmoothing')) {
            this.state.drawConfig.curveSmoothing = Math.max(
                0,
                Math.min(2, AppController.#parseFloat(patch.curveSmoothing, this.state.drawConfig.curveSmoothing))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'setupApplyAction')) {
            this.state.drawConfig.setupApplyAction = String(patch.setupApplyAction || '').trim().toLowerCase() === 'raise-off'
                ? 'raise-off'
                : 'toggle'
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'manualCommand')) {
            const nextCommand = String(patch.manualCommand || '').trim()
            const supportedCommands = [
                'disable-motors',
                'enable-motors',
                'raise-pen',
                'lower-pen',
                'walk-egg',
                'walk-pen',
                'query-version'
            ]
            this.state.drawConfig.manualCommand = supportedCommands.includes(nextCommand)
                ? nextCommand
                : this.state.drawConfig.manualCommand
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'manualWalkDistance')) {
            this.state.drawConfig.manualWalkDistance = Math.max(
                -64000,
                Math.min(
                    64000,
                    AppController.#parseInteger(patch.manualWalkDistance, this.state.drawConfig.manualWalkDistance)
                )
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'activeControlTab')) {
            const requestedTab = String(patch.activeControlTab || '').trim()
            if (EGGBOT_CONTROL_TABS.includes(requestedTab)) {
                this.state.drawConfig.activeControlTab = requestedTab
                this.activeEggBotControlTab = requestedTab
                didMutateState = true
            }
        }

        if (didMutateState) {
            this.#markProjectArtifactsDirty()
        }

        this.#syncControlsFromState()
        return {
            message: 'Draw configuration updated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Rerolls seed and renders for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpRerollSeed() {
        this.#clearImportedPattern()
        this.#rerollSeed()
        this.#renderPattern()
        return {
            message: 'Seed rerolled and pattern regenerated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Re-renders pattern for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpRegeneratePattern() {
        this.#renderPattern()
        return {
            message: 'Pattern regenerated.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Imports SVG text from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Promise<Record<string, any>>}
     */
    async #webMcpImportSvgText(args) {
        const svgText = String(args?.svgText || '').trim()
        if (!svgText) {
            throw new Error('Missing svgText.')
        }
        const fileName = String(args?.fileName || 'webmcp-import.svg')
        const importedProjectName = SvgProjectNameUtils.resolveProjectName(svgText, fileName) || this.#t('project.defaultName')
        if (Object.hasOwn(args || {}, 'importHeightScale')) {
            const nextScale = AppController.#parseFloat(args.importHeightScale, this.state.importHeightScale)
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(nextScale)
            this.#markProjectArtifactsDirty()
        }

        this.isPatternImporting = true
        this.#syncPatternImportUi()
        this.#setStatus(this.#t('messages.patternImportParsing', { name: fileName }), 'loading')
        try {
            const parsed = await this.#parseImportedPattern(svgText)
            this.state.projectName = importedProjectName
            this.importedPattern = {
                name: importedProjectName,
                strokes: parsed.strokes,
                svgText,
                heightRatio: parsed.heightRatio,
                heightScale: this.state.importHeightScale
            }
            this.#syncAutoGenerateOrnamentControlsUi()
            if (parsed.palette.length) {
                this.#normalizePaletteLength(Math.max(1, Math.min(6, parsed.palette.length)))
                parsed.palette.slice(0, this.state.palette.length).forEach((color, index) => {
                    this.state.palette[index] = color
                })
            }
            if (parsed.baseColor) {
                this.state.baseColor = parsed.baseColor
            }
            this.#markProjectArtifactsDirty()
            this.#syncControlsFromState()
            this.#setStatus(this.#t('messages.patternImportPreparingPreview', { name: fileName }), 'loading')
            await this.#renderImportedPreviewAndWait()
            this.#setStatus(
                this.#t('messages.patternImported', {
                    name: fileName,
                    count: this.state.strokes.length
                }),
                'success'
            )
            return {
                message: `Imported SVG pattern: ${fileName}.`,
                data: {
                    fileName,
                    projectName: importedProjectName,
                    strokeCount: this.state.strokes.length
                },
                state: this.#webMcpStateSnapshot()
            }
        } finally {
            this.isPatternImporting = false
            this.#syncPatternImportUi()
        }
    }

    /**
     * Applies project JSON content from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpApplyProjectJson(args) {
        const candidate = args?.project
        let projectValue = candidate
        if (typeof candidate === 'string') {
            const text = candidate.trim()
            if (!text) {
                throw new Error('Project JSON text is empty.')
            }
            projectValue = JSON.parse(text)
        }
        this.#clearImportedPattern()
        this.state = ProjectIoUtils.normalizeProjectState(projectValue)
        this.state.strokes = []
        this.#markProjectArtifactsDirty()
        this.#syncControlsFromState()
        this.#renderPattern()
        return {
            message: 'Project applied from JSON.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Returns normalized project JSON payload for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpGetProjectJson() {
        const payload = this.#getProjectPayload()
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this.#t('project.defaultFileStem'),
            this.state.seed,
            'json'
        )
        return {
            message: 'Project JSON payload ready.',
            data: {
                project: payload,
                jsonText: JSON.stringify(payload, null, 2),
                suggestedName
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Returns share URL for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpGetShareUrl() {
        const shareUrl = this.#buildProjectShareUrl()
        return {
            message: 'Share URL ready.',
            data: {
                shareUrl
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Returns SVG export text for WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async #webMcpBuildExportSvg() {
        if (!(await this.#ensureRenderedStrokesReady())) {
            throw new Error('No pattern available to export.')
        }
        const { contents, suggestedName } = await this.#buildSvgExportData()
        return {
            message: 'SVG export payload ready.',
            data: {
                svgText: contents,
                suggestedName
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Lists local projects for WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpLocalProjectsList() {
        const entries = this.#loadSavedProjects()
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map((entry) => ({
                id: entry.id,
                name: entry.name,
                updatedAt: entry.updatedAt
            }))
        return {
            message: `Loaded ${entries.length} local project entries.`,
            data: {
                entries
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Stores current project in local storage for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpLocalProjectStore(args) {
        const name = String(args?.name || '').trim()
        if (!name) {
            throw new Error('Missing local project name.')
        }
        const entry = this.#storeProjectLocallyByName(name)
        this.#refreshSavedProjectsSelect(entry.id, { preferIdle: false })
        return {
            message: `Stored local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Loads one local project for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpLocalProjectLoad(args) {
        const id = String(args?.id || '').trim()
        if (!id) {
            throw new Error('Missing local project id.')
        }
        let entry
        try {
            entry = this.#loadLocalProjectById(id)
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                throw new Error('Local project not found.')
            }
            throw error
        }
        this.#refreshSavedProjectsSelect(id, { preferIdle: false })
        return {
            message: `Loaded local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Deletes one local project for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpLocalProjectDelete(args) {
        const id = String(args?.id || '').trim()
        if (!id) {
            throw new Error('Missing local project id.')
        }
        let entry
        try {
            entry = this.#deleteLocalProjectById(id)
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                throw new Error('Local project not found.')
            }
            throw error
        }
        this.#refreshSavedProjectsSelect('', { preferIdle: false })
        return {
            message: `Deleted local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Connects EggBot serial from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async #webMcpSerialConnect() {
        await this.#connectSerial()
        return {
            message: 'Serial connection attempt completed.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Disconnects EggBot serial from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async #webMcpSerialDisconnect() {
        await this.#disconnectSerial()
        return {
            message: 'Serial disconnect attempt completed.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Starts EggBot drawing from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async #webMcpSerialDraw() {
        await this.#drawCurrentPattern()
        return {
            message: 'Draw command completed.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Stops EggBot drawing from WebMCP.
     * @returns {Record<string, any>}
     */
    #webMcpSerialStop() {
        this.serial.stop()
        this.#resolvePendingPenColorDialog(false)
        this.#setStatus(this.#t('messages.stopRequested'), 'info')
        return {
            message: 'Stop request sent.',
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Updates locale from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    #webMcpSetLocale(args) {
        const locale = String(args?.locale || '').trim()
        if (!locale) {
            throw new Error('Missing locale value.')
        }
        this.#handleLocaleChange(locale)
        return {
            message: `Locale set to ${this.i18n.locale}.`,
            state: this.#webMcpStateSnapshot()
        }
    }

    /**
     * Resolves decimal precision for one numeric step value.
     * @param {number} step
     * @returns {number}
     */
    static #resolveStepPrecision(step) {
        const text = String(step || '')
        const decimalIndex = text.indexOf('.')
        if (decimalIndex < 0) return 0
        return Math.max(0, text.length - decimalIndex - 1)
    }

    /**
     * Normalizes the draw color mode setting.
     * @param {unknown} value
     * @returns {'single' | 'per-color'}
     */
    static #normalizePrintColorMode(value) {
        return String(value || '').trim().toLowerCase() === 'single' ? 'single' : 'per-color'
    }

    /**
     * Parses an integer with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #parseInteger(value, fallback) {
        const parsed = Number.parseInt(String(value), 10)
        return Number.isFinite(parsed) ? parsed : fallback
    }
    /**
     * Parses a float with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static #parseFloat(value, fallback) {
        const parsed = Number.parseFloat(String(value))
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Parses a boolean-like value with fallback.
     * @param {unknown} value
     * @param {boolean} fallback
     * @returns {boolean}
     */
    static #parseBoolean(value, fallback) {
        if (typeof value === 'boolean') return value
        if (typeof value === 'number') return value !== 0
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false
        }
        return fallback
    }
}
const i18n = new I18n({
    storageKey: 'eggbot_app_locale'
})
/**
 * Starts the localized application.
 * @returns {Promise<void>}
 */
async function startApp() {
    await i18n.init()
    i18n.applyTranslations(document)
    const app = new AppController(i18n)
    await app.init()
}
startApp().catch((error) => {
    console.error(error)
    const statusElement = document.querySelector('[data-status]')
    if (!statusElement) return
    const translated = i18n.t('messages.appInitFailed', { message: error?.message || '' })
    statusElement.textContent =
        translated === 'messages.appInitFailed'
            ? `App initialization failed: ${String(error?.message || 'Unknown error')}`
            : translated
    statusElement.dataset.type = 'error'
})
