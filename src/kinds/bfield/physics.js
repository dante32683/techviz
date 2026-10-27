// The physics for bfield: amounts with units, the sources read from the spec (problem units, y up,
// z out of the page), B and E at a point of the page by superposition, charged-particle paths,
// and magnetic flux through a flat loop. Long wires give μ₀I/2πr; straight segments the
// closed-form Biot–Savart integral (any orientation in 3D); circular loops the exact off-axis
// field (complete elliptic integrals); solenoids a stack of loops; regions a uniform B and E.

import { SpecError } from '../../diag.js'
import { val, direction, fmt, W, angleOf, pair } from '../field/physics.js'

export { val, fmt, W, angleOf, pair }
export const MU0 = 4e-7 * Math.PI
export const QE = 1.602176634e-19
export const SPECIES = {
  proton: { q: QE, m: 1.67262192e-27, label: 'p^{+}' },
  electron: { q: -QE, m: 9.1093837e-31, label: 'e^{−}' },
  positron: { q: QE, m: 9.1093837e-31, label: 'e^{+}' },
  alpha: { q: 2 * QE, m: 6.6446573e-27, label: '\\alpha' },
  deuteron: { q: QE, m: 3.3435837768e-27, label: 'd^{+}' },
}

/** 3D vectors (x right, y up, z out of the page). */
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
}
const ZERO = [0, 0, 0]

// Units each amount takes, with SI factors; a one-letter prefix (p n u μ m k M G) may come first.
const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, μ: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 }
const UNITS = {
  I: { A: 1 }, B: { T: 1, G: 1e-4 }, E: { 'V/m': 1, 'N/C': 1 }, v: { 'm/s': 1 },
  m: { g: 1e-3, u: 1.6605390666e-27 }, q: { C: 1 }, R: { Ω: 1, ohm: 1, ohms: 1 },
  dBdt: { 'T/s': 1 }, dIdt: { 'A/s': 1 }, dAdt: { 'm^2/s': 1, 'm²/s': 1 },
  omega: { 'rad/s': 1, 'rev/s': 2 * Math.PI, Hz: 2 * Math.PI, rpm: Math.PI / 30 },
}
const EXAMPLE = { I: '2 A', B: '0.5 T', E: '2.4e4 V/m', v: '3e6 m/s', m: '1.67e-27 kg', q: '-1.6e-19 C', R: '10 Ω', dBdt: '2 T/s', dIdt: '5 A/s', dAdt: '0.01 m^2/s', omega: '20 rev/s' }
const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'
const WITH_UNIT = new RegExp(`^(${NUM})\\s*([A-Za-zΩμµ].*)$`)

/** An amount: a number (SI), an expression of params, or a string with its unit ("2 mT", "-e"). */
export function quantity(v, what, env, path) {
  if (typeof v === 'string') {
    const s = v.trim().replace(/−/g, '-')
    if (what === 'q') {
      const e = /^([+-]?)\s*(\d+\.?\d*|\.\d+)?\s*e$/.exec(s)
      if (e) return (e[1] === '-' ? -1 : 1) * (e[2] ? parseFloat(e[2]) : 1) * QE
    }
    const m = WITH_UNIT.exec(s)
    if (m) {
      const n = parseFloat(m[1]), u = m[2].trim(), units = UNITS[what]
      if (units[u] !== undefined) return n * units[u]
      if (PREFIX[u[0]] && units[u.slice(1)] !== undefined) return n * PREFIX[u[0]] * units[u.slice(1)]
      throw new SpecError(path, `this takes ${Object.keys(units).join(', ')} (a prefix like m or μ is fine), like "${EXAMPLE[what]}"; got "${v}"`)
    }
  }
  const x = val(v, env, path)
  if (!Number.isFinite(x)) throw new SpecError(path, `expected a finite number or a string like "${EXAMPLE[what]}"`)
  return x
}

const WORDS = { increasing: 1, decreasing: -1, growing: 1, shrinking: -1 }
/** A rate: an amount, or a word (increasing, decreasing, growing, shrinking) for its sign only. */
export function rate(v, what, env, path) {
  if (typeof v === 'string' && WORDS[v.trim()]) return { value: WORDS[v.trim()], qual: true }
  return { value: quantity(v, what, env, path), qual: false }
}

/** A direction as a 3D unit vector: in, out, up, down, left, right, or degrees in the page. */
export function dir3(d, env, path, { page = true, help } = {}) {
  if (page && d === 'in') return [0, 0, -1]
  if (page && d === 'out') return [0, 0, 1]
  try {
    const u = direction(d, env, path)
    return [u[0], u[1], 0]
  } catch {
    throw new SpecError(path, help ?? `a direction is ${page ? 'in, out, ' : ''}up, down, left, right, or degrees CCW from +x`)
  }
}

/** B (T) at p (3D, m) of a straight segment a→b (3D, m) carrying I: the closed-form Biot–Savart. */
export function segB(a, b, I, p) {
  const r1 = V3.sub(p, a), r2 = V3.sub(p, b), l1 = V3.len(r1), l2 = V3.len(r2)
  const c = V3.cross(r1, r2)
  if (V3.len(c) <= 1e-12 * l1 * l2) return ZERO
  return V3.mul(c, ((MU0 * I) / (4 * Math.PI)) * (l1 + l2) / (l1 * l2 * (l1 * l2 + V3.dot(r1, r2))))
}

/** Complete elliptic integrals K(m) and E(m) (m = k²) by the arithmetic-geometric mean. */
function ellipKE(m) {
  let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m), sum = 0.5 * m, pow = 0.5
  for (let i = 0; i < 40 && c > 1e-15; i++) {
    c = (a - b) / 2
    const an = (a + b) / 2
    b = Math.sqrt(a * b); a = an
    pow *= 2; sum += pow * c * c
  }
  const K = Math.PI / (2 * a)
  return [K, K * (1 - sum)]
}

/** [B along the axis, B radial] of a circular loop (radius R, current I) at axial z, radius rho. */
export function loopB(R, I, z, rho) {
  const s = R * R + rho * rho + z * z, al2 = s - 2 * R * rho, be2 = s + 2 * R * rho, be = Math.sqrt(be2)
  if (al2 <= 1e-10 * R * R) return [0, 0]
  const [K, E] = ellipKE(1 - al2 / be2)
  const C = (MU0 * I) / Math.PI
  const Bz = (C / (2 * al2 * be)) * ((R * R - rho * rho - z * z) * E + al2 * K)
  const Br = rho < 1e-9 * R ? 0 : ((C * z) / (2 * al2 * be * rho)) * (s * E - al2 * K)
  return [Bz, Br]
}

/** An edge-on circular loop's field in the page: center c (m), unit normal n (2D), radius R (m). */
const edgeLoopB = (c, n, R, I, p) => {
  const d = W.sub(p, c), z = W.dot(d, n), rv = W.sub(d, W.mul(n, z)), rho = W.len(rv)
  const [Bz, Br] = loopB(R, I, z, rho)
  const ru = rho > 0 ? W.mul(rv, 1 / rho) : [0, 0]
  return [n[0] * Bz + ru[0] * Br, n[1] * Bz + ru[1] * Br, 0]
}

const TYPES = 'wire, segment, loop, solenoid, cylinder, region'
const len = (v, env, path, what) => {
  const x = val(v, env, path)
  if (!(x > 0)) throw new SpecError(path, `${what} must be a positive length (length units)`)
  return x
}
const SIDE_DIR = { out: 1, in: -1 }

/**
 * Read `sources` (length units for drawing; `lu` is meters per length unit). Each current source
 * has `I` (A), `Bunit(p)` (T per ampere at p in meters, as [x, y, z]), and `through`: the currents
 * crossing the page ({at, I per ampere, r}) for Ampère's law and forces; regions have `inside(p)`
 * (length units), `Bv` and `Ev` (3D, SI), and `dBdt`.
 */
export function readSources(spec, env, lu) {
  const list = spec.sources ?? []
  if (!Array.isArray(list)) throw new SpecError('sources', `sources is a list: {"type": ${TYPES}, ...}`)
  const m = (p) => W.mul(p, lu)
  return list.map((s, i) => {
    const path = `sources[${i}]`
    if (!s || typeof s !== 'object') throw new SpecError(path, 'a source is an object with a type')
    const type = s.type ?? 'wire'
    const src = { i, path, type, id: s.id, label: s.label, color: s.color, through: [], rows: [] }
    if (type === 'region') return readRegion(s, src, env, path)
    if (!['wire', 'segment', 'loop', 'solenoid', 'cylinder'].includes(type)) throw new SpecError(`${path}.type`, `type is one of ${TYPES}`)
    if (s.I === undefined) throw new SpecError(`${path}.I`, `a ${type} needs I, its current, like "2 A"`)
    src.I = quantity(s.I, 'I', env, `${path}.I`)
    if (s.dIdt !== undefined) src.dIdt = rate(s.dIdt, 'dIdt', env, `${path}.dIdt`)
    if (type === 'wire' || type === 'cylinder') {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      const sign = SIDE_DIR[s.dir ?? 'out']
      if (!sign) throw new SpecError(`${path}.dir`, `a ${type} through the page runs out (⊙, default) or in (⊗)`)
      src.sign = sign
      src.r = type === 'cylinder' ? len(s.r, env, `${path}.r`, 'r (the wire radius)') : 0
      const c = m(src.at), a2 = (src.r * lu) ** 2
      src.Bunit = (p) => {
        const rx = p[0] - c[0], ry = p[1] - c[1], r2 = rx * rx + ry * ry
        if (r2 < 1e-30) return ZERO
        const k = (sign * MU0) / (2 * Math.PI) / (r2 < a2 ? a2 : r2)
        return [-k * ry, k * rx, 0]
      }
      src.through.push({ at: src.at, I: sign, r: src.r })
    } else if (type === 'segment') {
      src.a = pair(s.from, env, `${path}.from`); src.b = pair(s.to, env, `${path}.to`)
      src.L = W.len(W.sub(src.b, src.a))
      if (!(src.L > 0)) throw new SpecError(`${path}.to`, 'a segment needs two different ends')
      src.u = W.unit(W.sub(src.b, src.a)); src.infinite = !!s.infinite
      const A = m(src.a), B = m(src.b), n = W.perp(src.u)
      src.Bunit = src.infinite
        ? (p) => { const h = W.dot(W.sub(p, A), n); return Math.abs(h) < 1e-15 ? ZERO : [0, 0, MU0 / (2 * Math.PI * h)] }
        : (p) => segB([A[0], A[1], 0], [B[0], B[1], 0], 1, [p[0], p[1], 0])
    } else if (type === 'loop') {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      src.N = s.N === undefined ? 1 : val(s.N, env, `${path}.N`)
      if (s.r !== undefined) { src.shape = 'circle'; src.r = len(s.r, env, `${path}.r`, 'r (the loop radius)'); src.A = Math.PI * src.r ** 2 }
      else if (s.w !== undefined && s.h !== undefined) { src.shape = 'rect'; src.w = len(s.w, env, `${path}.w`, 'w'); src.h = len(s.h, env, `${path}.h`, 'h'); src.A = src.w * src.h }
      else throw new SpecError(path, 'a loop needs r (circular) or w and h (rectangular), in length units')
      const c = m(src.at), N = src.N
      if (s.normal !== undefined) {
        // Edge-on: the loop's plane holds the page normal z and t = n rotated +90°; current runs
        // out of the page (⊙) at the +t end and into it (⊗) at the −t end, so μ points along n.
        const n2 = direction(s.normal, env, `${path}.normal`), t = W.perp(n2)
        src.edge = true; src.n = n2; src.t = t
        const half = src.shape === 'circle' ? src.r : src.w / 2
        src.ends = [W.add(src.at, W.mul(t, half)), W.sub(src.at, W.mul(t, half))]
        src.through.push({ at: src.ends[0], I: N }, { at: src.ends[1], I: -N })
        if (src.shape === 'circle') src.Bunit = (p) => edgeLoopB(c, n2, src.r * lu, N, p)
        else {
          const hw = (src.w * lu) / 2, hd = (src.h * lu) / 2
          const P3 = (k, z) => [c[0] + t[0] * k, c[1] + t[1] * k, z]
          const cs = [P3(hw, -hd), P3(hw, hd), P3(-hw, hd), P3(-hw, -hd)]
          src.Bunit = (p) => cs.reduce((acc, a, k) => V3.add(acc, segB(a, cs[(k + 1) % 4], N, [p[0], p[1], 0])), ZERO)
        }
      } else {
        const sign = { ccw: 1, cw: -1 }[s.dir ?? 'ccw']
        if (!sign) throw new SpecError(`${path}.dir`, 'a face-on loop circulates ccw (default) or cw as seen from +z (out of the page)')
        src.sign = sign
        if (src.shape === 'circle') src.Bunit = (p) => [0, 0, sign * loopB(src.r * lu, N, 0, W.len(W.sub(p, c)))[0]]
        else {
          const hw = (src.w * lu) / 2, hh = (src.h * lu) / 2
          const cs = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [c[0] + x, c[1] + y, 0])
          src.Bunit = (p) => cs.reduce((acc, a, k) => V3.add(acc, segB(a, cs[(k + 1) % 4], sign * N, [p[0], p[1], 0])), ZERO)
        }
      }
    } else {
      src.at = pair(s.at ?? [0, 0], env, `${path}.at`)
      src.length = len(s.length, env, `${path}.length`, 'length (along the axis)')
      src.r = len(s.r, env, `${path}.r`, 'r (the winding radius)')
      if (s.N !== undefined) src.N = val(s.N, env, `${path}.N`)
      else if (s.n !== undefined) src.N = val(s.n, env, `${path}.n`) * src.length * lu
      else throw new SpecError(`${path}.N`, 'a solenoid needs N (turns) or n (turns per meter)')
      if (!(src.N > 0)) throw new SpecError(`${path}.N`, 'N must be positive')
      src.n2 = direction(s.dir ?? 'right', env, `${path}.dir`); src.t = W.perp(src.n2)
      // Rows of windings where the cut crosses them: ⊙ on the +t side, ⊗ on the −t side.
      const half = W.mul(src.n2, src.length / 2)
      for (const [k, sign] of [[1, 1], [-1, -1]]) {
        const o = W.add(src.at, W.mul(src.t, k * src.r))
        src.rows.push({ a: W.sub(o, half), b: W.add(o, half), I: (sign * src.N) / src.length })
      }
      const M = Math.max(1, Math.min(120, Math.round(src.N))), c = m(src.at)
      src.M = M
      const centers = Array.from({ length: M }, (_, k) => W.add(c, W.mul(src.n2, (src.length * lu * ((k + 0.5) / M - 0.5)))))
      src.Bunit = (p) => centers.reduce((acc, q) => V3.add(acc, edgeLoopB(q, src.n2, src.r * lu, src.N / M, p)), ZERO)
    }
    return src
  })
}

function readRegion(s, src, env, path) {
  if (s.box !== undefined) {
    const b = s.box
    if (!Array.isArray(b) || b.length !== 2) throw new SpecError(`${path}.box`, 'box is [[x0, y0], [x1, y1]], two opposite corners in length units')
    const p = pair(b[0], env, `${path}.box[0]`), q = pair(b[1], env, `${path}.box[1]`)
    src.box = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]
    if (!(src.box[2] > src.box[0] && src.box[3] > src.box[1])) throw new SpecError(`${path}.box`, 'the box needs width and height')
    src.inside = (p) => p[0] >= src.box[0] && p[0] <= src.box[2] && p[1] >= src.box[1] && p[1] <= src.box[3]
  } else if (s.circle !== undefined) {
    const c = s.circle
    if (!c || typeof c !== 'object') throw new SpecError(`${path}.circle`, 'circle is {"at": [x, y], "r": radius}')
    src.circle = { at: pair(c.at ?? [0, 0], env, `${path}.circle.at`), r: len(c.r, env, `${path}.circle.r`, 'r') }
    src.inside = (p) => W.len(W.sub(p, src.circle.at)) <= src.circle.r
  } else src.inside = () => true
  src.Bv = ZERO; src.Ev = ZERO
  if (s.B !== undefined) {
    if (s.dir === undefined) throw new SpecError(`${path}.dir`, 'a region with B needs dir: in, out, up, down, left, right, or degrees')
    src.Bmag = quantity(s.B, 'B', env, `${path}.B`)
    src.Bdir = dir3(s.dir, env, `${path}.dir`)
    src.Bv = V3.mul(src.Bdir, src.Bmag)
    if (s.dBdt !== undefined) src.dBdt = rate(s.dBdt, 'dBdt', env, `${path}.dBdt`)
  }
  if (s.E !== undefined) {
    if (!src.box) throw new SpecError(`${path}.E`, 'E needs a box region (it is drawn between plates on two of its sides)')
    const d = dir3(s.Edir ?? 'up', env, `${path}.Edir`, { page: false })
    if (Math.abs(d[0]) > 1e-9 && Math.abs(d[1]) > 1e-9) throw new SpecError(`${path}.Edir`, 'Edir is up, down, left, or right (the plates lie along the box sides)')
    src.Emag = quantity(s.E, 'E', env, `${path}.E`); src.Edir = d.map(Math.round)
    src.Ev = V3.mul(src.Edir, src.Emag)
  }
  if (s.B === undefined && s.E === undefined) throw new SpecError(path, 'a region needs B (with dir) or E (with Edir), or both')
  return src
}

/** The total fields: B(p) and E(p) at p in meters; `which` filters the sources. */
export function fields(sources, lu) {
  const B = (p, which = () => true) => {
    let b = ZERO
    for (const s of sources) {
      if (!which(s)) continue
      if (s.type === 'region') { if (V3.len(s.Bv) && s.inside([p[0] / lu, p[1] / lu])) b = V3.add(b, s.Bv) }
      else b = V3.add(b, V3.mul(s.Bunit(p), s.I))
    }
    return b
  }
  const E = (p) => {
    let e = ZERO
    for (const s of sources) if (s.type === 'region' && V3.len(s.Ev) && s.inside([p[0] / lu, p[1] / lu])) e = V3.add(e, s.Ev)
    return e
  }
  return { B, E }
}

/**
 * A charged particle's path by the Boris push (exact |v| in pure B). Starts at p0 (3D, m) with
 * v0; stops on leaving `bounds` [x0, x1, y0, y1] (m), on closing a loop, after `maxT`, or a `tail`
 * distance after leaving every field. Returns points, velocities, times, entry and exit indices.
 */
export function trace(p0, v0, q, m, F, { dt, maxT, bounds, tail }) {
  let x = p0, v = v0
  const pts = [x], vel = [v], ts = [0]
  const h = (q * dt) / (2 * m)
  const live = (p) => V3.len(F.B(p)) > 0 || V3.len(F.E(p)) > 0
  let entry = live(p0) ? 0 : -1, exit = -1, closed = false, out = 0
  const steps = Math.min(200000, Math.ceil(maxT / dt))
  for (let k = 1; k <= steps; k++) {
    const E = F.E(x), B = F.B(x)
    const vm = V3.add(v, V3.mul(E, h)), t = V3.mul(B, h), sc = 2 / (1 + V3.dot(t, t))
    const vp = V3.add(vm, V3.cross(vm, t))
    v = V3.add(V3.add(vm, V3.cross(vp, V3.mul(t, sc))), V3.mul(E, h))
    x = V3.add(x, V3.mul(v, dt))
    pts.push(x); vel.push(v); ts.push(k * dt)
    const on = live(x)
    if (on && entry < 0) entry = k
    if (!on && entry >= 0 && exit < 0) exit = k
    if (exit >= 0) { out += V3.len(v) * dt; if (out >= tail) break }
    if (x[0] < bounds[0] || x[0] > bounds[1] || x[1] < bounds[2] || x[1] > bounds[3]) break
    // Closed: back at the start, heading the same way, after a good part of a turn.
    if (k > 20 && V3.len(V3.sub(x, p0)) < 1.5 * V3.len(v) * dt && V3.dot(v, v0) > 0.999 * V3.len(v) * V3.len(v0)) { closed = true; break }
  }
  return { pts, vel, ts, entry, exit, closed }
}

/** Area (length units²) of a loop shape ({circle: [c, r]} or {rect: [x0, y0, x1, y1]}) inside a region. */
export function overlap(shape, region) {
  const area = shape.rect ? (shape.rect[2] - shape.rect[0]) * (shape.rect[3] - shape.rect[1]) : Math.PI * shape.circle[1] ** 2
  if (region.box && shape.rect) {
    const [a, b] = [shape.rect, region.box]
    return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  }
  if (region.circle && shape.circle) {
    const [c1, r1] = shape.circle, c2 = region.circle.at, r2 = region.circle.r, d = W.len(W.sub(c1, c2))
    if (d >= r1 + r2) return 0
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2
    return r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) + r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)) -
      0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2))
  }
  if (!region.box && !region.circle) return area
  // A circle and a box: integrate the chord inside the box across x (Simpson).
  const [c, r] = shape.circle ?? [region.circle.at, region.circle.r]
  const bx = shape.rect ?? region.box
  const x0 = Math.max(c[0] - r, bx[0]), x1 = Math.min(c[0] + r, bx[2])
  if (!(x1 > x0)) return 0
  const f = (x) => { const h = Math.sqrt(Math.max(0, r * r - (x - c[0]) ** 2)); return Math.max(0, Math.min(c[1] + h, bx[3]) - Math.max(c[1] - h, bx[1])) }
  const n = 400, dx = (x1 - x0) / n
  let s = f(x0) + f(x1)
  for (let k = 1; k < n; k++) s += f(x0 + k * dx) * (k % 2 ? 4 : 2)
  return (s * dx) / 3
}

/**
 * Flux (Wb, one turn) through a flat loop shape (length units) with unit normal `nrm` (3D), and
 * the flux per unit of each source's own rate (per T of a region's B, per A of a current).
 */
export function flux(shape, nrm, sources, lu) {
  const per = new Map()
  let total = 0
  // Sample points (m) with their areas (m²) for the current sources' fields.
  const samples = []
  if (shape.rect) {
    const [x0, y0, x1, y1] = shape.rect, n = 48, dx = (x1 - x0) / n, dy = (y1 - y0) / n
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) samples.push([[(x0 + (i + 0.5) * dx) * lu, (y0 + (j + 0.5) * dy) * lu], dx * dy * lu * lu])
  } else {
    const [c, r] = shape.circle, nr = 40, na = 72, dr = r / nr
    for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
      const rr = (i + 0.5) * dr, a = (2 * Math.PI * (j + 0.5)) / na
      samples.push([[(c[0] + rr * Math.cos(a)) * lu, (c[1] + rr * Math.sin(a)) * lu], rr * dr * ((2 * Math.PI) / na) * lu * lu])
    }
  }
  for (const s of sources) {
    let unit
    if (s.type === 'region') { if (!s.Bdir) continue; unit = V3.dot(s.Bdir, nrm) * overlap(shape, s) * lu * lu; total += unit * s.Bmag }
    else { unit = 0; for (const [p, dA] of samples) unit += V3.dot(s.Bunit(p), nrm) * dA; total += unit * s.I }
    per.set(s, unit)
  }
  return { total, per }
}
