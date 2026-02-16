/**
 * Runtime localization helper with JSON translation bundles.
 */
export class I18n {
    static SUPPORTED_LOCALES = ['en', 'de']

    #translations = {}
    #locale = 'en'
    #defaultLocale = 'en'
    #storageKey = 'eggbot_app_locale'

    /**
     * @param {{ defaultLocale?: string, storageKey?: string }} [options={}]
     */
    constructor(options = {}) {
        this.#defaultLocale = I18n.#normalizeLocale(options.defaultLocale || 'en')
        this.#locale = this.#defaultLocale
        this.#storageKey = String(options.storageKey || this.#storageKey)
    }

    /**
     * Initializes translation bundles and active locale.
     * @returns {Promise<void>}
     */
    async init() {
        await this.#loadTranslations()
        const detectedLocale = this.#detectPreferredLocale()
        this.setLocale(detectedLocale, false)
    }

    /**
     * Returns active locale code.
     * @returns {string}
     */
    get locale() {
        return this.#locale
    }

    /**
     * Sets active locale.
     * @param {string} locale
     * @param {boolean} [persist=true]
     */
    setLocale(locale, persist = true) {
        const normalizedLocale = I18n.#normalizeLocale(locale)
        this.#locale = this.#translations[normalizedLocale] ? normalizedLocale : this.#defaultLocale
        document.documentElement.lang = this.#locale
        if (persist) {
            window.localStorage.setItem(this.#storageKey, this.#locale)
        }
    }

    /**
     * Translates a key using active locale with fallback.
     * @param {string} key
     * @param {Record<string, string | number>} [params={}]
     * @returns {string}
     */
    t(key, params = {}) {
        const rawValue =
            I18n.#lookup(this.#translations[this.#locale], key) ??
            I18n.#lookup(this.#translations[this.#defaultLocale], key) ??
            key
        if (typeof rawValue !== 'string') {
            return key
        }
        return rawValue.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_full, name) => {
            if (!Object.hasOwn(params, name)) {
                return `{{${name}}}`
            }
            return String(params[name])
        })
    }

    /**
     * Applies i18n values to DOM nodes using data attributes.
     * @param {ParentNode} [root=document]
     */
    applyTranslations(root = document) {
        root.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.getAttribute('data-i18n')
            if (!key) return
            node.textContent = this.t(key)
        })

        root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
            const key = node.getAttribute('data-i18n-placeholder')
            if (!key || !('placeholder' in node)) return
            node.placeholder = this.t(key)
        })

        root.querySelectorAll('[data-i18n-title]').forEach((node) => {
            const key = node.getAttribute('data-i18n-title')
            if (!key) return
            node.title = this.t(key)
        })

        root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
            const key = node.getAttribute('data-i18n-aria-label')
            if (!key) return
            node.setAttribute('aria-label', this.t(key))
        })
    }

    /**
     * Loads all supported translation bundles.
     * @returns {Promise<void>}
     */
    async #loadTranslations() {
        const loadTasks = I18n.SUPPORTED_LOCALES.map(async (locale) => {
            const response = await fetch(`./i18n/${locale}.json`, { cache: 'no-store' })
            if (!response.ok) {
                throw new Error(`Failed to load locale ${locale}: HTTP ${response.status}`)
            }
            const payload = await response.json()
            this.#translations[locale] = payload && typeof payload === 'object' ? payload : {}
        })
        await Promise.all(loadTasks)
    }

    /**
     * Detects locale preference from URL, localStorage, or browser language.
     * @returns {string}
     */
    #detectPreferredLocale() {
        const params = new URLSearchParams(window.location.search)
        const urlLocale = params.get('lang')
        if (urlLocale) {
            return I18n.#normalizeLocale(urlLocale)
        }

        const storedLocale = window.localStorage.getItem(this.#storageKey)
        if (storedLocale) {
            return I18n.#normalizeLocale(storedLocale)
        }

        const browserLocale = window.navigator.language || this.#defaultLocale
        return I18n.#normalizeLocale(browserLocale)
    }

    /**
     * Reads nested translation key path from an object.
     * @param {object} source
     * @param {string} keyPath
     * @returns {unknown}
     */
    static #lookup(source, keyPath) {
        if (!source || typeof source !== 'object') return undefined
        return String(keyPath || '')
            .split('.')
            .reduce((current, segment) => {
                if (!current || typeof current !== 'object') return undefined
                return current[segment]
            }, source)
    }

    /**
     * Converts arbitrary locale strings to supported `en`/`de` code.
     * @param {string} locale
     * @returns {string}
     */
    static #normalizeLocale(locale) {
        const normalized = String(locale || '')
            .toLowerCase()
            .replace('_', '-')
        if (normalized.startsWith('de')) return 'de'
        return 'en'
    }
}
