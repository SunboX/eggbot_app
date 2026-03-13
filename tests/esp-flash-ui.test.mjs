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
    } finally {
        restoreSupportedNavigator()
    }

    const restoreUnsupportedNavigator = installNavigatorOverride({})

    try {
        AppControllerCoreControls.prototype._syncEspFlashInstallUi.call(controller)
        assert.equal(controller.els.espFlashBrowserNote.hidden, false)
        assert.equal(controller.els.espFlashBootHint.hidden, true)
        assert.equal(controller.els.espFlashInstall.disabled, true)
    } finally {
        restoreUnsupportedNavigator()
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
