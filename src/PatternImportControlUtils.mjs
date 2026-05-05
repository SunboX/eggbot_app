// SPDX-FileCopyrightText: 2026 André Fiedler
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Helpers for toggling control state in imported SVG mode.
 */
export class PatternImportControlUtils {
    /**
     * Enables or disables auto-generation controls.
     * @param {Array<{ disabled: boolean } | null | undefined>} controls
     * @param {boolean} disabled
     */
    static setAutoGenerateOrnamentControlsDisabled(controls, disabled) {
        if (!Array.isArray(controls)) return
        controls.forEach((control) => {
            if (!control || typeof control !== 'object' || !('disabled' in control)) return
            control.disabled = Boolean(disabled)
        })
    }
}
