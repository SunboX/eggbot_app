import { AppController } from './AppController.mjs'
import { AppVersion } from './AppVersion.mjs'
import { I18n } from './I18n.mjs'
import { WebModelContextBootstrap } from './WebModelContextBootstrap.mjs'

const i18n = new I18n({
    storageKey: 'eggbot_app_locale'
})
/**
 * Starts the localized application.
 * @returns {Promise<void>}
 */
async function startApp() {
    await AppVersion.loadFromPackageJson()
    await i18n.init()
    i18n.applyTranslations(document)
    await WebModelContextBootstrap.ensure()
    const app = new AppController(i18n)
    await app.init()
}
startApp().catch((error) => {
    console.error(error)
    const statusElement = document.querySelector('[data-status]')
    if (!statusElement) return
    const translated = i18n.t('messages.appInitFailed', { message: error?.message || '' })
    statusElement.textContent =
        translated === 'messages.appInitFailed'
            ? `App initialization failed: ${String(error?.message || 'Unknown error')}`
            : translated
    statusElement.dataset.type = 'error'
})


