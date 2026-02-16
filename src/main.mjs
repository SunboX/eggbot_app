import { AppElements } from './AppElements.mjs'
import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'
import { PatternGenerator } from './PatternGenerator.mjs'
import { PatternRenderer2D } from './PatternRenderer2D.mjs'
import { EggScene } from './EggScene.mjs'
import { EggBotSerial } from './EggBotSerial.mjs'
import { ProjectIoUtils } from './ProjectIoUtils.mjs'
import { ProjectUrlUtils } from './ProjectUrlUtils.mjs'

const LOCAL_STORAGE_KEY = 'eggbot.savedProjects.v1'

/**
 * App orchestration for controls, rendering, persistence, and EggBot drawing.
 */
class AppController {
    constructor() {
        this.els = AppElements.query(document)
        this.state = AppRuntimeConfig.createDefaultState()
        this.state.strokes = []
        this.renderDebounceTimer = 0
        this.renderer2d = new PatternRenderer2D(this.els.textureCanvas)
        this.eggScene = new EggScene(this.els.eggCanvas)
        this.serial = new EggBotSerial()
        this.isDrawing = false
    }

    /**
     * Starts the app.
     * @returns {Promise<void>}
     */
    async init() {
        this.#syncControlsFromState()
        this.#applyProjectFromUrl()
        this.#bindEvents()
        this.#refreshSavedProjectsSelect()
        this.#renderPattern({ reason: 'initialization' })
        this.#syncConnectionUi()
    }

    /**
     * Writes status text and type.
     * @param {string} text
     * @param {'info' | 'success' | 'error'} [type='info']
     */
    #setStatus(text, type = 'info') {
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
            this.state = ProjectIoUtils.normalizeProjectState(payload)
            this.state.strokes = []
            this.#syncControlsFromState()
            this.#setStatus('Loaded project from shared URL.', 'success')
        } catch (error) {
            this.#setStatus(`Failed to load shared project: ${error.message}`, 'error')
        }
    }

    /**
     * Binds UI event listeners.
     */
    #bindEvents() {
        this.els.projectName.addEventListener('input', () => {
            this.state.projectName = this.els.projectName.value.trim() || 'Sorbische Komposition'
        })

        this.els.preset.addEventListener('change', () => {
            this.state.preset = this.els.preset.value
            this.state.motifs = AppRuntimeConfig.presetMotifs(this.state.preset)
            this.#syncMotifControls()
            this.#scheduleRender('preset changed')
        })

        this.els.seed.addEventListener('change', () => {
            this.state.seed = AppController.#parseInteger(this.els.seed.value, this.state.seed)
            this.#scheduleRender('seed changed')
        })

        this.els.rerollSeed.addEventListener('click', () => {
            this.#rerollSeed()
            this.#renderPattern({ reason: 'seed reroll' })
        })

        this.els.regenerate.addEventListener('click', () => {
            this.#rerollSeed()
            this.#renderPattern({ reason: 'manual regenerate' })
        })

        this.els.symmetry.addEventListener('input', () => {
            this.state.symmetry = AppController.#parseInteger(this.els.symmetry.value, this.state.symmetry)
            this.els.symmetryLabel.textContent = String(this.state.symmetry)
            this.#scheduleRender('symmetry changed')
        })

        this.els.density.addEventListener('input', () => {
            this.state.density = AppController.#parseFloat(this.els.density.value, this.state.density)
            this.els.densityLabel.textContent = this.state.density.toFixed(2)
            this.#scheduleRender('density changed')
        })

        this.els.bands.addEventListener('input', () => {
            this.state.bands = AppController.#parseInteger(this.els.bands.value, this.state.bands)
            this.els.bandsLabel.textContent = String(this.state.bands)
            this.#scheduleRender('bands changed')
        })

        this.els.lineWidth.addEventListener('input', () => {
            this.state.lineWidth = AppController.#parseFloat(this.els.lineWidth.value, this.state.lineWidth)
            this.els.lineWidthLabel.textContent = this.state.lineWidth.toFixed(1)
            this.#scheduleRender('line width changed')
        })
        this.els.showHorizontalLines.addEventListener('change', () => {
            this.state.showHorizontalLines = this.els.showHorizontalLines.checked
            this.#scheduleRender('horizontal lines toggled')
        })

        this.els.baseColor.addEventListener('input', () => {
            this.state.baseColor = this.els.baseColor.value
            this.#scheduleRender('base color changed')
        })

        this.els.colorCount.addEventListener('change', () => {
            this.#normalizePaletteLength(AppController.#parseInteger(this.els.colorCount.value, this.state.palette.length))
            this.#renderPaletteControls()
            this.#scheduleRender('color count changed')
        })

        this.els.motifDots.addEventListener('change', () => {
            this.state.motifs.dots = this.els.motifDots.checked
            this.#scheduleRender('motifs changed')
        })
        this.els.motifRays.addEventListener('change', () => {
            this.state.motifs.rays = this.els.motifRays.checked
            this.#scheduleRender('motifs changed')
        })
        this.els.motifHoneycomb.addEventListener('change', () => {
            this.state.motifs.honeycomb = this.els.motifHoneycomb.checked
            this.#scheduleRender('motifs changed')
        })
        this.els.motifWolfTeeth.addEventListener('change', () => {
            this.state.motifs.wolfTeeth = this.els.motifWolfTeeth.checked
            this.#scheduleRender('motifs changed')
        })
        this.els.motifPine.addEventListener('change', () => {
            this.state.motifs.pineBranch = this.els.motifPine.checked
            this.#scheduleRender('motifs changed')
        })
        this.els.motifDiamond.addEventListener('change', () => {
            this.state.motifs.diamonds = this.els.motifDiamond.checked
            this.#scheduleRender('motifs changed')
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
        this.els.stopButton.addEventListener('click', () => {
            this.serial.stop()
            this.#setStatus('Stop requested. Finishing current move and lifting pen.', 'info')
        })

        this.els.saveProject.addEventListener('click', () => this.#saveProjectToFile())
        this.els.loadProject.addEventListener('click', () => this.#loadProjectFromFile())
        this.els.shareProject.addEventListener('click', () => this.#shareProjectUrl())
        this.els.storeLocal.addEventListener('click', () => this.#storeProjectLocally())
        this.els.loadLocal.addEventListener('click', () => this.#loadSelectedLocalProject())
        this.els.deleteLocal.addEventListener('click', () => this.#deleteSelectedLocalProject())
    }

    /**
     * Regenerates the pattern and updates 2D/3D output.
     * @param {{ reason: string }} meta
     */
    #renderPattern(meta) {
        this.state.strokes = PatternGenerator.generate(this.state)
        this.renderer2d.render({
            baseColor: this.state.baseColor,
            lineWidth: this.state.lineWidth,
            palette: this.state.palette,
            strokes: this.state.strokes,
            showGuides: this.state.showHorizontalLines
        })
        this.eggScene.updateTexture(this.els.textureCanvas)
        this.#setStatus(
            `Pattern generated (${this.state.strokes.length} strokes, seed ${this.state.seed}). Reason: ${meta.reason}`,
            'success'
        )
    }

    /**
     * Schedules a delayed render for slider/input changes.
     * @param {string} reason
     */
    #scheduleRender(reason) {
        clearTimeout(this.renderDebounceTimer)
        this.renderDebounceTimer = window.setTimeout(() => {
            this.#renderPattern({ reason })
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
            wrapper.textContent = `Color ${index + 1}`

            const input = document.createElement('input')
            input.type = 'color'
            input.value = color
            input.dataset.index = String(index)
            input.addEventListener('input', () => {
                const targetIndex = AppController.#parseInteger(input.dataset.index, index)
                this.state.palette[targetIndex] = input.value
                this.#scheduleRender('palette updated')
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
            this.#setStatus(`EggBot connected: ${version}`, 'success')
            this.#syncConnectionUi()
        } catch (error) {
            this.#setStatus(`Serial connect failed: ${error.message}`, 'error')
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
            this.#setStatus('EggBot disconnected.', 'info')
        } catch (error) {
            this.#setStatus(`Disconnect failed: ${error.message}`, 'error')
        }
        this.#syncConnectionUi()
    }

    /**
     * Executes a draw run for current strokes.
     * @returns {Promise<void>}
     */
    async #drawCurrentPattern() {
        if (!this.state.strokes.length) {
            this.#setStatus('No pattern to draw yet. Generate one first.', 'error')
            return
        }
        if (!this.serial.isConnected) {
            this.#setStatus('Connect EggBot before drawing.', 'error')
            return
        }

        this.isDrawing = true
        this.#syncConnectionUi()

        try {
            await this.serial.drawStrokes(this.state.strokes, this.state.drawConfig, {
                onStatus: (text) => this.#setStatus(text, 'info'),
                onProgress: (done, total) =>
                    this.#setStatus(`Drawing in progress: stroke ${done}/${total}`, 'info')
            })
            this.#setStatus('EggBot draw command stream completed.', 'success')
        } catch (error) {
            this.#setStatus(`Draw failed: ${error.message}`, 'error')
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
     * Saves current project JSON to file.
     * @returns {Promise<void>}
     */
    async #saveProjectToFile() {
        const payload = ProjectIoUtils.buildProjectPayload(this.state)
        const contents = JSON.stringify(payload, null, 2)
        const suggestedName = `${(this.state.projectName || 'eggbot-pattern').replace(/\s+/g, '-').toLowerCase()}.json`

        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: 'Project JSON',
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this.#setStatus(`Project saved: ${handle.name || suggestedName}`, 'success')
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
            this.#setStatus(`Project downloaded: ${suggestedName}`, 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus('Save canceled.', 'info')
                return
            }
            this.#setStatus(`Save failed: ${error.message}`, 'error')
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
                this.#setStatus('Load canceled.', 'info')
                return
            }
            const rawText = await file.text()
            const rawProject = JSON.parse(rawText)
            this.state = ProjectIoUtils.normalizeProjectState(rawProject)
            this.state.strokes = []
            this.#syncControlsFromState()
            this.#renderPattern({ reason: `project loaded (${file.name})` })
            this.#setStatus(`Loaded project: ${file.name}`, 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus('Load canceled.', 'info')
                return
            }
            this.#setStatus(`Load failed: ${error.message}`, 'error')
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
                        description: 'Project JSON',
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
                this.#setStatus('Project URL shared.', 'success')
                return
            }

            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl)
                this.#setStatus('Project URL copied to clipboard.', 'success')
                return
            }

            window.prompt('Copy this project URL:', shareUrl)
            this.#setStatus('Project URL ready to copy.', 'info')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.#setStatus('Share canceled.', 'info')
                return
            }
            this.#setStatus(`Share failed: ${error.message}`, 'error')
        }
    }

    /**
     * Stores current project payload in localStorage.
     */
    #storeProjectLocally() {
        const name = window.prompt('Store project as name:', this.state.projectName || 'New pattern')
        if (!name) {
            this.#setStatus('Store canceled.', 'info')
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
        this.#setStatus(`Stored local project: ${name}`, 'success')
    }

    /**
     * Loads selected local project.
     */
    #loadSelectedLocalProject() {
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus('No local project selected.', 'info')
            return
        }
        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this.#setStatus('Selected local project was not found.', 'error')
            this.#refreshSavedProjectsSelect()
            return
        }

        try {
            this.state = ProjectIoUtils.normalizeProjectState(entry.payload)
            this.state.strokes = []
            this.#syncControlsFromState()
            this.#renderPattern({ reason: `local load (${entry.name})` })
            this.#setStatus(`Loaded local project: ${entry.name}`, 'success')
        } catch (error) {
            this.#setStatus(`Local load failed: ${error.message}`, 'error')
        }
    }

    /**
     * Deletes the selected local project.
     */
    #deleteSelectedLocalProject() {
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this.#setStatus('No local project selected for deletion.', 'info')
            return
        }

        const entries = this.#loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this.#setStatus('Selected local project was not found.', 'error')
            this.#refreshSavedProjectsSelect()
            return
        }

        const confirmed = window.confirm(`Delete local project "${entry.name}"?`)
        if (!confirmed) {
            this.#setStatus('Delete canceled.', 'info')
            return
        }

        const filtered = entries.filter((candidate) => candidate.id !== selectedId)
        this.#saveSavedProjects(filtered)
        this.#refreshSavedProjectsSelect()
        this.#setStatus(`Deleted local project: ${entry.name}`, 'success')
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
        const entries = this.#loadSavedProjects().sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt)
        })

        this.els.localPatterns.innerHTML = ''

        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = entries.length ? 'Choose local project' : 'No local projects stored'
        this.els.localPatterns.appendChild(placeholder)

        entries.forEach((entry) => {
            const option = document.createElement('option')
            option.value = entry.id
            option.textContent = `${entry.name} (${new Date(entry.updatedAt).toLocaleString()})`
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

const app = new AppController()
app.init().catch((error) => {
    console.error(error)
})
