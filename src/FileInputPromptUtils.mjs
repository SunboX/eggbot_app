const DEFAULT_CANCEL_DELAY_MS = 120

/**
 * File-input chooser fallback helpers for browsers without File System Access API.
 */
export class FileInputPromptUtils {
    /**
     * Prompts for one selected file through a hidden `<input type="file">`.
     * Handles focus-before-change event ordering to avoid false cancellations.
     * @param {{ input: HTMLInputElement, windowObject?: Window, cancelDelayMs?: number }} config
     * @returns {Promise<File | null>}
     */
    static promptSingleFile(config) {
        const input = config?.input
        if (!input || typeof input.addEventListener !== 'function' || typeof input.click !== 'function') {
            throw new Error('Missing valid file input element.')
        }

        const windowObject = config?.windowObject || window
        const cancelDelayMs = FileInputPromptUtils.#resolveCancelDelayMs(config?.cancelDelayMs)

        return new Promise((resolve, reject) => {
            let settled = false
            let focusCancelTimer = 0

            const cleanup = () => {
                input.removeEventListener('change', onChange)
                input.removeEventListener('cancel', onCancel)
                windowObject.removeEventListener('focus', onFocus)
                if (focusCancelTimer) {
                    windowObject.clearTimeout(focusCancelTimer)
                    focusCancelTimer = 0
                }
            }

            const settle = (file) => {
                if (settled) return
                settled = true
                cleanup()
                resolve(file || null)
            }

            const onChange = () => {
                settle(input.files?.[0] ?? null)
            }

            const onCancel = () => {
                settle(null)
            }

            const onFocus = () => {
                if (focusCancelTimer) {
                    windowObject.clearTimeout(focusCancelTimer)
                    focusCancelTimer = 0
                }
                focusCancelTimer = windowObject.setTimeout(() => {
                    focusCancelTimer = 0
                    settle(input.files?.[0] ?? null)
                }, cancelDelayMs)
            }

            input.value = ''
            input.addEventListener('change', onChange)
            input.addEventListener('cancel', onCancel)
            windowObject.addEventListener('focus', onFocus, { once: true })

            try {
                input.click()
            } catch (error) {
                cleanup()
                reject(error)
            }
        })
    }

    /**
     * Resolves one non-negative timer value for fallback cancel checks.
     * @param {unknown} value
     * @returns {number}
     */
    static #resolveCancelDelayMs(value) {
        const parsed = Math.trunc(Number(value))
        if (!Number.isFinite(parsed)) return DEFAULT_CANCEL_DELAY_MS
        return Math.max(0, parsed)
    }
}
