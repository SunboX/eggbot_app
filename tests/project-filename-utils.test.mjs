import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectFilenameUtils } from '../src/ProjectFilenameUtils.mjs'

test('ProjectFilenameUtils should include seed in file stem', () => {
    const stem = ProjectFilenameUtils.buildFileStem('My Ornament', 'Fallback Name', 42)

    assert.equal(stem, 'my-ornament-seed-42')
})

test('ProjectFilenameUtils should build default stem when project name is empty', () => {
    const filename = ProjectFilenameUtils.buildFileName('', 'Sorbische Komposition', 'invalid', 'json')

    assert.equal(filename, 'sorbische-komposition-seed-1.json')
})

test('ProjectFilenameUtils should normalize extension and keep integer seed', () => {
    const filename = ProjectFilenameUtils.buildFileName('Deckblatt', 'Fallback', 13.9, '.SVG')

    assert.equal(filename, 'deckblatt-seed-13.svg')
})
