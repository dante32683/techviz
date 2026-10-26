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
