import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLabel, labelSvg } from '../src/label.js'
import { THEMES } from '../src/theme.js'

const italics = (src) => parseLabel(src).filter((r) => r.italic).map((r) => r.text)

test('a letter after a subscript is a quantity, after a power of ten a unit', () => {
  assert.deepEqual(italics('m_{1}g'), ['m', 'g'])
  assert.deepEqual(italics('1.5\\times10^{3} m'), [])
  assert.deepEqual(italics('12 V'), [])
})

test('\\vec, \\hat and \\bar keep their letter italic', () => {
  assert.deepEqual(italics('\\vec{v}'), ['v⃗'])
  assert.deepEqual(italics('\\vec{F}_{B}'), ['F⃗'])
  assert.deepEqual(italics('\\hat{x}'), ['x̂'])
})

test('a vector letter is drawn from its math-italic code point in Cambria Math', () => {
  const svg = labelSvg('\\vec{v}', 0, 0, THEMES.dark)
  assert.match(svg, /font-family="Cambria Math, [^"]*">\u{1d463}⃗</u)
  assert.doesNotMatch(svg, /font-style="italic"/)
})

test('in the app themes, a label with italic Greek places each piece itself (no bold serif fallback)', () => {
  // resvg sets plain pieces in a bold serif once any piece needs another font, unless each starts a new chunk.
  for (const label of ['mg\\sin\\theta', '\\theta', '\\vec{v}']) {
    assert.match(labelSvg(label, 0, 0, THEMES.dark), /<tspan x="/, label)
  }
  assert.doesNotMatch(labelSvg('mg', 0, 0, THEMES.dark), /<tspan x="/)
})

test('an italic letter after a subscript gets a little room (m_{1}g)', () => {
  assert.match(labelSvg('m_{1}g', 0, 0, THEMES.paper), /<tspan dx="[\d.]+"[^>]*font-style="italic"[^>]*>g</)
  assert.doesNotMatch(labelSvg('V_{in}', 0, 0, THEMES.paper), /dx=/)
})

test('a space after a command name ends the name before a letter and stays before anything else', () => {
  const text = (src) => parseLabel(src).map((r) => r.text).join('')
  assert.equal(text('100\\,\\mu F'), '100 μF')
  assert.equal(text('\\varphi = 30°'), 'φ = 30°')
})
