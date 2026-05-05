// SPDX-FileCopyrightText: 2026 André Fiedler
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Guard helpers for runtime SVG-import interactions.
 */
export class PatternImportRuntimeGuards {
    /**
     * Returns true when import interactions should be blocked.
     * @param {{ isPatternImporting?: boolean, isDrawing?: boolean }} [state]
     * @returns {boolean}
     */
    static isImportInteractionBlocked(state = {}) {
        return Boolean(state.isPatternImporting) || Boolean(state.isDrawing)
    }

    /**
     * Returns true when starting a draw run should be blocked.
     * @param {{ isPatternImporting?: boolean }} [state]
     * @returns {boolean}
     */
    static isDrawStartBlocked(state = {}) {
        return Boolean(state.isPatternImporting)
    }
}
