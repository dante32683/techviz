// Part bodies for breadboard, drawn in a local frame: x along the part's leads,
// y across them, centered on the body. index.js maps the frame onto the board.

import { el } from '../../svg.js'
import { color } from '../../theme.js'

// Body length along the leads (L) and thickness across them (T), in px.
export const TWO_LEAD = {
  R: { L: 28, T: 11 }, C: { L: 12, T: 12 }, Cp: { L: 22, T: 13 }, L: { L: 24, T: 10 },
  diode: { L: 20, T: 8 }, led: { L: 15, T: 15 }, switch: { L: 14, T: 14 },
}

// Pin names in the summary, in `pins` order.
export const MULTI_PINS = { npn: ['e', 'b', 'c'], pnp: ['e', 'b', 'c'], pot: ['a', 'w', 'b'] }

// Resistor color code (IEC 60062). These are the part's physical colors, so unlike the rest of
// the figure they stay the same in every theme, on a fixed tan body that reads on dark and white.
const DIGITS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray', 'white']
const BAND_INK = {
  black: '#1a1a1a', brown: '#8b4a1d', red: '#d8302a', orange: '#f28a17', yellow: '#f7d417', green: '#1f9d45',
  blue: '#2763d6', violet: '#8a43d0', gray: '#8c8c8c', white: '#ffffff', gold: '#b98d14', silver: '#b4b9c0',
}
const BODY_TAN = '#ecd6a7'
const PREFIX = { '': 0, m: -3, k: 3, K: 3, M: 6, G: 9 }

/**
 * A resistance written as light TeX or plain text (`16.2\,\Omega`, `4.7\,k\Omega`, `1 MΩ`, `330`)
 * as its significant digits and a power of ten: 16.2 Ω is {digits: '162', exp: -1}. Null when
 * the value isn't a plain resistance.
 */
export function parseOhms(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const s = String(value)
    .replace(/\\(?:mathrm|text|rm)\{([^}]*)\}/g, '$1')
    .replace(/\\[,;:! ]|~|\s/g, '')
    .replace(/(\\Omega|Ω|\u2126|[oO]hms?)$/, '')
  const m = s.match(/^(\d+\.?\d*|\.\d+)([mkKMG]?)$/)
  if (!m) return null
  const [int, frac = ''] = m[1].split('.')
  let digits = (int + frac).replace(/^0+/, ''), exp = PREFIX[m[2]] - frac.length
  if (!digits) return null // 0 Ω
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0, -1); exp++ }
  return { digits, exp }
}

// n bands: n - 2 digits, a multiplier (gold ×0.1, silver ×0.01), and tolerance (gold 5% or brown 1%).
function encode({ digits, exp }, n) {
  const sig = n - 2
  if (digits.length > sig) return null
  const mult = exp - (sig - digits.length)
  if (mult < -2 || mult > 9) return null
  return [...digits.padEnd(sig, '0')].map((d) => DIGITS[d])
    .concat(mult === -1 ? 'gold' : mult === -2 ? 'silver' : DIGITS[mult], n === 4 ? 'gold' : 'brown')
}

/**
 * Color bands for a resistor's value: 4 (2 digits, multiplier, gold 5%) when two significant
 * digits hold it, else 5 (3 digits, multiplier, brown 1%). `want` (4 or 5) asks for a count and
 * falls back to the other when the value doesn't fit it. Null when the value isn't a resistance;
 * `{bands: null}` when it is one but has no color code (4+ digits, or under 0.1 Ω or over 999 GΩ).
 */
export function resistorBands(value, want) {
  const v = parseOhms(value)
  if (!v) return null
  return { bands: (want && encode(v, want)) || encode(v, 4) || encode(v, 5) }
}

// Bands across the body between its rounded ends, read from pin 1; the tolerance band sits
// apart at the pin-2 end.
function banded(bands, box, rx, ink) {
  const n = bands.length, w = n === 4 ? 2.6 : 2.3, pitch = n === 4 ? 3.8 : 3.3
  const left = box.x + rx, right = box.x + box.width - rx
  const xs = bands.map((_, k) => (k < n - 1 ? left + w / 2 + k * pitch : right - w / 2))
  return el('rect', { ...box, rx, fill: BODY_TAN }) +
    bands.map((b, k) => el('rect', { x: +(xs[k] - w / 2).toFixed(2), y: box.y, width: w, height: box.height, fill: BAND_INK[b], stroke: '#000000', 'stroke-opacity': 0.3, 'stroke-width': 0.4 })).join('') +
    el('rect', { ...box, rx, fill: 'none', stroke: ink, 'stroke-width': 1.3 })
}

const tinted = (shape, attrs, tint, opacity, ink, theme) =>
  el(shape, { ...attrs, fill: theme.halo }) + el(shape, { ...attrs, fill: tint, 'fill-opacity': opacity, stroke: ink, 'stroke-width': 1.3 })

/** SVG for a two-lead body, centered at 0 with its leads along x (pin 1 at -x). */
export function twoLeadBody(t, part, ink, theme) {
  const { L, T } = TWO_LEAD[t]
  const box = { x: -L / 2, y: -T / 2, width: L, height: T }
  switch (t) {
    case 'R':
      if (part.colorBands) return banded(part.colorBands, box, 4, ink)
      return tinted('rect', { ...box, rx: 4 }, color('amber'), 0.45, ink, theme)
    case 'C': return tinted('ellipse', { cx: 0, cy: 0, rx: L / 2, ry: T / 2 }, color('coral'), 0.5, ink, theme)
    case 'Cp': // electrolytic: the stripe marks the minus lead (pin 2)
      return tinted('rect', { ...box, rx: 3 }, color('blue'), 0.4, ink, theme) +
        el('rect', { x: L / 2 - 7, y: -T / 2 + 0.7, width: 6.3, height: T - 1.4, fill: ink, 'fill-opacity': 0.45 }) +
        el('line', { x1: L / 2 - 5.6, y1: 0, x2: L / 2 - 2.4, y2: 0, stroke: theme.halo, 'stroke-width': 1.2 })
    case 'L':
      return tinted('rect', { ...box, rx: T / 2 }, color('green'), 0.4, ink, theme) +
        [-6, 0, 6].map((x) => el('line', { x1: x, y1: -T / 2 + 1.5, x2: x + 2, y2: T / 2 - 1.5, stroke: ink, 'stroke-width': 0.9, 'stroke-opacity': 0.7 })).join('')
    case 'diode': // body with a band at the cathode (pin 2)
      return el('rect', { ...box, rx: 1.5, fill: ink }) +
        el('rect', { x: L / 2 - 6, y: -T / 2, width: 2.6, height: T, fill: theme.halo })
    case 'led': { // round lens with the flat side at the cathode (pin 2)
      const r = L / 2, fx = r * 0.78, fy = Math.sqrt(r * r - fx * fx)
      return el('path', { d: `M${fx} ${-fy}A${r} ${r} 0 1 0 ${fx} ${fy}Z`, fill: color(part.color ?? 'red'), 'fill-opacity': 0.8, stroke: ink, 'stroke-width': 1.3 })
    }
    case 'switch':
      return el('rect', { ...box, rx: 2, fill: theme.halo, stroke: ink, 'stroke-width': 1.3 }) +
        el('circle', { cx: 0, cy: 0, r: 4, fill: theme.faint })
  }
  return ''
}

/** SVG for a multi-lead body of width w and height h, centered at 0; the leads leave its +y side. */
export function multiLeadBody(t, w, h, ink, theme) {
  if (t === 'npn' || t === 'pnp') { // TO-92: flat face toward the viewer, round back away from the board
    const r = w / 2
    return el('path', { d: `M${-r} ${h / 2}H${r}V${-h / 2 + r * 0.6}A${r} ${r * 0.6} 0 0 0 ${-r} ${-h / 2 + r * 0.6}Z`, fill: theme.halo, stroke: ink, 'stroke-width': 1.3 }) +
      el('path', { d: `M${-r} ${h / 2}H${r}V${-h / 2 + r * 0.6}A${r} ${r * 0.6} 0 0 0 ${-r} ${-h / 2 + r * 0.6}Z`, fill: ink, 'fill-opacity': 0.12 })
  }
  if (t === 'pot') {
    return tinted('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 2 }, color('teal'), 0.35, ink, theme) +
      el('circle', { cx: 0, cy: 0, r: Math.min(w, h) * 0.3, fill: theme.halo, stroke: ink, 'stroke-width': 1.1 }) +
      el('line', { x1: 0, y1: 0, x2: 0, y2: -Math.min(w, h) * 0.3, stroke: ink, 'stroke-width': 1.3 })
  }
  // box: a module or device under test
  return tinted('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3 }, theme.faint, 0.25, ink, theme)
}
