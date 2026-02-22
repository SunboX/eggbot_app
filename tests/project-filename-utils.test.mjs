import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectFilenameUtils } from '../src/ProjectFilenameUtils.mjs'

test('ProjectFilenameUtils should build stem from project name', () => {
    const stem = ProjectFilenameUtils.buildFileStem('My Ornament', 'Fallback Name')

    assert.equal(stem, 'my-ornament')
})

test('ProjectFilenameUtils should build default stem when project name is empty', () => {
    const filename = ProjectFilenameUtils.buildFileName('', 'Sorbische Komposition', 'json')

    assert.equal(filename, 'sorbische-komposition.json')
})

test('ProjectFilenameUtils should normalize extension', () => {
    const filename = ProjectFilenameUtils.buildFileName('Deckblatt', 'Fallback', '.SVG')

    assert.equal(filename, 'deckblatt.svg')
})
