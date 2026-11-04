// breadboard: a solderless breadboard with parts, jumper wires, and off-board
// posts (instrument leads and clips), placed by hole name ("a12", "t-3"). The
// board's internal strips plus the jumpers give the nets, which are tinted on
// the board and listed in the summary, so a part in the wrong column shows up.
// Every end lands in a real hole: rail gaps and missing columns are errors.
// A board can stand vertical, set its rails and printed letters, and carry
// header blocks beside it ("J1.5V"), or start from a preset like "mydaq".

import { el, pathD } from '../../svg.js'
import { color, COLOR_NAMES } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { labelSvg, measure } from '../../label.js'
import { V, Canvas } from '../fbd/draw.js'
import { placeLabels, drawLabels, ringCands } from '../fbd/place.js'
import { P, makeBoard, parseHole, holeXY, headerY, allHoles, Nets, stripOrder, isRailName, PRESETS } from './board.js'
import { TWO_LEAD, MULTI_PINS, twoLeadBody, multiLeadBody, resistorBands } from './parts.js'

const TYPES = [...Object.keys(TWO_LEAD), ...Object.keys(MULTI_PINS), 'box', 'ic']
const PART_FIELDS = new Set(['id', 't', 'pins', 'label', 'value', 'color', 'col', 'pinNames', 'bands'])
const WIRE_COLORS = ['coral', 'teal', 'purple', 'amber', 'green', 'pink']
const NET_COLORS = ['teal', 'purple', 'amber', 'green', 'pink', 'coral']
const raw = (s) => [{ text: String(s), shift: 0 }]
// Names of posts and nets are words (LO, CH1), set upright; TeX markup still works in them.
const word = (s) => (/[\\_^]/.test(s) ? s : raw(s))
const BOX_T = 17
const isTwo = (p) => !!TWO_LEAD[p.t] || (p.t === 'box' && p.holes.length === 2)
const FS = 12
const PIN_FS = 9.5

/** Perpendicular to u that points up the page (or right, for a vertical u). */
const upOf = (u) => { const n = V.perp(u); return n[1] < -1e-9 || (Math.abs(n[1]) < 1e-9 && n[0] > 0) ? n : V.mul(n, -1) }
const tf = (c, u, w) => `matrix(${[u[0], u[1], w[0], w[1], c[0], c[1]].map((v) => +v.toFixed(3)).join(' ')})`

function inkColor(c, theme) {
  if (c === 'black') return theme.fg
  if (c === 'white') return theme.faint
  return color(c)
}

/** A jumper's default color from what it plugs into: red to a + supply, black to ground. */
function supplyInk(h) {
  if (h.rail) return h.rail.endsWith('+') ? 'red' : 'black'
  if (h.pin) {
    const s = `${h.pin.id} ${h.pin.label}`.toUpperCase()
    if (/GND/.test(s)) return 'black'
    if (/^\+|(^|\s)(\d+(\.\d+)?V|VCC|VDD)(\s|$)/.test(h.pin.label.toUpperCase())) return 'red'
  }
  return null
}

function pinLabels(p, n) {
  if (['R', 'C', 'L', 'switch'].includes(p.t)) return [p.id, p.id]
  if (p.t === 'Cp') return [`${p.id}+`, `${p.id}-`]
  if (p.t === 'diode' || p.t === 'led') return [`${p.id}.a`, `${p.id}.k`]
  if (MULTI_PINS[p.t]) return MULTI_PINS[p.t].map((s) => `${p.id}.${s}`)
  const names = Array.from({ length: n }, (_, i) => p.pinNames?.[i])
  return names.map((s, i) => `${p.id}.${s && names.indexOf(s) === names.lastIndexOf(s) ? s : i + 1}`)
}

/** The board options: the preset's, with the spec's own fields on top. */
function boardOptions(spec) {
  let pre = {}
  if (spec.preset !== undefined) {
    pre = PRESETS[spec.preset]
    if (!pre) throw new SpecError('preset', `unknown preset "${spec.preset}"; use ${Object.keys(PRESETS).join(', ')}`)
  }
  const pick = (k) => (spec[k] !== undefined ? spec[k] : pre[k])
  const orient = pick('orient') ?? 'horizontal'
  if (!['horizontal', 'vertical'].includes(orient)) throw new SpecError('orient', 'orient is "horizontal" (numbers run left to right, the default) or "vertical" (numbers run down the page)')
  if (spec.cols !== undefined && spec.rows !== undefined) throw new SpecError('rows', 'give "cols" or "rows", not both: they are the same count of numbered strips')
  const n = spec.cols ?? spec.rows ?? pre.cols ?? 30
  const what = spec.rows !== undefined ? 'rows' : 'cols'
  if (!Number.isInteger(n) || n < 5 || n > 64) throw new SpecError(what, `${what} is the number of numbered strips: 30 for a half-size board, 63 for a full one, 60 for the myDAQ protoboard`)
  const half = spec.half
  if (half !== undefined && half !== 'top') throw new SpecError('half', 'half is "top" (rows a-e and the top rails only); leave it out for the whole board')
  if (half && orient === 'vertical') throw new SpecError('half', 'half works on a horizontal board only; leave it out, or use a smaller "rows"')
  const caps = pick('caps') ?? false
  if (typeof caps !== 'boolean') throw new SpecError('caps', 'caps is true (row letters printed A-J) or false (a-j, the default)')
  const railGaps = pick('railGaps') ?? true
  if (typeof railGaps !== 'boolean') throw new SpecError('railGaps', 'railGaps is true (a gap after every 5 rail holes, the default) or false (unbroken rails)')
  // The spec's headers add to the preset's, replacing one with the same id.
  let headers = pre.headers ?? []
  if (spec.headers !== undefined) {
    if (!Array.isArray(spec.headers)) throw new SpecError('headers', 'headers is a list like [{"id": "J1", "pins": ["5V", "GND"], "at": 3}]')
    const mine = new Set(spec.headers.map((h) => h?.id))
    headers = [...headers.filter((h) => !mine.has(h.id)), ...spec.headers]
  }
  return { cols: n, half, orient, caps, rails: pick('rails'), railGaps, headers }
}

/**
 * Resolve parts, wires, and posts to holes; record which hole holds what. Every bad hole or
 * part is reported (as an error) and skipped, so one render lists all of them at once.
 */
function resolve(spec, g, diag) {
  const bad = (e) => { if (!(e instanceof SpecError)) throw e; diag.error(e.path, e.message); return null }
  const hole = (h, path) => { try { return parseHole(h, g, path) } catch (e) { return bad(e) } }
  const used = new Map() // hole name -> owner text
  const take = (h, owner, path) => {
    if (!used.has(h.name)) { used.set(h.name, owner); return }
    const where = h.pin ? 'a socket takes one wire' : `a hole takes one lead; use a free hole in ${h.rail ? `rail ${h.rail}` : g.strip(h.strip)}, which the board connects`
    diag.warn(path, `${g.hole(h.name)} already holds ${used.get(h.name)}; ${where}`)
  }
  const inks = new Set([...COLOR_NAMES, 'black', 'white'])
  const checkInk = (c, path) => { if (c !== undefined && !inks.has(c) && !/^#[0-9a-f]{3,8}$/i.test(c)) diag.warn(path, `"${c}" isn't a color; use ${[...inks].join(', ')}, or a #hex`) }
  const num = g.vertical ? 'row' : 'column'
  if (spec.parts !== undefined && !Array.isArray(spec.parts)) throw new SpecError('parts', 'parts is a list like [{"id": "R1", "t": "R", "pins": ["a5", "a9"]}]')
  const parts = (spec.parts ?? []).map((p0, i) => { try { return part(p0, i) } catch (e) { return bad(e) } }).filter(Boolean)
  function part(p0, i) {
    const path = `parts[${i}]`
    if (!TYPES.includes(p0?.t)) throw new SpecError(`${path}.t`, `unknown part type "${p0?.t}"; use ${TYPES.join(', ')}`)
    for (const k of Object.keys(p0)) if (!PART_FIELDS.has(k)) diag.warn(`${path}.${k}`, `parts don't use "${k}"`)
    const p = { ...p0, id: p0.id ?? `${p0.t}#${i + 1}`, path }
    if (p.t === 'ic') {
      const n = p.pins ?? 8
      // Pin 1 sits by the notch, counterclockwise from the top: row f on a horizontal board
      // (notch left), row e on a vertical one (notch up).
      const [r1, r2] = g.vertical ? ['e', 'f'] : ['f', 'e']
      if (!Number.isInteger(n) || n < 4 || n % 2) throw new SpecError(`${path}.pins`, 'an ic\'s pins is an even count like 8 or 14')
      if (!Number.isInteger(p.col)) throw new SpecError(`${path}.col`, `give "col": the ${num} of pin 1 (${g.vertical ? 'top left, in row e, notch up' : 'bottom left, in row f, notch to the left'})`)
      if (p.col < 1 || p.col + n / 2 - 1 > g.cols) throw new SpecError(`${path}.col`, `pins 1 to ${n / 2} run along row ${r1} from ${num} ${p.col}, past the board's ${g.cols} ${num}s`)
      p.holes = Array.from({ length: n }, (_, k) => parseHole(k < n / 2 ? `${r1}${p.col + k}` : `${r2}${p.col + n - 1 - k}`, g, `${path}.col`))
    } else {
      const want = TWO_LEAD[p.t] ? 2 : MULTI_PINS[p.t] ? 3 : 0
      const names = TWO_LEAD[p.t] ? '' : MULTI_PINS[p.t] ? ` (${MULTI_PINS[p.t].join(', ')})` : ''
      if (!Array.isArray(p.pins) || (want && p.pins.length !== want) || !p.pins.length) {
        throw new SpecError(`${path}.pins`, `${p.t} needs "pins": ${want ? `${want} holes${names}` : 'a list of holes'}, like ["a5", "a9"]`)
      }
      p.holes = p.pins.map((h, k) => hole(h, `${path}.pins[${k}]`))
      if (p.holes.includes(null)) return null
    }
    p.pinIds = pinLabels(p, p.holes.length)
    if (p.bands !== undefined && p.t !== 'R') diag.warn(`${path}.bands`, 'only resistors ("t": "R") take bands')
    else if (p.bands !== undefined && p.bands !== 4 && p.bands !== 5) diag.warn(`${path}.bands`, 'bands is 4 (2 digits, 5%) or 5 (3 digits, 1%)')
    if (p.t === 'R') {
      const code = resistorBands(p.value, p.bands === 4 || p.bands === 5 ? p.bands : undefined)
      if (code && !code.bands) diag.warn(`${path}.value`, `"${p.value}" has no color code (it takes 2 or 3 significant digits, 0.1 Ω to 999 GΩ), so the body is drawn plain`)
      else if (code && (p.bands === 4 || p.bands === 5) && code.bands.length !== p.bands) diag.warn(`${path}.bands`, `"${p.value}" has no ${p.bands}-band code; drawn with ${code.bands.length} bands`)
      if (code?.bands) p.colorBands = code.bands
    }
    p.holes.forEach((h, k) => take(h, p.pinIds[k], `${path}.pins`))
    return p
  }
  let wc = 0
  const wires = (spec.wires ?? []).map((w0, i) => {
    const path = `wires[${i}]`
    const w = { ...w0, id: w0.id ?? `W${i + 1}`, path }
    checkInk(w.color, `${path}.color`)
    w.a = hole(w.from, `${path}.from`)
    w.b = hole(w.to, `${path}.to`)
    if (!w.a || !w.b) return null
    if (w.a.name === w.b.name) return bad(new SpecError(path, 'a wire needs two different holes'))
    const sup = [supplyInk(w.a), supplyInk(w.b)]
    w.ink = w.color ? null : sup.includes('red') ? 'red' : sup.includes('black') ? 'black' : WIRE_COLORS[wc++ % WIRE_COLORS.length]
    take(w.a, `wire ${w.id}`, `${path}.from`)
    take(w.b, `wire ${w.id}`, `${path}.to`)
    return w
  }).filter(Boolean)
  const sides = Object.values(g.sideName)
  const posts = (spec.posts ?? []).map((q0, i) => {
    const path = `posts[${i}]`
    const q = { ...q0, id: q0.id ?? `post${i + 1}`, path }
    checkInk(q.color, `${path}.color`)
    q.h = hole(q.to, `${path}.to`)
    if (!q.h) return null
    q.lines = Array.isArray(q.label) ? q.label.map(String) : [String(q.label ?? q.id)]
    if (q.side && !sides.includes(q.side)) return bad(new SpecError(`${path}.side`, `on a ${g.orient} board, side is ${sides.join(' or ')}`))
    const near = q.h.pin ? q.h.header.side : q.h.rail ? g.rails.find((r) => r.name === q.h.rail).side : q.h.row <= 'e' ? 't' : 'b'
    q.fside = q.side ? (q.side === g.sideName.t ? 't' : 'b') : near
    q.ink = q.color ?? WIRE_COLORS[wc++ % WIRE_COLORS.length]
    take(q.h, `post ${q.id}`, `${path}.to`)
    return q
  }).filter(Boolean)
  return { parts, wires, posts, used }
}

/** Nets from the board's strips and the jumpers: name, strips, members. */
function findNets(spec, R, g, diag) {
  const uf = new Nets()
  const members = [] // { name, strip, path, lone? }
  for (const p of R.parts) p.holes.forEach((h, k) => { uf.find(h.strip); members.push({ name: p.pinIds[k], strip: h.strip, path: `${p.path}.pins`, part: p, lone: isTwo(p) }) })
  for (const q of R.posts) { uf.find(q.h.strip); members.push({ name: q.id, strip: q.h.strip, path: `${q.path}.to`, post: q, lone: true }) }
  // A header pin in use is a terminal like a post: it belongs to its net and can name it.
  const pins = new Map()
  for (const w of R.wires) for (const [h, end] of [[w.a, 'from'], [w.b, 'to']]) if (h.pin && !pins.has(h.name)) pins.set(h.name, `${w.path}.${end}`)
  for (const q of R.posts) if (q.h.pin && !pins.has(q.h.name)) pins.set(q.h.name, `${q.path}.to`)
  for (const [name, path] of pins) { uf.find(name); members.push({ name, strip: name, path, pin: true, lone: true }) }
  for (const w of R.wires) uf.join(w.a.strip, w.b.strip)
  // Pins tied inside the board (every GND on the myDAQ protoboard) are one net.
  const ties = new Map()
  for (const name of pins.keys()) {
    const p = g.headers.flatMap((h) => h.pins).find((q) => q.name === name)
    if (!p?.tie) continue
    if (ties.has(p.tie)) uf.join(ties.get(p.tie), name)
    else ties.set(p.tie, name)
  }
  const nets = new Map() // root -> net
  const netOf = (strip) => {
    const r = uf.find(strip)
    if (!nets.has(r)) nets.set(r, { strips: new Set(), members: [], wires: [], name: null })
    return nets.get(r)
  }
  for (const m of members) netOf(m.strip).members.push(m)
  for (const w of R.wires) { const n = netOf(w.a.strip); n.wires.push(w) }
  for (const k of uf.parent.keys()) netOf(k).strips.add(k)
  const stripList = (n) => [...n.strips].filter((s) => !s.includes('.')).sort(stripOrder).map(g.strip)

  for (const [name, hole] of Object.entries(spec.nodes ?? {})) {
    let h
    try { h = parseHole(hole, g, `nodes.${name}`) } catch (e) { if (!(e instanceof SpecError)) throw e; diag.error(e.path, e.message); continue }
    const n = nets.get(uf.find(h.strip))
    if (!n) { diag.warn(`nodes.${name}`, `nothing connects at ${g.hole(h.name)}`); continue }
    if (n.name) diag.warn(`nodes.${name}`, `${n.name} and ${name} name the same net`)
    else { n.name = name; n.at = h }
  }
  const list = [...nets.values()]
  // Then a tie (GND), then a header pin (the supply a net comes from), then a post.
  for (const [tie, name] of ties) { const n = nets.get(uf.find(name)); if (n && !n.name) n.name = tie }
  for (const n of list) if (!n.name && n.members.some((m) => m.pin)) n.name = n.members.find((m) => m.pin).name
  for (const n of list) if (!n.name && n.members.some((m) => m.post)) n.name = n.members.find((m) => m.post).name
  // A pin of a chip or module alone on its strip is just unused: listed as open, not as a net.
  const isOpen = (n) => n.members.length === 1 && !n.members[0].lone && n.strips.size === 1 && !n.name
  const open = list.filter(isOpen)
  let k = 0
  for (const n of list) if (!n.name && n.members.length && !open.includes(n)) n.name = `n${++k}`

  for (const n of list) {
    if (!n.members.length) { for (const w of n.wires) diag.warn(w.path, `wire ${w.id} connects nothing: no part lead or post in ${stripList(n).join(', ')}`); continue }
    if (n.members.length === 1 && n.members[0].lone) {
      const m = n.members[0]
      if (m.pin) diag.warn(m.path, `${m.name} connects to nothing else${n.wires.length ? `: no part lead or post in ${stripList(n).join(', ')}` : ''}`)
      else diag.warn(m.path, `${m.name} is alone in ${g.strip(m.strip)}${n.strips.size > 1 ? ` (net ${n.name})` : ''}: nothing else connects there`)
    }
  }
  for (const p of R.parts) {
    if (!isTwo(p)) continue
    const [a, b] = p.holes
    if (uf.find(a.strip) === uf.find(b.strip)) {
      diag.warn(`${p.path}.pins`, a.strip === b.strip
        ? `${p.id} is shorted: both leads are in ${g.strip(a.strip)}, which the board connects; move one lead to another ${g.vertical ? 'row' : 'column'}`
        : `${p.id} is shorted: both leads are in net ${nets.get(uf.find(a.strip)).name}`)
    }
  }
  const shown = list.filter((n) => n.members.length && !open.includes(n))
  // Supply colors: the net on the first + rail (top or left side first) is red, on a - rail blue,
  // unless that net also holds a rail of the other sign. The rest cycle.
  const only = (sign) => (n) => [...n.strips].every((s) => !isRailName(s) || s.endsWith(sign))
  const onRail = (sign) => g.rails.filter((r) => r.sign === sign).map((r) => shown.find((n) => n.strips.has(r.name) && only(sign)(n))).find(Boolean)
  const plus = onRail('+'), minus = onRail('-')
  let ci = 0
  for (const n of shown) n.color = n === plus ? color('red') : n === minus ? color('blue') : color(NET_COLORS[ci++ % NET_COLORS.length])
  return { list: shown, open: open.map((n) => n.members[0].name), stripList }
}

export default {
  kind: 'breadboard',
  fields: ['preset', 'orient', 'cols', 'rows', 'half', 'caps', 'rails', 'railGaps', 'headers', 'parts', 'wires', 'posts', 'nodes', 'highlight'],
  collections: ['parts', 'wires', 'posts'],
  render(spec, { theme, diag, uid }) {
    const g = makeBoard(boardOptions(spec))
    const { cols, half } = g
    const R = resolve(spec, g, diag)
    const N = findNets(spec, R, g, diag)
    if (diag.hasErrors) return { body: '', width: 0, height: 0 }
    const hl = new Set(spec.highlight ?? [])
    const cv = new Canvas()
    const layers = { board: [], tint: [], holes: [], wires: [], parts: [], ends: [] }
    const xy = (h) => holeXY(g, h)
    const F = g.P // frame point -> page point
    const text = (s, at, opts) => labelSvg(s, at[0], at[1], theme, opts)

    // Board: body, channel, rail stripes and signs, row letters, column numbers.
    layers.board.push(el('rect', { ...g.rect(0, 0, g.W, g.H), rx: 7, fill: theme.grid, 'fill-opacity': 0.5, stroke: theme.faint, 'stroke-width': 1 }))
    layers.board.push(el('rect', { ...g.rect(g.X0 - 0.6 * P, g.y.e + 0.85 * P, (cols - 1) * P + 1.2 * P, 1.3 * P), rx: 2, fill: theme.faint, 'fill-opacity': 0.16 }))
    cv.ext.push(F(0, 0), F(g.W, g.H))
    const x1 = g.X0 - 0.5 * P, x2 = g.x(cols) + 0.5 * P
    const ends = [g.X0 - 1.1 * P, g.x(cols) + 1.1 * P]
    for (const side of ['t', 'b']) {
      const rs = g.rails.filter((r) => r.side === side)
      rs.forEach((r, i) => {
        // The stripe goes on the side away from the other rail (outward for a lone rail).
        const out = rs.length === 2 ? (i ? 1 : -1) : side === 't' ? -1 : 1
        const plus = r.sign === '+', fy = g.y[r.name] + out * 0.5 * P
        const [ax, ay] = F(x1, fy), [bx, by] = F(x2, fy)
        layers.board.push(el('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: plus ? theme.positive : theme.negative, 'stroke-width': 1.4 }))
        for (const fx of ends) {
          const at = F(fx, g.y[r.name])
          layers.board.push(text(raw(plus ? '+' : '−'), at, { size: 13, fill: plus ? theme.positive : theme.negative, middle: true, weight: 600 }))
          cv.obs.push([...at, 4, 'board'])
        }
      })
    }
    for (const r of g.rows) for (const fx of ends) {
      const at = F(fx, g.y[r])
      layers.board.push(text(raw(g.letter(r)), at, { size: 9.5, fill: theme.muted, middle: true }))
      cv.obs.push([...at, 4, 'board'])
    }
    for (let c = 1; c <= cols; c++) {
      if (c !== 1 && c % 5) continue
      for (const fy of half === 'top' ? [g.y.nums] : [g.y.nums, g.y.nums2]) {
        const at = F(g.x(c), fy)
        layers.board.push(text(raw(c), at, { size: 9, fill: theme.muted, middle: true }))
        cv.obs.push([...at, g.vertical ? 8 : 4, 'board'])
      }
    }

    // Net tints: each net's strips (columns of five, or a whole rail) in one color.
    N.list.forEach((n) => {
      for (const s of n.strips) {
        if (s.includes('.')) continue
        if (isRailName(s)) {
          layers.tint.push(el('rect', { ...g.rect(x1, g.y[s] - 0.42 * P, x2 - x1, 0.84 * P), rx: 3, fill: n.color, 'fill-opacity': 0.2 }))
        } else {
          const c = parseInt(s), top = s.endsWith('a-e')
          const y0 = top ? g.y.a : g.y.f
          layers.tint.push(el('rect', { ...g.rect(g.x(c) - 0.42 * P, y0 - 0.45 * P, 0.84 * P, 4.9 * P), rx: 3, fill: n.color, 'fill-opacity': 0.24 }))
        }
      }
    })

    // Holes: one path of small squares; used holes weigh more for label placement.
    let d = ''
    for (const h of allHoles(g)) {
      const [x, y] = xy(h)
      d += `M${+(x - 2.5).toFixed(2)} ${+(y - 2.5).toFixed(2)}h5v5h-5z`
      cv.obs.push([x, y, R.used.has(h.name) ? 6 : 0.15, 'hole'])
    }
    layers.holes.push(el('path', { d, fill: theme.faint, 'fill-opacity': 0.9 }))

    // Header blocks beside the board, on a PCB-blue panel per side: a strip of sockets lined up
    // with the board's numbers, each pin's printed label outside it, and the block's name.
    const depth = { t: 0, b: 0 }
    for (const side of ['t', 'b']) {
      const hs = g.headers.filter((h) => h.side === side)
      if (!hs.length) continue
      const s = side === 't' ? -1 : 1, hy = headerY(g, side), edge = side === 't' ? 0 : g.H
      const out = (k) => hy + s * k // across the frame, away from the board
      let fx1 = Infinity, fx2 = -Infinity, dep = 0
      const panel = [], obs = (box) => { for (let x = box[0]; x <= box[2]; x += 4) for (let y = box[1]; y <= box[3]; y += 4) cv.obs.push([x, y, 10, 'header']) }
      for (const h of hs) {
        const n = Math.max(h.pins.length, 2), xa = g.x(h.at) - 0.5 * P, xb = g.x(h.at + n - 1) + 0.5 * P
        const title = h.label ?? h.id
        const tw = measure(raw(title), 10) + 4
        if (h.pins.length) {
          panel.push(el('rect', { ...g.rect(xa, hy - 0.5 * P, xb - xa, P), rx: 2, fill: theme.fg, 'fill-opacity': 0.72 }))
          for (const p of h.pins) {
            const [px, py] = F(g.x(p.pos), hy)
            panel.push(el('rect', { x: px - 3, y: py - 3, width: 6, height: 6, fill: theme.halo }))
            const lw = measure(raw(p.label), PIN_FS)
            dep = Math.max(dep, 2.1 * P + 5 + lw)
            const a = F(g.x(p.pos), out(0.5 * P + 4))
            if (g.vertical) {
              panel.push(text(raw(p.label), a, { size: PIN_FS, fill: theme.fg, middle: true, anchor: s > 0 ? 'start' : 'end' }))
              obs(s > 0 ? [a[0], a[1] - 5, a[0] + lw, a[1] + 5] : [a[0] - lw, a[1] - 5, a[0], a[1] + 5])
            } else {
              panel.push(el('g', { transform: `rotate(-90 ${+a[0].toFixed(2)} ${+a[1].toFixed(2)})` }, [text(raw(p.label), a, { size: PIN_FS, fill: theme.fg, middle: true, anchor: s > 0 ? 'end' : 'start' })]))
              obs(s > 0 ? [a[0] - 5, a[1], a[0] + 5, a[1] + lw] : [a[0] - 5, a[1] - lw, a[0] + 5, a[1]])
            }
          }
        } else {
          // A pinless block (a switch, a jack): a small body with its name beside it.
          const [cx, cy] = F((xa + xb) / 2, hy)
          panel.push(el('rect', { ...g.rect(xa + 0.1 * P, hy - 0.45 * P, xb - xa - 0.2 * P, 0.9 * P), rx: 3, fill: theme.fg, 'fill-opacity': 0.72 }))
          panel.push(el('rect', { x: cx - 4, y: cy - 4, width: 8, height: 8, rx: 1.5, fill: theme.halo }))
          const a = F((xa + xb) / 2, out(0.5 * P + 4))
          panel.push(text(raw(title), g.vertical ? a : [a[0], a[1] + (s > 0 ? 10 : -3)], { size: PIN_FS, fill: theme.fg, middle: g.vertical, anchor: g.vertical ? (s > 0 ? 'start' : 'end') : 'middle' }))
          dep = Math.max(dep, 2.1 * P + 5 + (g.vertical ? tw : 14))
          fx1 = Math.min(fx1, xa - (g.vertical ? 0.4 * P : tw / 2 - 0.5 * P)); fx2 = Math.max(fx2, xb + (g.vertical ? 0.4 * P : tw / 2 - 0.5 * P))
          continue
        }
        // The block's name: above its first pin on a vertical board, left of it on a horizontal one.
        if (g.vertical) {
          const a = F(xa - 0.45 * P, hy - s * 0.5 * P)
          panel.push(text(raw(title), a, { size: 10, fill: theme.muted, weight: 600, anchor: s > 0 ? 'start' : 'end' }))
          dep = Math.max(dep, 1.1 * P + tw)
          fx1 = Math.min(fx1, xa - 1.1 * P)
        } else {
          const a = F(xa - 0.35 * P, hy)
          panel.push(text(raw(title), a, { size: 10, fill: theme.muted, weight: 600, middle: true, anchor: 'end' }))
          fx1 = Math.min(fx1, xa - 0.6 * P - tw)
        }
        fx2 = Math.max(fx2, xb + 0.3 * P)
      }
      depth[side] = dep + 0.4 * P
      const fy1 = edge + s * 0.55 * P, fy2 = edge + s * (dep + 0.4 * P)
      const box = g.rect(fx1, Math.min(fy1, fy2), fx2 - fx1, Math.abs(fy2 - fy1))
      layers.board.push(el('rect', { ...box, rx: 6, fill: color('blue'), 'fill-opacity': 0.13, stroke: color('blue'), 'stroke-opacity': 0.45, 'stroke-width': 1 }))
      layers.board.push(...panel)
      cv.ext.push([box.x, box.y], [box.x + box.width, box.y + box.height])
    }

    const labels = []
    // A part's label keeps away from other parts' leads and bodies, so it reads as its own.
    const others = (p) => new Set(R.parts.filter((o) => o !== p).map((o) => o.id))
    const lead = (pts, ink, tag, width = 1.8) => {
      layers.parts.push(el('path', { d: pathD(pts), fill: 'none', stroke: theme.halo, 'stroke-width': width + 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
      layers.parts.push(el('path', { d: pathD(pts), fill: 'none', stroke: ink, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
      cv.trace(pts, tag, 6)
    }
    const pinEnd = (p, ink) => layers.ends.push(el('circle', { cx: p[0], cy: p[1], r: 3.3, fill: ink, stroke: theme.halo, 'stroke-width': 1.4 }))
    const bodyBox = (c, u, w, L, T, tag) => {
      const corners = [[-L / 2, -T / 2], [L / 2, -T / 2], [L / 2, T / 2], [-L / 2, T / 2]].map(([a, b]) => V.add(c, V.add(V.mul(u, a), V.mul(w, b))))
      cv.trace(corners, tag, 6, true)
      cv.fill(corners, tag, 6)
    }
    const partLabel = (p, c, r, first) => {
      const t = [p.label, p.value].filter((s) => s !== undefined && s !== '').join(' ')
      if (t) labels.push({ label: t, size: FS, fill: hl.has(p.id) ? theme.highlight : theme.fg, cands: [r, r + 0.8 * P, r + 1.7 * P].flatMap((rr) => ringCands(c, rr, first)), path: p.path, avoid: others(p) })
    }

    // Parts.
    for (const p of R.parts) {
      const ink = hl.has(p.id) ? theme.highlight : theme.fg
      const pts = p.holes.map(xy)
      if (isTwo(p)) {
        const boxText = p.t === 'box' ? p.label ?? '' : ''
        const [a, b] = pts, dist = V.len(V.sub(b, a))
        const u = V.unit(V.sub(b, a)), n = upOf(u)
        // A box's upright label runs across it when its leads run down the page, so it widens instead.
        const tw = boxText ? measure(boxText, 11) + 12 : 0, down = Math.abs(u[1]) > Math.abs(u[0])
        const { L, T } = TWO_LEAD[p.t] ?? (down ? { L: 24, T: Math.max(BOX_T, tw) } : { L: Math.max(24, tw), T: BOX_T })
        // Too short to lie flat between its holes: it stands up, leads splayed below it.
        const c = dist >= L + 8 ? V.mid(a, b) : V.add(V.mid(a, b), V.mul(n, T / 2 + 0.75 * P))
        const e1 = V.sub(c, V.mul(u, L / 2 - (p.t === 'led' ? 2 : 0))), e2 = V.add(c, V.mul(u, L / 2 - (p.t === 'led' ? 2 : 0)))
        lead([a, e1], ink, p.id); lead([b, e2], ink, p.id)
        layers.parts.push(el('g', { transform: tf(c, u, V.perp(u)) }, [p.t === 'box' ? multiLeadBody('box', L, T, ink, theme) : twoLeadBody(p.t, p, ink, theme)]))
        bodyBox(c, u, V.perp(u), L, T, p.id)
        if (boxText) layers.parts.push(labelSvg(boxText, c[0], c[1], theme, { size: 11, fill: ink, middle: true }))
        partLabel(boxText ? { ...p, label: undefined } : p, c, Math.max(L, T) / 2 + 3, n)
      } else if (p.t === 'ic') {
        const n2 = p.holes.length / 2
        const xa = g.x(p.col) - 0.45 * P, xb = g.x(p.col + n2 - 1) + 0.45 * P, ya = g.y.e + 0.5 * P, yb = g.y.f - 0.5 * P
        const pin1e = p.holes[0].row === 'e'
        p.holes.forEach((h) => lead([xy(h), F(g.x(h.col), h.row === 'e' ? ya : yb)], ink, p.id, 2.2))
        const body = g.rect(xa, ya, xb - xa, yb - ya)
        layers.parts.push(el('rect', { ...body, rx: 2, fill: theme.halo }))
        layers.parts.push(el('rect', { ...body, rx: 2, fill: ink, 'fill-opacity': 0.14, stroke: ink, 'stroke-width': 1.3 }))
        const ym = (ya + yb) / 2
        const [na, nb] = [F(xa, ym - 4.5), F(xa, ym + 4.5)]
        // The swap mirrors the frame, so the notch's arc turns the other way on a vertical board.
        layers.parts.push(el('path', { d: `M${na[0]} ${na[1]}A4.5 4.5 0 0 ${g.vertical ? 0 : 1} ${nb[0]} ${nb[1]}`, fill: 'none', stroke: ink, 'stroke-width': 1.2 }))
        if (!Array.isArray(p.pinNames)) { const dot = F(g.x(p.col), pin1e ? ya + 4.5 : yb - 4.5); layers.parts.push(el('circle', { cx: dot[0], cy: dot[1], r: 1.8, fill: ink })) }
        const cen = F((xa + xb) / 2, ym)
        bodyBox(cen, F(1, 0), F(0, 1), xb - xa, yb - ya, p.id)
        if (Array.isArray(p.pinNames)) {
          p.holes.forEach((h, k) => {
            const nm = p.pinNames[k]
            if (!nm) return
            if (g.vertical) {
              const [px, py] = F(g.x(h.col), h.row === 'e' ? ya + 2.5 : yb - 2.5)
              layers.parts.push(labelSvg(word(nm), px, py, theme, { size: 7.5, fill: theme.muted, middle: true, anchor: h.row === 'e' ? 'start' : 'end' }))
            } else {
              layers.parts.push(labelSvg(word(nm), g.x(h.col), h.row === 'e' ? ya + 8 : yb - 3, theme, { size: 7.5, fill: theme.muted }))
            }
          })
        }
        const name = [p.label, p.value].filter(Boolean).join(' ')
        if (name) {
          const fits = !g.vertical && measure(name, 11) < xb - xa - 14
          if (fits) layers.parts.push(labelSvg(name, (xa + xb) / 2 + 3, ym, theme, { size: 11, fill: ink, middle: true }))
          else labels.push({ label: name, size: FS, fill: ink, cands: ringCands(cen, g.vertical ? (xb - xa) / 2 + 3 : (yb - ya) / 2 + 3, g.vertical ? [1, 0] : [0, 1]), path: p.path, avoid: others(p) })
        }
      } else {
        // Multi-lead parts sit beside their holes, on the side away from the channel.
        const a = pts[0], b = pts[pts.length - 1]
        const u = V.len(V.sub(b, a)) > 1 ? V.unit(V.sub(b, a)) : [1, 0]
        const cen = V.mul(pts.reduce((s, q) => V.add(s, q), [0, 0]), 1 / pts.length)
        const span = Math.max(...pts.map((q) => Math.abs(V.dot(V.sub(q, cen), u)))) * 2
        const boxText = p.t === 'box' && p.label ? p.label : ''
        const w = Math.max(p.t === 'box' ? span + 0.9 * P : Math.min(span + 4, 24), boxText ? measure(boxText, 11) + 12 : 0, 18)
        const h = p.t === 'pot' ? 20 : p.t === 'box' ? 20 : 17
        // The body goes on whichever side of its pins covers fewer holes in use.
        const covered = (nn) => {
          const cc = V.add(cen, V.mul(nn, 0.85 * P + h / 2))
          let k = 0
          for (const hh of allHoles(g)) {
            const q = xy(hh)
            if (Math.abs(V.dot(V.sub(q, cc), u)) < w / 2 + 3 && Math.abs(V.dot(V.sub(q, cc), nn)) < h / 2 + 3) k += R.used.has(hh.name) ? 10 : 1
          }
          return k
        }
        let n = upOf(u)
        if (covered(V.mul(n, -1)) < covered(n)) n = V.mul(n, -1)
        const c = V.add(cen, V.mul(n, 0.85 * P + h / 2))
        pts.forEach((q) => {
          const off = V.dot(V.sub(q, cen), u) * Math.min(1, (w - 6) / Math.max(span, 1))
          lead([q, V.add(V.add(c, V.mul(u, off)), V.mul(n, -h / 2))], ink, p.id)
        })
        layers.parts.push(el('g', { transform: tf(c, u, V.mul(n, -1)) }, [multiLeadBody(p.t, w, h, ink, theme)]))
        bodyBox(c, u, n, w, h, p.id)
        if (boxText) layers.parts.push(labelSvg(boxText, c[0], c[1], theme, { size: 11, fill: ink, middle: true }))
        const rest = boxText ? (p.value ?? '') : [p.label, p.value].filter(Boolean).join(' ')
        if (rest) labels.push({ label: rest, size: FS, fill: ink, cands: [Math.max(w, h) / 2 + 3, Math.max(w, h) / 2 + 0.9 * P].flatMap((rr) => ringCands(c, rr, n)), path: p.path, avoid: others(p) })
      }
      pts.forEach((q) => pinEnd(q, ink))
    }

    // Jumper wires: bowed so they never run along a line of holes, with a plug at each end.
    const wireDraw = (pts, ink, glow) => {
      const dd = pts.length === 3 ? `M${pts[0]}Q${pts[1]} ${pts[2]}` : pathD(pts)
      if (glow) layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.highlight, 'stroke-opacity': 0.45, 'stroke-width': 9, 'stroke-linecap': 'round' }))
      layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.halo, 'stroke-width': 6.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
      layers.wires.push(el('path', { d: dd, fill: 'none', stroke: ink, 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }
    const plug = (p, ink) => layers.ends.push(el('circle', { cx: p[0], cy: p[1], r: 3.7, fill: ink, stroke: theme.fg, 'stroke-width': 1.1 }))
    const quad = (a, c, b, n = 16) => Array.from({ length: n + 1 }, (_, k) => { const t = k / n; return V.add(V.add(V.mul(a, (1 - t) ** 2), V.mul(c, 2 * t * (1 - t))), V.mul(b, t * t)) })
    // Long wires between sockets of one header row run in lanes beside it: each takes the nearest
    // lane (of three) where it overlaps no other, so none hides another.
    const lanes = new Map(), taken = [[], [], []]
    for (const w of R.wires) {
      if (!(w.a.pin && w.b.pin && w.a.header.side === w.b.header.side) || Math.abs(w.a.pin.pos - w.b.pin.pos) < 2) continue
      const lo = Math.min(w.a.pin.pos, w.b.pin.pos), hi = Math.max(w.a.pin.pos, w.b.pin.pos)
      const free = (k) => taken[k].every(([a, b]) => hi < a || lo > b)
      const k = [0, 1, 2].find(free) ?? [0, 1, 2].reduce((m, k) => (taken[k].length < taken[m].length ? k : m), 0)
      taken[k].push([lo, hi]); lanes.set(w, k)
    }
    for (const w of R.wires) {
      const ink = inkColor(w.color ?? w.ink, theme)
      const a = xy(w.a), b = xy(w.b), dist = V.len(V.sub(b, a))
      const u = V.unit(V.sub(b, a))
      // Between two sockets of one header row, the wire bows toward the board, off the pin labels.
      const rowWire = w.a.pin && w.b.pin && w.a.header.side === w.b.header.side
      const n = rowWire ? F(0, w.a.header.side === 't' ? 1 : -1) : upOf(u)
      const off = (rowWire ? 1 + 0.45 * (lanes.get(w) ?? 0) : 0.5) * P
      if (dist >= 1.9 * P && (Math.abs(u[0]) < 1e-6 || Math.abs(u[1]) < 1e-6)) {
        // Along a row or column: step half a pitch aside into the lane between holes, so the
        // wire never lies over a hole it doesn't go into.
        const pts = [a, V.add(V.add(a, V.mul(u, 0.5 * P)), V.mul(n, off)), V.add(V.sub(b, V.mul(u, 0.5 * P)), V.mul(n, off)), b]
        wireDraw(pts, ink, hl.has(w.id))
        cv.trace(pts, w.id, 6)
      } else {
        const ctrl = V.add(V.mid(a, b), V.mul(n, 2 * Math.min(0.5 * P, 0.18 * dist)))
        wireDraw([a, ctrl, b].map((q) => q.map((v) => +v.toFixed(2))), ink, hl.has(w.id))
        cv.trace(quad(a, ctrl, b), w.id, 6)
      }
      plug(a, ink); plug(b, ink)
    }

    // Posts: terminals off the board's edge (past any headers there), each lead running down a
    // lane between strips. Laid out in the frame; on a vertical board the labels sit beside them.
    for (const side of ['t', 'b']) {
      const qs = R.posts.filter((q) => q.fside === side)
      const lanes = new Set()
      const sizes = (q) => q.lines.map((_, i) => (i ? 10.5 : FS))
      for (const q of qs) {
        const hx = g.x(q.h.pin ? q.h.pin.pos : q.h.col)
        let lx = hx + ((q.h.pin ? q.h.pin.pos : q.h.col) === cols ? -P / 2 : P / 2)
        if (lanes.has(lx)) lx = hx - P / 2
        lanes.add(lx)
        q.lx = lx
        // Room the post's label takes along the board: its width, or on a vertical board its height.
        q.w = g.vertical ? sizes(q).reduce((s, z) => s + z + 2, 0) + 4 : Math.max(...q.lines.map((s, i) => measure(word(s), i ? 10.5 : FS)), 14) + 10
      }
      qs.sort((a, b) => a.lx - b.lx)
      qs.forEach((q, i) => { q.px = i ? Math.max(q.lx, qs[i - 1].px + (qs[i - 1].w + q.w) / 2 + 4) : q.lx })
      for (const q of qs) {
        const s = side === 't' ? -1 : 1
        const edge = (side === 't' ? 0 : g.H) + s * depth[side]
        const py = edge + s * 22
        const ink = inkColor(q.ink, theme)
        const hp0 = q.h.pin ? [g.x(q.h.pin.pos), headerY(g, side)] : [g.x(q.h.col), g.y[q.h.rail ?? q.h.row]]
        const near = [q.lx, hp0[1] + s * 0.8 * P]
        const along = side === 't' ? Math.min(edge - 4, near[1]) : Math.max(edge + 4, near[1])
        const fpts = [[q.px, py - s * 6.5], [q.lx, along], near]
        const pts = fpts.map(([a, b]) => F(a, b)), bend = F(q.lx, hp0[1]), hp = F(...hp0)
        const dd = pathD(pts) + `Q${bend[0]} ${bend[1]} ${hp[0]} ${hp[1]}`
        if (hl.has(q.id)) layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.highlight, 'stroke-opacity': 0.45, 'stroke-width': 9, 'stroke-linecap': 'round' }))
        layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.halo, 'stroke-width': 6.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
        layers.wires.push(el('path', { d: dd, fill: 'none', stroke: ink, 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
        cv.trace([...pts, ...quad(pts[2], bend, hp, 6)], q.id, 6)
        plug(hp, ink)
        const [tx, ty] = F(q.px, py)
        layers.ends.push(el('circle', { cx: tx, cy: ty, r: 6.5, fill: theme.halo, stroke: ink, 'stroke-width': 2.4 }))
        layers.ends.push(el('circle', { cx: tx, cy: ty, r: 2.2, fill: ink }))
        const put = (t, k, x, base, size, anchor) => {
          const first = k === 0
          layers.ends.push(labelSvg(word(t), x, base, theme, { size, anchor, fill: first ? (hl.has(q.id) ? theme.highlight : theme.fg) : theme.muted, weight: first ? 600 : undefined }))
          const bw = measure(word(t), size) + 4
          const bx1 = anchor === 'middle' ? x - bw / 2 : anchor === 'end' ? x - bw : x
          cv.ext.push([bx1, base - size], [bx1 + bw, base + 3])
          for (let xx = bx1; xx <= bx1 + bw; xx += 4) cv.obs.push([xx, base - size / 2, 10, 'post'])
        }
        if (g.vertical) {
          // Beside the terminal, away from the board: the name, then smaller notes below it.
          const sz = sizes(q), total = sz.reduce((a, z) => a + z + 2, -2)
          let base = ty - total / 2
          q.lines.forEach((t, k) => { base += sz[k]; put(t, k, tx + s * 11, base - 2, sz[k], s > 0 ? 'start' : 'end'); base += 2 })
        } else {
          // Label lines stack away from the board: the first is the post's name, the rest smaller.
          const order = side === 't' ? [...q.lines.keys()].reverse() : [...q.lines.keys()]
          let y = ty + s * 11
          for (const k of order) {
            const size = k ? 10.5 : FS
            put(q.lines[k], k, tx, side === 't' ? y : y + size - 2, size, 'middle')
            y += s * (size + 2)
          }
        }
        cv.ext.push([tx - 8, ty - 8], [tx + 8, ty + 8])
      }
    }

    // Net names from `nodes`, in the channel or the gutter beside their strip.
    for (const n of N.list) {
      if (!n.at) continue
      let cands
      if (n.at.pin) cands = ringCands(xy(n.at), 8, g.P(0, n.at.header.side === 't' ? -1 : 1))
      else if (n.at.rail) {
        cands = [[g.X0 - 2.4 * P, -1], [g.x(cols) + 2.4 * P, 1]].map(([fx, sg]) => (w, h) => {
          const [px, py] = F(fx, g.y[n.at.rail])
          return g.vertical ? [px, py + sg * h / 2] : [px + sg * w / 2, py]
        })
      } else {
        const hx = g.x(n.at.col)
        cands = (n.at.row <= 'e'
          ? [[hx, g.y.e + 1.05 * P], [hx, g.y.a - 1.05 * P], [hx + P, g.y.e + 1.05 * P], [hx - P, g.y.e + 1.05 * P]]
          : [[hx, g.y.f - 1.05 * P], [hx, g.y.j + 1.05 * P], [hx + P, g.y.f - 1.05 * P], [hx - P, g.y.f - 1.05 * P]]).map(([a, b]) => F(a, b))
      }
      labels.unshift({ label: word(n.name), size: 11, fill: n.color, cands, path: `nodes.${n.name}` })
    }

    const placed = placeLabels(labels, cv)
    // Any hole under a label gets hidden by a backing, so no label reads as sitting in a hole.
    for (const q of placed) if (cv.obs.some(([x, y, , tag]) => tag === 'hole' && x > q.box[0] - 3 && x < q.box[2] + 3 && y > q.box[1] - 3 && y < q.box[3] + 3)) q.inner = Math.max(q.inner, 1)
    drawLabels(placed, cv, theme)
    for (const q of placed) {
      const [bx1, by1, bx2, by2] = q.box
      if (cv.obs.some(([x, y, wt, tag]) => wt >= 6 && tag !== 'hole' && x > bx1 && x < bx2 && y > by1 && y < by2)) diag.warn(q.path, `no clear spot for the label "${q.label}"; shorten it or move the part`)
    }

    // Canvas: everything drawn, plus a margin.
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const M = 14
    const bx = Math.min(...xs) - M, by = Math.min(...ys) - M
    const width = Math.max(...xs) - bx + M, height = Math.max(...ys) - by + M
    const body = el('g', { transform: `translate(${+(-bx).toFixed(2)} ${+(-by).toFixed(2)})` },
      [...layers.board, ...layers.tint, ...layers.holes, ...layers.wires, ...layers.parts, ...layers.ends, ...cv.front])

    const fmt = (n) => { const s = N.stripList(n); return `${n.name}${s.length ? `[${s.join(',')}]` : ''}{${n.members.map((m) => m.name).join(', ')}}` }
    const count = (k, n) => `${n} ${k}${n === 1 ? '' : 's'}`
    const nets = `nets: ${N.list.map(fmt).join(' ')}${N.open.length ? `; open: ${N.open.join(', ')}` : ''}`
    diag.note('', nets)
    const banded = R.parts.filter((p) => p.colorBands)
    const bands = banded.length ? `; bands: ${banded.map((p) => `${p.id} ${p.colorBands.join('-')}`).join(', ')}` : ''
    const board = `${spec.preset ? `${spec.preset} board, ` : ''}${g.vertical ? `${cols} rows (vertical)` : `${cols} columns${half === 'top' ? ' (top half)' : ''}`}`
    const hdrs = g.headers.length ? `; headers ${g.headers.map((h) => h.id).join(', ')}` : ''
    const summary = `breadboard: ${board}${hdrs}; ${count('part', R.parts.length)}, ${count('wire', R.wires.length)}, ${count('post', R.posts.length)}${bands}; ${nets}`
    const alt = `Breadboard with ${[...R.parts.map((p) => p.id), ...R.posts.map((q) => q.lines[0])].join(', ')}`
    void uid
    return { body, width, height, summary, alt }
  },
}
