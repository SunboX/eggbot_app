import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectUrlUtils } from '../src/ProjectUrlUtils.mjs'

test('ProjectUrlUtils should encode and decode project payload', () => {
    const payload = {
        projectName: 'Share test',
        seed: 123,
        palette: ['#111111', '#222222']
    }

    const encoded = ProjectUrlUtils.encodeProjectPayloadParam(payload)
    const decoded = ProjectUrlUtils.decodeEmbeddedProjectParam(encoded)

    assert.deepEqual(decoded, payload)
})

test('ProjectUrlUtils should resolve embedded project source', () => {
    const params = new URLSearchParams('project=abc123')
    const source = ProjectUrlUtils.resolveProjectSource(params)

    assert.equal(source.kind, 'embedded')
    assert.equal(source.value, 'abc123')
})
