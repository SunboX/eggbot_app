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

test('AppControllerCoreControls should start ESP flashing with a bootloader-waiting status', async () => {
    const statusUpdates = []

    const controller = {
        isEspFlashing: false,
        espFlashBootHintVisible: false,
        espFlashRetryWithoutResetPending: false,
        espFirmwareInstaller: {
            async install() {}
        },
        _resolveEspFlashManifestUrl() {
            return 'https://example.com/firmware/manifest.json'
        },
        _startEspFlashProgressUi() {},
        _updateEspFlashProgressUi() {},
        _syncEspFlashInstallUi() {},
        _syncConnectionUi() {},
        _formatEspFlashFailedStatusMessage: AppControllerCoreControls.prototype._formatEspFlashFailedStatusMessage,
        _shouldShowEspFlashBootHint: AppControllerCoreControls.prototype._shouldShowEspFlashBootHint,
        _setEspFlashStatus(message, type) {
            statusUpdates.push({ message, type })
        },
        _t(key, replacements = {}) {
            if (key === 'messages.espFlashWaitingForBootloader') {
                return 'waiting'
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
        assert.equal(statusUpdates[0]?.message, 'waiting')
        assert.equal(statusUpdates[0]?.type, 'loading')
        assert.equal(statusUpdates.at(-1)?.message, 'complete')
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
        _formatEspFlashFailedStatusMessage: AppControllerCoreControls.prototype._formatEspFlashFailedStatusMessage,
        _shouldShowEspFlashBootHint: AppControllerCoreControls.prototype._shouldShowEspFlashBootHint,
        _setEspFlashStatus(message, type) {
            statusUpdates.push({ message, type })
        },
        _t(key, replacements = {}) {
            if (key === 'messages.espFlashWaitingForBootloader') {
                return 'waiting'
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
        assert.equal(statusUpdates[0]?.message, 'waiting')
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
