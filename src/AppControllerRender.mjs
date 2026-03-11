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
import { AppControllerRuntime } from './AppControllerRuntime.mjs'

/**
 * AppControllerRender segment of the application controller.
 */
export class AppControllerRender extends AppControllerRuntime {
    _bindEvents() {
        this.els.localeSelect.addEventListener('change', () => {
            this._handleLocaleChange(this.els.localeSelect.value)
        })
        this.els.projectName.addEventListener('input', () => {
            this.state.projectName = this.els.projectName.value.trim() || this._t('project.defaultName')
            this._markProjectArtifactsDirty()
        })
        this.els.preset.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.preset = this.els.preset.value
            this.state.motifs = AppRuntimeConfig.presetMotifs(this.state.preset)
            this._syncMotifControls()
            this._scheduleRender()
        })
        this.els.seed.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.seed = this.constructor._parseInteger(this.els.seed.value, this.state.seed)
            this._scheduleRender()
        })
        this.els.rerollSeed.addEventListener('click', () => {
            this._clearImportedPattern()
            this._rerollSeed()
            this._renderPattern()
        })
        this.els.regenerate.addEventListener('click', () => {
            this._clearImportedPattern()
            this._rerollSeed()
            this._renderPattern()
        })
        this.els.symmetry.addEventListener('input', () => {
            this._clearImportedPattern()
            this.state.symmetry = this.constructor._parseInteger(this.els.symmetry.value, this.state.symmetry)
            this.els.symmetryLabel.textContent = String(this.state.symmetry)
            this._scheduleRender()
        })
        this.els.density.addEventListener('input', () => {
            this._clearImportedPattern()
            this.state.density = this.constructor._parseFloat(this.els.density.value, this.state.density)
            this.els.densityLabel.textContent = this.state.density.toFixed(2)
            this._scheduleRender()
        })
        this.els.bands.addEventListener('input', () => {
            this._clearImportedPattern()
            this.state.bands = this.constructor._parseInteger(this.els.bands.value, this.state.bands)
            this.els.bandsLabel.textContent = String(this.state.bands)
            this._scheduleRender()
        })
        this.els.ornamentSize.addEventListener('input', () => {
            this._clearImportedPattern()
            const nextValue = this.constructor._parseFloat(this.els.ornamentSize.value, this.state.ornamentSize)
            this.state.ornamentSize = Math.max(0.5, Math.min(2, nextValue))
            this.els.ornamentSizeLabel.textContent = this.state.ornamentSize.toFixed(2)
            this._scheduleRender()
        })
        this.els.ornamentCount.addEventListener('input', () => {
            this._clearImportedPattern()
            const nextValue = this.constructor._parseFloat(this.els.ornamentCount.value, this.state.ornamentCount)
            this.state.ornamentCount = Math.max(0.5, Math.min(2, nextValue))
            this.els.ornamentCountLabel.textContent = this.state.ornamentCount.toFixed(2)
            this._scheduleRender()
        })
        this.els.ornamentDistribution.addEventListener('input', () => {
            this._clearImportedPattern()
            const nextValue = this.constructor._parseFloat(
                this.els.ornamentDistribution.value,
                this.state.ornamentDistribution
            )
            this.state.ornamentDistribution = Math.max(0.6, Math.min(1.6, nextValue))
            this.els.ornamentDistributionLabel.textContent = this.state.ornamentDistribution.toFixed(2)
            this._scheduleRender()
        })
        this.els.lineWidth.addEventListener('input', () => {
            this.state.lineWidth = this.constructor._parseFloat(this.els.lineWidth.value, this.state.lineWidth)
            this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
            this._scheduleRender()
        })
        this.els.importHeightScale.addEventListener('input', () => {
            const nextValue = this.constructor._parseFloat(this.els.importHeightScale.value, this.state.importHeightScale)
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(nextValue)
            this.els.importHeightScaleLabel.textContent = this.state.importHeightScale.toFixed(2)
            this._scheduleRender()
        })
        this.els.importHeightScale.addEventListener('change', async () => {
            await this._reparseImportedPatternFromCurrentSettings()
        })
        this.els.showHorizontalLines.addEventListener('change', () => {
            this.state.showHorizontalLines = this.els.showHorizontalLines.checked
            this._scheduleRender()
        })
        this.els.fillPatterns.addEventListener('change', () => {
            this.state.fillPatterns = this.els.fillPatterns.checked
            this._scheduleRender()
        })
        this.els.baseColor.addEventListener('input', () => {
            this.state.baseColor = this.els.baseColor.value
            this._normalizePaletteLength(this.state.palette.length)
            this._renderPaletteControls()
            this._scheduleRender()
        })
        this.els.colorCount.addEventListener('change', () => {
            this._normalizePaletteLength(this.constructor._parseInteger(this.els.colorCount.value, this.state.palette.length))
            this._renderPaletteControls()
            this._scheduleRender()
        })
        this.els.motifDots.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.dots = this.els.motifDots.checked
            this._scheduleRender()
        })
        this.els.motifRays.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.rays = this.els.motifRays.checked
            this._scheduleRender()
        })
        this.els.motifHoneycomb.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.honeycomb = this.els.motifHoneycomb.checked
            this._scheduleRender()
        })
        this.els.motifWolfTeeth.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.wolfTeeth = this.els.motifWolfTeeth.checked
            this._scheduleRender()
        })
        this.els.motifPine.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.pineBranch = this.els.motifPine.checked
            this._scheduleRender()
        })
        this.els.motifDiamond.addEventListener('change', () => {
            this._clearImportedPattern()
            this.state.motifs.diamonds = this.els.motifDiamond.checked
            this._scheduleRender()
        })
        this.els.connectionTransport.addEventListener('change', () => {
            const requestedTransport = String(this.els.connectionTransport.value || '')
                .trim()
                .toLowerCase()
            this._switchConnectionTransport(requestedTransport).catch((error) => {
                this._setStatus(this._t('messages.transportSwitchFailed', { message: error.message }), 'error')
                this._syncConnectionUi()
            })
        })
        this.els.baudRate.addEventListener('change', () => {
            this.state.drawConfig.baudRate = Math.max(
                300,
                this.constructor._parseInteger(this.els.baudRate.value, this.state.drawConfig.baudRate)
            )
            this._markProjectArtifactsDirty()
        })
        this.els.wifiHost.addEventListener('change', () => {
            this.state.drawConfig.wifiHost = String(this.els.wifiHost.value || '').trim()
            this.els.wifiHost.value = this.state.drawConfig.wifiHost
            this._markProjectArtifactsDirty()
        })
        this.els.wifiPort.addEventListener('change', () => {
            this.state.drawConfig.wifiPort = Math.max(
                1,
                Math.min(65535, this.constructor._parseInteger(this.els.wifiPort.value, this.state.drawConfig.wifiPort))
            )
            this.els.wifiPort.value = String(this.state.drawConfig.wifiPort)
            this._markProjectArtifactsDirty()
        })
        if (this.els.wifiSecure) {
            this.els.wifiSecure.addEventListener('change', () => {
                this.state.drawConfig.wifiSecure = this.els.wifiSecure.checked
                this._markProjectArtifactsDirty()
            })
        }
        this.els.stepsPerTurn.addEventListener('change', () => {
            this.state.drawConfig.stepsPerTurn = Math.max(
                100,
                this.constructor._parseInteger(this.els.stepsPerTurn.value, this.state.drawConfig.stepsPerTurn)
            )
            this._markProjectArtifactsDirty()
        })
        this.els.penRangeSteps.addEventListener('change', () => {
            this.state.drawConfig.penRangeSteps = Math.max(
                100,
                this.constructor._parseInteger(this.els.penRangeSteps.value, this.state.drawConfig.penRangeSteps)
            )
            if (this.importedPattern) {
                this._scheduleRender()
                return
            }
            this._markProjectArtifactsDirty()
        })
        this.els.msPerStep.addEventListener('change', () => {
            this.state.drawConfig.msPerStep = this.constructor._parseFloat(
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
            this._markProjectArtifactsDirty()
        })
        this.els.servoUp.addEventListener('change', () => {
            this.state.drawConfig.servoUp = this.constructor._parseInteger(
                this.els.servoUp.value,
                this.state.drawConfig.servoUp
            )
            this.state.drawConfig.penUpPercent = this.constructor._servoValueToPercent(this.state.drawConfig.servoUp)
            this.els.controlPenUpPercent.value = String(Math.round(this.state.drawConfig.penUpPercent))
            this._markProjectArtifactsDirty()
        })
        this.els.servoDown.addEventListener('change', () => {
            this.state.drawConfig.servoDown = this.constructor._parseInteger(
                this.els.servoDown.value,
                this.state.drawConfig.servoDown
            )
            this.state.drawConfig.penDownPercent = this.constructor._servoValueToPercent(this.state.drawConfig.servoDown)
            this.els.controlPenDownPercent.value = String(Math.round(this.state.drawConfig.penDownPercent))
            this._markProjectArtifactsDirty()
        })
        this.els.invertPen.addEventListener('change', () => {
            this.state.drawConfig.invertPen = this.els.invertPen.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlPenUpPercent.addEventListener('change', () => {
            this.state.drawConfig.penUpPercent = Math.max(
                0,
                Math.min(100, this.constructor._parseFloat(this.els.controlPenUpPercent.value, this.state.drawConfig.penUpPercent))
            )
            this.state.drawConfig.servoUp = this.constructor._percentToServoValue(this.state.drawConfig.penUpPercent)
            this.els.servoUp.value = String(this.state.drawConfig.servoUp)
            this._markProjectArtifactsDirty()
        })
        this.els.controlPenDownPercent.addEventListener('change', () => {
            this.state.drawConfig.penDownPercent = Math.max(
                0,
                Math.min(
                    100,
                    this.constructor._parseFloat(this.els.controlPenDownPercent.value, this.state.drawConfig.penDownPercent)
                )
            )
            this.state.drawConfig.servoDown = this.constructor._percentToServoValue(this.state.drawConfig.penDownPercent)
            this.els.servoDown.value = String(this.state.drawConfig.servoDown)
            this._markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenDown.addEventListener('change', () => {
            this.state.drawConfig.penDownSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(this.els.controlSpeedPenDown.value, this.state.drawConfig.penDownSpeed))
            )
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, 1000 / this.state.drawConfig.penDownSpeed))
            this.els.msPerStep.value = this.state.drawConfig.msPerStep.toFixed(2)
            this._markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenUp.addEventListener('change', () => {
            this.state.drawConfig.penUpSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(this.els.controlSpeedPenUp.value, this.state.drawConfig.penUpSpeed))
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlSpeedPenMotor.addEventListener('change', () => {
            this.state.drawConfig.penMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    this.constructor._parseInteger(this.els.controlSpeedPenMotor.value, this.state.drawConfig.penMotorSpeed)
                )
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlSpeedEggMotor.addEventListener('change', () => {
            this.state.drawConfig.eggMotorSpeed = Math.max(
                10,
                Math.min(
                    4000,
                    this.constructor._parseInteger(this.els.controlSpeedEggMotor.value, this.state.drawConfig.eggMotorSpeed)
                )
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlPenRaiseRate.addEventListener('change', () => {
            this.state.drawConfig.penRaiseRate = Math.max(
                1,
                Math.min(100, this.constructor._parseInteger(this.els.controlPenRaiseRate.value, this.state.drawConfig.penRaiseRate))
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlDelayAfterRaise.addEventListener('change', () => {
            this.state.drawConfig.penRaiseDelayMs = Math.max(
                0,
                Math.min(
                    5000,
                    this.constructor._parseInteger(this.els.controlDelayAfterRaise.value, this.state.drawConfig.penRaiseDelayMs)
                )
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlPenLowerRate.addEventListener('change', () => {
            this.state.drawConfig.penLowerRate = Math.max(
                1,
                Math.min(100, this.constructor._parseInteger(this.els.controlPenLowerRate.value, this.state.drawConfig.penLowerRate))
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlDelayAfterLower.addEventListener('change', () => {
            this.state.drawConfig.penLowerDelayMs = Math.max(
                0,
                Math.min(
                    5000,
                    this.constructor._parseInteger(this.els.controlDelayAfterLower.value, this.state.drawConfig.penLowerDelayMs)
                )
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlReversePenMotor.addEventListener('change', () => {
            this.state.drawConfig.reversePenMotor = this.els.controlReversePenMotor.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlReverseEggMotor.addEventListener('change', () => {
            this.state.drawConfig.reverseEggMotor = this.els.controlReverseEggMotor.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlWrapsAround.addEventListener('change', () => {
            this.state.drawConfig.wrapAround = this.els.controlWrapsAround.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlReturnHome.addEventListener('change', () => {
            this.state.drawConfig.returnHome = this.els.controlReturnHome.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlPrintColorModeSingle.addEventListener('change', () => {
            if (!this.els.controlPrintColorModeSingle.checked) return
            this.state.drawConfig.printColorMode = 'single'
            this._markProjectArtifactsDirty()
        })
        this.els.controlPrintColorModePerColor.addEventListener('change', () => {
            if (!this.els.controlPrintColorModePerColor.checked) return
            this.state.drawConfig.printColorMode = 'per-color'
            this._markProjectArtifactsDirty()
        })
        this.els.controlEnableEngraver.addEventListener('change', () => {
            this.state.drawConfig.engraverEnabled = this.els.controlEnableEngraver.checked
            this._markProjectArtifactsDirty()
        })
        this.els.controlCurveSmoothing.addEventListener('change', () => {
            this.state.drawConfig.curveSmoothing = Math.max(
                0,
                Math.min(2, this.constructor._parseFloat(this.els.controlCurveSmoothing.value, this.state.drawConfig.curveSmoothing))
            )
            this._markProjectArtifactsDirty()
        })
        this.els.controlSetupActionToggle.addEventListener('change', () => {
            if (!this.els.controlSetupActionToggle.checked) return
            this.state.drawConfig.setupApplyAction = 'toggle'
            this._markProjectArtifactsDirty()
        })
        this.els.controlSetupActionRaiseOff.addEventListener('change', () => {
            if (!this.els.controlSetupActionRaiseOff.checked) return
            this.state.drawConfig.setupApplyAction = 'raise-off'
            this._markProjectArtifactsDirty()
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
            this._clearManualControlResult()
            this._markProjectArtifactsDirty()
        })
        this.els.controlWalkDistance.addEventListener('change', () => {
            this.state.drawConfig.manualWalkDistance = Math.max(
                -64000,
                Math.min(64000, this.constructor._parseInteger(this.els.controlWalkDistance.value, this.state.drawConfig.manualWalkDistance))
            )
            this._markProjectArtifactsDirty()
        })
        this.els.eggbotControlOpen.addEventListener('click', () => this._openEggBotControlDialog())
        this.els.espFlashOpen.addEventListener('click', () => this._openEspFlashDialog())
        this.els.eggbotDialogClose.addEventListener('click', () => this._closeEggBotControlDialog())
        this.els.eggbotDialogCloseIcon.addEventListener('click', () => this._closeEggBotControlDialog())
        this.els.espFlashDialogClose.addEventListener('click', () => this._closeEspFlashDialog())
        this.els.espFlashDialogCloseIcon.addEventListener('click', () => this._closeEspFlashDialog())
        this.els.eggbotDialogBackdrop.addEventListener('click', (event) => {
            if (event.target !== this.els.eggbotDialogBackdrop) return
            this._closeEggBotControlDialog()
        })
        this.els.espFlashDialogBackdrop.addEventListener('click', (event) => {
            if (event.target !== this.els.espFlashDialogBackdrop) return
            this._closeEspFlashDialog()
        })
        this.els.penColorDialogBackdrop.addEventListener('click', (event) => {
            if (event.target !== this.els.penColorDialogBackdrop) return
            this._resolvePendingPenColorDialog(false)
        })
        this.els.penColorDialogClose.addEventListener('click', () => this._resolvePendingPenColorDialog(false))
        this.els.penColorDialogCancel.addEventListener('click', () => this._resolvePendingPenColorDialog(false))
        this.els.penColorDialogContinue.addEventListener('click', () => this._resolvePendingPenColorDialog(true))
        this.els.eggbotDialog.addEventListener('click', (event) => this._applyControlStepperAdjustment(event))
        this.els.eggbotDialogApply.addEventListener('click', () => {
            this._applyEggBotControlCurrentTab().catch((error) => {
                this._setStatus(this._t('messages.controlDialogApplyFailed', { message: error.message }), 'error')
            })
        })
        this.els.eggbotTabButtons.forEach((button) => {
            button.addEventListener('click', () => this._setEggBotControlTab(button.dataset.eggbotTab || 'plot'))
        })
        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return
            if (this._isPenColorDialogOpen()) {
                this._resolvePendingPenColorDialog(false)
                return
            }
            if (this._isEspFlashDialogOpen()) {
                this._closeEspFlashDialog()
                return
            }
            if (this._isEggBotControlDialogOpen()) {
                this._closeEggBotControlDialog()
            }
        })
        this.els.serialConnect.addEventListener('click', () => this._connectSerial())
        this.els.serialDisconnect.addEventListener('click', () => this._disconnectSerial())
        this.els.drawButton.addEventListener('click', () => this._drawCurrentPattern())
        this.els.resumeStart.addEventListener('click', () => this._resumeFromCheckpoint())
        this.els.resumeClear.addEventListener('click', () => {
            if (this._clearResumeState()) {
                this._setStatus(this._t('messages.resumeCleared'), 'info')
            } else {
                this._setStatus(this._t('messages.resumeUnavailable'), 'info')
            }
        })
        this.els.loadPattern.addEventListener('click', () => this._loadPatternFromFile())
        this.els.stopButton.addEventListener('click', () => {
            this.serial.stop()
            this._resolvePendingPenColorDialog(false)
            this._setStatus(this._t('messages.stopRequested'), 'info')
        })
        this.els.saveProject.addEventListener('click', () => this._saveProjectToFile())
        this.els.exportSvg.addEventListener('click', () => this._exportPatternToSvg())
        this.els.loadProject.addEventListener('click', () => this._loadProjectFromFile())
        this.els.shareProject.addEventListener('click', () => this._shareProjectUrl())
        this.els.controlSettingsExport.addEventListener('click', () => this._exportSettingsToFile())
        this.els.controlSettingsImport.addEventListener('click', () => this._importSettingsFromFile())
        this.els.controlSettingsReset.addEventListener('click', () => this._resetSettingsToDefaults())
        if (this.els.storeLocal) {
            this.els.storeLocal.addEventListener('click', () => this._storeProjectLocally())
        }
        if (this.els.localPatterns) {
            this.els.localPatterns.addEventListener('focus', () => this._flushPendingSavedProjectsSelectRender())
            this.els.localPatterns.addEventListener('pointerdown', () => this._flushPendingSavedProjectsSelectRender())
        }
        if (this.els.loadLocal) {
            this.els.loadLocal.addEventListener('click', () => this._loadSelectedLocalProject())
        }
        if (this.els.deleteLocal) {
            this.els.deleteLocal.addEventListener('click', () => this._deleteSelectedLocalProject())
        }
    }

    /**
     * Binds Web Serial lifecycle listeners.
     */
    _bindSerialLifecycleEvents() {
        if (!('serial' in navigator) || typeof navigator.serial?.addEventListener !== 'function') {
            return
        }

        navigator.serial.addEventListener('disconnect', (event) => {
            this._handleSerialDisconnect(event)
        })
    }

    /**
     * Disposes all background worker resources.
     */
    _disposeBackgroundWorkers() {
        this._cancelAllIdleTasks()
        this.pendingSavedProjectsSelectRender = null
        if (this.pendingEggTextureSyncAnimationFrame) {
            window.cancelAnimationFrame(this.pendingEggTextureSyncAnimationFrame)
            this.pendingEggTextureSyncAnimationFrame = 0
        }
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
    async _handleSerialDisconnect(event) {
        const disconnectedPort = event?.port || null
        if (!this.serial.isCurrentPort(disconnectedPort)) {
            return
        }

        try {
            await this.serial.disconnect()
            this.isDrawing = false
            this._setStatus(this._t('messages.eggbotDisconnected'), 'info')
        } catch (error) {
            this._setStatus(this._t('messages.disconnectFailed', { message: error.message }), 'error')
        } finally {
            this._resetDrawProgressUi()
            this._syncConnectionUi()
        }
    }

    /**
     * Applies locale change and refreshes dynamic UI fragments.
     * @param {string} locale
     */
    _handleLocaleChange(locale) {
        this.i18n.setLocale(locale)
        this._applyLocaleToUi()
        this._syncEspFlashManifestVersionUi()
        this._syncConnectionTransportUi()
        this._renderPaletteControls()
        if (!this.isDrawing) {
            this._resetDrawProgressUi()
        }
        const selectedLocalProjectId = this.els.localPatterns ? this.els.localPatterns.value : ''
        this._refreshSavedProjectsSelect(selectedLocalProjectId, { preferIdle: false })
    }

    /**
     * Deprecated compatibility hook for legacy project/WebMCP payloads.
     * Runtime behavior is always v281-compatible now.
     * @returns {boolean}
     */
    _isInkscapeSvgCompatModeEnabled() {
        return false
    }

    /**
     * Resolves currently active render height ratio.
     * @returns {number}
     */
    _resolveActiveRenderHeightRatio() {
        if (!this.importedPattern) {
            return PatternStrokeScaleUtils.clampRatio(this.state.importHeightScale)
        }
        if (this._isInkscapeSvgCompatModeEnabled()) {
            return 1
        }
        return ImportedPatternScaleUtils.resolveDrawHeightRatio({
            parsedHeightRatio: this.importedPattern.heightRatio,
            parsedHeightScale: this.importedPattern.heightScale,
            activeHeightScale: this.state.importHeightScale
        })
    }

    /**
     * Resolves one draw-area ratio for imported preview mapping.
     * @returns {number}
     */
    _resolveImportedPreviewDrawAreaRatio() {
        if (!this._usesDocumentCenteredImportedMapping()) return 1
        const drawConfig = this._resolveDrawCoordinateConfig()
        return ImportedPatternScaleUtils.resolveDrawAreaPreviewRatio({
            documentWidthPx: Number(this.importedPattern.documentWidthPx),
            documentHeightPx: Number(this.importedPattern.documentHeightPx),
            stepsPerTurn: Number(this.state?.drawConfig?.stepsPerTurn),
            penRangeSteps: Number(this.state?.drawConfig?.penRangeSteps),
            stepScalingFactor: Number(drawConfig?.stepScalingFactor) || 2
        })
    }

    /**
     * Resolves one preview-only render ratio.
     * @param {number} sharedRenderHeightRatio
     * @returns {number}
     */
    _resolvePreviewRenderHeightRatio(sharedRenderHeightRatio) {
        const sharedRatio = PatternStrokeScaleUtils.clampRatio(sharedRenderHeightRatio)
        if (!this.importedPattern) return sharedRatio
        const drawAreaRatio = this._resolveImportedPreviewDrawAreaRatio()
        return PatternStrokeScaleUtils.clampRatio(sharedRatio * drawAreaRatio)
    }

    /**
     * Resolves exact imported SVG raster preview parameters when vector restyling should be bypassed.
     * @returns {{ preferImportedSvgRaster: boolean, importedSvgScaleU: number, importedSvgScaleV: number }}
     */
    _resolveImportedSvgRasterRenderConfig() {
        if (!this.importedPattern || this._usesDocumentCenteredImportedMapping()) {
            return {
                preferImportedSvgRaster: false,
                importedSvgScaleU: 1,
                importedSvgScaleV: 1
            }
        }

        return {
            preferImportedSvgRaster: true,
            importedSvgScaleU: 1,
            importedSvgScaleV: this._resolveActiveRenderHeightRatio()
        }
    }

    /**
     * Builds one worker-safe snapshot of generation settings.
     * @returns {Record<string, any>}
     */
    _buildGeneratedPatternWorkerState() {
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
    _buildRenderedStrokes() {
        const activeHeightRatio = this._resolveActiveRenderHeightRatio()
        if (this.importedPattern) {
            if (this._isInkscapeSvgCompatModeEnabled()) {
                return this.importedPattern.strokes
            }
            const sourceHeightRatio = PatternStrokeScaleUtils.clampRatio(this.importedPattern.heightRatio)
            // Imported SVG draw parity with v281: scale only vertically and keep U unchanged.
            return PatternStrokeScaleUtils.rescaleStrokesVertical(
                this.importedPattern.strokes,
                sourceHeightRatio,
                activeHeightRatio
            )
        }
        const generated = PatternGenerator.generate(this.state)
        return PatternStrokeScaleUtils.rescaleStrokes(generated, 1, activeHeightRatio)
    }

    /**
     * Builds one render-safe stroke list based on fill visibility settings.
     * @param {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>} strokes
     * @returns {Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>}
     */
    _buildRenderInputStrokes(strokes) {
        let output = Array.isArray(strokes) ? strokes : []
        if (this.importedPattern) {
            const preview = ImportedPreviewStrokeUtils.buildPreviewStrokes({
                strokes: this.importedPattern.strokes,
                coordinateMode: this._resolveImportedPatternCoordinateMode(),
                parsedHeightRatio: this.importedPattern.heightRatio,
                parsedHeightScale: this.importedPattern.heightScale,
                activeHeightScale: this.state.importHeightScale,
                documentWidthPx: this.importedPattern.documentWidthPx,
                documentHeightPx: this.importedPattern.documentHeightPx,
                stepsPerTurn: this.state?.drawConfig?.stepsPerTurn,
                penRangeSteps: this.state?.drawConfig?.penRangeSteps,
                stepScalingFactor: this._resolveDrawCoordinateConfig().stepScalingFactor
            })
            output = preview.strokes
        }
        if (this.state.fillPatterns !== false) {
            return output
        }
        return output.map((stroke) => {
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
    _renderPattern(options = {}) {
        const skipImportedStatus = Boolean(options.skipImportedStatus)
        const importedSvgText = this.importedPattern ? String(this.importedPattern.svgText || '') : ''
        const sharedRenderHeightRatio = this._resolveActiveRenderHeightRatio()
        const importedSvgHeightRatio = this.importedPattern
            ? this._resolvePreviewRenderHeightRatio(sharedRenderHeightRatio)
            : sharedRenderHeightRatio
        this.renderToken += 1
        const token = this.renderToken

        if (this.importedPattern || this.disableComputeWorker) {
            this.pendingGeneratedRenderPromise = null
            this.state.strokes = this._buildRenderedStrokes()
            void this._renderComputedPattern({
                token,
                importedSvgText,
                importedSvgHeightRatio,
                skipImportedStatus
            })
            return
        }

        const pending = this._renderGeneratedPatternWithWorker({
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
    async _renderGeneratedPatternWithWorker(config) {
        try {
            const result = await this.patternComputeWorker.computeGeneratedRenderedStrokes({
                state: this._buildGeneratedPatternWorkerState(),
                activeHeightRatio: config.importedSvgHeightRatio
            })
            if (config.token !== this.renderToken) return
            this.state.strokes = Array.isArray(result?.strokes) ? result.strokes : []
        } catch (error) {
            this.disableComputeWorker = true
            console.error('Pattern compute worker failed; falling back to main-thread compute.', error)
            if (config.token !== this.renderToken) return
            this.state.strokes = this._buildRenderedStrokes()
        }

        if (config.token !== this.renderToken) return
        await this._renderComputedPattern(config)
    }

    /**
     * Renders current stroke state into 2D + 3D output and updates status.
     * @param {{ token: number, importedSvgText: string, importedSvgHeightRatio: number, skipImportedStatus: boolean }} config
     * @returns {Promise<void>}
     */
    async _renderComputedPattern(config) {
        if (config.token !== this.renderToken) return
        const importedSvgRasterRenderConfig = this._resolveImportedSvgRasterRenderConfig()
        const renderInput = {
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth,
            fillPatterns: this.state.fillPatterns,
            palette: this.state.palette,
            strokes: this._buildRenderInputStrokes(this.state.strokes),
            importedSvgText: config.importedSvgText,
            importedSvgHeightRatio: config.importedSvgHeightRatio,
            preferImportedSvgRaster: importedSvgRasterRenderConfig.preferImportedSvgRaster,
            importedSvgScaleU: importedSvgRasterRenderConfig.importedSvgScaleU,
            importedSvgScaleV: importedSvgRasterRenderConfig.importedSvgScaleV
        }

        try {
            const renderResult = await this._renderTextureFrame(renderInput, config.token)
            if (renderResult?.stale || config.token !== this.renderToken) return
            if (this.renderBackendMode === 'main' && this.textureCanvasTransferredToWorker) {
                this._restoreVisibleTextureCanvasAfterWorkerFallback()
            }
            const postRenderAction = ImportedRenderSyncUtils.resolvePostRenderAction(config.importedSvgText, renderResult)
            if (postRenderAction.shouldSyncEggTextureNow) {
                this._syncEggSceneTexture()
            }
            if (postRenderAction.shouldDispatchImportedRenderedEvent) {
                this.els.textureCanvas.dispatchEvent(new Event('pattern-rendered'))
            }
            if (renderResult?.scheduleFollowUpTextureSync) {
                this._scheduleEggSceneTextureFollowUpSync(config.token)
            }
        } catch (error) {
            console.error('Pattern render failed.', error)
            if (config.importedSvgText && config.token === this.renderToken) {
                const reason = String(error?.code || error?.message || 'render-error')
                this.els.textureCanvas.dispatchEvent(new CustomEvent('pattern-render-failed', { detail: { reason } }))
            }
            return
        }

        this._scheduleDeferredStartupTasks()
        if (config.skipImportedStatus) return
        if (this.importedPattern) {
            this._setStatus(
                this._t('messages.patternImported', {
                    name: this.importedPattern.name,
                    count: this.state.strokes.length
                }),
                'success'
            )
            return
        }
        this._setStatus(this._t('messages.patternGenerated', { count: this.state.strokes.length, seed: this.state.seed }), 'success')
    }

    /**
     * Renders one texture frame with worker-first fallback behavior.
     * @param {{ baseColor: string, lineWidth: number, fillPatterns?: boolean, palette: string[], strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, importedSvgText?: string, importedSvgHeightRatio?: number }} input
     * @param {number} token
     * @returns {Promise<{ stale?: boolean, dispatchImportedRenderedEvent?: boolean }>}
     */
    async _renderTextureFrame(input, token) {
        if (this.renderBackendMode === 'worker' && !this.disableRenderWorker) {
            try {
                const result = await this.patternRenderWorker.render(input, token)
                if (result?.stale || Number(result?.token) !== Number(token)) {
                    return { stale: true }
                }
                this.activeTextureCanvas = this.els.textureCanvas
                return {
                    dispatchImportedRenderedEvent: Boolean(input.importedSvgText),
                    scheduleFollowUpTextureSync: true
                }
            } catch (error) {
                if (error?.code === 'imported-svg-raster-unsupported' && input.importedSvgText) {
                    console.warn('Render worker cannot rasterize imported SVG in this runtime. Using main-thread fallback for this render.')
                    return this._renderWithMainThreadRenderer(input, this.textureCanvasTransferredToWorker)
                }
                console.warn('Render worker failed; switching to main-thread renderer.', error)
                this._switchToMainThreadRenderBackend()
            }
        }

        return this._renderWithMainThreadRenderer(input, this.textureCanvasTransferredToWorker)
    }

    /**
     * Renders one frame on main thread and proxies imported render events when needed.
     * @param {{ baseColor: string, lineWidth: number, fillPatterns?: boolean, palette: string[], strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, importedSvgText?: string, importedSvgHeightRatio?: number }} input
     * @param {boolean} useFallbackCanvas
     * @returns {Promise<{ dispatchImportedRenderedEvent: boolean }>}
     */
}
