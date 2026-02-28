/**
 * Decides post-render texture sync behavior for imported/generated flows.
 */
export class ImportedRenderSyncUtils {
    /**
     * Resolves post-render actions for one render completion.
     * @param {string} importedSvgText
     * @param {{ dispatchImportedRenderedEvent?: boolean } | null | undefined} renderResult
     * @returns {{ shouldSyncEggTextureNow: boolean, shouldDispatchImportedRenderedEvent: boolean }}
     */
    static resolvePostRenderAction(importedSvgText, renderResult) {
        const hasImportedSvg = String(importedSvgText || '').trim().length > 0
        if (!hasImportedSvg) {
            return {
                shouldSyncEggTextureNow: true,
                shouldDispatchImportedRenderedEvent: false
            }
        }

        const shouldDispatchImportedRenderedEvent = Boolean(renderResult?.dispatchImportedRenderedEvent)
        return {
            shouldSyncEggTextureNow: !shouldDispatchImportedRenderedEvent,
            shouldDispatchImportedRenderedEvent
        }
    }
}
