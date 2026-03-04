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
import { AppControllerDraw } from './AppControllerDraw.mjs'

/**
 * AppControllerProjects segment of the application controller.
 */
export class AppControllerProjects extends AppControllerDraw {
    async _reparseImportedPatternFromCurrentSettings() {
        if (!this.importedPattern?.svgText) return
        if (
            PatternImportRuntimeGuards.isImportInteractionBlocked({
                isPatternImporting: this.isPatternImporting,
                isDrawing: this.isDrawing
            })
        ) {
            if (this.isDrawing) {
                this._setStatus(this._t('messages.patternImportBlockedWhileDrawing'), 'info')
            }
            return
        }
        const importedPatternName = String(this.importedPattern.name || this._t('project.defaultName'))
        clearTimeout(this.renderDebounceTimer)
        this.isPatternImporting = true
        this._syncPatternImportUi()
        this._setStatus(this._t('messages.patternImportParsing', { name: importedPatternName }), 'loading')

        try {
            const parsed = await this._parseImportedPattern(this.importedPattern.svgText)
            if (!this.importedPattern) return
            this.importedPattern.strokes = parsed.strokes
            this.importedPattern.heightRatio = parsed.heightRatio
            this.importedPattern.heightScale = this._resolveImportedPatternStoredHeightScale()
            this.importedPattern.documentWidthPx = Math.max(1, Number(parsed.documentWidthPx) || 3200)
            this.importedPattern.documentHeightPx = Math.max(1, Number(parsed.documentHeightPx) || 800)
            this._setStatus(this._t('messages.patternImportPreparingPreview', { name: importedPatternName }), 'loading')
            await this._renderImportedPreviewAndWait()
            this._setStatus(
                this._t('messages.patternImported', {
                    name: importedPatternName,
                    count: this.state.strokes.length
                }),
                'success'
            )
        } catch (error) {
            this._setImportedPatternErrorStatus(error)
        } finally {
            this.isPatternImporting = false
            this._syncPatternImportUi()
        }
    }

    /**
     * Enables/disables auto-generated ornament controls for imported SVG mode.
     */
    _syncAutoGenerateOrnamentControlsUi() {
        const disableAutoGenerateOrnaments = Boolean(this.importedPattern)
        PatternImportControlUtils.setAutoGenerateOrnamentControlsDisabled(
            this.autoGenerateOrnamentControls,
            disableAutoGenerateOrnaments
        )
    }

    /**
     * Parses imported SVG in worker thread.
     * @param {string} svgText
     * @returns {Promise<{ strokes: Array<{ colorIndex: number, points: Array<{u:number,v:number}>, closed?: boolean, fillGroupId?: number | null, fillAlpha?: number, fillRule?: 'nonzero' | 'evenodd' }>, palette: string[], baseColor?: string, heightRatio?: number, documentWidthPx?: number, documentHeightPx?: number }>}
     */
    async _parseImportedPattern(svgText) {
        return this.patternImportWorker.parse(svgText, this._resolveImportedPatternParseOptions())
    }

    /**
     * Imports an SVG pattern file and switches render mode to imported strokes.
     * @returns {Promise<void>}
     */
    async _loadPatternFromFile() {
        let fileName = 'unknown.svg'
        try {
            if (
                PatternImportRuntimeGuards.isImportInteractionBlocked({
                    isPatternImporting: this.isPatternImporting,
                    isDrawing: this.isDrawing
                })
            ) {
                if (this.isDrawing) {
                    this._setStatus(this._t('messages.patternImportBlockedWhileDrawing'), 'info')
                }
                return
            }
            const file = await this._promptForPatternFile()
            if (!file) {
                this._setStatus(this._t('messages.patternImportCanceled'), 'info')
                return
            }
            fileName = String(file.name || 'unknown.svg')
            this.isPatternImporting = true
            this._syncPatternImportUi()
            this._setStatus(this._t('messages.patternImportReading', { name: fileName }), 'loading')
            const svgText = await file.text()
            this._setStatus(this._t('messages.patternImportParsing', { name: fileName }), 'loading')
            const parsed = await this._parseImportedPattern(svgText)
            const importedProjectName =
                SvgProjectNameUtils.resolveProjectName(svgText, fileName) || this._t('project.defaultName')
            this.state.projectName = importedProjectName
            this.els.projectName.value = importedProjectName
            this.importedPattern = {
                name: importedProjectName,
                strokes: parsed.strokes,
                svgText,
                heightRatio: parsed.heightRatio,
                heightScale: this._resolveImportedPatternStoredHeightScale(),
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
                this.els.baseColor.value = parsed.baseColor
            }
            this.els.colorCount.value = String(this.state.palette.length)
            this._renderPaletteControls()
            this._markProjectArtifactsDirty()
            this._setStatus(this._t('messages.patternImportPreparingPreview', { name: fileName }), 'loading')
            await this._renderImportedPreviewAndWait()
            this._setStatus(
                this._t('messages.patternImported', {
                    name: importedProjectName,
                    count: this.state.strokes.length
                }),
                'success'
            )
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.patternImportCanceled'), 'info')
                return
            }
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
            this._setStatus(this._t('messages.patternImportFailed', { message: error.message }), 'error')
        } finally {
            this.isPatternImporting = false
            this._syncPatternImportUi()
        }
    }

    /**
     * Prompts for an SVG pattern file.
     * @returns {Promise<File | null>}
     */
    async _promptForPatternFile() {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: this._t('messages.patternFileDescription'),
                        accept: { 'image/svg+xml': ['.svg'] }
                    }
                ]
            })
            return handle ? handle.getFile() : null
        }
        return FileInputPromptUtils.promptSingleFile({
            input: this.els.patternInput,
            windowObject: window
        })
    }

    /**
     * Saves current project JSON to file.
     * @returns {Promise<void>}
     */
    async _saveProjectToFile() {
        const payload = this._getProjectPayload()
        const contents = JSON.stringify(payload, null, 2)
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this._t('project.defaultFileStem'),
            this.state.seed,
            'json'
        )
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: this._t('messages.projectJsonDescription'),
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this._setStatus(this._t('messages.projectSaved', { name: handle.name || suggestedName }), 'success')
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
            this._setStatus(this._t('messages.projectDownloaded', { name: suggestedName }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.saveCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.saveFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Exports the current settings snapshot as JSON file.
     * @returns {Promise<void>}
     */
    async _exportSettingsToFile() {
        const payload = this._getProjectPayload()
        const contents = JSON.stringify(payload, null, 2)
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            `${this._t('project.defaultFileStem')}-settings`,
            this.state.seed,
            'json'
        )
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: this._t('messages.settingsJsonDescription'),
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this._setStatus(this._t('messages.settingsExported', { name: handle.name || suggestedName }), 'success')
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
            this._setStatus(this._t('messages.settingsDownloaded', { name: suggestedName }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.settingsExportCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.settingsExportFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Imports settings from a JSON file and applies them.
     * @returns {Promise<void>}
     */
    async _importSettingsFromFile() {
        if (this.isDrawing) {
            this._setStatus(this._t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        try {
            const file = await this._promptForProjectFile({
                descriptionKey: 'messages.settingsJsonDescription'
            })
            if (!file) {
                this._setStatus(this._t('messages.settingsImportCanceled'), 'info')
                return
            }
            const rawText = await file.text()
            const rawProject = JSON.parse(rawText)
            await this._applyProjectPayload(rawProject)
            this._setStatus(this._t('messages.settingsImported', { name: file.name }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.settingsImportCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.settingsImportFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Resets all settings to application defaults.
     * @returns {Promise<void>}
     */
    async _resetSettingsToDefaults() {
        if (this.isDrawing) {
            this._setStatus(this._t('messages.controlDialogBusyDrawing'), 'error')
            return
        }
        const shouldReset = window.confirm(this._t('messages.settingsResetConfirm'))
        if (!shouldReset) {
            this._setStatus(this._t('messages.settingsResetCanceled'), 'info')
            return
        }
        try {
            await this._applyProjectPayload(AppRuntimeConfig.createDefaultState())
            this._setStatus(this._t('messages.settingsResetDone'), 'success')
        } catch (error) {
            this._setStatus(this._t('messages.settingsResetFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Applies one raw project payload to runtime state and refreshes controls/preview.
     * @param {Record<string, any>} rawProject
     * @returns {Promise<void>}
     */
    async _applyProjectPayload(rawProject) {
        this._clearImportedPattern()
        this.state = ProjectIoUtils.normalizeProjectState(rawProject)
        this.state.strokes = []
        this._markProjectArtifactsDirty()
        this._syncControlsFromState()
        this._renderPattern({ skipImportedStatus: true })
        await this._ensureRenderedStrokesReady()
    }

    /**
     * Ensures a current rendered stroke set exists, including pending async worker runs.
     * @returns {Promise<boolean>}
     */
    async _ensureRenderedStrokesReady() {
        if (this.pendingGeneratedRenderPromise) {
            try {
                await this.pendingGeneratedRenderPromise
            } catch (error) {
                console.error('Generated render task failed while waiting for strokes.', error)
            }
        }
        if (!this.state.strokes.length) {
            this._renderPattern({ skipImportedStatus: true })
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
    async _buildSvgExportData() {
        const fileStem = ProjectFilenameUtils.buildFileStem(
            this.state.projectName,
            this._t('project.defaultFileStem'),
            this.state.seed
        )
        const suggestedName = ProjectFilenameUtils.buildFileName(
            this.state.projectName,
            this._t('project.defaultFileStem'),
            this.state.seed,
            'svg'
        )
        const editorName = String(document?.title || 'eggbot-app').trim() || 'eggbot-app'
        const editorUrl = String(window?.location?.href || '').trim()
        const metadataTitle = String(this.state.projectName || this._t('project.defaultFileStem')).trim() || 'Sorbian egg composition'
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
    async _exportPatternToSvg() {
        if (!(await this._ensureRenderedStrokesReady())) {
            this._setStatus(this._t('messages.noPatternToDraw'), 'error')
            return
        }
        const { contents, suggestedName } = await this._buildSvgExportData()

        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [
                        {
                            description: this._t('messages.svgFileDescription'),
                            accept: { 'image/svg+xml': ['.svg'] }
                        }
                    ]
                })
                const writable = await handle.createWritable()
                await writable.write(contents)
                await writable.close()
                this._setStatus(this._t('messages.svgExported', { name: handle.name || suggestedName }), 'success')
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
            this._setStatus(this._t('messages.svgDownloaded', { name: suggestedName }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.svgExportCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.svgExportFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Loads a project JSON file.
     * @returns {Promise<void>}
     */
    async _loadProjectFromFile() {
        try {
            const file = await this._promptForProjectFile({
                descriptionKey: 'messages.projectJsonDescription'
            })
            if (!file) {
                this._setStatus(this._t('messages.loadCanceled'), 'info')
                return
            }
            const rawText = await file.text()
            const rawProject = JSON.parse(rawText)
            await this._applyProjectPayload(rawProject)
            this._setStatus(this._t('messages.loadedProject', { name: file.name }), 'success')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.loadCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.loadFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Prompts user for a project file.
     * @param {{ descriptionKey?: string }} [options]
     * @returns {Promise<File | null>}
     */
    async _promptForProjectFile(options = {}) {
        const descriptionKey = String(options?.descriptionKey || 'messages.projectJsonDescription')
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [
                    {
                        description: this._t(descriptionKey),
                        accept: { 'application/json': ['.json'] }
                    }
                ]
            })
            return handle ? handle.getFile() : null
        }
        return FileInputPromptUtils.promptSingleFile({
            input: this.els.loadInput,
            windowObject: window
        })
    }

    /**
     * Shares current project as URL parameter.
     * @returns {Promise<void>}
     */
    async _shareProjectUrl() {
        try {
            const shareUrl = this._getShareUrlCached()
            if (navigator.share) {
                await navigator.share({
                    title: this.state.projectName,
                    url: shareUrl
                })
                this._setStatus(this._t('messages.projectUrlShared'), 'success')
                return
            }
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl)
                this._setStatus(this._t('messages.projectUrlCopied'), 'success')
                return
            }
            window.prompt(this._t('messages.copyProjectUrlPrompt'), shareUrl)
            this._setStatus(this._t('messages.projectUrlReady'), 'info')
        } catch (error) {
            if (error?.name === 'AbortError') {
                this._setStatus(this._t('messages.shareCanceled'), 'info')
                return
            }
            this._setStatus(this._t('messages.shareFailed', { message: error.message }), 'error')
        }
    }

    /**
     * Builds the current share URL with embedded project payload.
     * @returns {string}
     */
    _buildProjectShareUrl() {
        return this._getShareUrlCached()
    }

    /**
     * Stores current project payload in localStorage.
     */
    _storeProjectLocally() {
        const name = window.prompt(
            this._t('messages.storeProjectPrompt'),
            this.state.projectName || this._t('project.defaultPatternName')
        )
        if (!name) {
            this._setStatus(this._t('messages.storeCanceled'), 'info')
            return
        }
        const entry = this._storeProjectLocallyByName(name)
        this._refreshSavedProjectsSelect(entry.id, { preferIdle: false })
        this._setStatus(this._t('messages.storedLocalProject', { name }), 'success')
    }

    /**
     * Loads selected local project.
     */
    _loadSelectedLocalProject() {
        if (!this.els.localPatterns) return
        this._flushPendingSavedProjectsSelectRender()
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this._setStatus(this._t('messages.noLocalProjectSelected'), 'info')
            return
        }
        try {
            const entry = this._loadLocalProjectById(selectedId)
            this._setStatus(this._t('messages.loadedLocalProject', { name: entry.name }), 'success')
        } catch (error) {
            if (error?.message === 'local-project-not-found') {
                this._setStatus(this._t('messages.localProjectNotFound'), 'error')
                this._refreshSavedProjectsSelect('', { preferIdle: false })
                return
            }
            this._setStatus(this._t('messages.localLoadFailed', { message: error?.message || String(error) }), 'error')
        }
    }

    /**
     * Deletes the selected local project.
     */
    _deleteSelectedLocalProject() {
        if (!this.els.localPatterns) return
        this._flushPendingSavedProjectsSelectRender()
        const selectedId = this.els.localPatterns.value
        if (!selectedId) {
            this._setStatus(this._t('messages.noLocalProjectSelectedForDelete'), 'info')
            return
        }
        const entries = this._loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            this._setStatus(this._t('messages.localProjectNotFound'), 'error')
            this._refreshSavedProjectsSelect('', { preferIdle: false })
            return
        }
        const confirmed = window.confirm(this._t('messages.deleteLocalProjectConfirm', { name: entry.name }))
        if (!confirmed) {
            this._setStatus(this._t('messages.deleteCanceled'), 'info')
            return
        }
        this._deleteLocalProjectById(selectedId)
        this._refreshSavedProjectsSelect('', { preferIdle: false })
        this._setStatus(this._t('messages.deletedLocalProject', { name: entry.name }), 'success')
    }

    /**
     * Stores current project payload in localStorage under the provided name.
     * @param {string} rawName
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    _storeProjectLocallyByName(rawName) {
        const name = String(rawName || '').trim() || this.state.projectName || this._t('project.defaultPatternName')
        const entries = this._loadSavedProjects()
        const payload = this._getProjectPayload()
        const entry = {
            id: `pattern-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            updatedAt: new Date().toISOString(),
            payload
        }
        entries.push(entry)
        this._saveSavedProjects(entries)
        return entry
    }

    /**
     * Loads one local project entry by id and applies it to app state.
     * @param {string} projectId
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    _loadLocalProjectById(projectId) {
        const selectedId = String(projectId || '').trim()
        const entries = this._loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            throw new Error('local-project-not-found')
        }
        this._clearImportedPattern()
        this.state = ProjectIoUtils.normalizeProjectState(entry.payload)
        this.state.strokes = []
        this._markProjectArtifactsDirty()
        this._syncControlsFromState()
        this._renderPattern()
        return entry
    }

    /**
     * Deletes one local project entry by id.
     * @param {string} projectId
     * @returns {{ id: string, name: string, updatedAt: string, payload: Record<string, any> }}
     */
    _deleteLocalProjectById(projectId) {
        const selectedId = String(projectId || '').trim()
        const entries = this._loadSavedProjects()
        const entry = entries.find((candidate) => candidate.id === selectedId)
        if (!entry) {
            throw new Error('local-project-not-found')
        }
        const filtered = entries.filter((candidate) => candidate.id !== selectedId)
        this._saveSavedProjects(filtered)
        return entry
    }

    /**
     * Loads localStorage entries.
     * @returns {Array<{id: string, name: string, updatedAt: string, payload: Record<string, any>}>}
     */
    _loadSavedProjects() {
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
    _saveSavedProjects(entries) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries.slice(-120)))
    }

    /**
     * Refreshes local project select options.
     * @param {string} [preferredId]
     * @param {{ preferIdle?: boolean }} [options]
     */
    _refreshSavedProjectsSelect(preferredId = '', options = {}) {
        if (!this.els.localPatterns) return
        const preferIdle = options?.preferIdle !== false
        const entries = this._loadSavedProjects().sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt)
        })
        this._cancelIdleTask('saved-projects-select-render')
        this.pendingSavedProjectsSelectRender = null
        this.els.localPatterns.innerHTML = ''
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = entries.length
            ? this._t('local.choosePlaceholder')
            : this._t('local.nonePlaceholder')
        this.els.localPatterns.appendChild(placeholder)

        if (!entries.length) {
            this.els.localPatterns.value = ''
            return
        }

        const shouldRenderInIdle = preferIdle && entries.length >= LOCAL_PROJECT_RENDER_IDLE_THRESHOLD
        if (!shouldRenderInIdle) {
            this._renderSavedProjectsSelectOptionsSync(entries, preferredId)
            return
        }

        this.pendingSavedProjectsSelectRender = {
            entries,
            preferredId: String(preferredId || ''),
            nextIndex: 0
        }
        this._scheduleIdleTask(
            'saved-projects-select-render',
            (deadline) => this._continueSavedProjectsSelectRender(deadline),
            IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS
        )
    }

    /**
     * Flushes a pending chunked local-project select render synchronously.
     */
    _flushPendingSavedProjectsSelectRender() {
        if (!this.pendingSavedProjectsSelectRender || !this.els.localPatterns) return
        this._cancelIdleTask('saved-projects-select-render')
        while (this.pendingSavedProjectsSelectRender) {
            this._continueSavedProjectsSelectRender({
                didTimeout: false,
                timeRemaining: () => Number.POSITIVE_INFINITY
            })
        }
    }

    /**
     * Continues idle chunk rendering for local project options.
     * @param {{ didTimeout: boolean, timeRemaining: () => number }} deadline
     */
    _continueSavedProjectsSelectRender(deadline) {
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
            fragment.appendChild(this._buildSavedProjectsSelectOption(state.entries[state.nextIndex]))
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

        this._scheduleIdleTask(
            'saved-projects-select-render',
            (nextDeadline) => this._continueSavedProjectsSelectRender(nextDeadline),
            IDLE_TIMEOUT_LOCAL_PROJECT_RENDER_MS
        )
    }

    /**
     * Renders all local project options synchronously.
     * @param {Array<{id: string, name: string, updatedAt: string, payload: Record<string, any>}>} entries
     * @param {string} preferredId
     */
    _renderSavedProjectsSelectOptionsSync(entries, preferredId) {
        const fragment = document.createDocumentFragment()
        entries.forEach((entry) => {
            fragment.appendChild(this._buildSavedProjectsSelectOption(entry))
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
    _buildSavedProjectsSelectOption(entry) {
        const option = document.createElement('option')
        option.value = entry.id
        option.textContent = this._t('local.entryLabel', {
            name: entry.name,
            updatedAt: new Date(entry.updatedAt).toLocaleString(this.i18n.locale)
        })
        return option
    }

    /**
     * Returns a normalized snapshot for WebMCP tools.
     * @returns {Record<string, any>}
     */
}
