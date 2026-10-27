// Reads a smith spec into computed facts: each point's Γ, each move's path and end, the circles,
// each sweep's samples, best match, and VSWR band, and the L-match solutions. Drawing is in index.js.

import { SpecError } from '../../diag.js'
import { eng } from '../scope/units.js'
import {
  C, gammaOf, zOf, yOf, facts, magFromVswr, magFromRl, qty, cplx, readModel, MODEL_KEYS,
  lineMove, lumpedMove, componentValue, deltaOf, lMatch, n3, cfmt, polarText, si, LIGHT,
} from './rf.js'

const KEYS = {
  points: ['id', 'label', 'color', 'vswr', 'f', 'Z', 'z', 'Y', 'y', 'gamma', ...MODEL_KEYS],
  moves: ['id', 'from', 'label', 'color', 'line', 'toward', 'vf', 'zc', 'f', 'quarter', 'series', 'shunt', 'value', 'x', 'b', 'to'],
  circles: ['id', 'vswr', 'gamma', 'rl', 'r', 'x', 'g', 'b', 'pass', 'label', 'color'],
  sweeps: ['id', 'label', 'color', 'data', 'unit', 'format', ...MODEL_KEYS, 'start', 'stop', 'center', 'span', 'n', 'line', 'vf', 'limit', 'markers'],
}
const FUNITS = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 }

function list(spec, key) {
  const v = spec[key]
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new SpecError(key, `${key} is a list of objects`)
  v.forEach((o, i) => { if (!o || typeof o !== 'object' || Array.isArray(o)) throw new SpecError(`${key}[${i}]`, `each item of ${key} is an object`) })
  return v
}
function checkKeys(o, key, path, diag) {
  for (const k of Object.keys(o)) if (!KEYS[key].includes(k)) diag.warn(`${path}.${k}`, `a ${key.slice(0, -1)} doesn't use "${k}"; it takes ${KEYS[key].join(', ')}`)
}

/** Facts for a Γ: z, y, Z in ohms, and the reflection numbers. */
export function describe(g, z0) {
  const z = zOf(g), y = yOf(g)
  return { g, z, y, Z: C.scale(z, z0), ...facts(g) }
}
export const ohms = (Z) => (Number.isFinite(Z[0]) ? `${cfmt(Z)} Ω` : '∞ (open)')
/** "z 0.8 + j0.6, Γ 0 + j0.333 = 0.333∠90.0°, VSWR 2.00, RL 9.54 dB, ML 0.512 dB" */
export function factText(d, z0, { y = false } = {}) {
  const out = [`Z ${ohms(d.Z)}`, `z ${cfmt(d.z)}`]
  if (y) out.push(`y ${cfmt(d.y)}`)
  out.push(`Γ ${cfmt(d.g)} = ${polarText(d.mag, d.ang)}`, `VSWR ${eng(d.vswr)}`, `RL ${dB(d.rl)}`, `ML ${dB(d.ml)}`)
  return out.join(', ')
}
/** A loss in dB; a perfect match has infinite return loss. */
export const dB = (v) => (v === Infinity ? '∞ dB' : `${n3(v)} dB`)
/** "series RLC (R 36 Ω, f0 2.45 GHz, Q 8)" or "series R 50, L 10 nH" */
function modelText(m, o) {
  if (m.desc) return `${m.desc.par ? 'parallel' : 'series'} RLC (R ${n3(m.desc.R)} Ω, f0 ${eng(m.desc.f0, 'Hz')}, Q ${n3(m.desc.Q)})`
  const parts = [m.R !== undefined && `R ${n3(m.R)} Ω`, m.L !== undefined && `L ${eng(m.L, 'H')}`, m.C !== undefined && `C ${eng(m.C, 'F')}`].filter(Boolean)
  return `${m.parallel ? 'parallel' : 'series'} ${parts.join(', ')}`
}

export const elName = ({ shunt, kind }) => `${shunt ? 'shunt' : 'series'} ${kind}`
const unitOf = (kind) => (kind === 'L' ? 'H' : 'F')

export function solve(spec, env, diag) {
  const z0 = qty(spec.z0 ?? 50, env, 'z0', ['Ω'])
  if (!(z0 > 0)) throw new SpecError('z0', 'z0 is the reference impedance in ohms, like 50')
  const f = spec.f === undefined ? undefined : qty(spec.f, env, 'f', ['Hz'])
  if (f !== undefined && !(f > 0)) throw new SpecError('f', 'f is a frequency above 0, like "500 MHz"')
  const byId = new Map()
  const own = (o, path) => { if (o.id !== undefined) { if (byId.has(o.id)) diag.warn(`${path}.id`, `id "${o.id}" is used twice`); byId.set(o.id, o) } }

  // Points.
  const points = list(spec, 'points').map((p, i) => {
    const path = `points[${i}]`
    checkKeys(p, 'points', path, diag)
    const forms = ['Z', 'z', 'Y', 'y', 'gamma'].filter((k) => p[k] !== undefined)
    const model = ['R', 'L', 'C', 'f0', 'Q'].some((k) => p[k] !== undefined)
    if (forms.length + (model ? 1 : 0) !== 1) {
      throw new SpecError(path, forms.length + model > 1 ? `give one of ${[...forms, ...(model ? ['the R, L, C model'] : [])].join(', ')}, not several`
        : 'a point needs one of Z: "40 + j30" (Ω), z (normalized), Y (S), y, gamma: [re, im] or {mag, ang}, or a model {R, L, C} at f')
    }
    let g, how
    const pf = p.f === undefined ? f : qty(p.f, env, `${path}.f`, ['Hz'])
    if (forms[0] === 'Z') g = gammaOf(C.scale(cplx(p.Z, env, `${path}.Z`), 1 / z0))
    else if (forms[0] === 'z') g = gammaOf(cplx(p.z, env, `${path}.z`))
    else if (forms[0] === 'Y') g = C.scale(gammaOf(C.scale(cplx(p.Y, env, `${path}.Y`), z0)), -1)
    else if (forms[0] === 'y') g = C.scale(gammaOf(cplx(p.y, env, `${path}.y`)), -1)
    else if (forms[0] === 'gamma') {
      const v = p.gamma
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (v.mag === undefined || v.ang === undefined) throw new SpecError(`${path}.gamma`, 'gamma in polar form is {"mag": 0.5, "ang": 30} (degrees)')
        g = C.polar(qty(v.mag, env, `${path}.gamma.mag`), (qty(v.ang, env, `${path}.gamma.ang`, ['°']) * Math.PI) / 180)
      } else g = cplx(v, env, `${path}.gamma`)
    } else {
      const m = readModel(p, env, path)
      if (m.needsF && pf === undefined) throw new SpecError(`${path}.f`, 'an L or C load needs a frequency: give "f" here or on the chart')
      g = gammaOf(C.scale(m.Z(pf ?? 1), 1 / z0))
      how = `${modelText(m)}${m.needsF ? ` at ${eng(pf, 'Hz')}` : ''}`
    }
    if (C.abs(g) > 1 + 1e-9) diag.warn(path, `|Γ| = ${n3(C.abs(g))} > 1: a negative resistance (an active port) sits outside the chart`)
    const pt = { type: 'point', i, path, id: p.id ?? `P${i + 1}`, label: p.label ?? p.id ?? `P_{${i + 1}}`, color: p.color, showCircle: !!p.vswr, how, ...describe(g, z0) }
    own(pt, path)
    return pt
  })

  // Moves, chained: each starts where the last ended unless "from" names a point or earlier move.
  const moves = []
  let cur = points[0]
  for (const [k, m] of list(spec, 'moves').entries()) {
    const path = `moves[${k}]`
    checkKeys(m, 'moves', path, diag)
    const start = m.from !== undefined ? byId.get(m.from) : cur
    if (m.from !== undefined && !start) throw new SpecError(`${path}.from`, `no point or earlier move "${m.from}"`)
    if (!start) throw new SpecError(path, 'a move starts at a point: add one to "points" first')
    const types = ['line', 'quarter', 'series', 'shunt'].filter((t) => m[t] !== undefined)
    if (types.length !== 1) throw new SpecError(path, 'a move is one of {"line": 0.125}, {"quarter": 70.7}, {"series": "L" | "C", ...}, {"shunt": "L" | "C", ...}')
    const type = types[0]
    const mf = m.f === undefined ? f : qty(m.f, env, `${path}.f`, ['Hz'])
    let res, title, text, short, value, delta, d, extra = {}
    if (type === 'line' || type === 'quarter') {
      const load = (m.toward ?? 'generator') === 'load'
      if (!['generator', 'load'].includes(m.toward ?? 'generator')) throw new SpecError(`${path}.toward`, 'toward is "generator" (default, clockwise) or "load"')
      const vf = m.vf === undefined ? 1 : qty(m.vf, env, `${path}.vf`)
      if (!(vf > 0 && vf <= 1)) throw new SpecError(`${path}.vf`, 'vf is the velocity factor, 0 to 1 (0.66 for solid PE coax)')
      let zc = 1, zt
      if (type === 'quarter') {
        if (m.quarter === true) {
          const Z = start.Z
          if (!Number.isFinite(Z[0]) || Math.abs(Z[1]) > 1e-3 * Math.max(1, Math.abs(Z[0]))) throw new SpecError(`${path}.quarter`, `quarter: true matches a real impedance; this point is ${ohms(Z)}. Move to the real axis first ({"line": true, "to": "max"}) or give Zt in ohms`)
          if (!(Z[0] > 0)) throw new SpecError(`${path}.quarter`, 'a quarter-wave transformer needs R > 0')
          zt = Math.sqrt(z0 * Z[0])
        } else zt = qty(m.quarter, env, `${path}.quarter`, ['Ω'])
        if (!(zt > 0)) throw new SpecError(`${path}.quarter`, 'the transformer impedance is above 0 Ω')
        zc = zt / z0
        d = 0.25
      } else {
        if (m.zc !== undefined) { zt = qty(m.zc, env, `${path}.zc`, ['Ω']); zc = zt / z0 }
        if (m.to !== undefined) {
          if (m.line !== true) throw new SpecError(`${path}.line`, 'with "to", write "line": true (the length is found)')
        } else if (typeof m.line === 'string' && /^\s*[-+−]?[\d.]+(?:e[-+]?\d+)?\s*[pnuµμmck]?m\s*$/i.test(m.line)) {
          const len = qty(m.line, env, `${path}.line`, ['m'])
          if (mf === undefined) throw new SpecError(`${path}.f`, `a line in meters needs a frequency: give "f" here or on the chart`)
          d = len / ((vf * LIGHT) / mf)
          extra.len = len
        } else d = qty(m.line, env, `${path}.line`)
        if (d !== undefined && !(d >= 0)) throw new SpecError(`${path}.line`, 'a line length is 0 or more wavelengths; set "toward": "load" to go the other way')
      }
      res = lineMove(start.g, { d, load, zc, to: m.to }, path)
      d = res.d
      const lam = mf ? (vf * LIGHT) / mf : undefined
      const metres = lam ? ` = ${eng(d * lam, 'm')}${vf !== 1 ? ` at vf ${vf}` : ''}` : ''
      title = type === 'quarter' ? `λ/4, ${n3(zt)} Ω` : `${n3(d)}λ${zc !== 1 ? `, ${n3(zt)} Ω` : ''}`
      text = type === 'quarter' ? `λ/4 transformer ${n3(zt)} Ω${metres}` : `line ${n3(d)}λ${metres}${zc !== 1 ? ` of ${n3(zt)} Ω` : ''}${m.to ? ` to ${m.to}` : ''} toward the ${load ? 'load' : 'generator'}`
      short = type === 'quarter' ? `λ/4 of ${n3(zt)} Ω` : `line ${n3(d)}λ${lam ? ` (${eng(d * lam, 'm')})` : ''}${load ? ' toward the load' : ''}`
      extra = { ...extra, zt }
    } else {
      const shunt = type === 'shunt', kind = m[type]
      if (kind !== 'L' && kind !== 'C') throw new SpecError(`${path}.${type}`, `${type} is "L" or "C"`)
      const el = { shunt, kind }
      const how = ['value', shunt ? 'b' : 'x', 'to'].filter((t) => m[t] !== undefined)
      if (m[shunt ? 'x' : 'b'] !== undefined) throw new SpecError(`${path}.${shunt ? 'x' : 'b'}`, `a ${type} element changes ${shunt ? 'b (susceptance)' : 'x (reactance)'}; write "${shunt ? 'b' : 'x'}"`)
      if (how.length !== 1) throw new SpecError(path, `give the ${type} ${kind} one of "value" ("${kind === 'L' ? '10 nH' : '2 pF'}"), "${shunt ? 'b' : 'x'}" (the normalized change), or "to" ("${shunt ? 'r=1' : 'g=1'}" or "match")`)
      if (how[0] === 'value') {
        value = qty(m.value, env, `${path}.value`, [unitOf(kind)])
        if (!(value > 0)) throw new SpecError(`${path}.value`, 'a component value is above 0')
        if (mf === undefined) throw new SpecError(`${path}.f`, 'a component value needs a frequency: give "f" here or on the chart')
        delta = deltaOf(el, value, mf, z0)
      } else if (how[0] !== 'to') delta = qty(m[how[0]], env, `${path}.${how[0]}`)
      res = lumpedMove(start.g, { shunt, kind, delta, to: m.to }, path, diag)
      delta = res.delta
      if (value === undefined && mf !== undefined && delta) value = componentValue(el, delta, mf, z0)
      const sym = shunt ? 'b' : 'x'
      const v = value !== undefined ? si(value, unitOf(kind)) : `${sym} ${delta > 0 ? '+' : '−'}${n3(Math.abs(delta))}`
      title = `${kind} ${v}`
      text = `${elName(el)} ${v}${value !== undefined ? ` (${sym} ${delta > 0 ? '+' : '−'}${n3(Math.abs(delta))})` : ''}${m.to ? ` to ${m.to}` : ''}`
      short = `${elName(el)} ${v}`
      extra = { el }
    }
    const mv = { type: 'move', kind: type, k, path, id: m.id ?? `m${k + 1}`, label: m.label, color: m.color, from: start, to: m.to, pts: res.pts, title, text, short, value, delta, d, ...extra, ...describe(res.end, z0) }
    own(mv, path)
    moves.push(mv)
    cur = mv
  }

  // Circles: constant |Γ| (vswr, gamma, rl), or a grid circle to emphasize (r, x, g, b).
  const circles = list(spec, 'circles').map((c, i) => {
    const path = `circles[${i}]`
    checkKeys(c, 'circles', path, diag)
    const forms = ['vswr', 'gamma', 'rl', 'r', 'x', 'g', 'b'].filter((k) => c[k] !== undefined)
    if (forms.length !== 1) throw new SpecError(path, 'a circle is one of {"vswr": 2}, {"gamma": 0.333}, {"rl": 10} (dB), or a grid circle {"r": 1}, {"x": 0.5}, {"g": 1}, {"b": -1}')
    const form = forms[0], v = qty(c[form], env, `${path}.${form}`, form === 'rl' ? ['dB'] : [])
    const out = { type: 'circle', i, path, id: c.id, form, value: v, pass: !!c.pass, label: c.label, color: c.color }
    if (['vswr', 'gamma', 'rl'].includes(form)) {
      if (form === 'vswr' && !(v >= 1)) throw new SpecError(`${path}.vswr`, 'VSWR is 1 or more, like 2 for 2:1')
      if (form === 'gamma' && !(v >= 0 && v <= 1)) throw new SpecError(`${path}.gamma`, '|Γ| is 0 to 1')
      out.mag = form === 'vswr' ? magFromVswr(v) : form === 'rl' ? magFromRl(v) : v
      Object.assign(out, facts([out.mag, 0]))
    } else if (out.pass) diag.warn(`${path}.pass`, 'pass shades inside a constant-|Γ| circle (vswr, gamma, or rl)')
    own(out, path)
    return out
  })

  // Sweeps: S11 from data or a load model over a frequency range.
  const sweeps = list(spec, 'sweeps').map((s, i) => readSweep(s, i, { env, z0, diag }))
  for (const s of sweeps) own(s, s.path)

  // The L-section match.
  let match = null
  if (spec.match !== undefined && spec.match !== false) {
    const o = spec.match === true ? {} : spec.match
    if (!o || typeof o !== 'object') throw new SpecError('match', 'match is true (from the first point) or {"from": "ZL", "f": "500 MHz"}')
    const from = o.from !== undefined ? byId.get(o.from) : points[0]
    if (!from || !('z' in from)) throw new SpecError('match.from', o.from !== undefined ? `no point or move "${o.from}"` : 'match needs a point')
    const mf = o.f === undefined ? f : qty(o.f, env, 'match.f', ['Hz'])
    if (!Number.isFinite(from.z[0]) || from.z[0] <= 1e-9) throw new SpecError('match.from', `${from.id} has no resistance (z = ${cfmt(from.z)}); a lossless L-section can't match it`)
    const sols = lMatch(from.z).map((s) => ({ ...s, els: s.els.map((e) => ({ ...e, value: mf ? componentValue(e, e.delta, mf, z0) : undefined })) }))
    match = { from, f: mf, sols }
  }
  return { z0, f, points, moves, circles, sweeps, match, byId }
}

/** "shunt C 1.84 pF" (or "shunt b +0.29" with no frequency). */
export const elText = (e) => `${elName(e)} ${e.value !== undefined ? si(e.value, unitOf(e.kind)) : `${e.shunt ? 'b' : 'x'} ${e.delta > 0 ? '+' : '−'}${n3(Math.abs(e.delta))}`}`

function readSweep(s, i, { env, z0, diag }) {
  const path = `sweeps[${i}]`
  checkKeys(s, 'sweeps', path, diag)
  let raw, samples, src
  const model = ['R', 'L', 'C', 'f0', 'Q'].some((k) => s[k] !== undefined)
  if (s.data !== undefined && model) throw new SpecError(path, 'a sweep is data or a load model, not both')
  if (s.data !== undefined) {
    if (!Array.isArray(s.data) || s.data.length < 2) throw new SpecError(`${path}.data`, 'data is a list of [f, a, b] rows (Touchstone style), at least two')
    const fu = FUNITS[s.unit ?? 'Hz']
    if (!fu) throw new SpecError(`${path}.unit`, 'unit is the frequency column\'s unit: Hz, kHz, MHz, or GHz')
    const fmt = s.format ?? 'ri'
    if (!['ri', 'ma', 'db'].includes(fmt)) throw new SpecError(`${path}.format`, 'format is ri (re, im), ma (|S11|, angle °), or db (dB, angle °)')
    const rows = s.data.map((r, k) => {
      if (!Array.isArray(r) || r.length !== 3) throw new SpecError(`${path}.data[${k}]`, 'a row is [f, a, b]')
      const [fv, a, b] = r.map((v, j) => qty(v, env, `${path}.data[${k}][${j}]`))
      const g = fmt === 'ri' ? [a, b] : C.polar(fmt === 'ma' ? a : 10 ** (a / 20), (b * Math.PI) / 180)
      return { f: fv * fu, g }
    }).sort((p, q) => p.f - q.f)
    raw = (fq) => {
      const k = rows.findIndex((r) => r.f >= fq)
      if (k < 0) return rows[rows.length - 1].g
      if (k === 0) return rows[0].g
      const a = rows[k - 1], b = rows[k], t = (fq - a.f) / (b.f - a.f)
      return C.add(a.g, C.scale(C.sub(b.g, a.g), t))
    }
    samples = rows.map((r) => r.f)
    src = `${rows.length} data points`
  } else if (model) {
    const m = readModel(s, env, path)
    let lo, hi
    if (s.center !== undefined || s.span !== undefined) {
      const c = qty(s.center, env, `${path}.center`, ['Hz']), sp = qty(s.span, env, `${path}.span`, ['Hz'])
      lo = c - sp / 2; hi = c + sp / 2
    } else {
      if (s.start === undefined || s.stop === undefined) throw new SpecError(path, 'a model sweep needs "start" and "stop" (or "center" and "span")')
      lo = qty(s.start, env, `${path}.start`, ['Hz']); hi = qty(s.stop, env, `${path}.stop`, ['Hz'])
    }
    if (!(lo > 0 && hi > lo)) throw new SpecError(path, 'the sweep runs from start > 0 up to stop > start')
    const n = s.n === undefined ? 201 : Math.round(qty(s.n, env, `${path}.n`))
    if (!(n >= 2 && n <= 5001)) throw new SpecError(`${path}.n`, 'n is 2 to 5001 points')
    raw = (fq) => gammaOf(C.scale(m.Z(fq), 1 / z0))
    samples = Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1))
    src = modelText(m)
  } else throw new SpecError(path, 'a sweep needs "data" ([f, re, im] rows) or a load model (R with L and C, or R with f0 and Q) and start, stop')

  // A length of line (a cable to the load) turns Γ by −2βl, more at higher frequencies.
  let rot = () => [1, 0], lineText = ''
  if (s.line !== undefined) {
    const len = qty(s.line, env, `${path}.line`, ['m']), vf = s.vf === undefined ? 1 : qty(s.vf, env, `${path}.vf`)
    if (!(len >= 0) || !(vf > 0 && vf <= 1)) throw new SpecError(`${path}.line`, 'line is a cable length ("1 m") with vf from 0 to 1')
    rot = (fq) => C.polar(1, (-4 * Math.PI * fq * len) / (vf * LIGHT))
    lineText = ` through ${eng(len, 'm')} of line${vf !== 1 ? ` (vf ${vf})` : ''}`
  }
  const G = (fq) => C.mul(raw(fq), rot(fq))
  const pts = samples.map((fq) => ({ f: fq, g: G(fq) }))
  const lo = samples[0], hi = samples[samples.length - 1]
  const mag = (fq) => C.abs(G(fq))

  // Best match: the sample nearest the center, refined between its neighbors for a model.
  let kb = 0
  pts.forEach((p, k) => { if (C.abs(p.g) < C.abs(pts[kb].g)) kb = k })
  let fb = pts[kb].f
  if (model) {
    let a = pts[Math.max(0, kb - 1)].f, b = pts[Math.min(pts.length - 1, kb + 1)].f
    const r = (Math.sqrt(5) - 1) / 2
    for (let it = 0; it < 60; it++) {
      const c = b - r * (b - a), d = a + r * (b - a)
      if (mag(c) < mag(d)) b = d; else a = c
    }
    fb = (a + b) / 2
  }
  const best = { f: fb, g: G(fb), ...facts(G(fb)) }

  // The band inside a VSWR limit: crossings found by bisection on a model, linearly on data.
  let limit, bands = []
  if (s.limit !== undefined) {
    limit = qty(s.limit, env, `${path}.limit`)
    if (!(limit > 1)) throw new SpecError(`${path}.limit`, 'limit is a VSWR above 1, like 2 for 2:1')
    const ml = magFromVswr(limit)
    const cross = (a, b) => {
      if (!model) { const ma = C.abs(a.g) - ml, mb = C.abs(b.g) - ml; return a.f + ((b.f - a.f) * ma) / (ma - mb) }
      let x = a.f, y = b.f
      const sa = mag(x) <= ml
      for (let it = 0; it < 60; it++) { const mid = (x + y) / 2; if ((mag(mid) <= ml) === sa) x = mid; else y = mid }
      return (x + y) / 2
    }
    let open = C.abs(pts[0].g) <= ml ? { lo, fromStart: true } : null
    for (let k = 1; k < pts.length; k++) {
      const was = C.abs(pts[k - 1].g) <= ml, now = C.abs(pts[k].g) <= ml
      if (!was && now) open = { lo: cross(pts[k - 1], pts[k]) }
      if (was && !now && open) { bands.push({ ...open, hi: cross(pts[k - 1], pts[k]) }); open = null }
    }
    if (open) bands.push({ ...open, hi, toStop: true })
  }

  const markers = (s.markers ?? []).map((m, k) => {
    const fq = qty(m, env, `${path}.markers[${k}]`, ['Hz'])
    if (fq < lo || fq > hi) diag.warn(`${path}.markers[${k}]`, `${eng(fq, 'Hz')} is outside the sweep (${eng(lo, 'Hz')} to ${eng(hi, 'Hz')})`)
    return { n: k + 1, f: fq, g: G(fq), ...facts(G(fq)) }
  })
  return { type: 'sweep', i, path, id: s.id ?? `S${i + 1}`, label: s.label, color: s.color, pts, G, lo, hi, best, limit, bands, markers, src: src + lineText, dots: s.data !== undefined && pts.length <= 60 }
}

/** "2.40 to 2.48 GHz (80.0 MHz, 3.3%)" */
export function bandText(b) {
  const w = b.hi - b.lo, c = (b.hi + b.lo) / 2
  return `${eng(b.lo, 'Hz')}${b.fromStart ? ' (start)' : ''} to ${eng(b.hi, 'Hz')}${b.toStop ? ' (stop)' : ''} (${eng(w, 'Hz')}, ${((100 * w) / c).toFixed(1)}%)`
}
