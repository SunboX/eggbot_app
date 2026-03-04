import { AppElements } from './AppElements.mjs'
import { AppRuntimeConfig } from './AppRuntimeConfig.mjs'
import { AppVersion } from './AppVersion.mjs'
import { EspFirmwareManifestMeta } from './EspFirmwareManifestMeta.mjs'
import { ImportedPatternScaleUtils } from './ImportedPatternScaleUtils.mjs'
import { ImportedPreviewStrokeUtils } from './ImportedPreviewStrokeUtils.mjs'
import { PatternGenerator } from './PatternGenerator.mjs'
import { PatternRenderer2D } from './PatternRenderer2D.mjs'
import { PatternStrokeScaleUtils } from './PatternStrokeScaleUtils.mjs'
import { PatternSvgExportUtils } from './PatternSvgExportUtils.mjs'
import { EggScene } from './EggScene.mjs'
import { EggBotTransportController } from './EggBotTransportController.mjs'
import { BleLinuxChromiumHints } from './BleLinuxChromiumHints.mjs'
import { ProjectFilenameUtils } from './ProjectFilenameUtils.mjs'
import { ProjectIoUtils } from './ProjectIoUtils.mjs'
import { ProjectUrlUtils } from './ProjectUrlUtils.mjs'
import { DrawProgressSmoother } from './DrawProgressSmoother.mjs'
import { DrawProgressTimeUtils } from './DrawProgressTimeUtils.mjs'
import { DrawTraceOverlayRenderer } from './DrawTraceOverlayRenderer.mjs'
import { ImportedRenderSyncUtils } from './ImportedRenderSyncUtils.mjs'
import { PatternComputeWorkerClient } from './PatternComputeWorkerClient.mjs'
import { PatternImportWorkerClient } from './PatternImportWorkerClient.mjs'
import { PatternRenderWorkerClient } from './PatternRenderWorkerClient.mjs'
import { PatternImportControlUtils } from './PatternImportControlUtils.mjs'
import { PatternImportRuntimeGuards } from './PatternImportRuntimeGuards.mjs'
import { WebMcpBridge } from './WebMcpBridge.mjs'
import { IdleScheduler } from './IdleScheduler.mjs'
import { SvgProjectNameUtils } from './SvgProjectNameUtils.mjs'
import { FileInputPromptUtils } from './FileInputPromptUtils.mjs'

const LOCAL_STORAGE_KEY = 'eggbot.savedProjects.v1'
const SETTINGS_STORAGE_KEY = 'eggbot.settings.v1'
const IMPORT_HEIGHT_REFERENCE = 1
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
const EGGBOT_TRANSPORTS = ['serial', 'ble']
const SERVO_VALUE_MIN = 5000
const SERVO_VALUE_MAX = 25000

export {
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
}
