// Part bodies for breadboard, drawn in a local frame: x along the part's leads,
// y across them, centered on the body. index.js maps the frame onto the board.

import { el } from '../../svg.js'
import { color } from '../../theme.js'

// Body length along the leads (L) and thickness across them (T), in px.
export const TWO_LEAD = {
  R: { L: 26, T: 9 }, C: { L: 12, T: 12 }, Cp: { L: 22, T: 13 }, L: { L: 24, T: 10 },
  diode: { L: 20, T: 8 }, led: { L: 15, T: 15 }, switch: { L: 14, T: 14 },
}

// Pin names in the summary, in `pins` order.
export const MULTI_PINS = { npn: ['e', 'b', 'c'], pnp: ['e', 'b', 'c'], pot: ['a', 'w', 'b'] }

const tinted = (shape, attrs, tint, opacity, ink, theme) =>
  el(shape, { ...attrs, fill: theme.halo }) + el(shape, { ...attrs, fill: tint, 'fill-opacity': opacity, stroke: ink, 'stroke-width': 1.3 })

/** SVG for a two-lead body, centered at 0 with its leads along x (pin 1 at -x). */
export function twoLeadBody(t, part, ink, theme) {
  const { L, T } = TWO_LEAD[t]
  const box = { x: -L / 2, y: -T / 2, width: L, height: T }
  switch (t) {
    case 'R': return tinted('rect', { ...box, rx: 4 }, color('amber'), 0.45, ink, theme)
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
