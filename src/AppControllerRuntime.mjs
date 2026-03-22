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
import { AppControllerCoreControls } from './AppControllerCoreControls.mjs'
import { DrawTimeProfileUtils } from './DrawTimeProfileUtils.mjs'

const DRAW_TIME_PROFILE_STORAGE_KEY = 'eggbot.drawTimeProfile.v1'

/**
 * AppControllerRuntime segment of the application controller.
 */
export class AppControllerRuntime extends AppControllerCoreControls {
    _syncEggBotDialogControlsFromState() {
        const currentServoUp = Math.max(0, this.constructor._parseInteger(this.state.drawConfig.servoUp, 12000))
        const currentServoDown = Math.max(0, this.constructor._parseInteger(this.state.drawConfig.servoDown, 17000))
        const penUpPercent = Math.max(
            0,
            Math.min(100, this.constructor._parseFloat(this.state.drawConfig.penUpPercent, this.constructor._servoValueToPercent(currentServoUp)))
        )
        const penDownPercent = Math.max(
            0,
            Math.min(
                100,
                this.constructor._parseFloat(this.state.drawConfig.penDownPercent, this.constructor._servoValueToPercent(currentServoDown))
            )
        )
        this.state.drawConfig.penUpPercent = penUpPercent
        this.state.drawConfig.penDownPercent = penDownPercent
        this.els.controlPenUpPercent.value = String(Math.round(penUpPercent))
        this.els.controlPenDownPercent.value = String(Math.round(penDownPercent))

        const fallbackSpeed = Math.max(10, Math.min(4000, Math.round(1000 / Math.max(0.2, this.state.drawConfig.msPerStep || 1.8))))
        const penDownSpeed = Math.max(10, Math.min(4000, this.constructor._parseInteger(this.state.drawConfig.penDownSpeed, fallbackSpeed)))
        const penUpSpeed = Math.max(10, Math.min(4000, this.constructor._parseInteger(this.state.drawConfig.penUpSpeed, penDownSpeed)))
        const penMotorSpeed = Math.max(10, Math.min(4000, this.constructor._parseInteger(this.state.drawConfig.penMotorSpeed, 4000)))
        const eggMotorSpeed = Math.max(10, Math.min(4000, this.constructor._parseInteger(this.state.drawConfig.eggMotorSpeed, 4000)))
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
            Math.min(100, this.constructor._parseInteger(this.state.drawConfig.penRaiseRate, 50))
        )
        this.state.drawConfig.penLowerRate = Math.max(
            1,
            Math.min(100, this.constructor._parseInteger(this.state.drawConfig.penLowerRate, 20))
        )
        this.state.drawConfig.penRaiseDelayMs = Math.max(
            0,
            Math.min(5000, this.constructor._parseInteger(this.state.drawConfig.penRaiseDelayMs, 200))
        )
        this.state.drawConfig.penLowerDelayMs = Math.max(
            0,
            Math.min(5000, this.constructor._parseInteger(this.state.drawConfig.penLowerDelayMs, 400))
        )
        this.els.controlPenRaiseRate.value = String(this.state.drawConfig.penRaiseRate)
        this.els.controlPenLowerRate.value = String(this.state.drawConfig.penLowerRate)
        this.els.controlDelayAfterRaise.value = String(this.state.drawConfig.penRaiseDelayMs)
        this.els.controlDelayAfterLower.value = String(this.state.drawConfig.penLowerDelayMs)

        this.state.drawConfig.reversePenMotor = Boolean(this.state.drawConfig.reversePenMotor)
        this.state.drawConfig.reverseEggMotor = Boolean(this.state.drawConfig.reverseEggMotor)
        this.state.drawConfig.wrapAround = this.state.drawConfig.wrapAround !== false
        this.state.drawConfig.returnHome = Boolean(this.state.drawConfig.returnHome)
        this.state.drawConfig.printColorMode = this.constructor._normalizePrintColorMode(this.state.drawConfig.printColorMode)
        this.state.drawConfig.inkscapeSvgCompatMode = Boolean(this.state.drawConfig.inkscapeSvgCompatMode)
        this.state.drawConfig.engraverEnabled = Boolean(this.state.drawConfig.engraverEnabled)
        this.state.drawConfig.curveSmoothing = Math.max(
            0,
            Math.min(2, this.constructor._parseFloat(this.state.drawConfig.curveSmoothing, 0.2))
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
            Math.min(64000, this.constructor._parseInteger(this.state.drawConfig.manualWalkDistance, 3200))
        )
        this.els.controlManualCommand.value = this.state.drawConfig.manualCommand
        this.els.controlWalkDistance.value = String(this.state.drawConfig.manualWalkDistance)
    }

    /**
     * Converts one pen position percent (0-100) into a servo value.
     * @param {number} percent
     * @returns {number}
     */
    static _percentToServoValue(percent) {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0))
        const span = SERVO_VALUE_MAX - SERVO_VALUE_MIN
        return Math.round(SERVO_VALUE_MIN + (clamped / 100) * span)
    }

    /**
     * Converts one servo value into a pen position percentage.
     * @param {number} value
     * @returns {number}
     */
    static _servoValueToPercent(value) {
        const span = SERVO_VALUE_MAX - SERVO_VALUE_MIN
        if (span <= 0) return 0
        const normalized = ((Number(value) || SERVO_VALUE_MIN) - SERVO_VALUE_MIN) / span
        return Math.max(0, Math.min(100, normalized * 100))
    }

    /**
     * Schedules one deferred startup pass after first visible render.
     */
    _scheduleDeferredStartupTasks() {
        if (this.hasDeferredStartupTasksScheduled) return
        this.hasDeferredStartupTasksScheduled = true
        this._scheduleIdleTask(
            'startup-local-projects',
            () => this._refreshSavedProjectsSelect('', { preferIdle: true }),
            IDLE_TIMEOUT_STARTUP_LOCAL_PROJECTS_MS
        )
        this._scheduleIdleTask('startup-webmcp', () => this._initWebMcpBridge(), IDLE_TIMEOUT_STARTUP_WEBMCP_MS)
        this._scheduleIdleTask('startup-workers', () => this._warmupBackgroundWorkers(), IDLE_TIMEOUT_STARTUP_WORKERS_MS)
    }

    /**
     * Warms background workers so the first real task starts faster.
     */
    _warmupBackgroundWorkers() {
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
    _initializeRenderBackend() {
        if (this.disableRenderWorker) {
            this.renderBackendMode = 'main'
            this._ensureMainThreadRenderer(false)
            return
        }
        if (!PatternRenderWorkerClient.isSupported(this.els.textureCanvas)) {
            this.disableRenderWorker = true
            this.renderBackendMode = 'main'
            this._ensureMainThreadRenderer(false)
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
            this._ensureMainThreadRenderer(false)
        }
    }

    /**
     * Creates a main-thread renderer instance on DOM or detached fallback canvas.
     * @param {boolean} useFallbackCanvas
     */
    _ensureMainThreadRenderer(useFallbackCanvas) {
        const targetCanvas = this._resolveMainThreadRenderCanvas(useFallbackCanvas)
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
    _resolveMainThreadRenderCanvas(useFallbackCanvas) {
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
     * Replaces a worker-owned DOM texture canvas with a fresh visible canvas.
     * @returns {HTMLCanvasElement | null}
     */
    _restoreTransferredTextureCanvasElement() {
        if (!this.textureCanvasTransferredToWorker) return null
        const currentTextureCanvas = this.els.textureCanvas
        if (!currentTextureCanvas) return null
        if (typeof currentTextureCanvas.cloneNode !== 'function' || typeof currentTextureCanvas.parentNode?.replaceChild !== 'function') {
            return null
        }

        const replacementCanvas = currentTextureCanvas.cloneNode(true)
        replacementCanvas.width = Math.max(1, Math.round(Number(currentTextureCanvas.width) || 1))
        replacementCanvas.height = Math.max(1, Math.round(Number(currentTextureCanvas.height) || 1))
        currentTextureCanvas.parentNode.replaceChild(replacementCanvas, currentTextureCanvas)
        this.els.textureCanvas = replacementCanvas
        if (!this.activeTextureCanvas || this.activeTextureCanvas === currentTextureCanvas) {
            this.activeTextureCanvas = replacementCanvas
        }
        this.textureCanvasTransferredToWorker = false
        if (typeof this._bindTextureCanvasRenderSync === 'function') {
            this._bindTextureCanvasRenderSync()
        }
        return replacementCanvas
    }

    /**
     * Switches to permanent main-thread render mode after worker failure.
     */
    _switchToMainThreadRenderBackend() {
        this.disableRenderWorker = true
        this.renderBackendMode = 'main'
        try {
            this.patternRenderWorker.dispose()
        } catch (_error) {
            // Ignore disposal races.
        }
        this._restoreTransferredTextureCanvasElement()
        this.fallbackRenderCanvas = null
        this._ensureMainThreadRenderer(false)
    }

    /**
     * Restores a visible DOM texture canvas after worker-backed fallback rendering.
     * @returns {boolean}
     */
    _restoreVisibleTextureCanvasAfterWorkerFallback() {
        const renderedTextureCanvas = this.activeTextureCanvas
        const replacementCanvas = this._restoreTransferredTextureCanvasElement()
        if (!replacementCanvas || !renderedTextureCanvas || renderedTextureCanvas === replacementCanvas) return false
        const width = Math.max(
            1,
            Math.round(Number(renderedTextureCanvas.width) || Number(replacementCanvas.width) || 1)
        )
        const height = Math.max(
            1,
            Math.round(Number(renderedTextureCanvas.height) || Number(replacementCanvas.height) || 1)
        )
        replacementCanvas.width = width
        replacementCanvas.height = height

        const replacementContext = replacementCanvas.getContext('2d')
        if (!replacementContext) return false
        replacementContext.drawImage(renderedTextureCanvas, 0, 0, width, height)

        this.activeTextureCanvas = replacementCanvas
        this.fallbackRenderCanvas = null
        return true
    }

    /**
     * Returns the currently active texture canvas for 3D updates.
     * @returns {HTMLCanvasElement}
     */
    _resolveActiveTextureCanvas() {
        return this.activeTextureCanvas || this.els.textureCanvas
    }

    /**
     * Syncs the 3D egg texture from active render output or draw-trace composite.
     */
    _syncEggSceneTexture() {
        if (this.drawTracePreviewActive) {
            this._refreshDrawTraceCompositeTexture()
            return
        }
        this.eggScene.updateTexture(this._resolveActiveTextureCanvas())
    }

    /**
     * Schedules a short follow-up sync after worker-backed renders.
     * OffscreenCanvas commits can land after the worker promise resolves, so
     * re-upload the canvas texture across the next frames as a safeguard.
     * @param {number} token
     * @param {number} [remainingFrames]
     */
    _scheduleEggSceneTextureFollowUpSync(token, remainingFrames = 2) {
        if (this.pendingEggTextureSyncAnimationFrame) {
            window.cancelAnimationFrame(this.pendingEggTextureSyncAnimationFrame)
            this.pendingEggTextureSyncAnimationFrame = 0
        }

        const normalizedToken = Number.isFinite(Number(token)) ? Number(token) : 0
        const framesLeft = Math.max(1, Math.round(Number(remainingFrames) || 1))
        const scheduleFrame = (nextFramesLeft) => {
            this.pendingEggTextureSyncAnimationFrame = window.requestAnimationFrame(() => {
                this.pendingEggTextureSyncAnimationFrame = 0
                if (normalizedToken !== this.renderToken) return
                if (this.renderBackendMode !== 'worker' || this.disableRenderWorker) return
                this._syncEggSceneTexture()
                if (nextFramesLeft <= 1) return
                scheduleFrame(nextFramesLeft - 1)
            })
        }

        scheduleFrame(framesLeft)
    }

    /**
     * Ensures draw-trace overlay/composite canvases exist and match the base texture size.
     * @param {HTMLCanvasElement} baseCanvas
     */
    _ensureDrawTraceCanvases(baseCanvas) {
        const width = Math.max(1, Math.round(Number(baseCanvas?.width) || Number(this.els.textureCanvas.width) || 1))
        const height = Math.max(1, Math.round(Number(baseCanvas?.height) || Number(this.els.textureCanvas.height) || 1))

        if (!this.drawTraceOverlayCanvas) {
            this.drawTraceOverlayCanvas = document.createElement('canvas')
        }
        if (this.drawTraceOverlayCanvas.width !== width || this.drawTraceOverlayCanvas.height !== height) {
            this.drawTraceOverlayCanvas.width = width
            this.drawTraceOverlayCanvas.height = height
        }

        if (!this.drawTraceCompositeCanvas) {
            this.drawTraceCompositeCanvas = document.createElement('canvas')
        }
        if (this.drawTraceCompositeCanvas.width !== width || this.drawTraceCompositeCanvas.height !== height) {
            this.drawTraceCompositeCanvas.width = width
            this.drawTraceCompositeCanvas.height = height
        }
    }

    /**
     * Rebuilds the draw-trace composite texture and applies it to the 3D preview.
     */
    _refreshDrawTraceCompositeTexture() {
        if (!this.drawTracePreviewActive) return
        const baseCanvas = this._resolveActiveTextureCanvas()
        if (!baseCanvas) return

        this._ensureDrawTraceCanvases(baseCanvas)
        if (!this.drawTraceCompositeCanvas || !this.drawTraceOverlayCanvas) return
        const compositeCtx = this.drawTraceCompositeCanvas.getContext('2d')
        if (!compositeCtx) return

        const width = this.drawTraceCompositeCanvas.width
        const height = this.drawTraceCompositeCanvas.height
        compositeCtx.clearRect(0, 0, width, height)
        compositeCtx.drawImage(baseCanvas, 0, 0, width, height)
        compositeCtx.drawImage(this.drawTraceOverlayCanvas, 0, 0, width, height)
        this.eggScene.updateTexture(this.drawTraceCompositeCanvas)
    }

    /**
     * Starts a live draw-trace preview for the ordered draw stroke sequence.
     * @param {Array<{ points?: Array<{u:number,v:number}> }>} strokes
     */
    _startDrawTracePreview(strokes) {
        this.drawTraceStrokes = Array.isArray(strokes) ? strokes : []
        this.drawTracePreviewActive = this.drawTraceStrokes.length > 0
        this.drawTraceLastCompletedStrokeCount = -1
        this.drawTraceLastActiveStrokeIndex = -1
        if (!this.drawTracePreviewActive) {
            this.eggScene.clearFollowTargetU()
            return
        }

        this._updateDrawTracePreview(0, this.drawTraceStrokes.length)
    }

    /**
     * Updates live draw-trace overlay using the current completed stroke count.
     * @param {number} completedStrokeCount
     * @param {number} totalStrokeCount
     */
    _updateDrawTracePreview(completedStrokeCount, totalStrokeCount) {
        if (!this.drawTracePreviewActive || !this.drawTraceOverlayCanvas) {
            const baseCanvas = this._resolveActiveTextureCanvas()
            if (!baseCanvas || !this.drawTracePreviewActive) return
            this._ensureDrawTraceCanvases(baseCanvas)
        }
        if (!this.drawTracePreviewActive || !this.drawTraceOverlayCanvas) return

        const total = Math.max(
            0,
            Math.round(Number(totalStrokeCount) || 0),
            Array.isArray(this.drawTraceStrokes) ? this.drawTraceStrokes.length : 0
        )
        const normalizedCompleted = Math.max(0, Math.min(total, Math.round(Number(completedStrokeCount) || 0)))
        const activeStrokeIndex = normalizedCompleted < total ? normalizedCompleted : -1
        if (
            normalizedCompleted === this.drawTraceLastCompletedStrokeCount &&
            activeStrokeIndex === this.drawTraceLastActiveStrokeIndex
        ) {
            return
        }

        this.drawTraceLastCompletedStrokeCount = normalizedCompleted
        this.drawTraceLastActiveStrokeIndex = activeStrokeIndex
        DrawTraceOverlayRenderer.render(this.drawTraceOverlayCanvas, {
            strokes: this.drawTraceStrokes,
            completedStrokeCount: normalizedCompleted,
            activeStrokeIndex,
            lineWidth: this.state.lineWidth
        })
        this._syncDrawTraceFollowRotation(activeStrokeIndex, normalizedCompleted)
        this._refreshDrawTraceCompositeTexture()
    }

    /**
     * Updates EggScene yaw target so draw preview follows current active path.
     * @param {number} activeStrokeIndex
     * @param {number} completedStrokeCount
     */
    _syncDrawTraceFollowRotation(activeStrokeIndex, completedStrokeCount) {
        const followU = this._resolveDrawTraceFollowU(activeStrokeIndex, completedStrokeCount)
        if (!Number.isFinite(followU)) {
            this.eggScene.clearFollowTargetU()
            return
        }
        this.eggScene.setFollowTargetU(followU)
    }

    /**
     * Resolves one representative U position for the active or most recently completed stroke.
     * @param {number} activeStrokeIndex
     * @param {number} completedStrokeCount
     * @returns {number | null}
     */
    _resolveDrawTraceFollowU(activeStrokeIndex, completedStrokeCount) {
        const strokes = Array.isArray(this.drawTraceStrokes) ? this.drawTraceStrokes : []
        if (!strokes.length) return null

        let targetStroke = null
        if (activeStrokeIndex >= 0 && activeStrokeIndex < strokes.length) {
            targetStroke = strokes[activeStrokeIndex]
        } else {
            const lastCompletedIndex = Math.max(0, Math.min(strokes.length - 1, Math.round(Number(completedStrokeCount) || 0) - 1))
            targetStroke = strokes[lastCompletedIndex]
        }
        if (!Array.isArray(targetStroke?.points) || !targetStroke.points.length) return null

        const midpointIndex = Math.max(0, Math.floor((targetStroke.points.length - 1) / 2))
        const midpointU = Number(targetStroke.points[midpointIndex]?.u)
        return Number.isFinite(midpointU) ? midpointU : null
    }

    /**
     * Stops live draw-trace preview and restores regular texture rendering.
     */
    _stopDrawTracePreview() {
        if (!this.drawTracePreviewActive) return
        this.drawTracePreviewActive = false
        this.drawTraceStrokes = []
        this.drawTraceLastCompletedStrokeCount = -1
        this.drawTraceLastActiveStrokeIndex = -1
        this.eggScene.clearFollowTargetU()
        this.eggScene.updateTexture(this._resolveActiveTextureCanvas())
    }

    /**
     * Schedules one named idle task and replaces any previous one with the same name.
     * @param {string} name
     * @param {(deadline: { didTimeout: boolean, timeRemaining: () => number }) => void} callback
     * @param {number} timeoutMs
     */
    _scheduleIdleTask(name, callback, timeoutMs) {
        this._cancelIdleTask(name)
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
    _cancelIdleTask(name) {
        const handle = this.idleTasks.get(name)
        if (!handle) return
        handle.cancel()
        this.idleTasks.delete(name)
    }

    /**
     * Cancels all pending idle tasks.
     */
    _cancelAllIdleTasks() {
        this.idleTasks.forEach((handle) => handle.cancel())
        this.idleTasks.clear()
    }

    /**
     * Marks project export/share artifacts as stale and schedules idle refresh.
     */
    _markProjectArtifactsDirty() {
        this.projectArtifactsRevision += 1
        this.projectArtifactsDirty = true
        this._scheduleProjectArtifactsRefreshIdle()
        this._scheduleSettingsPersistIdle()
        this._scheduleDrawTimeEstimateRefresh()
    }

    /**
     * Schedules one idle save for current project settings.
     */
    _scheduleSettingsPersistIdle() {
        const revision = this.projectArtifactsRevision
        this._scheduleIdleTask(
            'settings-persist',
            () => {
                if (revision !== this.projectArtifactsRevision) {
                    this._scheduleSettingsPersistIdle()
                    return
                }
                this._persistSettingsToLocalStorage()
            },
            IDLE_TIMEOUT_SETTINGS_PERSIST_MS
        )
    }

    /**
     * Persists current settings payload into localStorage.
     */
    _persistSettingsToLocalStorage() {
        try {
            if (!window?.localStorage) return
            const payload = ProjectIoUtils.buildProjectPayload(this.state)
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
        } catch (error) {
            console.warn('Failed to save settings to localStorage.', error)
        }
    }

    /**
     * Loads the persisted draw-time profile from localStorage.
     */
    _loadDrawTimeProfileFromLocalStorage() {
        try {
            if (!window?.localStorage) return
            const raw = window.localStorage.getItem(DRAW_TIME_PROFILE_STORAGE_KEY)
            if (!raw) {
                this.drawTimeProfile = DrawTimeProfileUtils.createDefaultProfile()
                return
            }
            this.drawTimeProfile = DrawTimeProfileUtils.normalizeProfile(JSON.parse(raw))
        } catch (error) {
            this.drawTimeProfile = DrawTimeProfileUtils.createDefaultProfile()
            console.warn('Failed to load draw-time profile from localStorage.', error)
        }
    }

    /**
     * Persists the current draw-time profile into localStorage.
     */
    _persistDrawTimeProfileToLocalStorage() {
        try {
            if (!window?.localStorage) return
            const payload = DrawTimeProfileUtils.normalizeProfile(this.drawTimeProfile)
            window.localStorage.setItem(DRAW_TIME_PROFILE_STORAGE_KEY, JSON.stringify(payload))
        } catch (error) {
            console.warn('Failed to save draw-time profile to localStorage.', error)
        }
    }

    /**
     * Updates the persisted draw-time profile from one measured stroke.
     * @param {{ actualDurationMs?: number, estimatedDurationMs?: number, updatedAt?: string }} measurement
     */
    _updateDrawTimeProfileFromStrokeMeasurement(measurement) {
        this.drawTimeProfile = DrawTimeProfileUtils.updateWithStrokeMeasurement(this.drawTimeProfile, measurement)
        this._persistDrawTimeProfileToLocalStorage()
        this._scheduleDrawTimeEstimateRefresh()
    }

    /**
     * Schedules idle refresh for cached project artifacts.
     */
    _scheduleProjectArtifactsRefreshIdle() {
        const revision = this.projectArtifactsRevision
        this._scheduleIdleTask(
            'project-artifacts-refresh',
            () => {
                if (revision !== this.projectArtifactsRevision) {
                    this._scheduleProjectArtifactsRefreshIdle()
                    return
                }
                this._refreshProjectArtifactsCache(revision)
            },
            IDLE_TIMEOUT_PROJECT_ARTIFACTS_MS
        )
    }

    /**
     * Rebuilds cached project payload and share URL.
     * @param {number} revision
     */
    _refreshProjectArtifactsCache(revision) {
        const payload = ProjectIoUtils.buildProjectPayload(this.state)
        this.cachedProjectPayload = payload
        this.cachedProjectShareUrl = this._buildProjectShareUrlFromPayload(payload)
        this.projectArtifactsCachedRevision = revision
        this.projectArtifactsDirty = false
    }

    /**
     * Returns the latest normalized project payload with sync fallback.
     * @returns {Record<string, any>}
     */
    _getProjectPayload() {
        if (
            !this.projectArtifactsDirty &&
            this.cachedProjectPayload &&
            this.projectArtifactsCachedRevision === this.projectArtifactsRevision
        ) {
            return this.cachedProjectPayload
        }
        this._cancelIdleTask('project-artifacts-refresh')
        this._refreshProjectArtifactsCache(this.projectArtifactsRevision)
        return this.cachedProjectPayload
    }

    /**
     * Returns cached share URL with sync fallback.
     * @returns {string}
     */
    _getShareUrlCached() {
        if (
            !this.projectArtifactsDirty &&
            this.cachedProjectShareUrl &&
            this.projectArtifactsCachedRevision === this.projectArtifactsRevision
        ) {
            return this.cachedProjectShareUrl
        }
        const payload = this._getProjectPayload()
        this.cachedProjectShareUrl = this._buildProjectShareUrlFromPayload(payload)
        return this.cachedProjectShareUrl
    }

    /**
     * Builds share URL using a prebuilt project payload.
     * @param {Record<string, any>} payload
     * @returns {string}
     */
    _buildProjectShareUrlFromPayload(payload) {
        const encoded = ProjectUrlUtils.encodeProjectPayloadParam(payload)
        const url = new URL(window.location.href)
        url.searchParams.set(ProjectUrlUtils.PROJECT_PARAM, encoded)
        return url.toString()
    }

    /**
     * Initializes WebMCP bridge registration with app command callbacks.
     */
    _initWebMcpBridge() {
        if (this.webMcpBridge) return
        try {
            this.webMcpBridge = new WebMcpBridge({
                commands: this._createWebMcpCommands(),
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
    _createWebMcpCommands() {
        return {
            getState: () => this._webMcpGetState(),
            setDesignSettings: (args) => this._webMcpSetDesignSettings(args),
            setColorSettings: (args) => this._webMcpSetColorSettings(args),
            setMotifSettings: (args) => this._webMcpSetMotifSettings(args),
            setDrawConfig: (args) => this._webMcpSetDrawConfig(args),
            rerollSeed: () => this._webMcpRerollSeed(),
            regeneratePattern: () => this._webMcpRegeneratePattern(),
            importSvgText: (args) => this._webMcpImportSvgText(args),
            applyProjectJson: (args) => this._webMcpApplyProjectJson(args),
            getProjectJson: () => this._webMcpGetProjectJson(),
            getShareUrl: () => this._webMcpGetShareUrl(),
            buildExportSvg: () => this._webMcpBuildExportSvg(),
            localProjectsList: () => this._webMcpLocalProjectsList(),
            localProjectStore: (args) => this._webMcpLocalProjectStore(args),
            localProjectLoad: (args) => this._webMcpLocalProjectLoad(args),
            localProjectDelete: (args) => this._webMcpLocalProjectDelete(args),
            serialConnect: () => this._webMcpSerialConnect(),
            serialDisconnect: () => this._webMcpSerialDisconnect(),
            serialDraw: () => this._webMcpSerialDraw(),
            serialStop: () => this._webMcpSerialStop(),
            setLocale: (args) => this._webMcpSetLocale(args)
        }
    }

    /**
     * Loads last saved settings snapshot from localStorage, when available.
     */
    _loadSettingsFromLocalStorage() {
        try {
            if (!window?.localStorage) return
            const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
            this._clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(parsed)
            this.state.strokes = []
            this._markProjectArtifactsDirty()
        } catch (error) {
            console.warn('Failed to load settings from localStorage.', error)
        }
    }

    /**
     * Applies URL-embedded project if present.
     */
    _applyProjectFromUrl() {
        try {
            const source = ProjectUrlUtils.resolveProjectSource(new URLSearchParams(window.location.search))
            if (!source.kind || !source.value) return
            const payload = ProjectUrlUtils.decodeEmbeddedProjectParam(source.value)
            this._clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(payload)
            this.state.strokes = []
            this._markProjectArtifactsDirty()
            this._syncControlsFromState()
            this._setStatus(this._t('messages.loadedFromSharedUrl'), 'success')
        } catch (error) {
            this._setStatus(this._t('messages.loadSharedFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Binds UI event listeners.
     */
}
