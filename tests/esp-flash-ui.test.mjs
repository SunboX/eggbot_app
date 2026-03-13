import assert from 'node:assert/strict'
import test from 'node:test'
import { AppControllerCoreControls } from '../src/AppControllerCoreControls.mjs'

/**
 * Overrides the global navigator property for one test scope.
 * @param {Navigator | undefined} navigatorValue
 * @returns {() => void}
 */
function installNavigatorOverride(navigatorValue) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        enumerable: originalDescriptor?.enumerable ?? true,
        writable: true,
        value: navigatorValue
    })

    return () => {
        if (originalDescriptor) {
            Object.defineProperty(globalThis, 'navigator', originalDescriptor)
            return
        }

        delete globalThis.navigator
    }
}

test('AppControllerCoreControls should explain runtime-not-ready serial connection failures clearly', () => {
    const controller = {
        serial: {
            connectionTransportKind: 'serial'
        },
        _t(key, replacements = {}) {
            if (key === 'messages.serialRuntimeNotReadyConnectFailed') {
                return `runtime:${replacements.message || ''}`
            }
            if (key === 'messages.serialConnectFailed') {
                return `generic:${replacements.message || ''}`
            }
            if (key === 'messages.bleLinuxChromiumTroubleshooting') {
                return 'ble-hint'
            }
            return key
        },
        _shouldShowBleTroubleshootingHint() {
            return false
        },
        _appendBleTroubleshootingHint: AppControllerCoreControls.prototype._appendBleTroubleshootingHint,
        _isRuntimeNotReadyConnectionError: AppControllerCoreControls.prototype._isRuntimeNotReadyConnectionError
    }

    const message = AppControllerCoreControls.prototype._formatConnectionFailedStatusMessage.call(
        controller,
        new Error(
            'Failed to detect EggBot runtime on the selected serial port. The ESP32 may still be rebooting or stuck in bootloader mode. Timed out waiting for EBB response.'
        )
    )

    assert.equal(
        message,
        'runtime:Failed to detect EggBot runtime on the selected serial port. The ESP32 may still be rebooting or stuck in bootloader mode. Timed out waiting for EBB response.'
    )
})

test('AppControllerCoreControls should keep generic connection failures on the standard message path', () => {
    const controller = {
        serial: {
            connectionTransportKind: 'serial'
        },
        _t(key, replacements = {}) {
            if (key === 'messages.serialRuntimeNotReadyConnectFailed') {
                return `runtime:${replacements.message || ''}`
            }
            if (key === 'messages.serialConnectFailed') {
                return `generic:${replacements.message || ''}`
            }
            if (key === 'messages.bleLinuxChromiumTroubleshooting') {
                return 'ble-hint'
            }
            return key
        },
        _shouldShowBleTroubleshootingHint() {
            return false
        },
        _appendBleTroubleshootingHint: AppControllerCoreControls.prototype._appendBleTroubleshootingHint,
        _isRuntimeNotReadyConnectionError: AppControllerCoreControls.prototype._isRuntimeNotReadyConnectionError
    }

    const message = AppControllerCoreControls.prototype._formatConnectionFailedStatusMessage.call(
        controller,
        new Error('Failed to open serial port.')
    )

    assert.equal(message, 'generic:Failed to open serial port.')
})

test('AppControllerCoreControls should only show the flash browser note when Web Serial is unavailable', () => {
    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        _t(key) {
            return key
        },
        els: {
            espFlashInstall: {
                disabled: false,
                hidden: false,
                textContent: '',
                attributes: new Map(),
                setAttribute(name, value) {
                    this.attributes.set(name, value)
                }
            },
            espFlashDialogClose: {
                disabled: false
            },
            espFlashDialogCloseIcon: {
                disabled: false
            },
            espFlashBrowserNote: {
                hidden: false
            },
            espFlashBootHint: {
                hidden: false
            }
        }
    }

    const restoreSupportedNavigator = installNavigatorOverride({
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        AppControllerCoreControls.prototype._syncEspFlashInstallUi.call(controller)
        assert.equal(controller.els.espFlashBrowserNote.hidden, true)
        assert.equal(controller.els.espFlashBootHint.hidden, true)
        assert.equal(controller.els.espFlashInstall.disabled, false)
        assert.equal(controller.els.espFlashInstall.hidden, false)
    } finally {
        restoreSupportedNavigator()
    }

    const restoreUnsupportedNavigator = installNavigatorOverride({})

    try {
        AppControllerCoreControls.prototype._syncEspFlashInstallUi.call(controller)
        assert.equal(controller.els.espFlashBrowserNote.hidden, false)
        assert.equal(controller.els.espFlashBootHint.hidden, true)
        assert.equal(controller.els.espFlashInstall.disabled, true)
        assert.equal(controller.els.espFlashInstall.hidden, false)
    } finally {
        restoreUnsupportedNavigator()
    }
})

test('AppControllerCoreControls should keep the in-app flash button available on macOS', () => {
    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        _t(key) {
            return key
        },
        els: {
            espFlashInstall: {
                disabled: false,
                hidden: false,
                textContent: '',
                attributes: new Map(),
                setAttribute(name, value) {
                    this.attributes.set(name, value)
                }
            },
            espFlashDialogClose: {
                disabled: false
            },
            espFlashDialogCloseIcon: {
                disabled: false
            },
            espFlashBrowserNote: {
                hidden: false
            },
            espFlashBootHint: {
                hidden: false
            }
        }
    }

    const restoreMacNavigator = installNavigatorOverride({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        AppControllerCoreControls.prototype._syncEspFlashInstallUi.call(controller)
        assert.equal(controller.els.espFlashInstall.hidden, false)
        assert.equal(controller.els.espFlashInstall.disabled, false)
        assert.equal(controller.els.espFlashBrowserNote.hidden, true)
    } finally {
        restoreMacNavigator()
    }
})

test('AppControllerCoreControls should tolerate older element maps without flash-note fields', () => {
    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        _t(key) {
            return key
        },
        els: {
            espFlashInstall: {
                disabled: false,
                textContent: '',
                attributes: new Map(),
                setAttribute(name, value) {
                    this.attributes.set(name, value)
                }
            },
            espFlashDialogClose: {
                disabled: false
            },
            espFlashDialogCloseIcon: {
                disabled: false
            }
        }
    }

    const restoreSupportedNavigator = installNavigatorOverride({
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        assert.doesNotThrow(() => {
            AppControllerCoreControls.prototype._syncEspFlashInstallUi.call(controller)
        })
        assert.equal(controller.els.espFlashInstall.disabled, false)
        assert.equal(controller.els.espFlashDialogClose.disabled, false)
        assert.equal(controller.els.espFlashDialogCloseIcon.disabled, false)
    } finally {
        restoreSupportedNavigator()
    }
})

test('AppControllerCoreControls should tolerate older element maps without flash status and progress fields', () => {
    const controller = {
        espFlashProgressStartedAtMs: 123,
        espFlashProgressSmoother: {
            resetCalls: 0,
            updateCalls: [],
            reset() {
                this.resetCalls += 1
            },
            update(value) {
                this.updateCalls.push(value)
                return null
            }
        },
        _estimateEspFlashRemainingMsFromRatio() {
            return null
        },
        _formatDurationLabel() {
            return '--:--'
        },
        _t(key, replacements = {}) {
            if (key === 'machine.flashDialog.progressPercent') {
                return `percent:${replacements.percent}`
            }
            if (key === 'machine.flashDialog.progressTime') {
                return `time:${replacements.time}`
            }
            if (key === 'messages.drawingRemainingTimeUnknown') {
                return 'unknown'
            }
            return key
        },
        els: {}
    }
    controller._updateEspFlashProgressUi = AppControllerCoreControls.prototype._updateEspFlashProgressUi

    assert.doesNotThrow(() => {
        AppControllerCoreControls.prototype._setEspFlashDialogStatus.call(controller, 'ready')
    })
    assert.doesNotThrow(() => {
        AppControllerCoreControls.prototype._resetEspFlashProgressUi.call(controller)
    })
    assert.doesNotThrow(() => {
        AppControllerCoreControls.prototype._startEspFlashProgressUi.call(controller)
    })
    assert.doesNotThrow(() => {
        AppControllerCoreControls.prototype._updateEspFlashProgressUi.call(controller, 0.5, 5000)
    })
    assert.equal(controller.espFlashProgressStartedAtMs > 0, true)
    assert.equal(controller.espFlashProgressSmoother.resetCalls, 2)
    assert.deepEqual(controller.espFlashProgressSmoother.updateCalls, [null, 5000])
})

test('AppControllerCoreControls should only show the BOOT hint for connect-like flash failures', () => {
    assert.equal(
        AppControllerCoreControls.prototype._shouldShowEspFlashBootHint.call({}, new Error('Wrong boot mode detected (0x13).')),
        true
    )
    assert.equal(
        AppControllerCoreControls.prototype._shouldShowEspFlashBootHint.call({}, new Error('Read timeout exceeded')),
        true
    )
    assert.equal(
        AppControllerCoreControls.prototype._shouldShowEspFlashBootHint.call({}, new Error('ESP firmware binary request failed: firmware.bin')),
        false
    )
})

test('AppControllerCoreControls should surface explicit flash stages through the dialog status', async () => {
    const statusUpdates = []

    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        espFlashRetryWithoutResetPending: false,
        espFirmwareInstaller: {
            async install(options) {
                options.onStage?.({ stage: 'syncing' })
                options.onStage?.({ stage: 'detectingChip' })
                options.onStage?.({ stage: 'writingFirmware' })
                options.onStage?.({ stage: 'finalizing' })
                options.onStage?.({ stage: 'done' })
            }
        },
        _resolveEspFlashManifestUrl() {
            return 'https://example.com/firmware/manifest.json'
        },
        _startEspFlashProgressUi() {},
        _updateEspFlashProgressUi() {},
        _syncEspFlashInstallUi() {},
        _syncConnectionUi() {},
        _formatEspFlashStageStatus: AppControllerCoreControls.prototype._formatEspFlashStageStatus,
        _handleEspFlashStageUpdate: AppControllerCoreControls.prototype._handleEspFlashStageUpdate,
        _formatEspFlashFailedStatusMessage: AppControllerCoreControls.prototype._formatEspFlashFailedStatusMessage,
        _shouldShowEspFlashBootHint: AppControllerCoreControls.prototype._shouldShowEspFlashBootHint,
        _setEspFlashStatus(message, type) {
            statusUpdates.push({ message, type })
        },
        _t(key, replacements = {}) {
            if (key === 'messages.espFlashStageEnteringBootloader') {
                return 'entering'
            }
            if (key === 'messages.espFlashStageSyncing') {
                return 'syncing'
            }
            if (key === 'messages.espFlashStageDetectingChip') {
                return 'detecting'
            }
            if (key === 'messages.espFlashStageWriting') {
                return 'writing'
            }
            if (key === 'messages.espFlashStageFinalizing') {
                return 'finalizing'
            }
            if (key === 'messages.espFlashRecoveringTimeout') {
                return 'recovering'
            }
            if (key === 'messages.espFlashComplete') {
                return 'complete'
            }
            if (key === 'messages.espFlashCanceled') {
                return 'canceled'
            }
            if (key === 'messages.espFlashConnectFailed') {
                return `connect:${replacements.message || ''}`
            }
            if (key === 'messages.espFlashFailed') {
                return `failed:${replacements.message || ''}`
            }
            return key
        }
    }

    const restoreNavigator = installNavigatorOverride({
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        await AppControllerCoreControls.prototype._installEspFirmware.call(controller)
        assert.equal(statusUpdates[0]?.message, 'entering')
        assert.equal(statusUpdates[0]?.type, 'loading')
        assert.equal(statusUpdates.some((entry) => entry.message === 'syncing'), true)
        assert.equal(statusUpdates.some((entry) => entry.message === 'detecting'), true)
        assert.equal(statusUpdates.some((entry) => entry.message === 'writing'), true)
        assert.equal(statusUpdates.some((entry) => entry.message === 'finalizing'), true)
        assert.equal(statusUpdates.at(-1)?.message, 'complete')
    } finally {
        restoreNavigator()
    }
})

test('AppControllerCoreControls should show a temporary recovery status when ESP flashing retries after a serial timeout', async () => {
    const statusUpdates = []

    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        espFlashRetryWithoutResetPending: false,
        espFirmwareInstaller: {
            async install(options) {
                options.onStage?.({ stage: 'recoveringSerialTimeout', context: 'syncing' })
                options.onStage?.({ stage: 'syncing' })
            }
        },
        _resolveEspFlashManifestUrl() {
            return 'https://example.com/firmware/manifest.json'
        },
        _startEspFlashProgressUi() {},
        _updateEspFlashProgressUi() {},
        _syncEspFlashInstallUi() {},
        _syncConnectionUi() {},
        _formatEspFlashStageStatus: AppControllerCoreControls.prototype._formatEspFlashStageStatus,
        _handleEspFlashStageUpdate: AppControllerCoreControls.prototype._handleEspFlashStageUpdate,
        _formatEspFlashFailedStatusMessage: AppControllerCoreControls.prototype._formatEspFlashFailedStatusMessage,
        _shouldShowEspFlashBootHint: AppControllerCoreControls.prototype._shouldShowEspFlashBootHint,
        _setEspFlashStatus(message, type) {
            statusUpdates.push({ message, type })
        },
        _t(key, replacements = {}) {
            if (key === 'messages.espFlashStageEnteringBootloader') {
                return 'entering'
            }
            if (key === 'messages.espFlashStageSyncing') {
                return 'syncing'
            }
            if (key === 'messages.espFlashRecoveringTimeout') {
                return 'recovering'
            }
            if (key === 'messages.espFlashComplete') {
                return 'complete'
            }
            if (key === 'messages.espFlashConnectFailed') {
                return `connect:${replacements.message || ''}`
            }
            if (key === 'messages.espFlashFailed') {
                return `failed:${replacements.message || ''}`
            }
            return key
        }
    }

    const restoreNavigator = installNavigatorOverride({
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        await AppControllerCoreControls.prototype._installEspFirmware.call(controller)
        assert.equal(statusUpdates.some((entry) => entry.message === 'recovering'), true)
        assert.equal(statusUpdates.some((entry) => entry.message === 'syncing'), true)
    } finally {
        restoreNavigator()
    }
})

test('AppControllerCoreControls should keep manual BOOT retry inside the flasher UI without using a browser confirm dialog', async () => {
    const installModes = []
    const statusUpdates = []
    const originalWindow = globalThis.window
    let confirmCalls = 0

    globalThis.window = {
        confirm() {
            confirmCalls += 1
            return true
        }
    }

    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        espFlashRetryWithoutResetPending: false,
        espFirmwareInstaller: {
            async install(options) {
                installModes.push(options.mode)
                if (installModes.length === 1) {
                    throw new Error('Failed to connect with the device')
                }
            }
        },
        _resolveEspFlashManifestUrl() {
            return 'https://example.com/firmware/manifest.json'
        },
        _startEspFlashProgressUi() {},
        _updateEspFlashProgressUi() {},
        _syncEspFlashInstallUi() {},
        _syncConnectionUi() {},
        _formatEspFlashStageStatus: AppControllerCoreControls.prototype._formatEspFlashStageStatus,
        _handleEspFlashStageUpdate: AppControllerCoreControls.prototype._handleEspFlashStageUpdate,
        _formatEspFlashFailedStatusMessage: AppControllerCoreControls.prototype._formatEspFlashFailedStatusMessage,
        _shouldShowEspFlashBootHint: AppControllerCoreControls.prototype._shouldShowEspFlashBootHint,
        _setEspFlashStatus(message, type) {
            statusUpdates.push({ message, type })
        },
        _t(key, replacements = {}) {
            if (key === 'messages.espFlashStageEnteringBootloader') {
                return 'entering'
            }
            if (key === 'messages.espFlashConnectFailed') {
                return `connect:${replacements.message || ''}`
            }
            if (key === 'messages.espFlashPreparing') {
                return 'preparing'
            }
            if (key === 'messages.espFlashComplete') {
                return 'complete'
            }
            if (key === 'messages.espFlashCanceled') {
                return 'canceled'
            }
            if (key === 'messages.espFlashFailed') {
                return `failed:${replacements.message || ''}`
            }
            return key
        }
    }

    const restoreNavigator = installNavigatorOverride({
        serial: {
            async requestPort() {
                return {}
            }
        }
    })

    try {
        await AppControllerCoreControls.prototype._installEspFirmware.call(controller)
        assert.equal(controller.espFlashRetryWithoutResetPending, true)
        assert.equal(controller.espFlashBootHintVisible, true)

        await AppControllerCoreControls.prototype._installEspFirmware.call(controller)

        assert.deepEqual(installModes, ['default_reset', 'no_reset'])
        assert.equal(confirmCalls, 0)
        assert.equal(statusUpdates[0]?.message, 'entering')
        assert.equal(controller.espFlashRetryWithoutResetPending, false)
        assert.equal(controller.espFlashBootHintVisible, false)
        assert.equal(
            statusUpdates.some((entry) => entry.type === 'error' && entry.message === 'connect:Failed to connect with the device'),
            true
        )
        assert.equal(statusUpdates.at(-1)?.message, 'complete')
    } finally {
        restoreNavigator()
        globalThis.window = originalWindow
    }
})
