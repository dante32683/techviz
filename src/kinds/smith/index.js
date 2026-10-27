// smith: Smith charts with the reflection quantities computed. Loads given as Z, Y, Γ, or an RLC
// model at a frequency; constant-|Γ| (VSWR) circles and pass regions; moves along a lossless line,
// series and shunt L or C, and quarter-wave transformers, each an arc with its direction, one step
// per move; S11 sweeps from data or a load model with markers, the best match, and the VSWR band;
// the L-section match's two solutions; and expect checks. Γ maps to the screen as center + R·(re, −im).

import { el, pathD } from '../../svg.js'
import { labelSvg } from '../../label.js'
import { color } from '../../theme.js'
import { SpecError, Diag } from '../../diag.js'
import { Canvas, V } from '../fbd/draw.js'
import { ringCands, placeLabels, extent } from '../fbd/place.js'
import { readouts } from '../scope/screen.js'
import { eng } from '../scope/units.js'
import { C, n3, cfmt, deg, facts, zOf, polarText } from './rf.js'
import { drawGrid, drawScales, rCircle, xArc, SCALE_NAMES } from './chart.js'
import { solve, factText, elText, bandText, ohms, dB } from './solve.js'
import { checkExpect } from './expect.js'

const R = 116 // chart radius, px
const MARGIN = 12
const FIELDS = ['z0', 'f', 'admittance', 'scales', 'standards', 'points', 'moves', 'circles', 'sweeps', 'match', 'expect', 'readout', 'highlight']
const POINT_COLORS = ['blue', 'pink', 'amber', 'red', 'teal', 'green']

// Param values for a spec's own steps (steps() gets no env).
const paramDefaults = (spec) => Object.fromEntries(Object.entries(spec.params ?? {}).map(([k, p]) => [k, typeof p === 'number' ? p : p?.value]))

export default {
  kind: 'smith',
  fields: FIELDS,
  collections: ['points', 'moves', 'circles', 'sweeps'],
  // One step per move, so an L-section match or a line rotation is walked one element at a time.
  steps(spec) {
    if (!Array.isArray(spec.moves) || !spec.moves.length) return []
    const s = solve(spec, paramDefaults(spec), new Diag())
    const start = s.moves[0].from
    return [{ label: `${start.id}: z = ${cfmt(start.z)}`, __moves: 0 }, ...s.moves.map((m, k) => ({ label: `${k + 1}. ${m.text}`, __moves: k + 1 }))]
  },
  render(spec, { theme, diag, env, uid }) {
    const S = solve(spec, env, diag)
    const shownMoves = Number.isInteger(spec.__moves) ? S.moves.slice(0, spec.__moves) : S.moves
    const partial = shownMoves.length < S.moves.length
    const hl = new Set(spec.highlight ?? [])
    if (partial && shownMoves.length) hl.add(shownMoves[shownMoves.length - 1].id)
    const fs = theme.size
    const MOVE = color('coral'), SWEEP = color('teal'), CIRC = color('purple'), PASS = color('green'), EMPH = color('amber'), YT = color('blue')
    const ptColor = (p, i) => (p.color ? color(p.color) : color(POINT_COLORS[i % POINT_COLORS.length]))

    // Chart frame and grid.
    const F = { R, cx: 0, cy: 0, P: (g) => [R * g[0], -R * g[1]] }
    let scales = spec.scales ?? []
    if (scales === true) scales = ['wtg', 'angle']
    if (!Array.isArray(scales)) throw new SpecError('scales', `scales is a list from ${SCALE_NAMES.map((s) => `"${s}"`).join(', ')}, or true for ["wtg", "angle"]`)
    for (const [i, s] of scales.entries()) if (!SCALE_NAMES.includes(s)) throw new SpecError(`scales[${i}]`, `scales are ${SCALE_NAMES.join(', ')}`)
    // r labels give way to a point, marker, or standard drawn on top of them.
    const busy = [...S.points.map((p) => p.g), ...shownMoves.map((m) => m.g), ...S.sweeps.flatMap((s) => [s.best.g, ...s.markers.map((m) => m.g)]), ...(spec.standards ? [[0, 0]] : [])].map(F.P)
    const grid = drawGrid(F, theme, { admittance: !!spec.admittance, ytint: YT, busy })
    const sc = drawScales(F, theme, scales, grid.outer + 4)
    const outer = scales.length ? sc.outer + 10 : grid.outer
    const cv = new Canvas()
    cv.ext.push([-outer, -outer], [outer, outer])
    for (const b of grid.boxes) for (let x = b[0]; x <= b[2]; x += 3) for (let y = b[1]; y <= b[3]; y += 3) cv.obs.push([x, y, 2, 'grid'])

    const back = [...grid.back], mid = [], front = [], labels = []
    const scr = (pts) => pts.map(F.P)
    const stroke = (pts, attrs, tag, weight = 1) => { const s = scr(pts); mid.push(el('path', { d: pathD(s), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...attrs })); cv.trace(s, tag, weight) }
    const waiting = []
    // Labels are placed in priority order: points, moves, the end point, sweeps, standards, circles.
    const PRI = { p: 0, m: 1, end: 2, s: 3, std: 4, c: 5 }
    const label = (text, size, fill, cands, pri) => waiting.push({ label: text, size, fill, cands, pri: PRI[pri] })
    const outward = (p) => (Math.hypot(p[0], p[1]) > 4 ? V.unit(p) : V.unit([1, -1]))
    const dot = (g, fill, r = 3.5, tag) => { const p = F.P(g); front.push(el('circle', { cx: p[0], cy: p[1], r, fill, stroke: theme.bg ?? 'none', 'stroke-width': 1 })); cv.trace([[p[0] - r, p[1]], [p[0] + r, p[1]], [p[0], p[1] - r], [p[0], p[1] + r]], tag, 3) }
    const head = (pts, at, fill, size = 8) => {
      // An arrowhead at fraction `at` of the polyline's length, pointing along it.
      const s = scr(pts), lens = [0]
      for (let k = 1; k < s.length; k++) lens.push(lens[k - 1] + Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]))
      const total = lens[lens.length - 1]
      if (total < 6) return
      const want = Math.max(size, total * at)
      const k = Math.max(1, lens.findIndex((l) => l >= want))
      const tip = s[k], back2 = s.slice(0, k).reverse().find((q) => Math.hypot(q[0] - tip[0], q[1] - tip[1]) >= 4) ?? s[0]
      const d = V.unit(V.sub(tip, back2)), n = V.perp(d)
      const a = V.add(V.sub(tip, V.mul(d, size)), V.mul(n, size * 0.45)), b = V.sub(V.sub(tip, V.mul(d, size)), V.mul(n, size * 0.45))
      front.push(el('path', { d: pathD([tip, a, b], true), fill }))
    }
    // Candidate spots along a polyline (fractions of its points), each a ring of 8 around it.
    const along = (pts, fracs, r = 5) => fracs.flatMap((t) => { const p = F.P(pts[Math.round(t * (pts.length - 1))]); return ringCands(p, r, outward(p)).slice(0, 6) })
    const facts1 = [`smith: Z0 ${n3(S.z0)} Ω${S.f ? `, f ${eng(S.f, 'Hz')}` : ''}`]
    const rows = []
    const T = (s) => `\\text{${s}}`

    // Circles: constant |Γ| (with a pass region), and emphasized grid circles. Moves that aim at
    // r = 1 or g = 1 and sweeps with a limit add theirs.
    const circles = [...S.circles]
    for (const m of shownMoves) if ((m.to === 'r=1' || m.to === 'g=1') && !circles.some((c) => c.form === m.to[0] && c.value === 1)) circles.push({ form: m.to[0], value: 1, auto: true })
    for (const s of S.sweeps) if (s.limit && !circles.some((c) => c.mag !== undefined && Math.abs(c.mag - (s.limit - 1) / (s.limit + 1)) < 1e-9)) circles.push({ form: 'vswr', value: s.limit, mag: (s.limit - 1) / (s.limit + 1), pass: true, auto: true, ...facts([(s.limit - 1) / (s.limit + 1), 0]) })
    for (const c of circles) {
      const col = c.color ? color(c.color) : c.pass ? PASS : c.mag !== undefined ? CIRC : EMPH
      if (c.mag !== undefined) {
        const r = c.mag * R
        if (c.pass) back.splice(0, 0, el('circle', { cx: 0, cy: 0, r, fill: col, 'fill-opacity': 0.13 }))
        mid.push(el('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: col, 'stroke-width': 1.4, 'stroke-dasharray': c.pass ? undefined : '5 3' }))
        const ring = Array.from({ length: 73 }, (_, k) => C.polar(c.mag, (k * Math.PI) / 36))
        cv.trace(scr(ring), `c${c.i}`, 0.6)
        const lab = c.label ?? (c.form === 'rl' ? `RL ${n3(c.value)} dB` : c.form === 'gamma' ? `|Γ| ${n3(c.value)}` : `${T('SWR')} ${n3(c.value)}`)
        if (c.mag > 0.02) {
          const cands = [135, 45, -135, -45, 160, 20, -160, -20, 110, 70].map((a) => { const d = [Math.cos((a * Math.PI) / 180), -Math.sin((a * Math.PI) / 180)]; const p = V.mul(d, r); return (w, h) => V.add(p, V.mul(d, 3 + extent(d, w, h))) })
          label(lab, 9.5, col, cands, 'c')
        }
        facts1.push(`circle ${c.form === 'vswr' ? `VSWR ${n3(c.value)}` : c.form === 'rl' ? `RL ${n3(c.value)} dB` : `|Γ| ${n3(c.value)}`}: |Γ| ${n3(c.mag)}, VSWR ${eng(c.vswr)}, RL ${dB(c.rl)}, ML ${dB(c.ml)}${c.pass ? ' (pass region inside)' : ''}`)
        if (!c.auto) rows.push([[c.label ?? `${T('SWR')} ${n3(c.vswr)}`, col, 6], [`|Γ| = ${n3(c.mag)}`, theme.fg], [`${T('RL')} ${dB(c.rl)}`, theme.fg], [`${T('ML')} ${dB(c.ml)}`, theme.muted]])
      } else {
        const pts = c.form === 'r' || c.form === 'g' ? rCircle(c.value, c.form === 'g') : xArc(c.value, c.form === 'b')
        stroke(pts, { stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': c.auto ? '4 3' : undefined, 'stroke-opacity': 0.9 }, `c${c.i}`, 0.4)
        if (!c.auto) {
          const t = c.form === 'r' || c.form === 'g' ? [0.25, 0.75, 0.15, 0.85] : [0.35, 0.6]
          label(c.label ?? `${c.form} = ${n3(c.value)}`, 9.5, col, along(pts, t, 3), 'c')
        }
      }
    }

    // Calibration standards: the open, short, and matched load.
    if (spec.standards) {
      for (const [name, g] of [['open', [1, 0]], ['short', [-1, 0]], ['load', [0, 0]]]) {
        const p = F.P(g)
        front.push(el('rect', { x: p[0] - 3.5, y: p[1] - 3.5, width: 7, height: 7, fill: theme.bg ?? 'none', stroke: theme.fg, 'stroke-width': 1.4 }))
        cv.trace([[p[0] - 4, p[1]], [p[0] + 4, p[1]]], 'std', 3)
        const first = name === 'open' ? [1, 0.6] : name === 'short' ? [-1, 0.6] : [0.5, 1]
        label(T(name), 9.5, theme.fg, ringCands(p, 5, V.unit(first)), 'std')
      }
      facts1.push('standards: open Γ = 1, short Γ = −1, load Γ = 0')
    }

    // Sweeps.
    for (const s of S.sweeps) {
      const col = s.color ? color(s.color) : SWEEP, w = hl.has(s.id) ? 3 : 1.8
      const gs = s.pts.map((p) => p.g)
      stroke(gs, { stroke: col, 'stroke-width': w }, `s${s.i}`)
      if (s.dots) for (const g of gs) { const p = F.P(g); mid.push(el('circle', { cx: p[0], cy: p[1], r: 1.8, fill: col })) }
      for (const b of s.bands) {
        const band = Array.from({ length: 81 }, (_, k) => s.G(b.lo + ((b.hi - b.lo) * k) / 80))
        stroke(band, { stroke: col, 'stroke-width': w + 2.4 }, `s${s.i}`)
        for (const [fq, edge] of [[b.lo, b.fromStart], [b.hi, b.toStop]]) {
          if (edge) continue
          const g = s.G(fq), p = F.P(g), q = F.P(s.G(fq * 1.0005)), d = V.unit(V.perp(V.sub(q, p)))
          mid.push(el('line', { x1: p[0] - d[0] * 6, y1: p[1] - d[1] * 6, x2: p[0] + d[0] * 6, y2: p[1] + d[1] * 6, stroke: theme.fg, 'stroke-width': 1.6 }))
        }
      }
      head(gs, 1, col, 8)
      const fl = (fq) => eng(fq, 'Hz', 3, true)
      label(fl(s.lo), 9.5, col, ringCands(F.P(gs[0]), 5, outward(F.P(gs[0]))), 's')
      label(fl(s.hi), 9.5, col, ringCands(F.P(gs[gs.length - 1]), 7, outward(F.P(gs[gs.length - 1]))), 's')
      const bp = F.P(s.best.g)
      front.push(el('circle', { cx: bp[0], cy: bp[1], r: 5, fill: 'none', stroke: theme.fg, 'stroke-width': 1.5 }))
      cv.trace([[bp[0] - 5, bp[1]], [bp[0] + 5, bp[1]]], `s${s.i}`, 3)
      label(T('best'), 9.5, theme.fg, ringCands(bp, 7, outward(bp)), 's')
      for (const m of s.markers) {
        dot(m.g, theme.fg, 3, `s${s.i}`)
        label(String(m.n), 9.5, theme.fg, ringCands(F.P(m.g), 4, outward(F.P(m.g))), 's')
      }
      rows.push([[s.label ?? 'S_{11}', col, 7], [T(`best ${eng(s.best.f, 'Hz')}`), theme.fg], [`${T('SWR')} ${eng(s.best.vswr)}`, theme.muted], [`${T('RL')} ${dB(s.best.rl)}`, theme.muted]])
      if (s.limit) rows.push([[`${T(`SWR ≤ ${n3(s.limit)}:`)}`, PASS, 6], [s.bands.length ? T(s.bands.map(bandText).join(', ')) : T('nowhere in the sweep'), theme.fg]])
      for (const m of s.markers) rows.push([[String(m.n), theme.fg, 6], [T(eng(m.f, 'Hz')), theme.fg], [`z = ${cfmt(zOf(m.g))}`, theme.fg], [`${T('SWR')} ${eng(m.vswr)}`, theme.muted]])
      const bandsTxt = s.limit ? `; VSWR ≤ ${n3(s.limit)} ${s.bands.length ? `from ${s.bands.map(bandText).join(' and ')}` : 'nowhere in the sweep'}` : ''
      const mk = s.markers.map((m) => `marker ${m.n} ${eng(m.f, 'Hz')}: z ${cfmt(zOf(m.g))}, Γ ${polarText(m.mag, m.ang)}, VSWR ${eng(m.vswr)}, RL ${dB(m.rl)}`)
      facts1.push(`sweep ${s.id} (${s.src}), ${eng(s.lo, 'Hz')} to ${eng(s.hi, 'Hz')}, ${s.pts.length} points: best ${eng(s.best.f, 'Hz')} z ${cfmt(zOf(s.best.g))}, |Γ| ${n3(s.best.mag)}, VSWR ${eng(s.best.vswr)}, RL ${dB(s.best.rl)}${bandsTxt}${mk.length ? `; ${mk.join('; ')}` : ''}`)
    }

    // Points.
    S.points.forEach((p, i) => {
      const col = ptColor(p, i)
      p.col = col
      if (p.showCircle && p.mag > 1e-6) {
        mid.push(el('circle', { cx: 0, cy: 0, r: p.mag * R, fill: 'none', stroke: col, 'stroke-width': 1.3, 'stroke-dasharray': '5 3' }))
        cv.trace(scr(Array.from({ length: 73 }, (_, k) => C.polar(p.mag, (k * Math.PI) / 36))), `p${i}`, 0.6)
      }
    })

    // Moves: arcs with a mid arrowhead, a dot where each ends, and the element's value beside it.
    for (const m of shownMoves) {
      const col = m.color ? color(m.color) : MOVE, w = hl.has(m.id) ? 3.2 : 2.2
      stroke(m.pts, { stroke: col, 'stroke-width': w }, `m${m.k}`)
      head(m.pts, 0.58, col, hl.has(m.id) ? 10 : 8.5)
      label(m.label ?? m.title, 10, col, along(m.pts, [0.5, 0.35, 0.65, 0.2, 0.8]), 'm')
    }
    shownMoves.forEach((m) => dot(m.g, m.color ? color(m.color) : MOVE, 3.2, `m${m.k}`))
    if (shownMoves.length) {
      const last = shownMoves[shownMoves.length - 1]
      label(last.label && !partial ? last.label : `z = ${cfmt(last.z)}`, 10, theme.fg, ringCands(F.P(last.g), 6, outward(F.P(last.g))), 'end')
    }
    S.points.forEach((p, i) => {
      const r = hl.has(p.id) ? 5.5 : 4.5
      dot(p.g, p.col, r, `p${i}`)
      label(p.label, 11, p.col, ringCands(F.P(p.g), r + 2, outward(F.P(p.g))), 'p')
    })

    // Readout rows and summary facts.
    for (const p of S.points) {
      rows.push([[p.label, p.col, 6], [`z = ${cfmt(p.z)}`, theme.fg], [`Γ = ${polarText(p.mag, p.ang)}`, theme.fg], [`${T('SWR')} ${eng(p.vswr)}`, theme.muted]])
      facts1.push(`${p.id}${p.how ? ` (${p.how})` : ''}: ${factText(p, S.z0, { y: true })}`)
    }
    shownMoves.forEach((m, k) => {
      rows.push([[`${k + 1}`, m.color ? color(m.color) : MOVE, 5], [T(m.short), m.color ? color(m.color) : MOVE], [`${T('to')} z = ${cfmt(m.z)}`, theme.fg]])
      facts1.push(`move ${k + 1} ${m.id} (${m.text}) from ${m.from.id}: ${factText(m, S.z0, { y: m.kind === 'shunt' })}`)
    })
    if (partial) facts1.push(`showing ${shownMoves.length} of ${S.moves.length} moves`)
    if (S.match) {
      const { from, f, sols } = S.match
      const solText = sols.map((s, k) => `${k + 1}) ${s.els.length ? s.els.map(elText).join(', then ') : 'nothing (already matched)'}`)
      facts1.push(`L-match ${from.id} (${ohms(from.Z)}) to ${n3(S.z0)} Ω${f ? ` at ${eng(f, 'Hz')}` : ''}, elements from the load out: ${solText.join('; ')}`)
      rows.push([[T(`L-match${f ? ` at ${eng(f, 'Hz')}` : ''}, from the load:`), theme.fg]])
      for (const t of solText) rows.push([[T(t), theme.muted]])
    }
    const ex = checkExpect(spec.expect, S, env, diag)
    if (ex) facts1.push(ex)

    // Labels go where they cover the fewest strokes; each sits on a backing box over the grid.
    for (const q of placeLabels(waiting.sort((a, b) => a.pri - b.pri), cv)) {
      const [x1, y1, x2, y2] = q.box
      labels.push(el('rect', { x: x1, y: y1 + 1, width: x2 - x1, height: y2 - y1 - 2, rx: 2.5, fill: theme.halo, 'fill-opacity': 0.85, class: 'tv-label-bg' }))
      labels.push(labelSvg(q.label, (x1 + x2) / 2, y2 - 4.5, theme, { size: q.size, fill: q.fill }))
    }

    // Fit the canvas to what's drawn, then add the readouts under the chart.
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const width = Math.max(maxX - minX + 2 * MARGIN, 280)
    const dx = (width - (maxX - minX)) / 2 - minX, dy = MARGIN - minY
    const ro = spec.readout === false ? { svg: '', height: 0 } : readouts(rows, MARGIN, maxY + dy + 4, width - 2 * MARGIN, theme, 11)
    const height = maxY + dy + ro.height + MARGIN + (ro.height ? 4 : 0)
    const body = el('g', { transform: `translate(${dx.toFixed(2)},${dy.toFixed(2)})` }, [...back, ...sc.parts, ...mid, ...grid.labels, ...front, ...labels]) + ro.svg
    return { body, width, height, summary: facts1.join('; '), alt: 'Smith chart' }
  },
}
