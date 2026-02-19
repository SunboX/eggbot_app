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
import { PatternImportWorkerClient } from './PatternImportWorkerClient.mjs'
import { PatternImportControlUtils } from './PatternImportControlUtils.mjs'
const LOCAL_STORAGE_KEY = 'eggbot.savedProjects.v1'
const IMPORT_HEIGHT_REFERENCE = 800
const SVG_EXPORT_WIDTH = 2048
const SVG_EXPORT_HEIGHT = 1024
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
        this.renderer2d = new PatternRenderer2D(this.els.textureCanvas)
        this.eggScene = new EggScene(this.els.eggCanvas)
        this.serial = new EggBotSerial()
        this.patternImportWorker = new PatternImportWorkerClient()
        this.isDrawing = false
        this.isPatternImporting = false
        this.i18n = i18n
        this.importedPattern = null
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
        this.#syncControlsFromState()
        this.#applyProjectFromUrl()
        this.#bindEvents()
        this.#bindSerialLifecycleEvents()
        this.els.textureCanvas.addEventListener('pattern-rendered', () => this.eggScene.updateTexture(this.els.textureCanvas))
        this.#refreshSavedProjectsSelect()
        this.#renderPattern()
        this.#syncConnectionUi()
        this.#syncPatternImportUi()
        this.#syncAutoGenerateOrnamentControlsUi()
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
        this.els.stepsPerTurn.addEventListener('change', () => {
            this.state.drawConfig.stepsPerTurn = AppController.#parseInteger(
                this.els.stepsPerTurn.value,
                this.state.drawConfig.stepsPerTurn
            )
        })
        this.els.penRangeSteps.addEventListener('change', () => {
            this.state.drawConfig.penRangeSteps = AppController.#parseInteger(
                this.els.penRangeSteps.value,
                this.state.drawConfig.penRangeSteps
            )
        })
        this.els.msPerStep.addEventListener('change', () => {
            this.state.drawConfig.msPerStep = AppController.#parseFloat(
                this.els.msPerStep.value,
                this.state.drawConfig.msPerStep
            )
        })
        this.els.servoUp.addEventListener('change', () => {
            this.state.drawConfig.servoUp = AppController.#parseInteger(
                this.els.servoUp.value,
                this.state.drawConfig.servoUp
            )
        })
        this.els.servoDown.addEventListener('change', () => {
            this.state.drawConfig.servoDown = AppController.#parseInteger(
                this.els.servoDown.value,
                this.state.drawConfig.servoDown
            )
        })
        this.els.invertPen.addEventListener('change', () => {
            this.state.drawConfig.invertPen = this.els.invertPen.checked
        })
        this.els.serialConnect.addEventListener('click', () => this.#connectSerial())
        this.els.serialDisconnect.addEventListener('click', () => this.#disconnectSerial())
        this.els.drawButton.addEventListener('click', () => this.#drawCurrentPattern())
        this.els.loadPattern.addEventListener('click', () => this.#loadPatternFromFile())
        this.els.stopButton.addEventListener('click', () => {
            this.serial.stop()
            this.#setStatus(this.#t('messages.stopRequested'), 'info')
        })
        this.els.saveProject.addEventListener('click', () => this.#saveProjectToFile())
        this.els.exportSvg.addEventListener('click', () => this.#exportPatternToSvg())
        this.els.loadProject.addEventListener('click', () => this.#loadProjectFromFile())
        this.els.shareProject.addEventListener('click', () => this.#shareProjectUrl())
        if (this.els.storeLocal) {
            this.els.storeLocal.addEventListener('click', () => this.#storeProjectLocally())
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
        const selectedLocalProjectId = this.els.localPatterns ? this.els.localPatterns.value : ''
        this.#refreshSavedProjectsSelect(selectedLocalProjectId)
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
     * Regenerates the pattern and updates 2D/3D output.
     * @param {{ skipImportedStatus?: boolean }} [options]
     */
    #renderPattern(options = {}) {
        const skipImportedStatus = Boolean(options.skipImportedStatus)
        const importedSvgText = this.importedPattern ? String(this.importedPattern.svgText || '') : ''
        const importedSvgHeightRatio = this.#resolveActiveRenderHeightRatio()
        this.state.strokes = this.#buildRenderedStrokes()
        this.renderer2d.render({
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth,
            palette: this.state.palette,
            strokes: this.state.strokes,
            importedSvgText,
            importedSvgHeightRatio
        })
        if (!importedSvgText) {
            this.eggScene.updateTexture(this.els.textureCanvas)
        }
        if (skipImportedStatus) return
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
        this.els.baseColor.value = this.state.baseColor
        this.#normalizePaletteLength(this.state.palette.length)
        this.els.colorCount.value = String(this.state.palette.length)
        this.#syncMotifControls()
        this.#renderPaletteControls()
        this.els.stepsPerTurn.value = String(this.state.drawConfig.stepsPerTurn)
        this.els.penRangeSteps.value = String(this.state.drawConfig.penRangeSteps)
        this.els.msPerStep.value = String(this.state.drawConfig.msPerStep)
        this.els.servoUp.value = String(this.state.drawConfig.servoUp)
        this.els.servoDown.value = String(this.state.drawConfig.servoDown)
        this.els.invertPen.checked = Boolean(this.state.drawConfig.invertPen)
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
     * Opens Web Serial and refreshes UI.
     * @returns {Promise<void>}
     */
    async #connectSerial() {
        try {
            const version = await this.serial.connect()
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
        if (!this.state.strokes.length) {
            this.#setStatus(this.#t('messages.noPatternToDraw'), 'error')
            return
        }
        if (this.isDrawing) {
            return
        }

        let connectingBeforeDraw = false
        this.isDrawing = true
        this.#syncConnectionUi()

        try {
            if (!this.serial.isConnected) {
                connectingBeforeDraw = true
                this.#setStatus(this.#t('messages.connectingBeforeDraw'), 'loading')
                const version = await this.serial.connectForDraw()
                connectingBeforeDraw = false
                this.#setStatus(this.#t('messages.eggbotConnected', { version }), 'success')
                this.#syncConnectionUi()
            }

            await this.serial.drawStrokes(this.state.strokes, this.state.drawConfig, {
                onStatus: (text) => this.#setStatus(text, 'info'),
                onProgress: (done, total) => this.#setStatus(this.#t('messages.drawingProgress', { done, total }), 'info')
            })
            this.#setStatus(this.#t('messages.drawCompleted'), 'success')
        } catch (error) {
            if (connectingBeforeDraw) {
                this.#setStatus(this.#t('messages.serialConnectFailed', { message: error.message }), 'error')
            } else {
                this.#setStatus(this.#t('messages.drawFailed', { message: error.message }), 'error')
            }
        } finally {
            this.isDrawing = false
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
            this.importedPattern = {
                name: file.name,
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
            this.#setStatus(this.#t('messages.patternImportPreparingPreview', { name: fileName }), 'loading')
            await this.#renderImportedPreviewAndWait()
            this.#setStatus(
                this.#t('messages.patternImported', {
                    name: file.name,
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
        const payload = ProjectIoUtils.buildProjectPayload(this.state)
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
     * Exports the visible pattern as an SVG file.
     * @returns {Promise<void>}
     */
    async #exportPatternToSvg() {
        if (!this.state.strokes.length) {
            this.#renderPattern({ skipImportedStatus: true })
        }
        if (!this.state.strokes.length) {
            this.#setStatus(this.#t('messages.noPatternToDraw'), 'error')
            return
        }

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
        const contents = PatternSvgExportUtils.buildSvg({
            strokes: this.state.strokes,
            palette: this.state.palette,
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth * 2.4,
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
        })

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
            this.#syncControlsFromState()
            this.#renderPattern()
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
            const payload = ProjectIoUtils.buildProjectPayload(this.state)
            const encoded = ProjectUrlUtils.encodeProjectPayloadParam(payload)
            const url = new URL(window.location.href)
            url.searchParams.set(ProjectUrlUtils.PROJECT_PARAM, encoded)
            const shareUrl = url.toString()
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
        const entries = this.#loadSavedProjects()
        const payload = ProjectIoUtils.buildProjectPayload(this.state)
        const id = `pattern-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        entries.push({
            id,
            name,
            updatedAt: new Date().toISOString(),
            payload
        })
        this.#saveSavedProjects(entries)
        this.#refreshSavedProjectsSelect(id)
        this.#setStatus(this.#t('messages.storedLocalProject', { name }), 'success')
    }
    /**
     * Loads selected local project.
     */
    #loadSelectedLocalProject() {
        if (!this.els.localPatterns) return
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus(this.#t('messages.noLocalProjectSelected'), 'info')
            return
        }
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this.#setStatus(this.#t('messages.localProjectNotFound'), 'error')
            this.#refreshSavedProjectsSelect()
            return
        }
        try {
            this.#clearImportedPattern()
            this.state = ProjectIoUtils.normalizeProjectState(entry.payload)
            this.state.strokes = []
            this.#syncControlsFromState()
            this.#renderPattern()
            this.#setStatus(this.#t('messages.loadedLocalProject', { name: entry.name }), 'success')
        } catch (error) {
            this.#setStatus(this.#t('messages.localLoadFailed', { message: error.message }), 'error')
        }
    }
    /**
     * Deletes the selected local project.
     */
    #deleteSelectedLocalProject() {
        if (!this.els.localPatterns) return
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus(this.#t('messages.noLocalProjectSelectedForDelete'), 'info')
            return
        }
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this.#setStatus(this.#t('messages.localProjectNotFound'), 'error')
            this.#refreshSavedProjectsSelect()
            return
        }
        const confirmed = window.confirm(this.#t('messages.deleteLocalProjectConfirm', { name: entry.name }))
        if (!confirmed) {
            this.#setStatus(this.#t('messages.deleteCanceled'), 'info')
            return
        }
        const filtered = entries.filter((candidate) => candidate.id !== selectedId)
        this.#saveSavedProjects(filtered)
        this.#refreshSavedProjectsSelect()
        this.#setStatus(this.#t('messages.deletedLocalProject', { name: entry.name }), 'success')
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
     */
    #refreshSavedProjectsSelect(preferredId = '') {
        if (!this.els.localPatterns) return
        const entries = this.#loadSavedProjects().sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt)
        })
        this.els.localPatterns.innerHTML = ''
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = entries.length
            ? this.#t('local.choosePlaceholder')
            : this.#t('local.nonePlaceholder')
        this.els.localPatterns.appendChild(placeholder)
        entries.forEach((entry) => {
            const option = document.createElement('option')
            option.value = entry.id
            option.textContent = this.#t('local.entryLabel', {
                name: entry.name,
                updatedAt: new Date(entry.updatedAt).toLocaleString(this.i18n.locale)
            })
            if (preferredId && entry.id === preferredId) {
                option.selected = true
            }
            this.els.localPatterns.appendChild(option)
        })
        if (!preferredId) {
            this.els.localPatterns.value = ''
        }
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
