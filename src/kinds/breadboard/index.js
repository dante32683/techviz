// breadboard: a solderless breadboard with parts, jumper wires, and off-board
// posts (instrument leads and clips), placed by hole name ("a12", "t-3"). The
// board's internal strips plus the jumpers give the nets, which are tinted on
// the board and listed in the summary, so a part in the wrong column shows up.
// Every end lands in a real hole: rail gaps and missing columns are errors.

import { el, pathD } from '../../svg.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { labelSvg, measure } from '../../label.js'
import { V, Canvas } from '../fbd/draw.js'
import { placeLabels, drawLabels, ringCands } from '../fbd/place.js'
import { P, RAILS, boardGeometry, parseHole, holeXY, allHoles, Nets, stripOrder } from './board.js'
import { TWO_LEAD, MULTI_PINS, twoLeadBody, multiLeadBody } from './parts.js'

const TYPES = [...Object.keys(TWO_LEAD), ...Object.keys(MULTI_PINS), 'box', 'ic']
const PART_FIELDS = new Set(['id', 't', 'pins', 'label', 'value', 'color', 'col', 'pinNames'])
const WIRE_COLORS = ['coral', 'teal', 'purple', 'amber', 'green', 'pink']
const NET_COLORS = ['teal', 'purple', 'amber', 'green', 'pink', 'coral']
const raw = (s) => [{ text: String(s), shift: 0 }]
// Names of posts and nets are words (LO, CH1), set upright; TeX markup still works in them.
const word = (s) => (/[\\_^]/.test(s) ? s : raw(s))
const BOX_T = 17
const isTwo = (p) => !!TWO_LEAD[p.t] || (p.t === 'box' && p.holes.length === 2)
const FS = 12

/** Perpendicular to u that points up the page (or right, for a vertical u). */
const upOf = (u) => { const n = V.perp(u); return n[1] < -1e-9 || (Math.abs(n[1]) < 1e-9 && n[0] > 0) ? n : V.mul(n, -1) }
const tf = (c, u, w) => `matrix(${[u[0], u[1], w[0], w[1], c[0], c[1]].map((v) => +v.toFixed(3)).join(' ')})`

function inkColor(c, theme) {
  if (c === 'black') return theme.fg
  if (c === 'white') return theme.faint
  return color(c)
}

function pinLabels(p, n) {
  if (['R', 'C', 'L', 'switch'].includes(p.t)) return [p.id, p.id]
  if (p.t === 'Cp') return [`${p.id}+`, `${p.id}-`]
  if (p.t === 'diode' || p.t === 'led') return [`${p.id}.a`, `${p.id}.k`]
  if (MULTI_PINS[p.t]) return MULTI_PINS[p.t].map((s) => `${p.id}.${s}`)
  const names = Array.from({ length: n }, (_, i) => p.pinNames?.[i])
  return names.map((s, i) => `${p.id}.${s && names.indexOf(s) === names.lastIndexOf(s) ? s : i + 1}`)
}

/** Resolve parts, wires, and posts to holes; record which hole holds what. */
function resolve(spec, cols, diag) {
  const used = new Map() // hole name -> owner text
  const take = (h, owner, path) => {
    if (used.has(h.name)) diag.warn(path, `${h.name} already holds ${used.get(h.name)}; a hole takes one lead`)
    else used.set(h.name, owner)
  }
  if (spec.parts !== undefined && !Array.isArray(spec.parts)) throw new SpecError('parts', 'parts is a list like [{"id": "R1", "t": "R", "pins": ["a5", "a9"]}]')
  const parts = (spec.parts ?? []).map((p0, i) => {
    const path = `parts[${i}]`
    if (!TYPES.includes(p0?.t)) throw new SpecError(`${path}.t`, `unknown part type "${p0?.t}"; use ${TYPES.join(', ')}`)
    for (const k of Object.keys(p0)) if (!PART_FIELDS.has(k)) diag.warn(`${path}.${k}`, `parts don't use "${k}"`)
    const p = { ...p0, id: p0.id ?? `${p0.t}#${i + 1}`, path }
    if (p.t === 'ic') {
      const n = p.pins ?? 8
      if (!Number.isInteger(n) || n < 4 || n % 2) throw new SpecError(`${path}.pins`, 'an ic\'s pins is an even count like 8 or 14')
      if (!Number.isInteger(p.col)) throw new SpecError(`${path}.col`, 'give "col": the column of pin 1 (bottom left, in row f, notch to the left)')
      if (p.col < 1 || p.col + n / 2 - 1 > cols) throw new SpecError(`${path}.col`, `pins 1 to ${n / 2} run along row f from column ${p.col}, past the board's ${cols} columns`)
      p.holes = Array.from({ length: n }, (_, k) => parseHole(k < n / 2 ? `f${p.col + k}` : `e${p.col + n - 1 - k}`, cols, `${path}.col`))
    } else {
      const want = TWO_LEAD[p.t] ? 2 : MULTI_PINS[p.t] ? 3 : 0
      const names = TWO_LEAD[p.t] ? '' : MULTI_PINS[p.t] ? ` (${MULTI_PINS[p.t].join(', ')})` : ''
      if (!Array.isArray(p.pins) || (want && p.pins.length !== want) || !p.pins.length) {
        throw new SpecError(`${path}.pins`, `${p.t} needs "pins": ${want ? `${want} holes${names}` : 'a list of holes'}, like ["a5", "a9"]`)
      }
      p.holes = p.pins.map((h, k) => parseHole(h, cols, `${path}.pins[${k}]`))
    }
    p.pinIds = pinLabels(p, p.holes.length)
    p.holes.forEach((h, k) => take(h, p.pinIds[k], `${path}.pins`))
    return p
  })
  let wc = 0
  const wires = (spec.wires ?? []).map((w0, i) => {
    const path = `wires[${i}]`
    const w = { ...w0, id: w0.id ?? `W${i + 1}`, path }
    w.a = parseHole(w.from, cols, `${path}.from`)
    w.b = parseHole(w.to, cols, `${path}.to`)
    if (w.a.name === w.b.name) throw new SpecError(path, 'a wire needs two different holes')
    const rails = [w.a.rail, w.b.rail].filter(Boolean)
    w.ink = w.color ? null : rails.some((r) => r.endsWith('+')) ? 'red' : rails.some((r) => r.endsWith('-')) ? 'black' : WIRE_COLORS[wc++ % WIRE_COLORS.length]
    take(w.a, `wire ${w.id}`, `${path}.from`)
    take(w.b, `wire ${w.id}`, `${path}.to`)
    return w
  })
  const posts = (spec.posts ?? []).map((q0, i) => {
    const path = `posts[${i}]`
    const q = { ...q0, id: q0.id ?? `post${i + 1}`, path }
    q.h = parseHole(q.to, cols, `${path}.to`)
    q.lines = Array.isArray(q.label) ? q.label.map(String) : [String(q.label ?? q.id)]
    if (q.side && !['top', 'bottom'].includes(q.side)) throw new SpecError(`${path}.side`, 'side is top or bottom')
    q.side = q.side ?? (q.h.rail ? (q.h.rail[0] === 't' ? 'top' : 'bottom') : q.h.row <= 'e' ? 'top' : 'bottom')
    q.ink = q.color ?? WIRE_COLORS[wc++ % WIRE_COLORS.length]
    take(q.h, `post ${q.id}`, `${path}.to`)
    return q
  })
  return { parts, wires, posts, used }
}

/** Nets from the board's strips and the jumpers: name, strips, members. */
function findNets(spec, R, cols, diag) {
  const uf = new Nets()
  const members = [] // { name, strip, path, lone? }
  for (const p of R.parts) p.holes.forEach((h, k) => { uf.find(h.strip); members.push({ name: p.pinIds[k], strip: h.strip, path: `${p.path}.pins`, part: p, lone: isTwo(p) }) })
  for (const q of R.posts) { uf.find(q.h.strip); members.push({ name: q.id, strip: q.h.strip, path: `${q.path}.to`, post: q, lone: true }) }
  for (const w of R.wires) uf.join(w.a.strip, w.b.strip)
  const nets = new Map() // root -> net
  const netOf = (strip) => {
    const r = uf.find(strip)
    if (!nets.has(r)) nets.set(r, { strips: new Set(), members: [], wires: [], name: null })
    return nets.get(r)
  }
  for (const m of members) netOf(m.strip).members.push(m)
  for (const w of R.wires) { const n = netOf(w.a.strip); n.wires.push(w) }
  for (const k of uf.parent.keys()) netOf(k).strips.add(k)

  for (const [name, hole] of Object.entries(spec.nodes ?? {})) {
    const h = parseHole(hole, cols, `nodes.${name}`)
    const n = nets.get(uf.find(h.strip))
    if (!n) { diag.warn(`nodes.${name}`, `nothing connects at ${h.name}`); continue }
    if (n.name) diag.warn(`nodes.${name}`, `${n.name} and ${name} name the same net`)
    else { n.name = name; n.at = h }
  }
  const list = [...nets.values()]
  for (const n of list) if (!n.name && n.members.some((m) => m.post)) n.name = n.members.find((m) => m.post).name
  // A pin of a chip or module alone on its strip is just unused: listed as open, not as a net.
  const isOpen = (n) => n.members.length === 1 && !n.members[0].lone && n.strips.size === 1 && !n.name
  const open = list.filter(isOpen)
  let k = 0
  for (const n of list) if (!n.name && n.members.length && !open.includes(n)) n.name = `n${++k}`

  for (const n of list) {
    if (!n.members.length) { for (const w of n.wires) diag.warn(w.path, `wire ${w.id} connects nothing: no part lead or post in ${[...n.strips].sort(stripOrder).join(', ')}`); continue }
    if (n.members.length === 1 && n.members[0].lone) {
      const m = n.members[0]
      diag.warn(m.path, `${m.name} is alone in ${m.strip}${n.strips.size > 1 ? ` (net ${n.name})` : ''}: nothing else connects there`)
    }
  }
  for (const p of R.parts) {
    if (!isTwo(p)) continue
    const [a, b] = p.holes
    if (uf.find(a.strip) === uf.find(b.strip)) {
      diag.warn(`${p.path}.pins`, a.strip === b.strip
        ? `${p.id} is shorted: both leads are in ${a.strip}, which the board connects; move one lead to another column`
        : `${p.id} is shorted: both leads are in net ${nets.get(uf.find(a.strip)).name}`)
    }
  }
  const shown = list.filter((n) => n.members.length && !open.includes(n))
  // Supply colors: the net on the top + rail (else the bottom one) is red, on a - rail blue,
  // unless that net also holds a rail of the other sign. The rest cycle.
  const only = (sign) => (n) => [...n.strips].every((s) => !RAILS.includes(s) || s.endsWith(sign))
  const onRail = (rails, sign) => rails.map((r) => shown.find((n) => n.strips.has(r) && only(sign)(n))).find(Boolean)
  const plus = onRail(['t+', 'b+'], '+'), minus = onRail(['t-', 'b-'], '-')
  let ci = 0
  for (const n of shown) n.color = n === plus ? color('red') : n === minus ? color('blue') : color(NET_COLORS[ci++ % NET_COLORS.length])
  return { list: shown, open: open.map((n) => n.members[0].name) }
}

export default {
  kind: 'breadboard',
  fields: ['cols', 'parts', 'wires', 'posts', 'nodes', 'highlight'],
  collections: ['parts', 'wires', 'posts'],
  render(spec, { theme, diag, uid }) {
    const cols = spec.cols ?? 30
    if (!Number.isInteger(cols) || cols < 5 || cols > 64) throw new SpecError('cols', 'cols is the number of columns: 30 for a half-size board, 63 for a full one')
    const g = boardGeometry(cols)
    const R = resolve(spec, cols, diag)
    const N = findNets(spec, R, cols, diag)
    const hl = new Set(spec.highlight ?? [])
    const cv = new Canvas()
    const layers = { board: [], tint: [], holes: [], wires: [], parts: [], ends: [] }
    const xy = (h) => holeXY(g, h)

    // Board: body, channel, rail stripes and signs, row letters, column numbers.
    layers.board.push(el('rect', { x: 0, y: 0, width: g.W, height: g.H, rx: 7, fill: theme.grid, 'fill-opacity': 0.5, stroke: theme.faint, 'stroke-width': 1 }))
    layers.board.push(el('rect', { x: g.X0 - 0.6 * P, y: g.y.e + 0.85 * P, width: (cols - 1) * P + 1.2 * P, height: 1.3 * P, rx: 2, fill: theme.faint, 'fill-opacity': 0.16 }))
    cv.ext.push([0, 0], [g.W, g.H])
    const x1 = g.X0 - 0.5 * P, x2 = g.x(cols) + 0.5 * P
    for (const [rail, side] of [['t+', -1], ['t-', 1], ['b-', -1], ['b+', 1]]) {
      const plus = rail.endsWith('+'), y = g.y[rail] + side * 0.5 * P
      layers.board.push(el('line', { x1, y1: y, x2, y2: y, stroke: plus ? theme.positive : theme.negative, 'stroke-width': 1.4 }))
      for (const x of [g.X0 - 1.1 * P, g.x(cols) + 1.1 * P]) {
        layers.board.push(labelSvg(raw(plus ? '+' : '−'), x, g.y[rail], theme, { size: 13, fill: plus ? theme.positive : theme.negative, middle: true, weight: 600 }))
        cv.obs.push([x, g.y[rail], 4, 'board'])
      }
    }
    for (const r of 'abcdefghij') for (const x of [g.X0 - 1.1 * P, g.x(cols) + 1.1 * P]) {
      layers.board.push(labelSvg(raw(r), x, g.y[r], theme, { size: 9.5, fill: theme.muted, middle: true }))
      cv.obs.push([x, g.y[r], 4, 'board'])
    }
    for (let c = 1; c <= cols; c++) {
      if (c !== 1 && c % 5) continue
      for (const y of [g.y.nums, g.y.nums2]) {
        layers.board.push(labelSvg(raw(c), g.x(c), y, theme, { size: 9, fill: theme.muted, middle: true }))
        cv.obs.push([g.x(c), y, 4, 'board'])
      }
    }

    // Net tints: each net's strips (columns of five, or a whole rail) in one color.
    N.list.forEach((n) => {
      for (const s of n.strips) {
        if (RAILS.includes(s)) {
          layers.tint.push(el('rect', { x: x1, y: g.y[s] - 0.42 * P, width: x2 - x1, height: 0.84 * P, rx: 3, fill: n.color, 'fill-opacity': 0.2 }))
        } else {
          const c = parseInt(s), top = s.endsWith('a-e')
          const y0 = top ? g.y.a : g.y.f
          layers.tint.push(el('rect', { x: g.x(c) - 0.42 * P, y: y0 - 0.45 * P, width: 0.84 * P, height: 4.9 * P, rx: 3, fill: n.color, 'fill-opacity': 0.24 }))
        }
      }
    })

    // Holes: one path of small squares; used holes weigh more for label placement.
    let d = ''
    for (const h of allHoles(cols)) {
      const [x, y] = xy(h)
      d += `M${+(x - 2.5).toFixed(2)} ${+(y - 2.5).toFixed(2)}h5v5h-5z`
      const name = h.rail ? `${h.rail}${h.col}` : `${h.row}${h.col}`
      cv.obs.push([x, y, R.used.has(name) ? 6 : 0.15, 'hole'])
    }
    layers.holes.push(el('path', { d, fill: theme.faint, 'fill-opacity': 0.9 }))

    const labels = []
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
      const text = [p.label, p.value].filter((s) => s !== undefined && s !== '').join(' ')
      if (text) labels.push({ label: text, size: FS, fill: hl.has(p.id) ? theme.highlight : theme.fg, cands: [r, r + 0.8 * P, r + 1.7 * P].flatMap((rr) => ringCands(c, rr, first)), path: p.path })
    }

    // Parts.
    for (const p of R.parts) {
      const ink = hl.has(p.id) ? theme.highlight : theme.fg
      const pts = p.holes.map(xy)
      if (isTwo(p)) {
        const boxText = p.t === 'box' ? p.label ?? '' : ''
        const { L, T } = TWO_LEAD[p.t] ?? { L: Math.max(24, boxText ? measure(boxText, 11) + 12 : 0), T: BOX_T }
        const [a, b] = pts, dist = V.len(V.sub(b, a))
        const u = V.unit(V.sub(b, a)), n = upOf(u)
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
        p.holes.forEach((h, k) => lead([xy(h), [g.x(h.col), h.row === 'e' ? ya : yb]], ink, p.id, 2.2))
        layers.parts.push(el('rect', { x: xa, y: ya, width: xb - xa, height: yb - ya, rx: 2, fill: theme.halo }))
        layers.parts.push(el('rect', { x: xa, y: ya, width: xb - xa, height: yb - ya, rx: 2, fill: ink, 'fill-opacity': 0.14, stroke: ink, 'stroke-width': 1.3 }))
        const ym = (ya + yb) / 2
        layers.parts.push(el('path', { d: `M${xa} ${ym - 4.5}A4.5 4.5 0 0 1 ${xa} ${ym + 4.5}`, fill: 'none', stroke: ink, 'stroke-width': 1.2 }))
        if (!Array.isArray(p.pinNames)) layers.parts.push(el('circle', { cx: g.x(p.col), cy: yb - 4.5, r: 1.8, fill: ink }))
        bodyBox([(xa + xb) / 2, ym], [1, 0], [0, 1], xb - xa, yb - ya, p.id)
        if (Array.isArray(p.pinNames)) {
          p.holes.forEach((h, k) => {
            const nm = p.pinNames[k]
            if (nm) layers.parts.push(labelSvg(word(nm), g.x(h.col), h.row === 'e' ? ya + 8 : yb - 3, theme, { size: 7.5, fill: theme.muted }))
          })
        }
        const name = [p.label, p.value].filter(Boolean).join(' ')
        if (name) {
          const fits = measure(name, 11) < xb - xa - 14
          if (fits) layers.parts.push(labelSvg(name, (xa + xb) / 2 + 3, ym, theme, { size: 11, fill: ink, middle: true }))
          else labels.push({ label: name, size: FS, fill: ink, cands: ringCands([(xa + xb) / 2, ym], (yb - ya) / 2 + 3, [0, 1]), path: p.path })
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
          for (const hh of allHoles(cols)) {
            const q = xy(hh)
            if (Math.abs(V.dot(V.sub(q, cc), u)) < w / 2 + 3 && Math.abs(V.dot(V.sub(q, cc), nn)) < h / 2 + 3) k += R.used.has(hh.rail ? `${hh.rail}${hh.col}` : `${hh.row}${hh.col}`) ? 10 : 1
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
        if (rest) labels.push({ label: rest, size: FS, fill: ink, cands: [Math.max(w, h) / 2 + 3, Math.max(w, h) / 2 + 0.9 * P].flatMap((rr) => ringCands(c, rr, n)), path: p.path })
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
    for (const w of R.wires) {
      const ink = inkColor(w.color ?? w.ink, theme)
      const a = xy(w.a), b = xy(w.b), dist = V.len(V.sub(b, a))
      const u = V.unit(V.sub(b, a)), n = upOf(u)
      if (dist >= 1.9 * P && (Math.abs(u[0]) < 1e-6 || Math.abs(u[1]) < 1e-6)) {
        // Along a row or column: step half a pitch aside into the lane between holes, so the
        // wire never lies over a hole it doesn't go into.
        const pts = [a, V.add(V.add(a, V.mul(u, 0.5 * P)), V.mul(n, 0.5 * P)), V.add(V.sub(b, V.mul(u, 0.5 * P)), V.mul(n, 0.5 * P)), b]
        wireDraw(pts, ink, hl.has(w.id))
        cv.trace(pts, w.id, 6)
      } else {
        const ctrl = V.add(V.mid(a, b), V.mul(n, 2 * Math.min(0.5 * P, 0.18 * dist)))
        wireDraw([a, ctrl, b].map((q) => q.map((v) => +v.toFixed(2))), ink, hl.has(w.id))
        cv.trace(quad(a, ctrl, b), w.id, 6)
      }
      plug(a, ink); plug(b, ink)
    }

    // Posts: terminals off the board's edge, each lead running down a lane between columns.
    const top = 0, bottom = g.H
    for (const side of ['top', 'bottom']) {
      const qs = R.posts.filter((q) => q.side === side)
      const lanes = new Set()
      for (const q of qs) {
        const hx = g.x(q.h.col)
        let lx = hx + (q.h.col === cols ? -P / 2 : P / 2)
        if (lanes.has(lx)) lx = hx - P / 2
        lanes.add(lx)
        q.lx = lx
        q.w = Math.max(...q.lines.map((s, i) => measure(word(s), i ? 10.5 : FS)), 14) + 10
      }
      qs.sort((a, b) => a.lx - b.lx)
      qs.forEach((q, i) => { q.px = i ? Math.max(q.lx, qs[i - 1].px + (qs[i - 1].w + q.w) / 2 + 4) : q.lx })
      for (const q of qs) {
        const s = side === 'top' ? -1 : 1
        const edge = side === 'top' ? top : bottom
        const py = edge + s * 22
        const ink = inkColor(q.ink, theme)
        const hp = xy(q.h)
        const near = [q.lx, hp[1] + s * 0.8 * P]
        const along = side === 'top' ? Math.min(edge - 4, near[1]) : Math.max(edge + 4, near[1])
        const pts = [[q.px, py - s * 6.5], [q.lx, along], near]
        const dd = pathD(pts) + `Q${q.lx} ${hp[1]} ${hp[0]} ${hp[1]}`
        if (hl.has(q.id)) layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.highlight, 'stroke-opacity': 0.45, 'stroke-width': 9, 'stroke-linecap': 'round' }))
        layers.wires.push(el('path', { d: dd, fill: 'none', stroke: theme.halo, 'stroke-width': 6.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
        layers.wires.push(el('path', { d: dd, fill: 'none', stroke: ink, 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
        cv.trace([...pts, ...quad(near, [q.lx, hp[1]], hp, 6)], q.id, 6)
        plug(hp, ink)
        layers.ends.push(el('circle', { cx: q.px, cy: py, r: 6.5, fill: theme.halo, stroke: ink, 'stroke-width': 2.4 }))
        layers.ends.push(el('circle', { cx: q.px, cy: py, r: 2.2, fill: ink }))
        // Label lines stack away from the board: the first is the post's name, the rest smaller.
        const lines = side === 'top' ? [...q.lines].reverse() : q.lines
        let y = py + s * 11
        lines.forEach((t, k) => {
          const first = side === 'top' ? k === lines.length - 1 : k === 0
          const size = first ? FS : 10.5
          const base = side === 'top' ? y : y + size - 2
          layers.ends.push(labelSvg(word(t), q.px, base, theme, { size, fill: first ? (hl.has(q.id) ? theme.highlight : theme.fg) : theme.muted, weight: first ? 600 : undefined }))
          const bw = measure(word(t), size) / 2 + 2
          cv.ext.push([q.px - bw, base - size], [q.px + bw, base + 3])
          for (let x = q.px - bw; x <= q.px + bw; x += 4) cv.obs.push([x, base - size / 2, 10, 'post'])
          y += s * (size + 2)
        })
        cv.ext.push([q.px - 8, py - 8], [q.px + 8, py + 8])
      }
    }

    // Net names from `nodes`, in the channel or the gutter beside their strip.
    for (const n of N.list) {
      if (!n.at) continue
      const [hx] = xy(n.at)
      const cands = n.at.rail
        ? [[g.X0 - 2.4 * P, g.y[n.at.rail]], [g.x(cols) + 2.4 * P, g.y[n.at.rail]]].map(([x, y]) => (w) => [x + Math.sign(x - g.W / 2) * w / 2, y])
        : n.at.row <= 'e'
          ? [[hx, g.y.e + 1.05 * P], [hx, g.y.a - 1.05 * P], [hx + P, g.y.e + 1.05 * P], [hx - P, g.y.e + 1.05 * P]]
          : [[hx, g.y.f - 1.05 * P], [hx, g.y.j + 1.05 * P], [hx + P, g.y.f - 1.05 * P], [hx - P, g.y.f - 1.05 * P]]
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

    const fmt = (n) => `${n.name}[${[...n.strips].sort(stripOrder).join(',')}]{${n.members.map((m) => m.name).join(', ')}}`
    const count = (k, n) => `${n} ${k}${n === 1 ? '' : 's'}`
    const summary = `breadboard: ${cols} columns; ${count('part', R.parts.length)}, ${count('wire', R.wires.length)}, ${count('post', R.posts.length)}; nets: ${N.list.map(fmt).join(' ')}${N.open.length ? `; open: ${N.open.join(', ')}` : ''}`
    const alt = `Breadboard with ${[...R.parts.map((p) => p.id), ...R.posts.map((q) => q.lines[0])].join(', ')}`
    void uid
    return { body, width, height, summary, alt }
  },
}
