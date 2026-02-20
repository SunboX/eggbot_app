/**
 * @typedef {{ didTimeout: boolean, timeRemaining: () => number }} IdleSchedulerDeadline
 */

/**
 * @typedef {{ timeout?: number }} IdleSchedulerOptions
 */

/**
 * @typedef {{ cancel: () => void }} IdleSchedulerHandle
 */

/**
 * Utility for cancellable idle-time scheduling with timeout safety fallback.
 */
export class IdleScheduler {
    /**
     * Schedules one callback for idle execution.
     * @param {(deadline: IdleSchedulerDeadline) => void} callback
     * @param {IdleSchedulerOptions} [options]
     * @returns {IdleSchedulerHandle}
     */
    static schedule(callback, options = {}) {
        const host = typeof window !== 'undefined' ? window : globalThis
        const timeout = IdleScheduler.#resolveTimeout(options.timeout)
        const hasRequestIdleCallback = typeof host.requestIdleCallback === 'function'
        const hasCancelIdleCallback = typeof host.cancelIdleCallback === 'function'
        let cancelled = false
        let completed = false
        let idleCallbackId = null
        let timeoutId = null

        const complete = (deadline) => {
            if (cancelled || completed) return
            completed = true
            if (idleCallbackId !== null && hasCancelIdleCallback) {
                host.cancelIdleCallback(idleCallbackId)
            }
            if (timeoutId !== null) {
                host.clearTimeout(timeoutId)
            }
            callback(deadline)
        }

        if (hasRequestIdleCallback) {
            idleCallbackId = host.requestIdleCallback((deadline) => {
                complete({
                    didTimeout: Boolean(deadline?.didTimeout),
                    timeRemaining: () => {
                        if (typeof deadline?.timeRemaining === 'function') {
                            return Math.max(0, Number(deadline.timeRemaining()) || 0)
                        }
                        return 0
                    }
                })
            }, timeout === null ? undefined : { timeout })

            if (timeout !== null) {
                timeoutId = host.setTimeout(() => {
                    complete(IdleScheduler.#createDeadline(true))
                }, timeout)
            }
        } else {
            timeoutId = host.setTimeout(() => {
                complete(IdleScheduler.#createDeadline(false))
            }, 0)
        }

        return {
            cancel: () => {
                if (cancelled || completed) return
                cancelled = true
                if (idleCallbackId !== null && hasCancelIdleCallback) {
                    host.cancelIdleCallback(idleCallbackId)
                }
                if (timeoutId !== null) {
                    host.clearTimeout(timeoutId)
                }
            }
        }
    }

    /**
     * Resolves timeout option.
     * @param {unknown} timeout
     * @returns {number | null}
     */
    static #resolveTimeout(timeout) {
        if (!Number.isFinite(timeout)) return null
        return Math.max(0, Math.min(Math.trunc(Number(timeout)), 2_147_483_647))
    }

    /**
     * Builds one deadline shim for fallback execution.
     * @param {boolean} didTimeout
     * @returns {IdleSchedulerDeadline}
     */
    static #createDeadline(didTimeout) {
        const startedAt = Date.now()
        const fallbackBudgetMs = 50
        return {
            didTimeout: Boolean(didTimeout),
            timeRemaining: () => Math.max(0, fallbackBudgetMs - (Date.now() - startedAt))
        }
    }
}
