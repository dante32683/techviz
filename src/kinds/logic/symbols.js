// Part symbols: ANSI distinctive-shape gates (the Harris & Harris style) and RTL blocks.
// geom(part) gives the body size, pin positions (relative to the body's top-left), and the
// room each part needs above it (routed top pins, the clock stub); drawPart() draws it.

import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { GATES } from './net.js'

export const BUB = 3.5 // inversion bubble radius
export const TOP_LANE = 7 // spacing of the wires that run above a part to its top pins
const PIN = 12 // gate input pitch
const BPIN = 16 // block pin pitch
const PF = 10 // block pin label size
const CLK_ROOM = 20

/** A net name as a label: Cin and Cout get subscripts (C_{in}), as do D0 and A3 (D_{0}); longer names are upright. */
export const texName = (s) => {
  const m = /^([A-Za-z])(in|out|[0-9]+)$/.exec(s)
  if (m) return `${m[1]}_{${m[2]}}`
  return /^[A-Za-z]$/.test(s) || /[_^\\{]/.test(s) ? s : `\\text{${s}}`
}

const orBack = (w, y, h) => 0.56 * w * (y / h) * (1 - y / h) // x of an OR's concave back at height y

function gateGeom(p) {
  const t = p.t
  const data = p.ins.filter((q) => q.data)
  const n = data.length
  const inv = ['nand', 'nor', 'xnor', 'not'].includes(t)
  if (t === 'not' || t === 'buf' || t === 'tri') {
    const h = t === 'tri' ? 18 : 16, body = t === 'tri' ? 18 : 16
    const pins = { [data[0].name]: { x: 0, y: h / 2, side: 'L' }, y: { x: body + (inv ? 2 * BUB : 0), y: h / 2, side: 'R' } }
    if (t === 'tri') pins.en = { x: body / 2, y: h / 4, side: 'T' }
    return { w: body + (inv ? 2 * BUB : 0), h, body, pins, shape: t }
  }
  const h = Math.max(24, n * PIN)
  const pinY = (k) => (h - n * PIN) / 2 + PIN / 2 + k * PIN
  let body, back = () => 0, off = 0
  if (t === 'and' || t === 'nand') body = Math.round(h * 0.5) + 12
  else {
    body = Math.round(h * 0.55) + 13
    if (t === 'xor' || t === 'xnor') off = 5
    back = (y) => orBack(body, y, h)
  }
  const pins = {}
  data.forEach((q, k) => { pins[q.name] = { x: back(pinY(k)), y: pinY(k), side: 'L' } })
  pins.y = { x: off + body + (inv ? 2 * BUB : 0), y: h / 2, side: 'R' }
  return { w: off + body + (inv ? 2 * BUB : 0), h, body, off, pins, shape: t }
}

const centerLabel = (p) => {
  if (p.label !== undefined) return String(p.label).split('\n')
  switch (p.t) {
    case 'dec': return [`${p.ins.filter((q) => q.data).length === 1 ? p.width : p.ins.filter((q) => q.data).length}:${p.outPorts.length}`]
    case 'enc': return ['enc']
    case 'ha': return ['HA']
    case 'fa': return ['FA']
    case 'cmp': return ['cmp']
    case 'counter': return ['cnt']
    case 'shift': return [p.dir === 'right' ? 'shift →' : 'shift ←']
    case 'regfile': return ['Register', 'File']
    case 'mem': return ['Data', 'Memory']
    case 'rom': return ['Instr', 'Memory']
    default: return []
  }
}

/** Geometry of a part: { w, h, pins: {port: {x, y, side}}, above, shape }. */
export function geom(p) {
  let g
  if (GATES.has(p.t)) g = gateGeom(p)
  else if (p.t === 'mux') {
    const n = p.ins.filter((q) => q.data).length
    const h = n * 14 + 8, w = 22, s = 7
    const pins = {}
    p.ins.filter((q) => q.data).forEach((q, k) => { pins[q.name] = { x: 0, y: 4 + 7 + k * 14, side: 'L' } })
    const sel = p.ins.filter((q) => q.ctl === 'sel')
    sel.forEach((q, k) => { const x = w / 2 + (k - (sel.length - 1) / 2) * 7; pins[q.name] = { x, y: (s * x) / w, side: 'T' } })
    pins.y = { x: w, y: h / 2, side: 'R' }
    g = { w, h, pins, shape: 'mux', s }
  } else if (p.t === 'alu' || p.t === 'add') {
    const w = p.t === 'alu' ? 40 : 30, h = p.t === 'alu' ? 64 : 48
    const pins = { a: { x: 0, y: h * 0.21, side: 'L' }, b: { x: 0, y: h * 0.79, side: 'L' }, y: { x: w, y: h / 2, side: 'R' } }
    const top = p.ins.filter((q) => q.ctl === 'op' || q.name === 'cin')
    top.forEach((q, k) => { const x = w * (0.5 + (k - (top.length - 1) / 2) * 0.22); pins[q.name] = { x, y: (0.25 * h * x) / w, side: 'T' } })
    if (p.t === 'alu') pins.zero = { x: w, y: h * 0.33, side: 'R' }
    if (p.t === 'add' && p.outPorts.some((o) => o.name === 'cout')) pins.cout = { x: w, y: h * 0.33, side: 'R' }
    g = { w, h, pins, shape: 'alu', text: p.t === 'alu' ? 'ALU' : '+' }
  } else g = blockGeom(p)
  // Routed top pins need lanes above the body; a clocked part needs room for its clock stub.
  const tops = Object.values(g.pins).filter((q) => q.side === 'T').length
  g.above = tops * TOP_LANE + (p.clocked ? CLK_ROOM : 0) + (tops ? 3 : 0)
  // Inverted inputs (~A) get a bubble; the wire stops short of it.
  for (const q of p.ins) {
    const pin = g.pins[q.name]
    if (!pin || !q.r.inv) continue
    pin.bubble = true
    if (pin.side === 'L') pin.x -= 2 * BUB
    else pin.y -= 2 * BUB
  }
  return g
}

function blockGeom(p) {
  const left = p.ins.filter((q) => q.side === 'L'), right = p.outPorts, top = p.ins.filter((q) => q.side === 'T')
  const lw = Math.max(0, ...left.map((q) => (q.label ? measure(q.label, PF) : 0)))
  const rw = Math.max(0, ...right.map((o) => (o.label ? measure(o.label, PF) : 0)))
  const center = centerLabel(p)
  const cw = Math.max(0, ...center.map((l) => measure(l, 11)))
  const clockedReg = p.t === 'reg' || p.t === 'dff'
  let w = Math.max(clockedReg ? 24 : 30, (lw ? lw + 5 : 0) + (rw ? rw + 5 : 0) + (cw ? cw + 8 : 0) + 6)
  if (p.clocked) w = Math.max(w, top.length * 8 + 26)
  const rows = Math.max(left.length, right.length, center.length + (p.t === 'regfile' ? 2 : 0), clockedReg ? 2 : 1)
  const h = Math.max(clockedReg ? 32 : 30, rows * BPIN + 6)
  const pins = {}
  const spread = (list, side, x) => {
    const n = list.length
    list.forEach((q, k) => { pins[q.name] = { x, y: Math.round(h / 2 + (k - (n - 1) / 2) * BPIN), side } })
  }
  if (p.t === 'regfile') {
    // H&H: RD1 and RD2 line up with A1 and A2.
    left.forEach((q, k) => { pins[q.name] = { x: 0, y: 11 + k * BPIN, side: 'L' } })
    right.forEach((o, k) => { pins[o.name] = { x: w, y: 11 + k * BPIN, side: 'R' } })
  } else {
    spread(left, 'L', 0)
    spread(right, 'R', w)
  }
  // Top pins sit left of the clock stub, which is at 70% of the width.
  top.forEach((q, k) => { pins[q.name] = { x: p.clocked ? 8 + k * 8 : Math.round(w * (k + 1) / (top.length + 1)), y: 0, side: 'T' } })
  return { w, h, pins, shape: 'block', center, lw, rw }
}

const r1 = (v) => Math.round(v * 10) / 10
// Pin names are upright (RD1, WD3, Q); ones with TeX markup (C_{in}) are left as written.
const upright = (s) => (/[_^\\{]/.test(s) ? s : `\\text{${s}}`)

/**
 * Draw a part with its body's top-left at (x, y). style: {stroke, sw, fill, theme, labels}.
 */
export function drawPart(p, g, x, y, { stroke, sw, theme }) {
  const out = []
  const a = { fill: theme.bg ?? 'none', stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' }
  const h = g.h
  const P = (px, py) => `${r1(x + px)} ${r1(y + py)}`
  const bubble = (cx, cy) => out.push(el('circle', { cx: r1(cx), cy: r1(cy), r: BUB, fill: theme.bg ?? 'none', stroke, 'stroke-width': sw }))
  const t = g.shape
  if (GATES.has(t)) {
    const b = g.body, o = g.off ?? 0
    let d
    if (t === 'not' || t === 'buf' || t === 'tri') d = `M${P(0, 0)}L${P(b, h / 2)}L${P(0, h)}Z`
    else if (t === 'and' || t === 'nand') d = `M${P(0, 0)}H${r1(x + b - h / 2)}A${h / 2} ${h / 2} 0 0 1 ${P(b - h / 2, h)}H${r1(x)}Z`
    else d = `M${P(o, 0)}Q${P(o + b * 0.6, 0)} ${P(o + b, h / 2)}Q${P(o + b * 0.6, h)} ${P(o, h)}Q${P(o + b * 0.28, h / 2)} ${P(o, 0)}Z`
    out.push(el('path', { d, ...a }))
    if (o) out.push(el('path', { d: `M${P(0, 0)}Q${P(b * 0.28, h / 2)} ${P(0, h)}`, fill: 'none', stroke, 'stroke-width': sw }))
    if (['nand', 'nor', 'xnor', 'not'].includes(t)) bubble(x + o + b + BUB, y + h / 2)
  } else if (t === 'mux') {
    const s = g.s
    out.push(el('path', { d: `M${P(0, 0)}L${P(g.w, s)}L${P(g.w, h - s)}L${P(0, h)}Z`, ...a }))
    for (const q of p.ins.filter((q) => q.data)) out.push(labelSvg(q.label, x + 7, y + g.pins[q.name].y, theme, { size: 9, fill: theme.muted, middle: true }))
  } else if (t === 'alu') {
    const w = g.w
    out.push(el('path', { d: `M${P(0, 0)}L${P(w, h * 0.25)}L${P(w, h * 0.75)}L${P(0, h)}L${P(0, h * 0.6)}L${P(w * 0.24, h / 2)}L${P(0, h * 0.4)}Z`, ...a }))
    out.push(labelSvg(`\\text{${g.text}}`, x + w * 0.62, y + h / 2, theme, { size: g.text === '+' ? 14 : 10, fill: theme.fg, middle: true }))
    if (p.t === 'alu') out.push(labelSvg('\\text{Zero}', x + w + 2, y + h * 0.33 - 5, theme, { size: 8, fill: theme.muted, anchor: 'start' }))
  } else {
    out.push(el('rect', { x: r1(x), y: r1(y), width: g.w, height: h, ...a }))
    for (const q of p.ins) {
      const pin = g.pins[q.name]
      if (!q.label || !pin) continue
      if (pin.side === 'L') out.push(labelSvg(upright(q.label), x + 3, y + pin.y, theme, { size: PF, fill: theme.muted, anchor: 'start', middle: true }))
      else out.push(labelSvg(`\\text{${q.label}}`, x + pin.x, y + 9, theme, { size: 8, fill: theme.muted, middle: true }))
    }
    for (const o of p.outPorts) {
      const pin = g.pins[o.name]
      if (o.label && pin) out.push(labelSvg(upright(o.label), x + g.w - 3, y + pin.y, theme, { size: PF, fill: theme.muted, anchor: 'end', middle: true }))
    }
    const c = g.center
    const cx = x + (g.lw ? g.lw + 5 : 0) / 2 + g.w / 2 - (g.rw ? g.rw + 5 : 0) / 2
    c.forEach((l, k) => out.push(labelSvg(`\\text{${l}}`, cx, y + h / 2 + (k - (c.length - 1) / 2) * 12, theme, { size: 10.5, fill: theme.fg, middle: true })))
  }
  // Clock: a wedge on the top edge and a short stub labeled with the clock net.
  if (p.clocked) {
    const cx = x + Math.max(g.w * 0.7, g.w - 9)
    out.push(el('path', { d: `M${r1(cx - 5)} ${r1(y)}L${r1(cx)} ${r1(y + 6)}L${r1(cx + 5)} ${r1(y)}`, fill: 'none', stroke, 'stroke-width': sw * 0.85 }))
    out.push(el('line', { x1: r1(cx), y1: r1(y), x2: r1(cx), y2: r1(y - 8), stroke, 'stroke-width': sw }))
    out.push(labelSvg(`\\text{${p.clk ?? 'clk'}}`, cx, y - 11, theme, { size: 9, fill: theme.muted }))
  }
  // Input bubbles.
  for (const q of p.ins) {
    const pin = g.pins[q.name]
    if (!pin?.bubble) continue
    if (pin.side === 'L') bubble(x + pin.x + BUB, y + pin.y)
    else bubble(x + pin.x, y + pin.y + BUB)
  }
  return out.join('')
}
