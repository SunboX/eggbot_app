import test from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser as LinkedomDOMParser } from '../node_modules/linkedom/worker.js'
import { SvgProjectNameUtils } from '../src/SvgProjectNameUtils.mjs'

/**
 * Installs one DOMParser implementation for a test and returns a restore callback.
 * @param {typeof DOMParser} parserCtor
 * @returns {() => void}
 */
function installDomParser(parserCtor) {
    const hasOwnDomParser = Object.prototype.hasOwnProperty.call(globalThis, 'DOMParser')
    const originalDomParser = globalThis.DOMParser

    Object.defineProperty(globalThis, 'DOMParser', {
        value: parserCtor,
        configurable: true,
        writable: true
    })

    return () => {
        if (hasOwnDomParser) {
            Object.defineProperty(globalThis, 'DOMParser', {
                value: originalDomParser,
                configurable: true,
                writable: true
            })
            return
        }
        delete globalThis.DOMParser
    }
}

test('SvgProjectNameUtils should prefer cc:Work metadata title over agent titles', () => {
    const restore = installDomParser(LinkedomDOMParser)
    try {
        const svgText = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <metadata>
    <rdf:RDF>
      <cc:Work rdf:about="">
        <dc:title>Fruehlings Muster</dc:title>
      </cc:Work>
      <dc:creator>
        <cc:Agent>
          <dc:title>Creator Name</dc:title>
        </cc:Agent>
      </dc:creator>
    </rdf:RDF>
  </metadata>
  <path d="M0,0 L10,10" />
</svg>`

        const projectName = SvgProjectNameUtils.resolveProjectName(svgText, 'fallback_name.svg')

        assert.equal(projectName, 'Fruehlings Muster')
    } finally {
        restore()
    }
})

test('SvgProjectNameUtils should read plain svg title when metadata title is missing', () => {
    const restore = installDomParser(LinkedomDOMParser)
    try {
        const svgText = `<svg xmlns="http://www.w3.org/2000/svg">
  <title> Ornament Titel </title>
  <path d="M0,0 L10,10" />
</svg>`

        const projectName = SvgProjectNameUtils.resolveProjectName(svgText, 'fallback_name.svg')

        assert.equal(projectName, 'Ornament Titel')
    } finally {
        restore()
    }
})

test('SvgProjectNameUtils should use Inkscape docname when no title elements exist', () => {
    const restore = installDomParser(LinkedomDOMParser)
    try {
        const svgText = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" sodipodi:docname="inkscape-ornament.svg">
  <path d="M0,0 L10,10" />
</svg>`

        const projectName = SvgProjectNameUtils.resolveProjectName(svgText, 'fallback_name.svg')

        assert.equal(projectName, 'inkscape-ornament')
    } finally {
        restore()
    }
})

test('SvgProjectNameUtils should fall back to file name and replace separators', () => {
    const restore = installDomParser(LinkedomDOMParser)
    try {
        const svgText = `<svg xmlns="http://www.w3.org/2000/svg">
  <path d="M0,0 L10,10" />
</svg>`

        const projectName = SvgProjectNameUtils.resolveProjectName(svgText, '/tmp/my-awesome_pattern.SVG')

        assert.equal(projectName, 'my awesome pattern')
    } finally {
        restore()
    }
})

test('SvgProjectNameUtils should fall back to file name when DOMParser is unavailable', () => {
    const restore = installDomParser(undefined)
    try {
        const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><title>Ignored</title></svg>`
        const projectName = SvgProjectNameUtils.resolveProjectName(svgText, 'dom_parser_missing-test.svg')

        assert.equal(projectName, 'dom parser missing test')
    } finally {
        restore()
    }
})
