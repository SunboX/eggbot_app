import assert from 'node:assert/strict'
import test from 'node:test'
import { FileInputPromptUtils } from '../src/FileInputPromptUtils.mjs'

/**
 * Creates one EventTarget-like object.
 * @returns {{ addEventListener: (type: string, handler: Function) => void, removeEventListener: (type: string, handler: Function) => void, emit: (type: string, event?: Record<string, any>) => void }}
 */
function createEventDispatcher() {
    const listeners = new Map()
    return {
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set())
            }
            listeners.get(type).add(handler)
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler)
        },
        emit(type, event = {}) {
            listeners.get(type)?.forEach((handler) => {
                handler({ type, ...event })
            })
        }
    }
}

/**
 * Creates one file-input test double.
 * @returns {{ input: { value: string, files: any[] | null, addEventListener: Function, removeEventListener: Function, click: Function }, events: ReturnType<typeof createEventDispatcher> }}
 */
function createInputMock() {
    const events = createEventDispatcher()
    const input = {
        value: 'preset',
        files: null,
        addEventListener(type, handler) {
            events.addEventListener(type, handler)
        },
        removeEventListener(type, handler) {
            events.removeEventListener(type, handler)
        },
        click() {}
    }
    return { input, events }
}

/**
 * Creates one window-like test double.
 * @returns {{ windowObject: { addEventListener: Function, removeEventListener: Function, setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }, events: ReturnType<typeof createEventDispatcher> }}
 */
function createWindowMock() {
    const events = createEventDispatcher()
    return {
        windowObject: {
            addEventListener(type, handler) {
                events.addEventListener(type, handler)
            },
            removeEventListener(type, handler) {
                events.removeEventListener(type, handler)
            },
            setTimeout,
            clearTimeout
        },
        events
    }
}

test('FileInputPromptUtils should keep selected file when focus arrives before change event', async () => {
    const { input, events: inputEvents } = createInputMock()
    const { windowObject, events: windowEvents } = createWindowMock()
    const selected = { name: 'selected.svg' }

    const pending = FileInputPromptUtils.promptSingleFile({
        input,
        windowObject,
        cancelDelayMs: 20
    })

    input.files = [selected]
    windowEvents.emit('focus')
    inputEvents.emit('change')

    const resolved = await pending
    assert.equal(resolved, selected)
})

test('FileInputPromptUtils should resolve null when focus returns without selection', async () => {
    const { input } = createInputMock()
    const { windowObject, events: windowEvents } = createWindowMock()

    const pending = FileInputPromptUtils.promptSingleFile({
        input,
        windowObject,
        cancelDelayMs: 0
    })

    windowEvents.emit('focus')
    const resolved = await pending
    assert.equal(resolved, null)
})

test('FileInputPromptUtils should resolve null on input cancel event', async () => {
    const { input, events: inputEvents } = createInputMock()
    const { windowObject } = createWindowMock()

    const pending = FileInputPromptUtils.promptSingleFile({
        input,
        windowObject
    })

    inputEvents.emit('cancel')
    const resolved = await pending
    assert.equal(resolved, null)
})

test('FileInputPromptUtils should clear previous input value before opening chooser', async () => {
    const { input, events: inputEvents } = createInputMock()
    const { windowObject } = createWindowMock()

    let clickCalls = 0
    input.click = () => {
        clickCalls += 1
        input.files = [{ name: 'pattern.svg' }]
        inputEvents.emit('change')
    }

    const resolved = await FileInputPromptUtils.promptSingleFile({
        input,
        windowObject
    })

    assert.equal(clickCalls, 1)
    assert.equal(input.value, '')
    assert.equal(resolved?.name, 'pattern.svg')
})
