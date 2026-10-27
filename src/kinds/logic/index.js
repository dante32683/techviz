// logic: gate-level schematics and RTL block diagrams from a netlist or Boolean expressions.
// The kind lays the parts out left to right by logic depth, routes orthogonal wires with
// junction dots, and simulates: input values color every wire (steps walk input vectors or
// clock cycles), and the summary gives the truth table as minterms, the minimal SOP, a check
// against expected expressions, the critical path, and the diagnostics.

import { SpecError, Diag } from '../../diag.js'
import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { parseExpr, mintermsOf, minimize, sopText, sigma } from './bool.js'
import { buildNetlist, checkNetlist, topoOrder, settle, clock, initialState, inputValues, truthTable, criticalPath, valueText, X, Z } from './net.js'
import { layoutNetlist } from './layout.js'
import { drawPart, texName } from './symbols.js'

const FIELDS = ['inputs', 'parts', 'outputs', 'expr', 'simplify', 'bubbles', 'expect', 'vectors', 'cycles', 'table', 'highlight']
const r1 = (v) => Math.round(v * 10) / 10

function prepareNet(spec, diag) {
  const nl = buildNetlist(spec, diag)
  checkNetlist(nl, diag)
  nl.order = topoOrder(nl)
  return nl
}

/** The input vector for each step: [{vals, label}], or null for a spec without vectors or cycles. */
function vectorsOf(spec, nl) {
  const seq = nl.parts.some((p) => p.seq || p.t === 'latch')
  if (spec.cycles !== undefined && !(Number.isInteger(spec.cycles) && spec.cycles >= 1 && spec.cycles <= 64)) throw new SpecError('cycles', 'cycles is the number of clock edges to step through, 1 to 64')
  if (spec.cycles !== undefined && !seq) throw new SpecError('cycles', 'cycles steps clock edges; this circuit has no registers. Use "vectors" to walk input values')
  let list = null
  if (spec.vectors === 'all') {
    if (seq) throw new SpecError('vectors', '"all" is for combinational circuits; give a list of vectors, one per clock cycle')
    const bits = nl.inputs.reduce((s, d) => s + d.width, 0)
    if (bits > 6) throw new SpecError('vectors', `"all" would be ${2 ** bits} steps; list the vectors to show`)
    list = Array.from({ length: 2 ** bits }, (_, m) => m.toString(2).padStart(bits, '0'))
  } else if (Array.isArray(spec.vectors)) list = spec.vectors
  else if (spec.vectors !== undefined) throw new SpecError('vectors', 'vectors is "all", or a list of bit strings in input order ("101") or objects ({"A": 1})')
  if (!list && spec.cycles === undefined) return null
  const n = Math.max(list?.length ?? 0, spec.cycles !== undefined ? spec.cycles + 1 : 0)
  const out = []
  for (let k = 0; k < n; k++) {
    const raw = list ? list[Math.min(k, list.length - 1)] : undefined
    const vals = raw === undefined ? inputValues(nl, undefined) : inputValues(nl, raw, `vectors[${Math.min(k, list.length - 1)}]`)
    const txt = nl.inputs.filter((d) => !(seq && /^clk$/i.test(d.name))).map((d) => `${d.name}=${valueText(vals[d.name], d.width)}`).join(' ')
    out.push({ vals, label: seq ? `cycle ${k}${list ? `: ${txt}` : ''}` : txt })
  }
  return out
}

/** Settle the circuit as of step k: combinational, or clocked k times from the initial state. */
function simulate(nl, vecs, k) {
  let state = initialState(nl)
  let vals = null
  for (let i = 0; i <= k; i++) {
    vals = settle(nl, vecs[i].vals, state)
    if (i < k) state = clock(nl, vals, state)
  }
  return { vals, state, next: clock(nl, vals, state) }
}

const hasValues = (spec) => spec.inputs && !Array.isArray(spec.inputs) && typeof spec.inputs === 'object' && Object.values(spec.inputs).some((v) => v !== null && v !== undefined)

function valueColor(v, theme, w) {
  if (v === X) return theme.muted
  if (v === Z) return color('amber')
  if (w > 1) return color('teal')
  return v ? theme.positive : theme.negative
}

// --- Label placement -----------------------------------------------------------------

function makePlacer(wires, boxes) {
  const pts = []
  for (const w of wires) for (const [x1, y1, x2, y2] of w.segs) {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3))
    for (let i = 0; i <= n; i++) pts.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n])
  }
  const taken = [...boxes]
  return {
    taken,
    place(cands, w, h, pad = 1) {
      let best = null
      cands.forEach(([cx, cy], i) => {
        const b = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
        let s = i * 0.3
        for (const [px, py] of pts) if (px > b[0] - pad && px < b[2] + pad && py > b[1] - pad && py < b[3] + pad) s += 10
        for (const o of taken) if (b[0] < o[2] + 1 && o[0] < b[2] + 1 && b[1] < o[3] + 1 && o[1] < b[3] + 1) s += 1000
        if (!best || s < best.s) best = { s, b, c: [cx, cy] }
      })
      if (best) taken.push(best.b)
      return best
    },
  }
}

// --- Truth table drawing -------------------------------------------------------------

function drawTable(tt, theme, x0, y0, rowOn) {
  const fs = 11, rh = 15
  const cols = [...tt.vars, ...tt.outs]
  const cw = cols.map((c) => Math.max(16, measure(c, fs) + 10))
  const parts = []
  let x = x0
  const cx = []
  cols.forEach((c, i) => { cx.push(x + cw[i] / 2); x += cw[i] })
  const width = x - x0
  const split = x0 + cw.slice(0, tt.vars.length).reduce((a, b) => a + b, 0)
  cols.forEach((c, i) => parts.push(labelSvg(c, cx[i], y0 + 11, theme, { size: fs, fill: theme.fg })))
  parts.push(el('line', { x1: x0, y1: y0 + 16, x2: x0 + width, y2: y0 + 16, stroke: theme.fg, 'stroke-width': 1 }))
  parts.push(el('line', { x1: split, y1: y0, x2: split, y2: y0 + 18 + tt.rows.length * rh, stroke: theme.fg, 'stroke-width': 1 }))
  const n = tt.vars.length
  tt.rows.forEach((row, m) => {
    const y = y0 + 18 + m * rh
    if (m === rowOn) parts.push(el('rect', { x: x0, y, width, height: rh, fill: theme.highlight, 'fill-opacity': 0.18 }))
    const bits = Array.from({ length: n }, (_, k) => (m >> (n - 1 - k)) & 1)
    ;[...bits, ...row].forEach((v, i) => parts.push(labelSvg(`\\text{${typeof v === 'number' ? v : 'x'}}`, cx[i], y + 11, theme, { size: fs, fill: i < n ? theme.muted : theme.fg })))
  })
  return { body: parts.join(''), w: width, h: 18 + tt.rows.length * rh }
}

// --- Render --------------------------------------------------------------------------

function render(spec, { theme, diag }) {
  for (const k of ['simplify', 'bubbles', 'table']) if (spec[k] !== undefined && typeof spec[k] !== 'boolean') throw new SpecError(k, `${k} is true or false`)
  if (!spec.parts && spec.expr === undefined) throw new SpecError('parts', 'give "parts" (a netlist: [{"id": "g1", "t": "and", "in": ["A", "B"]}]) or "expr" ({"Y": "AB + C\'"})')
  for (const k of ['simplify', 'bubbles']) if (spec[k] && spec.expr === undefined) diag.warn(k, `"${k}" applies to "expr"; this spec has none`)
  const nl = prepareNet(spec, diag)
  const seq = nl.parts.some((p) => p.seq || p.t === 'latch')

  // Values: a vector step, or the inputs object.
  const vecs = vectorsOf(spec, nl)
  let sim = null, stepK = null
  if (vecs) {
    stepK = Number.isInteger(spec.__vec) ? Math.min(spec.__vec, vecs.length - 1) : vecs.length - 1
    sim = simulate(nl, vecs, stepK)
  } else if (hasValues(spec)) sim = simulate(nl, [{ vals: inputValues(nl, undefined) }], 0)
  const valOf = (net) => (sim ? sim.vals.get(net) ?? X : undefined)

  // Analysis.
  const tt = truthTable(nl)
  const facts = []
  const cp = criticalPath(nl)
  const counts = {}
  for (const p of nl.parts) counts[p.t] = (counts[p.t] ?? 0) + 1
  const ioName = (d) => (d.width > 1 ? `${d.name}[${d.width - 1}:0]` : d.name)
  facts.push(`logic: ${nl.inputs.length} input${nl.inputs.length === 1 ? '' : 's'} (${nl.inputs.map(ioName).join(', ') || 'none'}), ${nl.outputs.length} output${nl.outputs.length === 1 ? '' : 's'} (${nl.outputs.map((o) => (o.width > 1 ? `${o.label}[${o.width - 1}:0]` : o.label)).join(', ') || 'none'}), ${nl.parts.length} parts (${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')})`)
  if (tt) {
    const n = tt.vars.length
    const states = new Set(nl.parts.filter((p) => p.seq).map((p) => p.outPorts[0].net))
    const oneBit = nl.outputs.filter((o) => o.width === 1)
    tt.outs.forEach((o, k) => {
      const ones = tt.ones[k], xs = tt.xs[k]
      if (states.has(oneBit[k]?.r.net)) return // an output wired straight to a register says nothing new
      const { cover } = minimize(ones, [], n)
      facts.push(`${o} = ${n <= 4 || ones.length <= 12 ? `${sigma(ones)} = ` : ''}${sopText(cover, tt.vars, ones)} (minimal SOP)${xs.length ? `; x at m${xs.join(',')}` : ''}`)
    })
  } else if (spec.expect) diag.warn('expect', 'expect needs a truth table: 1-bit inputs and outputs, at most 10 input bits, and only reg or dff for state')
  if (spec.expect !== undefined) {
    if (typeof spec.expect !== 'object' || Array.isArray(spec.expect)) throw new SpecError('expect', 'expect is {"S": "A ^ B ^ Cin"}: an output name to the expression it should equal')
    if (tt) for (const [name, src] of Object.entries(spec.expect)) {
      const k = tt.outs.indexOf(name)
      if (k < 0) throw new SpecError(`expect.${name}`, `no 1-bit output "${name}"; outputs are ${tt.outs.join(', ')}`)
      const ast = parseExpr(src, { names: tt.vars, path: `expect.${name}` })
      const want = mintermsOf(ast, tt.vars)
      const got = tt.ones[k]
      const bad = []
      for (let m = 0; m < 1 << tt.vars.length; m++) if (want.includes(m) !== got.includes(m)) bad.push(m)
      if (!bad.length) facts.push(`expect ${name} = ${src}: matches`)
      else {
        const m = bad[0], n = tt.vars.length
        const at = tt.vars.map((v, i) => `${v}=${(m >> (n - 1 - i)) & 1}`).join(' ')
        const msg = `${name} doesn't match "${src}": ${bad.length} of ${1 << n} rows differ, first at ${at} (circuit ${got.includes(m) ? 1 : 0}, expected ${want.includes(m) ? 1 : 0}); circuit ${sigma(got)}, expected ${sigma(want)}`
        diag.warn(`expect.${name}`, msg)
        facts.push(`expect ${name}: MISMATCH (${bad.length} rows)`)
      }
    }
  }
  if (cp && cp.t > 0) facts.push(`critical path ${cp.t} ${cp.t === 1 ? cp.unit.replace(/s$/, '').replace('gate delay', 'gate delay') : cp.unit}: ${cp.path.join(' → ')}`)

  // Highlights: part ids, nets, or "critical".
  const hl = new Set()
  const hlRaw = spec.highlight === undefined ? [] : Array.isArray(spec.highlight) ? spec.highlight : [spec.highlight]
  for (const h of hlRaw) {
    if (h === 'critical') { for (const id of cp?.parts ?? []) hl.add(id); continue }
    if (!nl.byId.has(String(h)) && !nl.nets.has(String(h))) diag.warn('highlight', `no part or net "${h}"`)
    hl.add(String(h))
  }
  const hlNet = (ln) => {
    if (!ln.net) return false
    if (hl.has(ln.net)) return true
    const d = nl.nets.get(ln.net).drivers[0]
    if (!d?.part || !hl.has(d.part)) return false
    // On the critical path, only the nets between highlighted parts.
    return !hlRaw.includes('critical') || nl.nets.get(ln.net).sinks.some((s) => (s.part && hl.has(s.part)) || s.output)
  }

  // Layout and drawing.
  const lay = layoutNetlist(nl, { valueRoom: !!sim })
  const back = [], mid = [], front = []
  const boxes = []
  for (const n of lay.nodes.values()) if (n.kind === 'part') boxes.push([n.x - 1, n.y - 1, n.x + n.w + 1, n.y + n.h + 1])
  for (const w of lay.wires) {
    const ln = w.ln
    const v = ln.net ? valOf(ln.net) : sim ? ln.kval : undefined
    w.value = v
    const on = hlNet(ln)
    const stroke = on ? theme.highlight : v !== undefined ? valueColor(v, theme, ln.width) : theme.fg
    w.stroke = stroke
    const sw = (ln.width > 1 ? 2.4 : 1.3) + (on ? 0.6 : 0)
    const d = w.segs.map(([x1, y1, x2, y2]) => `M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}`).join('')
    back.push(el('path', { d, stroke, 'stroke-width': sw, fill: 'none', 'stroke-linecap': 'square' }))
    for (const [x, y] of w.dots) mid.push(el('circle', { cx: r1(x), cy: r1(y), r: ln.width > 1 ? 3.2 : 2.6, fill: stroke }))
  }
  // Parts and their labels.
  for (const n of lay.nodes.values()) {
    if (n.kind === 'part') {
      const on = hl.has(n.part.id)
      front.push(drawPart(n.part, n.g, n.x, n.y, { stroke: on ? theme.highlight : theme.fg, sw: on ? 2 : 1.4, theme }))
    } else if (n.kind === 'in' || n.kind === 'const') {
      const lx = n.x + n.w - 10
      const t = n.kind === 'const' ? `\\text{${n.label}}` : texName(n.label)
      front.push(labelSvg(t, lx, n.y, theme, { size: 13, anchor: 'end', middle: true, fill: n.kind === 'const' ? theme.muted : theme.fg }))
      boxes.push([lx - measure(t, 13) - 1, n.y - 8, lx + 1, n.y + 8])
    } else if (n.kind === 'out') {
      const o = n.output
      const lx = n.x + 8
      front.push(labelSvg(texName(o.label), lx, n.y, theme, { size: 13, anchor: 'start', middle: true }))
      let bw = measure(texName(o.label), 13)
      if (sim && o.r.konst === undefined && o.width === 1) {
        let v = valOf(o.r.net)
        if (o.r.hi !== null && typeof v === 'number') v = Math.floor(v / 2 ** o.r.lo) % 2 ** (o.r.hi - o.r.lo + 1)
        const t = `= ${valueText(v, o.width)}`
        front.push(labelSvg(`\\text{${t}}`, lx + bw + 4, n.y, theme, { size: 13, anchor: 'start', middle: true, fill: valueColor(v, theme, o.width) }))
        bw += 4 + measure(t, 13)
      }
      boxes.push([lx - 1, n.y - 8, lx + bw + 1, n.y + 8])
    }
  }
  const placer = makePlacer(lay.wires, boxes)
  // Bus widths: a slash with the width on the net's first long horizontal run.
  for (const w of lay.wires) {
    if (w.ln.width <= 1) continue
    const src = lay.nodes.get(w.ln.drv.node)
    const runs = w.segs.filter((s) => s[1] === s[3] && Math.abs(s[2] - s[0]) >= 14)
      .sort((a, b) => Math.hypot(a[0] - (src.x + src.w), a[1] - src.y) - Math.hypot(b[0] - (src.x + src.w), b[1] - src.y))
    if (!runs.length) continue
    // The slash, with its width under the wire (values go above), where both clear what's placed.
    const t = String(w.ln.width), tw = measure(t, 9) + 2
    const free = (b) => !placer.taken.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])
    let pick = null
    for (const s of runs.slice(0, 3)) {
      const x1 = Math.min(s[0], s[2]), x2 = Math.max(s[0], s[2])
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const mx = x1 + (x2 - x1) * f, y = s[1]
        if (mx - 5 < x1 || mx + 5 > x2) continue
        for (const [lx, ly] of [[mx + 3 + tw / 2, y + 9], [mx - 3 - tw / 2, y + 9], [mx + 4 + tw / 2, y - 9]]) {
          if (free([mx - 4, y - 4, mx + 4, y + 4]) && free([lx - tw / 2, ly - 4, lx + tw / 2, ly + 5])) { pick = { mx, y, lx, ly }; break }
        }
        if (pick) break
      }
      if (pick) break
    }
    if (!pick) { const s = runs[0], mx = (s[0] + s[2]) / 2; pick = { mx, y: s[1], lx: mx + 3 + tw / 2, ly: s[1] + 9 } }
    mid.push(el('line', { x1: r1(pick.mx - 3), y1: r1(pick.y + 4.5), x2: r1(pick.mx + 3), y2: r1(pick.y - 4.5), stroke: w.stroke, 'stroke-width': 1.3 }))
    placer.taken.push([pick.mx - 4, pick.y - 4, pick.mx + 4, pick.y + 4], [pick.lx - tw / 2, pick.ly - 4, pick.lx + tw / 2, pick.ly + 5])
    front.push(labelSvg(`\\text{${t}}`, pick.lx, pick.ly, theme, { size: 9, fill: theme.muted, middle: true }))
  }
  // Values on every net, next to its driver.
  if (sim) {
    for (const w of lay.wires) {
      if (!w.ln.net) continue
      const v = w.value
      const t = valueText(v, w.ln.width)
      const tw = measure(t, 10.5) + 2, th = 11
      const src = lay.nodes.get(w.ln.drv.node)
      const [px, py] = [src.x + (src.pins[w.ln.drv.pin]?.x ?? src.w), src.y + (src.pins[w.ln.drv.pin]?.y ?? 0)]
      const hs = w.segs.filter((s) => s[1] === s[3]).sort((a, b) => Math.hypot(Math.min(a[0], a[2]) - px, a[1] - py) - Math.hypot(Math.min(b[0], b[2]) - px, b[1] - py))
      const cands = []
      for (const s of hs.slice(0, 4)) {
        const x1 = Math.min(s[0], s[2]), x2 = Math.max(s[0], s[2])
        for (const fx of [x1 + 2 + tw / 2, (x1 + x2) / 2, x2 - 2 - tw / 2]) {
          if (x2 - x1 < tw + 2) { cands.push([(x1 + x2) / 2, s[1] - 10], [(x1 + x2) / 2, s[1] + 10]); break }
          cands.push([fx, s[1] - 10], [fx, s[1] + 10])
        }
      }
      if (!cands.length) cands.push([px + tw / 2 + 2, py - 7])
      const at = placer.place(cands, tw, th)
      front.push(labelSvg(`\\text{${t}}`, at.c[0], at.c[1], theme, { size: 10.5, fill: w.stroke, middle: true, weight: 'bold' }))
    }
  }
  // Slices read at a pin: the bit range near the sink.
  for (const p of nl.parts) for (const q of p.ins) {
    if (q.r.hi === null || q.r.konst !== undefined) continue
    const n = lay.nodes.get(`p:${p.id}`), pin = n.pins[q.name]
    const t = q.r.hi === q.r.lo ? `[${q.r.hi}]` : `[${q.r.hi}:${q.r.lo}]`
    const tw = measure(t, 9) + 2
    const x = n.x + pin.x, y = n.y + pin.y
    const at = pin.side === 'T' ? placer.place([[x + tw / 2 + 3, y - 10], [x - tw / 2 - 3, y - 10]], tw, 10) : placer.place([[x - tw / 2 - 3, y - 7], [x - tw / 2 - 3, y + 7], [x - tw / 2 - 12, y - 7]], tw, 10)
    front.push(labelSvg(`\\text{${t}}`, at.c[0], at.c[1], theme, { size: 9, fill: theme.muted, middle: true }))
  }

  // Bounds, then the truth table under the schematic.
  const xs = [lay.box[0], lay.box[2], ...placer.taken.flatMap((b) => [b[0], b[2]])]
  const ys = [lay.box[1], lay.box[3], ...placer.taken.flatMap((b) => [b[1], b[3]])]
  let [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  if (spec.table) {
    if (!tt) diag.warn('table', 'no truth table: it needs 1-bit inputs and outputs, at most 10 input bits')
    else if (tt.rows.length > 32) diag.warn('table', `${tt.rows.length} rows is too many to draw; the summary has the minterms`)
    else {
      let row = null
      if (sim) {
        const bits = tt.vars.map((v) => { const p = nl.parts.find((x) => x.seq && x.outPorts[0].net === v); return p ? sim.state.get(p.id) : sim.vals.get(v) })
        if (bits.every((b) => b === 0 || b === 1)) row = bits.reduce((a, b) => a * 2 + b, 0)
      }
      const t = drawTable(tt, theme, 0, 0, row)
      const tx = (minX + maxX) / 2 - t.w / 2
      front.push(el('g', { transform: `translate(${r1(tx)},${r1(maxY + 14)})` }, t.body))
      minX = Math.min(minX, tx); maxX = Math.max(maxX, tx + t.w); maxY += 14 + t.h
    }
  }
  const M = 12
  const body = el('g', { transform: `translate(${r1(M - minX)},${r1(M - minY)})` }, [...back, ...mid, ...front])

  // Summary: facts, then values and state.
  if (sim) {
    const outs = nl.outputs.map((o) => {
      let v = o.r.konst !== undefined ? o.r.konst : valOf(o.r.net)
      if (o.r.hi !== null && typeof v === 'number') v = Math.floor(v / 2 ** o.r.lo) % 2 ** (o.r.hi - o.r.lo + 1)
      return `${o.label}=${valueText(v, o.width)}`
    })
    const ins = nl.inputs.map((d) => `${d.name}=${valueText(sim.vals.get(d.name), d.width)}`).join(' ')
    let s = `${vecs && seq ? `cycle ${stepK} of ${vecs.length - 1}` : 'values'}: ${ins}${ins ? ' → ' : ''}${outs.join(' ')}`
    const regs = nl.parts.filter((p) => p.seq && !['regfile', 'mem'].includes(p.t))
    if (regs.length) s += `; state ${regs.map((p) => `${p.id}=${valueText(sim.state.get(p.id), p.width)}→${valueText(sim.next.get(p.id), p.width)}`).join(' ')} at the next edge`
    const mems = nl.parts.filter((p) => ['regfile', 'mem'].includes(p.t))
    for (const p of mems) {
      const cur = sim.state.get(p.id), nx = sim.next.get(p.id)
      const changed = Object.keys(nx).filter((k) => nx[k] !== cur[k])
      if (changed.length) s += `; ${p.id} writes ${changed.map((k) => `${p.t === 'regfile' ? `x${k}` : `[0x${Number(k).toString(16)}]`}=${valueText(nx[k], p.width)}`).join(', ')} at the next edge`
    }
    facts.push(s)
  }
  if (seq && !sim) facts.push(`registers: ${nl.parts.filter((p) => p.seq).map((p) => `${p.id} (${p.t}, ${p.width} bit${p.width === 1 ? '' : 's'})`).join(', ')}`)
  return {
    body, width: r1(maxX - minX + 2 * M), height: r1(maxY - minY + 2 * M), defs: '',
    summary: facts.join('; '),
    alt: seq ? 'sequential logic schematic' : 'logic schematic',
  }
}

export default {
  kind: 'logic',
  fields: FIELDS,
  collections: [],
  steps(spec) {
    const diag = new Diag()
    const nl = prepareNet(spec, diag)
    const vecs = vectorsOf(spec, nl)
    return vecs && vecs.length > 1 ? vecs.map((v, k) => ({ label: v.label, __vec: k })) : []
  },
  render,
}
