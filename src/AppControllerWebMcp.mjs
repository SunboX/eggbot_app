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
import { AppControllerProjects } from './AppControllerProjects.mjs'

/**
 * AppControllerWebMcp segment of the application controller.
 */
export class AppControllerWebMcp extends AppControllerProjects {
    _webMcpStateSnapshot() {
        const project = this._getProjectPayload()
        return {
            ...project,
            strokesCount: Array.isArray(this.state.strokes) ? this.state.strokes.length : 0,
            serialConnected: Boolean(this.serial?.isConnected),
            connectionTransport: this.serial.connectionTransportKind,
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
    _webMcpGetState() {
        return this._webMcpStateSnapshot()
    }

    /**
     * Applies design setting patches from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpSetDesignSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false
        let didMutateState = false
        const shouldRerollSeed = this.constructor._parseBoolean(patch.rerollSeed, false)
        const shouldRegenerate = this.constructor._parseBoolean(patch.regenerate, false)
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
            this._clearImportedPattern()
        }

        if (Object.hasOwn(patch, 'projectName')) {
            const projectName = String(patch.projectName || '').trim()
            this.state.projectName = projectName || this._t('project.defaultName')
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'preset')) {
            this.state.preset = String(patch.preset || this.state.preset)
            this.state.motifs = AppRuntimeConfig.presetMotifs(this.state.preset)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'seed')) {
            this.state.seed = this.constructor._parseInteger(patch.seed, this.state.seed)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'symmetry')) {
            this.state.symmetry = Math.max(2, Math.min(24, this.constructor._parseInteger(patch.symmetry, this.state.symmetry)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'density')) {
            this.state.density = Math.max(0.05, Math.min(1, this.constructor._parseFloat(patch.density, this.state.density)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'bands')) {
            this.state.bands = Math.max(1, Math.min(16, this.constructor._parseInteger(patch.bands, this.state.bands)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentSize')) {
            const nextValue = this.constructor._parseFloat(patch.ornamentSize, this.state.ornamentSize)
            this.state.ornamentSize = Math.max(0.5, Math.min(2, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentCount')) {
            const nextValue = this.constructor._parseFloat(patch.ornamentCount, this.state.ornamentCount)
            this.state.ornamentCount = Math.max(0.5, Math.min(2, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'ornamentDistribution')) {
            const nextValue = this.constructor._parseFloat(patch.ornamentDistribution, this.state.ornamentDistribution)
            this.state.ornamentDistribution = Math.max(0.6, Math.min(1.6, nextValue))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'lineWidth')) {
            this.state.lineWidth = Math.max(0.5, Math.min(4, this.constructor._parseFloat(patch.lineWidth, this.state.lineWidth)))
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'importHeightScale')) {
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(
                this.constructor._parseFloat(patch.importHeightScale, this.state.importHeightScale)
            )
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'showHorizontalLines')) {
            this.state.showHorizontalLines = this.constructor._parseBoolean(patch.showHorizontalLines, this.state.showHorizontalLines)
            shouldRender = true
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'fillPatterns')) {
            this.state.fillPatterns = this.constructor._parseBoolean(patch.fillPatterns, this.state.fillPatterns)
            shouldRender = true
            didMutateState = true
        }

        if (shouldRerollSeed) {
            this._clearImportedPattern()
            this._rerollSeed()
            shouldRender = true
        }
        if (shouldRegenerate) {
            shouldRender = true
        }

        if (didMutateState && !shouldRerollSeed) {
            this._markProjectArtifactsDirty()
        }
        this._syncControlsFromState()
        if (shouldRender) {
            this._renderPattern()
        }

        return {
            message: 'Design settings updated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Applies color settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpSetColorSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false
        let desiredColorCount = this.state.palette.length
        let shouldNormalizePalette = false

        if (Object.hasOwn(patch, 'baseColor')) {
            this.state.baseColor = String(patch.baseColor || this.state.baseColor)
            shouldRender = true
            shouldNormalizePalette = true
        }
        if (Array.isArray(patch.palette) && patch.palette.length) {
            const normalizedPalette = patch.palette
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .slice(0, 6)
            if (normalizedPalette.length) {
                this.state.palette = normalizedPalette
                desiredColorCount = normalizedPalette.length
                shouldRender = true
                shouldNormalizePalette = true
            }
        }
        if (Object.hasOwn(patch, 'colorCount')) {
            desiredColorCount = Math.max(1, Math.min(6, this.constructor._parseInteger(patch.colorCount, this.state.palette.length)))
            shouldRender = true
            shouldNormalizePalette = true
        }
        if (shouldNormalizePalette) {
            this._normalizePaletteLength(desiredColorCount)
        }

        if (shouldRender) {
            this._markProjectArtifactsDirty()
        }
        this._syncControlsFromState()
        if (shouldRender) {
            this._renderPattern()
        }

        return {
            message: 'Color settings updated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Applies motif toggle settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpSetMotifSettings(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let shouldRender = false
        const motifPatchKeys = ['dots', 'rays', 'honeycomb', 'wolfTeeth', 'pineBranch', 'diamonds']
        if (motifPatchKeys.some((key) => Object.hasOwn(patch, key))) {
            this._clearImportedPattern()
        }

        if (Object.hasOwn(patch, 'dots')) {
            this.state.motifs.dots = this.constructor._parseBoolean(patch.dots, this.state.motifs.dots)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'rays')) {
            this.state.motifs.rays = this.constructor._parseBoolean(patch.rays, this.state.motifs.rays)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'honeycomb')) {
            this.state.motifs.honeycomb = this.constructor._parseBoolean(patch.honeycomb, this.state.motifs.honeycomb)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'wolfTeeth')) {
            this.state.motifs.wolfTeeth = this.constructor._parseBoolean(patch.wolfTeeth, this.state.motifs.wolfTeeth)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'pineBranch')) {
            this.state.motifs.pineBranch = this.constructor._parseBoolean(patch.pineBranch, this.state.motifs.pineBranch)
            shouldRender = true
        }
        if (Object.hasOwn(patch, 'diamonds')) {
            this.state.motifs.diamonds = this.constructor._parseBoolean(patch.diamonds, this.state.motifs.diamonds)
            shouldRender = true
        }

        if (shouldRender) {
            this._markProjectArtifactsDirty()
        }
        this._syncControlsFromState()
        if (shouldRender) {
            this._renderPattern()
        }

        return {
            message: 'Motif settings updated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Applies draw configuration settings from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    async _webMcpSetDrawConfig(args) {
        const patch = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        let didMutateState = false
        let requestedTransportSwitch = null
        let shouldRerenderImportedPreview = false

        if (Object.hasOwn(patch, 'connectionTransport')) {
            const requestedTransport = String(patch.connectionTransport || '')
                .trim()
                .toLowerCase()
            if (EGGBOT_TRANSPORTS.includes(requestedTransport)) {
                this.state.drawConfig.connectionTransport = requestedTransport
                requestedTransportSwitch = requestedTransport
                didMutateState = true
            }
        }

        if (Object.hasOwn(patch, 'baudRate')) {
            this.state.drawConfig.baudRate = Math.max(
                300,
                this.constructor._parseInteger(patch.baudRate, this.state.drawConfig.baudRate)
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'wifiHost')) {
            this.state.drawConfig.wifiHost = String(patch.wifiHost || '').trim()
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'wifiPort')) {
            this.state.drawConfig.wifiPort = Math.max(
                1,
                Math.min(65535, this.constructor._parseInteger(patch.wifiPort, this.state.drawConfig.wifiPort))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'wifiSecure')) {
            this.state.drawConfig.wifiSecure = this.constructor._parseBoolean(patch.wifiSecure, this.state.drawConfig.wifiSecure)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'stepsPerTurn')) {
            this.state.drawConfig.stepsPerTurn = Math.max(
                100,
                this.constructor._parseInteger(patch.stepsPerTurn, this.state.drawConfig.stepsPerTurn)
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRangeSteps')) {
            this.state.drawConfig.penRangeSteps = Math.max(
                100,
                this.constructor._parseInteger(patch.penRangeSteps, this.state.drawConfig.penRangeSteps)
            )
            didMutateState = true
            if (this.importedPattern) {
                shouldRerenderImportedPreview = true
            }
        }
        if (Object.hasOwn(patch, 'msPerStep')) {
            const nextValue = this.constructor._parseFloat(patch.msPerStep, this.state.drawConfig.msPerStep)
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, nextValue))
            const derivedSpeed = Math.max(10, Math.min(4000, Math.round(1000 / this.state.drawConfig.msPerStep)))
            this.state.drawConfig.penDownSpeed = derivedSpeed
            this.state.drawConfig.penUpSpeed = derivedSpeed
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'servoUp')) {
            this.state.drawConfig.servoUp = Math.max(0, this.constructor._parseInteger(patch.servoUp, this.state.drawConfig.servoUp))
            this.state.drawConfig.penUpPercent = this.constructor._servoValueToPercent(this.state.drawConfig.servoUp)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'servoDown')) {
            this.state.drawConfig.servoDown = Math.max(
                0,
                this.constructor._parseInteger(patch.servoDown, this.state.drawConfig.servoDown)
            )
            this.state.drawConfig.penDownPercent = this.constructor._servoValueToPercent(this.state.drawConfig.servoDown)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'invertPen')) {
            this.state.drawConfig.invertPen = this.constructor._parseBoolean(patch.invertPen, this.state.drawConfig.invertPen)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penUpPercent')) {
            this.state.drawConfig.penUpPercent = Math.max(
                0,
                Math.min(100, this.constructor._parseFloat(patch.penUpPercent, this.state.drawConfig.penUpPercent))
            )
            this.state.drawConfig.servoUp = this.constructor._percentToServoValue(this.state.drawConfig.penUpPercent)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penDownPercent')) {
            this.state.drawConfig.penDownPercent = Math.max(
                0,
                Math.min(100, this.constructor._parseFloat(patch.penDownPercent, this.state.drawConfig.penDownPercent))
            )
            this.state.drawConfig.servoDown = this.constructor._percentToServoValue(this.state.drawConfig.penDownPercent)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penDownSpeed')) {
            this.state.drawConfig.penDownSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(patch.penDownSpeed, this.state.drawConfig.penDownSpeed))
            )
            this.state.drawConfig.msPerStep = Math.max(0.2, Math.min(20, 1000 / this.state.drawConfig.penDownSpeed))
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penUpSpeed')) {
            this.state.drawConfig.penUpSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(patch.penUpSpeed, this.state.drawConfig.penUpSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penMotorSpeed')) {
            this.state.drawConfig.penMotorSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(patch.penMotorSpeed, this.state.drawConfig.penMotorSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'eggMotorSpeed')) {
            this.state.drawConfig.eggMotorSpeed = Math.max(
                10,
                Math.min(4000, this.constructor._parseInteger(patch.eggMotorSpeed, this.state.drawConfig.eggMotorSpeed))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRaiseRate')) {
            this.state.drawConfig.penRaiseRate = Math.max(
                1,
                Math.min(100, this.constructor._parseInteger(patch.penRaiseRate, this.state.drawConfig.penRaiseRate))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penRaiseDelayMs')) {
            this.state.drawConfig.penRaiseDelayMs = Math.max(
                0,
                Math.min(5000, this.constructor._parseInteger(patch.penRaiseDelayMs, this.state.drawConfig.penRaiseDelayMs))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penLowerRate')) {
            this.state.drawConfig.penLowerRate = Math.max(
                1,
                Math.min(100, this.constructor._parseInteger(patch.penLowerRate, this.state.drawConfig.penLowerRate))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'penLowerDelayMs')) {
            this.state.drawConfig.penLowerDelayMs = Math.max(
                0,
                Math.min(5000, this.constructor._parseInteger(patch.penLowerDelayMs, this.state.drawConfig.penLowerDelayMs))
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'reversePenMotor')) {
            this.state.drawConfig.reversePenMotor = this.constructor._parseBoolean(
                patch.reversePenMotor,
                this.state.drawConfig.reversePenMotor
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'reverseEggMotor')) {
            this.state.drawConfig.reverseEggMotor = this.constructor._parseBoolean(
                patch.reverseEggMotor,
                this.state.drawConfig.reverseEggMotor
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'wrapAround')) {
            this.state.drawConfig.wrapAround = this.constructor._parseBoolean(patch.wrapAround, this.state.drawConfig.wrapAround)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'returnHome')) {
            this.state.drawConfig.returnHome = this.constructor._parseBoolean(patch.returnHome, this.state.drawConfig.returnHome)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'printColorMode')) {
            this.state.drawConfig.printColorMode = this.constructor._normalizePrintColorMode(patch.printColorMode)
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'inkscapeSvgCompatMode')) {
            // Deprecated compatibility input: accepted for API stability but ignored at runtime.
            this.state.drawConfig.inkscapeSvgCompatMode = this.constructor._parseBoolean(
                patch.inkscapeSvgCompatMode,
                this.state.drawConfig.inkscapeSvgCompatMode
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'engraverEnabled')) {
            this.state.drawConfig.engraverEnabled = this.constructor._parseBoolean(
                patch.engraverEnabled,
                this.state.drawConfig.engraverEnabled
            )
            didMutateState = true
        }
        if (Object.hasOwn(patch, 'curveSmoothing')) {
            this.state.drawConfig.curveSmoothing = Math.max(
                0,
                Math.min(2, this.constructor._parseFloat(patch.curveSmoothing, this.state.drawConfig.curveSmoothing))
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
                    this.constructor._parseInteger(patch.manualWalkDistance, this.state.drawConfig.manualWalkDistance)
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

        if (requestedTransportSwitch) {
            await this.serial.switchTransportKind(requestedTransportSwitch)
        }

        if (didMutateState) {
            this._markProjectArtifactsDirty()
        }

        this._syncControlsFromState()
        if (shouldRerenderImportedPreview) {
            this._renderPattern({ skipImportedStatus: true })
        }
        return {
            message: 'Draw configuration updated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Rerolls seed and renders for WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpRerollSeed() {
        this._clearImportedPattern()
        this._rerollSeed()
        this._renderPattern()
        return {
            message: 'Seed rerolled and pattern regenerated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Re-renders pattern for WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpRegeneratePattern() {
        this._renderPattern()
        return {
            message: 'Pattern regenerated.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Imports SVG text from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Promise<Record<string, any>>}
     */
    async _webMcpImportSvgText(args) {
        if (this.isDrawing) {
            throw new Error('Pattern import is blocked while a draw run is active.')
        }
        const svgText = String(args?.svgText || '').trim()
        if (!svgText) {
            throw new Error('Missing svgText.')
        }
        const fileName = String(args?.fileName || 'webmcp-import.svg')
        const importedProjectName = SvgProjectNameUtils.resolveProjectName(svgText, fileName) || this._t('project.defaultName')
        if (Object.hasOwn(args || {}, 'importHeightScale')) {
            const nextScale = this.constructor._parseFloat(args.importHeightScale, this.state.importHeightScale)
            this.state.importHeightScale = ImportedPatternScaleUtils.clampScale(nextScale)
            this._markProjectArtifactsDirty()
        }

        this.isPatternImporting = true
        this._syncPatternImportUi()
        this._setStatus(this._t('messages.patternImportParsing', { name: fileName }), 'loading')
        try {
            const parsed = await this._parseImportedPattern(svgText)
            this.state.projectName = importedProjectName
            this.importedPattern = {
                name: importedProjectName,
                strokes: parsed.strokes,
                svgText,
                heightRatio: parsed.heightRatio,
                heightScale: this._resolveImportedPatternStoredHeightScale(),
                coordinateMode: parsed.coordinateMode === 'normalized-uv' ? 'normalized-uv' : 'document-px-centered',
                documentWidthPx: Math.max(1, Number(parsed.documentWidthPx) || 3200),
                documentHeightPx: Math.max(1, Number(parsed.documentHeightPx) || 800)
            }
            this._syncAutoGenerateOrnamentControlsUi()
            if (parsed.palette.length) {
                this._normalizePaletteLength(Math.max(1, Math.min(6, parsed.palette.length)))
                parsed.palette.slice(0, this.state.palette.length).forEach((color, index) => {
                    this.state.palette[index] = color
                })
            }
            if (parsed.baseColor) {
                this.state.baseColor = parsed.baseColor
            }
            this._normalizePaletteLength(this.state.palette.length)
            this._markProjectArtifactsDirty()
            this._syncControlsFromState()
            this._setStatus(this._t('messages.patternImportPreparingPreview', { name: fileName }), 'loading')
            await this._renderImportedPreviewAndWait()
            this._setStatus(
                this._t('messages.patternImported', {
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
                state: this._webMcpStateSnapshot()
            }
        } finally {
            this.isPatternImporting = false
            this._syncPatternImportUi()
        }
    }

    /**
     * Applies project JSON content from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpApplyProjectJson(args) {
        const candidate = args?.project
        let projectValue = candidate
        if (typeof candidate === 'string') {
            const text = candidate.trim()
            if (!text) {
                throw new Error('Project JSON text is empty.')
            }
            projectValue = JSON.parse(text)
        }
        this._clearImportedPattern()
        this.state = ProjectIoUtils.normalizeProjectState(projectValue)
        this.state.strokes = []
        this._markProjectArtifactsDirty()
        this._syncControlsFromState()
        this._renderPattern()
        return {
            message: 'Project applied from JSON.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Returns normalized project JSON payload for WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpGetProjectJson() {
        const payload = this._getProjectPayload()
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this._t('project.defaultFileStem'),
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
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Returns share URL for WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpGetShareUrl() {
        const shareUrl = this._buildProjectShareUrl()
        return {
            message: 'Share URL ready.',
            data: {
                shareUrl
            },
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Returns SVG export text for WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async _webMcpBuildExportSvg() {
        if (!(await this._ensureRenderedStrokesReady())) {
            throw new Error('No pattern available to export.')
        }
        const { contents, suggestedName } = await this._buildSvgExportData()
        return {
            message: 'SVG export payload ready.',
            data: {
                svgText: contents,
                suggestedName
            },
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Lists local projects for WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpLocalProjectsList() {
        const entries = this._loadSavedProjects()
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
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Stores current project in local storage for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpLocalProjectStore(args) {
        const name = String(args?.name || '').trim()
        if (!name) {
            throw new Error('Missing local project name.')
        }
        const entry = this._storeProjectLocallyByName(name)
        this._refreshSavedProjectsSelect(entry.id, { preferIdle: false })
        return {
            message: `Stored local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Loads one local project for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpLocalProjectLoad(args) {
        const id = String(args?.id || '').trim()
        if (!id) {
            throw new Error('Missing local project id.')
        }
        let entry
        try {
            entry = this._loadLocalProjectById(id)
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                throw new Error('Local project not found.')
            }
            throw error
        }
        this._refreshSavedProjectsSelect(id, { preferIdle: false })
        return {
            message: `Loaded local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Deletes one local project for WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
    _webMcpLocalProjectDelete(args) {
        const id = String(args?.id || '').trim()
        if (!id) {
            throw new Error('Missing local project id.')
        }
        let entry
        try {
            entry = this._deleteLocalProjectById(id)
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                throw new Error('Local project not found.')
            }
            throw error
        }
        this._refreshSavedProjectsSelect('', { preferIdle: false })
        return {
            message: `Deleted local project: ${entry.name}.`,
            data: {
                id: entry.id,
                name: entry.name
            },
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Connects EggBot serial from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async _webMcpSerialConnect() {
        await this._connectSerial()
        return {
            message: 'Connection attempt completed.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Disconnects EggBot serial from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async _webMcpSerialDisconnect() {
        await this._disconnectSerial()
        return {
            message: 'Disconnect attempt completed.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Starts EggBot drawing from WebMCP.
     * @returns {Promise<Record<string, any>>}
     */
    async _webMcpSerialDraw() {
        await this._drawCurrentPattern()
        return {
            message: 'Draw command completed.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Stops EggBot drawing from WebMCP.
     * @returns {Record<string, any>}
     */
    _webMcpSerialStop() {
        this.serial.stop()
        this._resolvePendingPenColorDialog(false)
        this._setStatus(this._t('messages.stopRequested'), 'info')
        return {
            message: 'Stop request sent.',
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Updates locale from WebMCP.
     * @param {Record<string, any>} args
     * @returns {Record<string, any>}
     */
}
