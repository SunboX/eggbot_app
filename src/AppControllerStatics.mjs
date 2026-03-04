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
import { AppControllerWebMcp } from './AppControllerWebMcp.mjs'

/**
 * AppControllerStatics segment of the application controller.
 */
export class AppControllerStatics extends AppControllerWebMcp {
    _webMcpSetLocale(args) {
        const locale = String(args?.locale || '').trim()
        if (!locale) {
            throw new Error('Missing locale value.')
        }
        this._handleLocaleChange(locale)
        return {
            message: `Locale set to ${this.i18n.locale}.`,
            state: this._webMcpStateSnapshot()
        }
    }

    /**
     * Resolves decimal precision for one numeric step value.
     * @param {number} step
     * @returns {number}
     */
    static _resolveStepPrecision(step) {
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
    static _normalizePrintColorMode(value) {
        return String(value || '').trim().toLowerCase() === 'single' ? 'single' : 'per-color'
    }

    /**
     * Parses an integer with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static _parseInteger(value, fallback) {
        const parsed = Number.parseInt(String(value), 10)
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Parses a float with fallback.
     * @param {unknown} value
     * @param {number} fallback
     * @returns {number}
     */
    static _parseFloat(value, fallback) {
        const parsed = Number.parseFloat(String(value))
        return Number.isFinite(parsed) ? parsed : fallback
    }

    /**
     * Parses a boolean-like value with fallback.
     * @param {unknown} value
     * @param {boolean} fallback
     * @returns {boolean}
     */
    static _parseBoolean(value, fallback) {
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
