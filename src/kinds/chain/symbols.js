// RF block symbols, drawn centered on the signal line at (x, y): a triangle for an amplifier, a box
// of three waves for a filter (the struck waves are the stopbands), a circle with an X for a
// mixer, a circle with a sine for a source, and boxes for the rest. Sizes come first, so the
// layout can space the blocks before anything is drawn.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'

/** A label as written when it has TeX in it, else upright text (so "IF amp" and "R" aren't italic). */
export const up = (s) => (/[\\_^{}$]/.test(s) ? s : `\\text{${s}}`)

export const INSIDE = 10 // font size of a label drawn inside a box
const fits = (b) => (b.type === 'block' || b.type === 'receiver') && b.label && measure(up(b.label), INSIDE) <= 40

/** Width and the top and bottom offsets from the line; `inside` when the label goes in the box. */
export function size(b) {
  switch (b.type) {
    case 'amp': return { w: 26, top: -12, bottom: 12 }
    case 'mixer': case 'source': return { w: 24, top: -12, bottom: 12 }
    case 'antenna': return { w: 16, top: -24, bottom: 0 }
    case 'port': return { w: 10, top: -5, bottom: 5 }
    case 'cable': return { w: 28, top: -5, bottom: 5 }
    case 'atten': return { w: 28, top: -8, bottom: 8 }
    case 'switch': return { w: 26, top: -11, bottom: 4 }
    case 'coupler': case 'adc': case 'display': return { w: 30, top: -11, bottom: 11 }
    case 'block': case 'receiver':
      return fits(b) ? { w: Math.max(24, measure(up(b.label), INSIDE) + 12), top: -11, bottom: 11, inside: true } : { w: 30, top: -11, bottom: 11 }
    default: return { w: 28, top: -11, bottom: 11 }
  }
}

/** Where a coupler's coupled arm or a splitter's second output leaves the block, from its center. */
export const branchDx = (b) => (b.type === 'coupler' ? (b.samples === 'reflected' ? -9 : 9) : 0)

const wave = (x0, x1, y, amp = 1.7, periods = 2) => {
  const n = 24, pts = []
  for (let k = 0; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y - amp * Math.sin((2 * Math.PI * periods * k) / n)])
  return pts
}

/** The symbol's SVG. `st` is the stroke color, `bg` the fill, `w` the stroke width. */
export function draw(b, x, y, { st, bg, w = 1.5, theme }) {
  const p = []
  const line = (pts, extra = {}) => p.push(el('path', { d: pathD(pts), fill: 'none', stroke: st, 'stroke-width': w, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra }))
  const box = (bw, bh, rx = 2) => p.push(el('rect', { x: x - bw / 2, y: y - bh / 2, width: bw, height: bh, rx, fill: bg, stroke: st, 'stroke-width': w }))
  const dot = (cx, cy, r = 1.8) => p.push(el('circle', { cx, cy, r, fill: st }))
  const { w: W } = size(b)
  switch (b.type) {
    case 'amp':
      p.push(el('path', { d: pathD([[x - 13, y - 12], [x + 13, y], [x - 13, y + 12]], true), fill: bg, stroke: st, 'stroke-width': w, 'stroke-linejoin': 'round' }))
      break
    case 'mixer': {
      p.push(el('circle', { cx: x, cy: y, r: 12, fill: bg, stroke: st, 'stroke-width': w }))
      const k = 12 * Math.SQRT1_2
      line([[x - k, y - k], [x + k, y + k]]); line([[x + k, y - k], [x - k, y + k]])
      break
    }
    case 'source':
      p.push(el('circle', { cx: x, cy: y, r: 12, fill: bg, stroke: st, 'stroke-width': w }))
      line(wave(x - 7, x + 7, y, 4, 1))
      break
    case 'antenna':
      line([[x, y], [x, y - 12]])
      p.push(el('path', { d: pathD([[x - 8, y - 24], [x + 8, y - 24], [x, y - 12]], true), fill: 'none', stroke: st, 'stroke-width': w, 'stroke-linejoin': 'round' }))
      break
    case 'port':
      p.push(el('circle', { cx: x, cy: y, r: 4.5, fill: bg, stroke: st, 'stroke-width': w }))
      break
    case 'cable':
      p.push(el('rect', { x: x - 14, y: y - 5, width: 28, height: 10, rx: 5, fill: bg, stroke: st, 'stroke-width': w }))
      line([[x - 14, y], [x + 14, y]], { 'stroke-width': w * 0.8 })
      break
    case 'atten': {
      box(28, 16)
      const z = [[x - 14, y], [x - 9, y]]
      for (let k = 0; k < 6; k++) z.push([x - 7.5 + k * 3, y + (k % 2 ? 3.5 : -3.5)])
      z.push([x + 9, y], [x + 14, y])
      line(z, { 'stroke-width': w * 0.85 })
      break
    }
    case 'switch':
      line([[x - 13, y], [x - 9, y]]); line([[x + 9, y], [x + 13, y]])
      line([[x - 9, y], [x + 8, y - 2.5]])
      dot(x - 9, y); dot(x + 9, y); dot(x + 9, y - 9)
      break
    case 'filter': {
      box(28, 22)
      for (const [k, dy] of [[0, -6], [1, 0], [2, 6]]) {
        line(wave(x - 8, x + 8, y + dy), { 'stroke-width': 1.1 })
        const struck = (b.shape === 'bpf' && k !== 1) || (b.shape === 'lpf' && k === 0) || (b.shape === 'hpf' && k === 2)
        if (struck) line([[x - 2.5, y + dy + 3], [x + 2.5, y + dy - 3]], { 'stroke-width': 1.1 })
      }
      break
    }
    case 'splitter':
      box(28, 22)
      line([[x - 14, y], [x + 14, y]], { 'stroke-width': 1.1 }); line([[x, y], [x, y + 11]], { 'stroke-width': 1.1 })
      dot(x, y, 2)
      break
    case 'coupler': {
      box(30, 22)
      line([[x - 15, y], [x + 15, y]], { 'stroke-width': 1.1 })
      const port = branchDx(b), end = -port
      line([[x - 9, y + 5], [x + 9, y + 5]], { 'stroke-width': 1.1 })
      line([[x + port, y + 5], [x + port, y + 11]], { 'stroke-width': 1.1 })
      line([[x + end, y + 5], [x + end, y + 8]], { 'stroke-width': 1.1 })
      p.push(el('rect', { x: x + end - 2.5, y: y + 7.5, width: 5, height: 2, fill: st }))
      break
    }
    case 'detector':
      box(28, 22)
      line([[x - 11, y], [x - 5, y]], { 'stroke-width': 1.1 }); line([[x + 3, y], [x + 11, y]], { 'stroke-width': 1.1 })
      p.push(el('path', { d: pathD([[x - 5, y - 5], [x + 3, y], [x - 5, y + 5]], true), fill: st }))
      line([[x + 3, y - 5], [x + 3, y + 5]], { 'stroke-width': 1.3 })
      break
    case 'adc':
      box(30, 22)
      line([[x - 15, y + 11], [x + 15, y - 11]], { 'stroke-width': 1.1 })
      p.push(labelSvg('\\text{A}', x - 8, y - 2, theme, { size: 8, fill: st }), labelSvg('\\text{D}', x + 8, y + 8, theme, { size: 8, fill: st }))
      break
    case 'display':
      box(30, 22, 2)
      line([[x - 11, y + 6], [x - 7, y + 5], [x - 4, y + 6], [x - 1, y + 4], [x + 1, y - 6], [x + 3, y + 4], [x + 6, y + 6], [x + 9, y + 5], [x + 11, y + 6]], { 'stroke-width': 1.1 })
      break
    default: // block, receiver
      box(W, 22, 3)
      if (size(b).inside) p.push(labelSvg(up(b.label), x, y, theme, { size: INSIDE, fill: st, middle: true, weight: b.type === 'receiver' ? 600 : undefined }))
  }
  return p.join('')
}

/** An LO source below a mixer: a circle with a sine, and a diagonal arrow through it when swept. */
export function drawLO(x, y, r, { st, bg, w = 1.4, sweep }) {
  const p = [el('circle', { cx: x, cy: y, r, fill: bg, stroke: st, 'stroke-width': w })]
  p.push(el('path', { d: pathD(wave(x - r * 0.6, x + r * 0.6, y, r * 0.35, 1)), fill: 'none', stroke: st, 'stroke-width': 1.1 }))
  if (sweep) {
    const a = [x - r - 3, y + r + 3], t = [x + r + 3, y - r - 3]
    p.push(el('line', { x1: a[0], y1: a[1], x2: t[0] - 2.5, y2: t[1] + 2.5, stroke: st, 'stroke-width': 1.1 }))
    p.push(el('path', { d: pathD([t, [t[0] - 5.5, t[1] + 1.5], [t[0] - 1.5, t[1] + 5.5]], true), fill: st }))
  }
  return p.join('')
}
