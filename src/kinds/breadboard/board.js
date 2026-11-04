// The board model for breadboard: hole names, where each hole sits, and which
// holes are wired together inside the board (a strip of five in each half, and
// each power rail along its length), plus header blocks beside the board.
//
// Everything is laid out in a board frame: x runs along the numbered strips
// (column 1 at the left), y across them (top rails, rows a-e, the center channel,
// rows f-j, bottom rails). A horizontal board draws the frame as it is; a vertical
// one swaps x and y, so the numbers run down the page, rows a-j read left to right,
// and the top rails become the left ones. Text is placed at mapped points, never
// transformed, so it stays upright either way. Rail holes line up with the strips,
// but every 6th position is a gap between groups of five, as on real boards.

import { SpecError } from '../../diag.js'

export const P = 18 // hole pitch in px (0.1 in)
const ROWS = 'abcdefghij'
// Every rail name a board can have, in summary order.
const RAIL_ORDER = ['t+', 't-', 'b-', 'b+', 'l+', 'l-', 'r+', 'r-']
export const isRailName = (s) => RAIL_ORDER.includes(s)

const SIDES = { horizontal: { t: 'top', b: 'bottom' }, vertical: { t: 'left', b: 'right' } }
const DEFAULT_RAILS = { t: '+-', b: '-+' } // page order: + outermost on both sides

// Names compare without case, spaces, a leading +, or the difference between - and −.
const norm = (s) => String(s).toLowerCase().replace(/−/g, '-').replace(/\s+/g, '').replace(/^\+/, '')

/**
 * Build the board from the resolved options. Throws a SpecError for a bad option.
 * opts: { cols, half, orient, caps, rails, railGaps, headers }
 */
export function makeBoard({ cols, half, orient = 'horizontal', caps = false, rails, railGaps = true, headers = [] }) {
  const vertical = orient === 'vertical'
  const sideName = SIDES[orient]
  const letter = (side) => (vertical ? { t: 'l', b: 'r' } : { t: 't', b: 'b' })[side]
  // Rails per side, in page order (top to bottom, or left to right).
  const railSpec = { ...DEFAULT_RAILS }
  if (rails !== undefined) {
    if (typeof rails !== 'object' || rails === null || Array.isArray(rails)) throw new SpecError('rails', `rails is {"${sideName.t}": "+-", "${sideName.b}": "-+"}: each side's rail signs in page order, "" for none`)
    for (const [k, v] of Object.entries(rails)) {
      const side = Object.keys(sideName).find((s) => sideName[s] === k)
      if (!side) throw new SpecError(`rails.${k}`, `a ${orient} board's rail sides are ${sideName.t} and ${sideName.b}`)
      const sv = typeof v === 'string' ? v.replace(/−/g, '-') : v
      if (!['', '+', '-', '+-', '-+'].includes(sv)) throw new SpecError(`rails.${k}`, `"${v}": give the signs in page order (${vertical ? 'left to right' : 'top to bottom'}): "+-", "-+", "+", "-", or "" for no rails`)
      railSpec[side] = sv
    }
  }
  if (half === 'top') railSpec.b = ''
  const railList = [] // { name, side, sign }, frame top to bottom
  for (const side of ['t', 'b']) for (const sign of railSpec[side]) railList.push({ name: letter(side) + sign, side, sign })

  const X0 = 1.8 * P // column 1, from the board's left edge
  const y = {}
  const nTop = railSpec.t.length, nBot = railSpec.b.length
  railList.filter((r) => r.side === 't').forEach((r, i) => { y[r.name] = 0.9 * P + i * P })
  const lastTop = 0.9 * P + (nTop - 1) * P
  y.nums = lastTop + 1.05 * P
  y.a = lastTop + 2.1 * P
  for (let i = 1; i < 5; i++) y[ROWS[i]] = y.a + i * P
  y.f = y.e + 3 * P // 0.3 in across the channel, where a DIP chip straddles it
  for (let i = 6; i < 10; i++) y[ROWS[i]] = y.f + (i - 5) * P
  y.nums2 = y.j + 1.05 * P
  railList.filter((r) => r.side === 'b').forEach((r, i) => { y[r.name] = y.j + 2.1 * P + i * P })
  const lastBot = y.j + 2.1 * P + (nBot - 1) * P
  const W = X0 * 2 + (cols - 1) * P
  // A top-half board ends just past the channel, which marks where the rest would be.
  const H = half === 'top' ? y.e + 2.4 * P : lastBot + 0.9 * P
  const rows = half === 'top' ? 'abcde' : ROWS
  const x = (c) => X0 + (c - 1) * P

  const g = {
    cols, half, vertical, orient, caps, X0, y, W, H, x, rows, rails: railList, sideName, railGaps,
    /** Frame point to page point. */
    P: (fx, fy) => (vertical ? [fy, fx] : [fx, fy]),
    /** Frame rectangle to page rect attributes. */
    rect: (fx, fy, w, h) => (vertical ? { x: fy, y: fx, width: h, height: w } : { x: fx, y: fy, width: w, height: h }),
    isGap: (c) => railGaps && c % 6 === 0,
    /** A row letter or strip as printed. */
    letter: (r) => (caps ? r.toUpperCase() : r),
    strip: (s) => (caps && /^\d+[a-j]-[a-j]$/.test(s) ? s.toUpperCase() : s),
    hole: (name) => (caps && /^[a-j]\d+$/.test(name) ? name.toUpperCase() : name),
  }
  g.railNames = railList.map((r) => r.name)
  // A header that starts past the board's last strip is left off a trimmed board.
  const all = resolveHeaders(headers, g)
  g.headers = all.filter((h) => h.at <= cols)
  g.offBoard = all.filter((h) => h.at > cols)
  return g
}

function resolveHeaders(list, g) {
  if (!Array.isArray(list)) throw new SpecError('headers', 'headers is a list like [{"id": "J1", "pins": ["5V", "GND"], "at": 3}]')
  const sides = Object.values(g.sideName)
  const ids = new Set()
  return list.map((h0, i) => {
    const path = `headers[${i}]`
    if (!h0 || typeof h0 !== 'object') throw new SpecError(path, 'a header is {"id": "J1", "pins": ["5V", "GND"], "at": 3}')
    for (const k of Object.keys(h0)) if (!['id', 'label', 'pins', 'at', 'side'].includes(k)) throw new SpecError(`${path}.${k}`, `headers don't use "${k}"; use id, label, pins, at, side`)
    if (typeof h0.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(h0.id)) throw new SpecError(`${path}.id`, 'give the header an "id" of letters and digits, like "J1" (pins are then "J1.5V")')
    if (ids.has(h0.id)) throw new SpecError(`${path}.id`, `two headers are named "${h0.id}"`)
    ids.add(h0.id)
    const side = h0.side ?? g.sideName.b
    if (!sides.includes(side)) throw new SpecError(`${path}.side`, `a ${g.orient} board's headers go on the ${sides.join(' or ')}`)
    const at = h0.at ?? 1
    if (!Number.isInteger(at)) throw new SpecError(`${path}.at`, `at is the ${g.vertical ? 'row' : 'column'} number pin 1 lines up with`)
    const pins0 = h0.pins ?? []
    if (!Array.isArray(pins0)) throw new SpecError(`${path}.pins`, 'pins is a list of pin labels, like ["5V", "GND"], or {"id", "label"} objects')
    const pins = pins0.map((p, k) => {
      const o = typeof p === 'string' ? { label: p } : p
      if (!o || typeof o !== 'object' || (o.label === undefined && o.id === undefined)) throw new SpecError(`${path}.pins[${k}]`, 'a pin is a label like "5V" or {"id": "AO0", "label": "0"}')
      const label = String(o.label ?? o.id), id = String(o.id ?? o.label)
      return { label, id, k, pos: at + k, name: `${h0.id}.${id}` }
    })
    for (const p of pins) if (pins.filter((q) => q.id === p.id).length > 1) throw new SpecError(`${path}.pins`, `two pins have the id "${p.id}"; give each repeated label its own "id"`)
    return { id: h0.id, label: h0.label, side: side === g.sideName.t ? 't' : 'b', at, pins, path }
  })
}

/** Find a header pin from the text after the dot: its id, else its label when only one pin has it. */
function headerPin(h, s, path, full) {
  const want = norm(s)
  const byId = h.pins.filter((p) => norm(p.id) === want)
  if (byId.length === 1) return byId[0]
  const byLabel = h.pins.filter((p) => norm(p.label) === want)
  if (byLabel.length === 1) return byLabel[0]
  if (byLabel.length > 1) throw new SpecError(path, `"${full}": ${h.id} has ${byLabel.length} pins labeled ${byLabel[0].label}; name one by its id: ${byLabel.map((p) => `${h.id}.${p.id}`).join(', ')}`)
  const list = h.pins.map((p) => (p.id === p.label ? p.id : `${p.id} (${p.label})`)).join(', ')
  throw new SpecError(path, `"${full}": ${h.id} has no pin "${s}"; its pins are ${list || 'none'}`)
}

/**
 * Parse a hole name: "a12" (row a, column 12), "t-3" (top minus rail, column 3), or a header
 * pin "J1.5V". Returns { name, col, row?, rail?, pin?, strip }. Throws a SpecError naming the fix.
 */
export function parseHole(name, g, path) {
  if (typeof name !== 'string') throw new SpecError(path, 'a hole is a string like "a12" (row a, column 12) or "t-3" (rail)')
  const s = name.trim().replace(/−/g, '-')
  const num = g.vertical ? 'row' : 'column'
  const range = `the board has ${num}s 1 to ${g.cols}`
  const dot = s.indexOf('.')
  if (dot > 0) {
    const h = g.headers.find((q) => q.id.toLowerCase() === s.slice(0, dot).toLowerCase())
    if (h) {
      const p = headerPin(h, s.slice(dot + 1), path, s)
      return { name: p.name, pin: p, header: h, strip: p.name }
    }
    const off = g.offBoard.find((q) => q.id.toLowerCase() === s.slice(0, dot).toLowerCase())
    if (off) throw new SpecError(path, `"${s}": header ${off.id} starts at ${num} ${off.at}, past this ${g.cols}-${num} board, so it isn't drawn; give "${g.vertical ? 'rows' : 'cols'}": ${off.at + Math.max(off.pins.length, 2) - 1} or more`)
    if (g.headers.length) throw new SpecError(path, `"${s}": no header "${s.slice(0, dot)}"; the headers are ${g.headers.map((q) => q.id).join(', ')}`)
  }
  let m = /^([a-jA-J])(\d+)$/.exec(s)
  if (m) {
    const col = +m[2], row = m[1].toLowerCase()
    if (col < 1 || col > g.cols) throw new SpecError(path, `"${s}": ${range}`)
    if (!g.rows.includes(row)) throw new SpecError(path, `"${s}": a "half": "top" board has rows a-e only; drop "half" to use rows f-j`)
    return { name: `${row}${col}`, col, row, strip: `${col}${row <= 'e' ? 'a-e' : 'f-j'}` }
  }
  m = /^([tblrTBLR])([+-])(\d+)$/.exec(s)
  if (m) {
    const col = +m[3], rail = m[1].toLowerCase() + m[2]
    const have = g.railNames.join(', ') || 'none'
    if (!g.railNames.includes(rail)) {
      if (g.half === 'top' && (rail === 'b+' || rail === 'b-')) throw new SpecError(path, `"${s}": a "half": "top" board has the top rails t+ and t- only; drop "half" to use the bottom rails`)
      const other = g.vertical ? { t: 'l', b: 'r' }[rail[0]] : { l: 't', r: 'b' }[rail[0]]
      const hint = other && g.railNames.includes(other + rail[1]) ? `; on a ${g.orient} board that is ${other}${rail[1]}${col}` : ''
      throw new SpecError(path, `"${s}": this board's rails are ${have}${hint}`)
    }
    if (col < 1 || col > g.cols) throw new SpecError(path, `"${s}": ${range}`)
    if (g.isGap(col)) throw new SpecError(path, `"${s}": rails have no hole at ${num} ${col} (a gap between groups of five); use ${rail}${col - 1} or ${rail}${col + 1}`)
    return { name: `${rail}${col}`, col, rail, strip: rail }
  }
  const rails = g.railNames.length ? `, or a rail ${g.railNames.join(', ')} and a ${num} ("${g.railNames[0]}3")` : ''
  const pins = g.headers.length ? `, or a header pin ("${g.headers[0].id}.${g.headers[0].pins[0]?.id ?? '1'}")` : ''
  throw new SpecError(path, `"${s}" is not a hole; use a row a-j and a ${num} ("a12")${rails}${pins}`)
}

/** Where a header's pins sit across the board frame (y), clear of the board's edge. */
export const headerY = (g, side) => (side === 't' ? -1.6 * P : g.H + 1.6 * P)

export const holeXY = (g, h) => (h.pin ? g.P(g.x(h.pin.pos), headerY(g, h.header.side)) : g.P(g.x(h.col), g.y[h.rail ?? h.row]))

/** Every hole on the board (not header pins), for drawing. */
export function* allHoles(g) {
  for (let c = 1; c <= g.cols; c++) {
    for (const r of g.rows) yield { col: c, row: r, name: `${r}${c}` }
    if (!g.isGap(c)) for (const rail of g.railNames) yield { col: c, rail, name: `${rail}${c}` }
  }
}

/** Union-find over strip keys. */
export class Nets {
  constructor() { this.parent = new Map() }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k)
    let r = k
    while (this.parent.get(r) !== r) r = this.parent.get(r)
    this.parent.set(k, r)
    return r
  }
  join(a, b) { this.parent.set(this.find(a), this.find(b)) }
}

/** Strip keys sorted for the summary: columns by number (top half first), then rails, then header pins. */
export function stripOrder(a, b) {
  const key = (s) => (isRailName(s) ? 1e4 + RAIL_ORDER.indexOf(s) : s.includes('.') ? 2e4 : parseInt(s) * 2 + (s.endsWith('f-j') ? 1 : 0))
  return key(a) - key(b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** The protoboard that comes with the NI myDAQ (Digilent): vertical, 60 rows, + and − rails on
 * each side, and the three header blocks and +5 V switch on its blue PCB to the right. */
export const PRESETS = {
  mydaq: {
    orient: 'vertical', cols: 60, caps: true, rails: { left: '+-', right: '+-' },
    headers: [
      { id: 'AJ1', label: 'AJ1 PWR AO AI0', side: 'right', at: 11, pins: ['S1', 'T1', 'R1', '+15V', '−15V',
        { id: 'PWRGND', label: 'GND' }, { id: 'AOGND', label: 'GND' }, { id: 'AO0', label: '0' }, { id: 'AO1', label: '1' },
        { id: 'AI0GND', label: 'GND' }, { id: 'AI0+', label: '0+' }, { id: 'AI0-', label: '0−' }] },
      { id: 'DIG', label: 'AI1 DIGITAL', side: 'right', at: 25, pins: [{ id: 'AI1GND', label: 'GND' }, { id: 'AI1+', label: '1+' },
        { id: 'AI1-', label: '1−' }, { id: 'DGND', label: 'GND' }, 'DIO0', 'DIO1', 'DIO2', 'DIO3', 'DIO4', 'DIO5', 'DIO6', 'DIO7'] },
      { id: 'AJ2', label: 'AJ2 LED Pot PWR', side: 'right', at: 39, pins: ['G', 'Y', 'R', 'CCW', 'Wiper', 'CW', '5V', 'GND', 'Vext', 'S2', 'T2', 'R2'] },
      { id: 'SW5V', label: '+5V ON/OFF switch', side: 'right', at: 52 },
    ],
  },
}
