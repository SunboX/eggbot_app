import test from 'node:test'
import assert from 'node:assert/strict'
import { PatternSvgExportUtils } from '../src/PatternSvgExportUtils.mjs'
import { AppVersion } from '../src/AppVersion.mjs'

test('PatternSvgExportUtils should build a valid SVG document shell with Inkscape metadata', () => {
    const svg = PatternSvgExportUtils.buildSvg({
        strokes: [],
        baseColor: '#efe7ce',
        editorName: 'Eggbot Editor',
        editorUrl: 'https://example.com/eggbot',
        width: 320,
        height: 160
    })

    assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
    assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'))
    assert.ok(svg.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"'))
    assert.ok(svg.includes('xmlns:cc="http://creativecommons.org/ns#"'))
    assert.ok(svg.includes('xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'))
    assert.ok(svg.includes('viewBox="0 0 320 160" width="320" height="160" fill="none"'))
    assert.ok(svg.includes('<metadata id="metadata1">'))
    assert.ok(svg.includes('<rdf:RDF>'))
    assert.ok(svg.includes('<cc:Work rdf:about="">'))
    assert.ok(svg.includes('<dc:format>image/svg+xml</dc:format>'))
    assert.ok(svg.includes('<dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" />'))
    assert.ok(svg.includes('<dc:title>Sorbian egg composition</dc:title>'))
    assert.match(svg, /<dc:date>[^<]+<\/dc:date>/)
    assert.ok(svg.includes('<dc:creator><cc:Agent><dc:title>Eggbot Editor</dc:title></cc:Agent></dc:creator>'))
    assert.ok(svg.includes('<dc:source>https://example.com/eggbot</dc:source>'))
    assert.ok(svg.includes(`<dc:identifier>eggbot-app-${AppVersion.get()}</dc:identifier>`))
    assert.ok(svg.includes(`<dc:description>Generated with Eggbot Editor (https://example.com/eggbot) using eggbot-app ${AppVersion.get()}</dc:description>`))
    assert.ok(svg.includes('<rdf:li>sorbian</rdf:li>'))
    assert.equal(svg.includes('eggbot-metadata'), false)
    assert.equal(svg.includes('Edited with'), false)
    assert.ok(svg.includes('<rect width="320" height="160" fill="#efe7ce" />'))
    assert.equal(svg.includes('NaN'), false)
})

test('PatternSvgExportUtils should export stroke and fill path attributes', () => {
    const svg = PatternSvgExportUtils.buildSvg({
        palette: ['#8b1f1a', '#1f3f8b'],
        baseColor: '#ffffff',
        lineWidth: 2,
        width: 100,
        height: 50,
        strokes: [
            {
                colorIndex: 0,
                closed: true,
                fillGroupId: 5,
                fillAlpha: 0.4,
                fillRule: 'evenodd',
                points: [
                    { u: 0.1, v: 0.2 },
                    { u: 0.4, v: 0.2 },
                    { u: 0.2, v: 0.6 }
                ]
            },
            {
                colorIndex: 1,
                points: [
                    { u: 0.05, v: 0.8 },
                    { u: 0.95, v: 0.8 }
                ]
            },
            {
                colorIndex: 1,
                closed: true,
                points: [
                    { u: 0.6, v: 0.2 },
                    { u: 0.8, v: 0.2 },
                    { u: 0.7, v: 0.4 }
                ]
            }
        ]
    })

    assert.ok(svg.includes('fill-opacity="0.4"'))
    assert.ok(svg.includes('fill-opacity="0.16"'))
    assert.ok(svg.includes('fill-rule="evenodd"'))
    assert.ok(svg.includes('stroke="#8b1f1a"'))
    assert.ok(svg.includes('stroke="#1f3f8b"'))
    assert.ok(svg.includes('stroke-width="2"'))
    assert.ok(svg.includes('<g id="ornament-fills">'))
    assert.ok(svg.includes('<g id="ungrouped-strokes">'))
    assert.ok(svg.includes('<path d="M'))
    assert.equal(svg.includes('NaN'), false)
})

test('PatternSvgExportUtils should group horizontal ring strokes by preset names', () => {
    const svg = PatternSvgExportUtils.buildSvg({
        palette: ['#8b1f1a'],
        width: 120,
        height: 60,
        lineWidth: 2,
        strokes: [
            {
                colorIndex: 0,
                horizontalRingGroup: 'punkte',
                points: [
                    { u: 0, v: 0.5 },
                    { u: 0.5, v: 0.5 },
                    { u: 1, v: 0.5 }
                ]
            },
            {
                colorIndex: 0,
                points: [
                    { u: 0.2, v: 0.2 },
                    { u: 0.3, v: 0.3 }
                ]
            }
        ]
    })

    assert.ok(svg.includes('<g id="horizontal-lines-rings">'))
    assert.ok(svg.includes('<g id="horizontal-lines-punkte" data-label="Punkte">'))
    assert.ok(svg.includes('<g id="horizontal-lines-strahlen" data-label="Strahlen">'))
    assert.ok(svg.includes('<g id="horizontal-lines-feder-raute" data-label="Feder/Raute">'))
    assert.match(svg, /<g id="horizontal-lines-punkte"[\s\S]*stroke="#8b1f1a"/)
})

test('PatternSvgExportUtils should group ornament strokes by motif names', () => {
    const svg = PatternSvgExportUtils.buildSvg({
        palette: ['#8b1f1a'],
        width: 120,
        height: 60,
        lineWidth: 2,
        strokes: [
            {
                colorIndex: 0,
                motifGroup: 'wabe',
                points: [
                    { u: 0.2, v: 0.2 },
                    { u: 0.4, v: 0.2 },
                    { u: 0.3, v: 0.4 }
                ]
            },
            {
                colorIndex: 0,
                motifGroup: 'feder-raute',
                points: [
                    { u: 0.6, v: 0.2 },
                    { u: 0.8, v: 0.2 },
                    { u: 0.7, v: 0.4 }
                ]
            }
        ]
    })

    assert.ok(svg.includes('<g id="ornaments-by-motif">'))
    assert.ok(svg.includes('<g id="ornament-wabe" data-label="Wabe">'))
    assert.ok(svg.includes('<g id="ornament-feder-raute" data-label="Feder/Raute">'))
    assert.match(svg, /<g id="ornament-wabe"[\s\S]*stroke="#8b1f1a"/)
})
