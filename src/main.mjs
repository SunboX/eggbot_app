import { AppElements } from './AppElements.mjs'
import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'
import { PatternGenerator } from './PatternGenerator.mjs'
import { PatternRenderer2D } from './PatternRenderer2D.mjs'
import { EggScene } from './EggScene.mjs'
import { EggBotSerial } from './EggBotSerial.mjs'
import { ProjectIoUtils } from './ProjectIoUtils.mjs'
import { ProjectUrlUtils } from './ProjectUrlUtils.mjs'
import { I18n } from './I18n.mjs'
import { SvgPatternImportUtils } from './SvgPatternImportUtils.mjs'

const LOCAL_STORAGE_KEY = 'eggbot.savedProjects.v1'

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
        this.isDrawing = false
        this.i18n = i18n
        this.importedPattern = null
    }

    /**
     * Starts the app.
     * @returns {Promise<void>}
     */
    async init() {
        this.#applyLocaleToUi()
        this.#syncControlsFromState()
        this.#applyProjectFromUrl()
        this.#bindEvents()
        this.#refreshSavedProjectsSelect()
        this.#renderPattern()
        this.#syncConnectionUi()
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
     * Clears imported pattern mode and returns true if one was active.
     * @returns {boolean}
     */
    #clearImportedPattern() {
        if (!this.importedPattern) return false
        this.importedPattern = null
        return true
    }

    /**
     * Writes status text and type.
     * @param {string} text
     * @param {'info' | 'success' | 'error'} [type='info']
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

        this.els.lineWidth.addEventListener('input', () => {
            this.state.lineWidth = AppController.#parseFloat(this.els.lineWidth.value, this.state.lineWidth)
            this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
            this.#scheduleRender()
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
        this.els.loadProject.addEventListener('click', () => this.#loadProjectFromFile())
        this.els.shareProject.addEventListener('click', () => this.#shareProjectUrl())
        this.els.storeLocal.addEventListener('click', () => this.#storeProjectLocally())
        if (this.els.loadLocal) {
            this.els.loadLocal.addEventListener('click', () => this.#loadSelectedLocalProject())
        }
        if (this.els.deleteLocal) {
            this.els.deleteLocal.addEventListener('click', () => this.#deleteSelectedLocalProject())
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
     * Regenerates the pattern and updates 2D/3D output.
     */
    #renderPattern() {
        this.state.strokes = this.importedPattern ? this.importedPattern.strokes : PatternGenerator.generate(this.state)
        this.renderer2d.render({
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth,
            palette: this.state.palette,
            strokes: this.state.strokes,
            showGuides: this.state.showHorizontalLines
        })
        this.eggScene.updateTexture(this.els.textureCanvas)
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
        this.els.lineWidth.value = String(this.state.lineWidth)
        this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
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
        if (!this.serial.isConnected) {
            this.#setStatus(this.#t('messages.connectBeforeDraw'), 'error')
            return
        }

        this.isDrawing = true
        this.#syncConnectionUi()

        try {
            await this.serial.drawStrokes(this.state.strokes, this.state.drawConfig, {
                onStatus: (text) => this.#setStatus(text, 'info'),
                onProgress: (done, total) => this.#setStatus(this.#t('messages.drawingProgress', { done, total }), 'info')
            })
            this.#setStatus(this.#t('messages.drawCompleted'), 'success')
        } catch (error) {
            this.#setStatus(this.#t('messages.drawFailed', { message: error.message }), 'error')
        } finally {
            this.isDrawing = false
            this.#syncConnectionUi()
        }
    }

    /**
     * Syncs machine control button enabled states.
     */
    #syncConnectionUi() {
        const connected = this.serial.isConnected
        this.els.serialConnect.disabled = connected || this.isDrawing
        this.els.serialDisconnect.disabled = !connected || this.isDrawing
        this.els.drawButton.disabled = !connected || this.isDrawing
        this.els.stopButton.disabled = !this.isDrawing
    }

    /**
     * Imports an SVG pattern file and switches render mode to imported strokes.
     * @returns {Promise<void>}
     */
    async #loadPatternFromFile() {
        let fileName = 'unknown'
        let debugGroupOpened = false
        try {
            if (typeof console.groupCollapsed === 'function') {
                console.groupCollapsed('[PatternImport] Start')
                debugGroupOpened = true
            }
            const file = await this.#promptForPatternFile()
            if (!file) {
                console.info('[PatternImport] Canceled by user')
                this.#setStatus(this.#t('messages.patternImportCanceled'), 'info')
                return
            }

            fileName = String(file.name || 'unknown.svg')
            console.info('[PatternImport] File selected', {
                name: fileName,
                size: file.size,
                type: file.type || 'n/a'
            })

            const svgText = await file.text()
            console.info('[PatternImport] File read complete', {
                name: fileName,
                chars: svgText.length
            })

            const parsed = SvgPatternImportUtils.parse(svgText, {
                maxColors: 6,
                debug: true,
                sourceName: fileName
            })
            console.info('[PatternImport] Parse completed', {
                name: fileName,
                strokes: parsed.strokes.length,
                colors: parsed.palette.length
            })

            this.importedPattern = {
                name: file.name,
                strokes: parsed.strokes
            }

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
            this.#renderPattern()
        } catch (error) {
            console.error('[PatternImport] Import failed', {
                name: fileName,
                message: String(error?.message || error),
                stack: String(error?.stack || '')
            })
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
            this.#setStatus(this.#t('messages.patternImportFailed', { message: error.message }), 'error')
        } finally {
            if (debugGroupOpened && typeof console.groupEnd === 'function') {
                console.groupEnd()
            }
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
        const suggestedName = `${(this.state.projectName || this.#t('project.defaultFileStem')).replace(/\s+/g, '-').toLowerCase()}.json`

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
