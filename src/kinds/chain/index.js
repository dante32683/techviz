// chain: RF signal chains and instrument block diagrams with the levels computed. Blocks run left
// to right (wrapping to more rows rather than shrinking), each node labeled with its level in dBm;
// a cascade table under the blocks gives each stage's G and NF and each node's totals and noise
// floor (Friis); a mixer's LO comes in from below, and couplers and splitters hang their second
// output below. The footer gives the cascade NF, SNR, sensitivity, IIP3, compression warnings, and
// each mixer's image; `plan` draws RF, LO, IF, and the image on a frequency axis.

import { el, pathD } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError } from '../../diag.js'
import { readouts, T } from '../scope/screen.js'
import { solve, facts as factLines, num, dB, dBm, hz } from './cascade.js'
import { checkExpect } from './expect.js'
import { size, draw, drawLO, branchDx, up } from './symbols.js'

const MARGIN = 12
const MAXW = 340 // a row wraps before its content passes this x
const LEAD = 16 // the wire into the first block of a wrapped row
const MIN_GAP = 20
const FS = { name: 10, level: 10, val: 9.5, note: 9, foot: 10.5 }
const ROW_H = 12.5
const FIELDS = ['blocks', 'preset', 'input', 'f', 'bw', 'snr', 'table', 'plan', 'expect', 'highlight']
const ROWS = {
  G: { label: 'G', at: 'stage' }, NF: { label: 'NF', at: 'stage' },
  G_cum: { label: 'ΣG', at: 'node' }, NF_cum: { label: 'ΣNF', at: 'node' },
  N: { label: 'N', at: 'node' }, P: { label: 'P', at: 'node' },
}

function tableRows(spec, S) {
  const t = spec.table
  if (t === false || (t === undefined && S.preset)) return []
  if (t === undefined || t === true) return ['G', 'NF', 'G_cum', 'NF_cum', ...(S.B !== null ? ['N'] : [])]
  if (!Array.isArray(t)) throw new SpecError('table', `table is true, false, or a list of rows from ${Object.keys(ROWS).join(', ')}`)
  t.forEach((k, i) => { if (!ROWS[k]) throw new SpecError(`table[${i}]`, `rows are ${Object.keys(ROWS).join(', ')}`) })
  if (t.includes('N') && S.B === null) throw new SpecError('table', 'the N row (noise floor) needs bw, the noise bandwidth')
  return t
}

/** Words wrapped to `width` px at `fs`; a word longer than the width gets a line of its own. */
function wrap(text, width, fs) {
  const out = []
  const words = String(text).replace(/(\d) (?=(?:[kMG]?Hz|dB[mc]?|m?W|V)\b)/g, '$1\u00a0').split(/[ \t\n]+/).filter(Boolean)
  for (const word of words) {
    const last = out[out.length - 1]
    if (last !== undefined && measure(`${last} ${word}`, fs) <= width) out[out.length - 1] = `${last} ${word}`
    else out.push(word)
  }
  return out
}

const arrowR = (x, y, fill) => el('path', { d: pathD([[x, y], [x - 6.5, y - 3.3], [x - 6.5, y + 3.3]], true), fill })
const arrowD = (x, y, fill) => el('path', { d: pathD([[x, y], [x - 3.3, y - 6.5], [x + 3.3, y - 6.5]], true), fill })
const arrowU = (x, y, fill) => el('path', { d: pathD([[x, y], [x - 3.3, y + 6.5], [x + 3.3, y + 6.5]], true), fill })

export default {
  kind: 'chain',
  fields: FIELDS,
  collections: ['blocks'],
  render(spec, { theme, diag, env }) {
    const S = solve(spec, env, diag)
    const rows = tableRows(spec, S)
    const hl = new Set(spec.highlight ?? [])
    const SIG = color('blue'), LOC = color('amber'), RED = color('red'), GREEN = color('green')
    const bg = theme.bg ?? 'none'
    const plan = (s) => S.plans.find((p) => p.s === s)
    // Nodes and blocks past a limit are drawn red.
    const badNode = new Set(), badBlock = new Set()
    for (const l of S.limits) if (l.over > 0) { badBlock.add(l.s); badNode.add(l.isIn ? l.s.inNode ?? l.s.in : l.s.out) }

    // Items in the main row: the source (or a bare input), then every stage.
    const items = [S.start ? { b: S.start, k: 0 } : { b: { type: 'input', label: null }, k: 0 }, ...S.stages.map((s, i) => ({ b: s, k: i + 1 }))]
    let unit = false
    for (const [i, it] of items.entries()) {
      const b = it.b
      it.sz = b.type === 'input' ? { w: 8, top: -4, bottom: 4 } : size(b)
      it.name = b.type !== 'input' && !it.sz.inside && b.label ? up(b.label) : null
      it.nameW = it.name ? measure(it.name, FS.name) : 0
      it.node = S.nodes[it.k] ?? null
      it.hasOut = i < items.length - 1 || b.role !== 'sink'
      it.label = null
      const same = b.type === 'port' // a port continues the node before it
      if (it.node && it.node.level !== null && !same) {
        it.label = num(it.node.level, 1, true) + (unit ? '' : ' dBm')
        unit = true
      }
      const stageVal = (key) => {
        if (it.k === 0 || b.role === 'sink' || b.role === 'marker') return ''
        return key === 'G' ? num(b.g, 1, true) : num(b.nf, 1)
      }
      const nodeVal = (key) => {
        const nd = it.node
        if (!nd || same) return ''
        if (key === 'N') return nd.N === null ? '' : num(nd.N, 1)
        if (key === 'P') return nd.level === null ? '' : num(nd.level, 1, true)
        if (it.k === 0) return ''
        return key === 'G_cum' ? (nd.G === null ? '—' : num(nd.G, 1, true)) : nd.nf === null ? '—' : num(nd.nf, 2)
      }
      it.vals = rows.map((key) => (ROWS[key].at === 'stage' ? stageVal(key) : ''))
      it.nvals = rows.map((key) => (ROWS[key].at === 'node' ? nodeVal(key) : ''))
      const vw = Math.max(0, ...it.vals.map((v) => measure(v, FS.val)))
      const nw = Math.max(0, ...it.nvals.map((v) => measure(v, FS.val)))
      it.a = Math.max(it.sz.w / 2, vw / 2 + 1)
      it.gapW = it.hasOut ? Math.max(MIN_GAP, (it.label ? measure(it.label, FS.level) : 0) + 8, nw + 8) : 0
      it.wireOut = (x) => (b.type === 'antenna' ? x : x + it.sz.w / 2)
      it.wireIn = (x) => x - it.sz.w / 2

      // Below the block: a mixer's LO, or a coupler's or splitter's branch.
      it.brL = 0; it.brR = 0; it.belowH = it.sz.bottom
      if (b.type === 'mixer') {
        const p = plan(b), r = 8, sw = b.sweep ? 3 : 0
        it.lo = { r, freq: p?.lo !== null && p?.lo !== undefined ? hz(p.lo) : b.sweep ? 'swept' : null }
        const fw = it.lo.freq ? measure(it.lo.freq, FS.note) : 0
        it.brR = Math.max(r + sw + 4 + measure('\\text{LO}', 9.5), fw / 2)
        it.brL = Math.max(r + sw, fw / 2)
        it.belowH = it.sz.bottom + 14 + 2 * r + (it.lo.freq ? 12 : 0)
      }
      if (b.branch) {
        const dx = branchDx(b)
        let yb = it.sz.bottom, lvl = b.branchLevel
        it.br = []
        for (const q of b.branch) {
          const qs = size(q), top = yb + 20
          const lt = lvl !== null && lvl !== undefined ? num(lvl, 1, true) : null
          const qn = !qs.inside && q.label ? up(q.label) : null
          it.br.push({ q, qs, from: yb, top, cy: top - qs.top, lt, qn })
          it.brR = Math.max(it.brR, dx + 4 + (lt ? measure(lt, FS.val) : 0), dx + qs.w / 2 + (qn ? 4 + measure(qn, FS.name) : 0))
          it.brL = Math.max(it.brL, -dx + qs.w / 2)
          yb = top - qs.top + qs.bottom
          lvl = q.out?.level ?? null
        }
        it.belowH = yb
      }
      it.notes = [b.note, ...(b.branch ?? []).map((q) => q.note)].filter(Boolean).map(up)
    }

    // Rows: blocks go left to right and wrap before MAXW.
    const rowLabelW = rows.length ? Math.max(...rows.map((k) => measure(T(ROWS[k].label), FS.val))) + 8 : 0
    const LEFT = MARGIN + rowLabelW + 2
    const lines = []
    let cur = []
    for (const it of items) {
      const half = Math.max(it.a, it.brL, it.nameW / 2)
      let c
      if (!cur.length) c = lines.length ? LEFT + LEAD + half : it.k === 0 ? Math.max(MARGIN + half, LEFT - 4 - it.a) : LEFT + half
      else {
        const p = cur[cur.length - 1]
        c = p.c + Math.max(p.a + p.gapW + it.a, (p.nameW + it.nameW) / 2 + 6, p.brR + it.brL + 8)
        if (c + Math.max(it.a + it.gapW, it.brR, it.nameW / 2) > MAXW) { lines.push(cur); cur = []; c = LEFT + LEAD + half }
      }
      it.c = c
      cur.push(it)
    }
    lines.push(cur)

    // Notes wrap to the room between neighbors' centers.
    for (const row of lines) row.forEach((it, i) => {
      const room = (j) => { const o = row[j], d = Math.abs(o.c - it.c); return o.notes.length ? d / 2 - 3 : d - 6 - Math.max(o.a, o.brL, o.brR) }
      const hl2 = i > 0 ? room(i - 1) : 44, hr = i < row.length - 1 ? room(i + 1) : 44
      it.noteLines = it.notes.flatMap((n) => wrap(n, 2 * Math.min(hl2, hr), FS.note))
    })

    // Bands of each row, top to bottom: names, the blocks, what hangs below, notes, the table.
    let y = MARGIN
    const geo = lines.map((row) => {
      const topExt = Math.max(15, ...row.map((it) => -Math.min(it.sz.top, -12) + (it.name ? 4 + FS.name : 0)))
      const cy = y + topExt
      const below = cy + Math.max(...row.map((it) => it.belowH + (it.noteLines.length ? 4 + it.noteLines.length * 11 : 0)))
      const tableY = below + 4
      const bottom = tableY + (rows.length ? 6 + rows.length * ROW_H : 0)
      y = bottom + 14
      return { cy, below, tableY, bottom }
    })

    const back = [], mid = [], front = []
    let right = 0
    const text = (s, x, yy, o) => { front.push(labelSvg(s, x, yy, theme, o)); const w = measure(s, o.size ?? theme.size); right = Math.max(right, o.anchor === 'start' ? x + w : o.anchor === 'end' ? x : x + w / 2) }
    lines.forEach((row, ri) => {
      const g = geo[ri], cy = g.cy
      row.forEach((it, i) => {
        const b = it.b, c = it.c, next = row[i + 1]
        const stroke = badBlock.has(b) ? RED : theme.fg
        const sw = badBlock.has(b) ? 2.2 : 1.5
        if (hl.has(b.id)) mid.push(el('rect', { x: c - it.sz.w / 2 - 5, y: cy + it.sz.top - 5, width: it.sz.w + 10, height: it.sz.bottom - it.sz.top + 10, rx: 5, fill: color('amber'), 'fill-opacity': 0.25 }))
        // The wire out, with its level above it.
        if (it.hasOut) {
          const x0 = it.wireOut(c), gx0 = c + it.a
          let gx1, pts
          if (next) { gx1 = next.c - next.a; pts = [[x0, cy], [next.wireIn(next.c), cy]] }
          else {
            gx1 = c + it.a + it.gapW
            const nrow = lines[ri + 1]
            if (nrow) {
              const n0 = nrow[0], yRet = g.bottom + 7, xl = LEFT + 4
              pts = [[x0, cy], [gx1, cy], [gx1, yRet], [xl, yRet], [xl, geo[ri + 1].cy], [n0.wireIn(n0.c), geo[ri + 1].cy]]
            } else pts = [[x0, cy], [gx1, cy]]
          }
          const tip = pts[pts.length - 1]
          const ln = pts.map((p, k) => (k === pts.length - 1 ? [p[0] - 5, p[1]] : p))
          back.push(el('path', { d: pathD(ln), fill: 'none', stroke: SIG, 'stroke-width': 2, 'stroke-linejoin': 'round' }))
          back.push(arrowR(tip[0], tip[1], SIG))
          right = Math.max(right, gx1)
          const mx = (gx0 + gx1) / 2
          if (it.label) text(it.label, mx, cy - 4.5, { size: FS.level, fill: badNode.has(it.node) ? RED : SIG })
          it.mx = mx
        }
        // The symbol and its name.
        if (b.type === 'input') mid.push(el('circle', { cx: c, cy, r: 3.5, fill: bg, stroke: SIG, 'stroke-width': 1.6 }))
        else mid.push(draw(b, c, cy, { st: stroke, bg, w: sw, theme }))
        // Names sit above the level labels, which share the band just over the line.
        if (it.name) text(it.name, c, cy + Math.min(it.sz.top, -12) - 4, { size: FS.name, fill: stroke })
        right = Math.max(right, c + it.a)
        // A mixer's LO, from below.
        if (it.lo) {
          const { r } = it.lo, ly = cy + it.sz.bottom + 14 + r
          back.push(el('line', { x1: c, y1: ly - r, x2: c, y2: cy + it.sz.bottom + 5, stroke: LOC, 'stroke-width': 1.6 }))
          back.push(arrowU(c, cy + it.sz.bottom, LOC))
          mid.push(drawLO(c, ly, r, { st: LOC, bg, sweep: b.sweep }))
          text('\\text{LO}', c + r + (b.sweep ? 3 : 0) + 4, ly, { size: 9.5, fill: LOC, anchor: 'start', middle: true })
          if (it.lo.freq) text(it.lo.freq, c, ly + r + 10, { size: FS.note, fill: LOC })
        }
        // A branch: the coupled arm or the second output, going down.
        for (const br of it.br ?? []) {
          const bx = c + branchDx(b), y0 = cy + br.from, y1 = cy + br.top, qcy = cy + br.cy
          back.push(el('line', { x1: bx, y1: y0, x2: bx, y2: y1 - 5, stroke: theme.muted, 'stroke-width': 1.4 }))
          back.push(arrowD(bx, y1, theme.muted))
          if (br.lt) text(br.lt, bx + 4, y0 + 13, { size: FS.val, fill: badNode.has(br.q.in) ? RED : SIG, anchor: 'start' })
          const qst = badBlock.has(br.q) ? RED : theme.fg
          if (hl.has(br.q.id)) mid.push(el('rect', { x: bx - br.qs.w / 2 - 5, y: qcy + br.qs.top - 5, width: br.qs.w + 10, height: br.qs.bottom - br.qs.top + 10, rx: 5, fill: color('amber'), 'fill-opacity': 0.25 }))
          mid.push(draw(br.q, bx, qcy, { st: qst, bg, w: badBlock.has(br.q) ? 2.2 : 1.5, theme }))
          if (br.qn) text(br.qn, bx + br.qs.w / 2 + 4, qcy, { size: FS.name, fill: qst, anchor: 'start', middle: true })
        }
        it.noteLines.forEach((ln, k) => text(ln, c, cy + it.belowH + 13 + k * 11, { size: FS.note, fill: theme.muted }))
      })
      // The table: stage values under the blocks, node values under the wires.
      if (rows.length) {
        const ty = g.tableY + 3
        back.push(el('line', { x1: MARGIN, y1: ty, x2: Math.max(...row.map((it) => it.mx ?? it.c + it.a)) + 16, y2: ty, stroke: theme.grid, 'stroke-width': 1 }))
        rows.forEach((key, r) => {
          const by = ty + (r + 1) * ROW_H - 2
          text(T(ROWS[key].label), LEFT - 6, by, { size: FS.val, fill: theme.muted, anchor: 'end' })
          for (const it of row) {
            if (it.vals[r]) text(T(it.vals[r]), it.c, by, { size: FS.val, fill: theme.muted })
            if (it.nvals[r] && it.mx !== undefined) text(T(it.nvals[r]), it.mx, by, { size: FS.val, fill: key === 'N' ? theme.muted : theme.fg })
          }
        })
      }
    })

    let width = Math.max(right + MARGIN, 250)
    let yEnd = geo[geo.length - 1].bottom
    // Frequency plans.
    const planParts = []
    if (spec.plan) {
      const shown = S.plans.filter((p) => p.rf !== null)
      if (!shown.length) diag.warn('plan', 'a frequency plan needs a mixer with lo or if, and the input frequency f')
      for (const p of shown) {
        const out = drawPlan(p, MARGIN + 4, width - MARGIN - 4, yEnd + 6, theme)
        planParts.push(out.svg)
        yEnd += 6 + out.height
      }
    }

    // Footer: the cascade totals, limits, receivers, and each mixer's image.
    const t = S.T, fr = []
    const active = S.stages.some((s) => s.type === 'amp' || s.type === 'mixer')
    const r1 = []
    if (active && t.G !== null && !(S.gStop && S.gStop.role !== 'sink')) r1.push([T(`G ${dB(t.G)}`), theme.fg])
    if (active && t.nf !== null) r1.push([T(`NF ${dB(t.nf, 2)}`), theme.fg])
    if (t.iip3 !== undefined) r1.push([T(`IIP3 ${dBm(t.iip3)}`), theme.fg])
    if (t.snr !== undefined) r1.push([T(`SNR ${dB(t.snr)}`), theme.fg])
    fr.push(r1)
    if (t.mds !== undefined) fr.push([[T(t.sens !== undefined ? `sensitivity ${dBm(t.sens)} for SNR ${dB(S.snrReq)}` : `input noise floor ${dBm(t.mds)} in ${hz(S.B)}`), theme.fg]])
    const rx = S.stages.flatMap((s) => [s, ...(s.branch ?? [])]).filter((q) => q.type === 'receiver' && q.in.level !== null)
    if (rx.length) fr.push(rx.map((q) => [T(`${q.disp} ${dBm(q.in.level)}`), SIG]))
    for (const l of S.limits) if (l.over > 0) fr.push([[T(`${l.s.disp}: ${l.isIn ? 'input' : 'output'} ${dB(l.over)} past its ${l.what}`), RED]])
    if (!S.limits.some((l) => l.over > 0) && S.limits.length) {
      const c = S.limits.reduce((a, b) => (b.over > a.over ? b : a))
      if (c.over > -20) fr.push([[T(`${c.s.disp}: ${dB(-c.over)} under its ${c.what}`), GREEN]])
    }
    for (const p of S.plans) {
      if (p.rf === null) continue
      const ok = p.filters.length && !p.passing.length
      const how = !p.filters.length ? 'no filter ahead: not rejected' : p.passing.length ? `inside ${p.passing.map((q) => q.disp).join(', ')}: not rejected` : `rejected by ${p.rejecting.map((q) => q.disp).join(', ')}${p.rejectDb !== null ? ` (${dB(p.rejectDb)})` : ''}`
      fr.push([[T(`${p.s.disp}: ${p.inject}-side LO`), theme.fg], [T(`IF ${hz(p.if)}`), theme.fg], [T(`image ${hz(p.image)}`), ok ? GREEN : RED], [T(how), ok ? GREEN : RED]])
    }
    const cap = []
    if (rows.some((k) => k === 'G_cum' || k === 'NF_cum')) cap.push([T('Σ: input to that node, dB'), theme.muted])
    if (rows.includes('N')) cap.push([T(`N: noise in ${hz(S.B)}, dBm`), theme.muted])
    fr.push(cap)
    if (S.caption) fr.push([[up(S.caption), theme.muted]])
    const ro = readouts(fr, MARGIN, yEnd + 2, width - 2 * MARGIN, theme, FS.foot)
    const height = yEnd + ro.height + MARGIN + 2

    const summary = factLines(S)
    const ex = checkExpect(spec.expect, S, env, diag)
    if (ex) summary.push(ex)
    const body = [...back, ...mid, ...front, ...planParts, ro.svg].join('')
    return { body, width, height, summary: summary.join('; '), alt: 'RF signal chain' }
  },
}

/** RF, LO, the image, and the IF when it's near them, on a frequency axis, with the filters' passbands. */
function drawPlan(p, X0, X1, Y, theme) {
  const parts = [], taken = []
  const SIG = color('blue'), LOC = color('amber'), IMG = color('red'), IFC = color('teal'), BAND = color('green')
  const rejected = p.filters.length > 0 && !p.passing.length
  const lines = [
    { f: p.rf, label: 'RF', col: SIG, h: 30 },
    { f: p.lo, label: 'LO', col: LOC, h: 38 },
    { f: p.image, label: 'image', col: IMG, h: rejected ? 13 : 30, dash: true },
  ]
  let lo = Math.min(p.rf, p.lo, p.image), hi = Math.max(p.rf, p.lo, p.image)
  for (const q of p.filters) {
    if (q.band[0] > 0) lo = Math.min(lo, q.band[0])
    if (Number.isFinite(q.band[1])) hi = Math.max(hi, q.band[1])
  }
  const span0 = hi - lo
  if (p.if >= lo - 0.6 * span0 && p.if <= hi + 0.6 * span0) { lines.push({ f: p.if, label: 'IF', col: IFC, h: 22 }); lo = Math.min(lo, p.if); hi = Math.max(hi, p.if) }
  const span = hi - lo || hi || 1
  const a0 = Math.max(0, lo - 0.08 * span), a1 = hi + 0.08 * span
  const [sc, unit] = a1 >= 1e9 ? [1e9, 'GHz'] : a1 >= 1e6 ? [1e6, 'MHz'] : a1 >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz']
  const uw = measure(`\\text{${unit}}`, 9)
  X1 -= uw + 4
  const X = (f) => X0 + ((f - a0) / (a1 - a0)) * (X1 - 6 - X0)
  const ax = Y + 58
  const box = (b) => taken.push(b)
  const free = (b) => !taken.some((o) => b[0] < o[2] + 2 && o[0] < b[2] + 2 && b[1] < o[3] + 1 && o[1] < b[3] + 1)
  const put = (s, cands, fs, fill, halo) => {
    const w = measure(s, fs) + 2
    const at = (c) => { const x0 = c[2] === 'start' ? c[0] : c[2] === 'end' ? c[0] - w : c[0] - w / 2; return [x0, c[1] - fs + 1, x0 + w, c[1] + 2] }
    const c = cands.find((cc) => free(at(cc))) ?? cands[0]
    const b = at(c)
    box(b)
    if (halo) parts.push(el('rect', { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], fill: theme.halo, class: 'tv-label-bg' }))
    parts.push(labelSvg(s, c[0], c[1], theme, { size: fs, fill, anchor: c[2] }))
    return b
  }
  // Passbands, shaded.
  for (const q of p.filters) {
    const x0 = X(Math.max(q.band[0], a0)), x1 = X(Math.min(q.band[1], a1))
    parts.push(el('rect', { x: x0, y: ax - 46, width: Math.max(1, x1 - x0), height: 46, fill: BAND, 'fill-opacity': 0.14 }))
    for (const e of q.band) if (e > a0 && e < a1) parts.push(el('line', { x1: X(e), y1: ax - 46, x2: X(e), y2: ax, stroke: BAND, 'stroke-width': 1.2, 'stroke-dasharray': '3 2' }))
  }
  // The axis, its unit, and the spectral lines with their names.
  parts.push(el('line', { x1: X0, y1: ax, x2: X1 - 5, y2: ax, stroke: theme.muted, 'stroke-width': 1.2 }), arrowR(X1, ax, theme.muted))
  put(`\\text{${unit}}`, [[X1 + 4, ax + 3, 'start']], 9, theme.muted)
  for (const l of lines) {
    const x = X(l.f)
    parts.push(el('line', { x1: x, y1: ax, x2: x, y2: ax - l.h + 5, stroke: l.col, 'stroke-width': 2, 'stroke-dasharray': l.dash ? '4 2.5' : undefined }), arrowU(x, ax - l.h, l.col))
    box([x - 3.5, ax - l.h, x + 3.5, ax])
  }
  for (const l of lines) {
    const x = X(l.f), top = ax - l.h - 4
    put(`\\text{${l.label}}`, [[x, top, 'middle'], [x + 5, top + 9, 'start'], [x - 5, top + 9, 'end'], [x, top - 11, 'middle'], [x, top - 22, 'middle']], 9.5, l.col)
  }
  for (const q of p.filters) {
    const x0 = X(Math.max(q.band[0], a0)), x1 = X(Math.min(q.band[1], a1))
    if (q.label) put(q.label, [[x0 + 3, ax - 36, 'start'], [x1 - 3, ax - 36, 'end'], [x0 + 3, ax - 6, 'start'], [x1 - 3, ax - 6, 'end'], [x0, ax - 49, 'start']], 9, BAND)
  }
  // Values under the axis.
  let low = ax + 4
  for (const l of [...lines].sort((a, b) => a.f - b.f)) {
    const x = X(l.f)
    parts.push(el('line', { x1: x, y1: ax, x2: x, y2: ax + 3, stroke: theme.muted, 'stroke-width': 1 }))
    const v = Number((l.f / sc).toPrecision(4)).toString()
    const b = put(`\\text{${v}}`, [[x, ax + 12, 'middle'], [x, ax + 23, 'middle']], 9, l.col)
    low = Math.max(low, b[3])
  }
  // IF brackets: the IF is RF to LO, and the image sits as far on the LO's other side.
  const yb = low + 8
  for (const [fa, fb] of [[p.rf, p.lo], [p.lo, p.image]]) {
    const xa = Math.min(X(fa), X(fb)), xb = Math.max(X(fa), X(fb))
    for (const x of [xa, xb]) parts.push(el('line', { x1: x, y1: low + 1, x2: x, y2: yb + 3, stroke: theme.faint, 'stroke-width': 0.8, 'stroke-dasharray': '2 2' }))
    if (xb - xa < 14) continue
    parts.push(el('line', { x1: xa + 4, y1: yb, x2: xb - 4, y2: yb, stroke: theme.muted, 'stroke-width': 1 }))
    parts.push(el('path', { d: pathD([[xa, yb], [xa + 5, yb - 2.5], [xa + 5, yb + 2.5]], true), fill: theme.muted }), el('path', { d: pathD([[xb, yb], [xb - 5, yb - 2.5], [xb - 5, yb + 2.5]], true), fill: theme.muted }))
    const s = '\\text{IF}', w = measure(s, 9) + 4
    parts.push(el('rect', { x: (xa + xb) / 2 - w / 2, y: yb - 6, width: w, height: 12, fill: theme.halo, class: 'tv-label-bg' }))
    parts.push(labelSvg(s, (xa + xb) / 2, yb, theme, { size: 9, fill: theme.muted, middle: true }))
  }
  return { svg: parts.join(''), height: yb + 9 - Y }
}
