// Transfer functions for Bode plots: from a divider (factored from its polynomials in s) or
// from poles and zeros, as Bode factors K (jω)^m ∏(1 + jω/ωz) / ∏(1 + jω/ωp) with complex
// pairs (1 + 2ζ jω/ω0 + (jω/ω0)²). Gives the exact response, the straight-line asymptotes,
// and the −3 dB points.

import { SpecError } from '../../diag.js'
import { cx, add, mul, div, abs, arg, roots, pmul, padd } from './complex.js'
import { amount, freq } from './units.js'
import { zS, zAt } from './circuit.js'

const TAU = 2 * Math.PI

/** Factors from roots of num and den (common roots cancel). */
function factor(num, den) {
  const rz = roots(num), rp = roots(den)
  const close = (a, b) => abs(cx(a.re - b.re, a.im - b.im)) <= 1e-6 * Math.max(abs(a), abs(b), 1e-300)
  for (let i = rz.length - 1; i >= 0; i--) {
    const j = rp.findIndex((p) => close(p, rz[i]))
    if (j >= 0 && abs(rz[i])) { rz.splice(i, 1); rp.splice(j, 1) }
  }
  const lowest = (p) => p.find((c) => c !== 0)
  const m = rz.filter((r) => !abs(r)).length - rp.filter((r) => !abs(r)).length
  const K = lowest(num) / lowest(den)
  const fac = []
  const take = (rs, zero) => {
    const used = new Set()
    rs.forEach((r, i) => {
      if (!abs(r) || used.has(i)) return
      if (r.im === 0) { fac.push({ pair: false, w: Math.abs(r.re), zero, rhp: r.re > 0 }); return }
      const j = rs.findIndex((q, k) => k !== i && !used.has(k) && Math.abs(q.re - r.re) <= 1e-6 * abs(r) && Math.abs(q.im + r.im) <= 1e-6 * abs(r))
      used.add(i); if (j >= 0) used.add(j)
      fac.push({ pair: true, w: abs(r), zeta: -r.re / abs(r), zero })
    })
  }
  take(rz, true); take(rp, false)
  return { K, m, fac: fac.sort((a, b) => a.w - b.w) }
}

/** The divider's H(s) = Z_out / (Z_out + Z_rest) as Bode factors, and its exact response. */
export function fromDivider(div0, P) {
  const o = zS(div0.out, P), r = zS(div0.rest, P)
  const num = pmul(o.num, r.den)
  const den = padd(num, pmul(r.num, o.den))
  const tf = factor(num, den)
  tf.H = (f) => { const w = TAU * f, zo = zAt(div0.out, P, w); return div(zo, add(zo, zAt(div0.rest, P, w))) }
  return tf
}

/** Poles and zeros in Hz (0 = at the origin; {f, Q} or {f, zeta} = a complex pair) and gain K. */
export function fromPoles(spec, env, diag) {
  const fac = []
  let m = 0
  for (const [key, zero] of [['zeros', true], ['poles', false]]) {
    const list = spec[key] ?? []
    if (!Array.isArray(list)) throw new SpecError(key, `${key} is a list of frequencies, like ["1 kHz", 0, {"f": "10 kHz", "Q": 2}]`)
    list.forEach((p, i) => {
      const path = `${key}[${i}]`
      if (p && typeof p === 'object') {
        const w = TAU * freq(p.f, env, `${path}.f`, diag)
        const zeta = p.zeta !== undefined ? amount(p.zeta, env, `${path}.zeta`)[0] : p.Q !== undefined ? 1 / (2 * amount(p.Q, env, `${path}.Q`)[0]) : null
        if (zeta === null || !(zeta >= 0)) throw new SpecError(path, 'a complex pair is {"f": "1 kHz", "Q": 5} or {"f": ..., "zeta": 0.1}')
        fac.push({ pair: true, w, zeta, zero })
      } else if (amount(p, env, path)[0] === 0) m += zero ? 1 : -1
      else fac.push({ pair: false, w: TAU * freq(p, env, path, diag), zero, rhp: false })
    })
  }
  if (!fac.length && !m) throw new SpecError('poles', 'a Bode plot needs out (a divider) or poles and zeros')
  let K = 1
  if (spec.gain !== undefined) {
    const [g, u] = amount(spec.gain, env, 'gain')
    K = u === 'dB' ? 10 ** (g / 20) : g
  }
  const tf = { K, m, fac: fac.sort((a, b) => a.w - b.w) }
  tf.H = (f) => evalFactors(tf, f)
  return tf
}

function term(F, w) {
  const u = w / F.w
  const t = F.pair ? cx(1 - u * u, 2 * F.zeta * u) : cx(1, F.rhp ? -u : u)
  return t
}
/** H(jω) from the factors (used to check the factoring). */
export function evalFactors(tf, f) {
  const w = TAU * f
  let h = cx(tf.K)
  for (let k = 0; k < Math.abs(tf.m); k++) h = tf.m > 0 ? mul(h, cx(0, w)) : div(h, cx(0, w))
  for (const F of tf.fac) h = F.zero ? mul(h, term(F, w)) : div(h, term(F, w))
  return h
}

/** Straight-line magnitude (dB) at f. */
export function asymMag(tf, f) {
  const w = TAU * f
  let db = 20 * Math.log10(Math.abs(tf.K)) + 20 * tf.m * Math.log10(w)
  for (const F of tf.fac) if (w > F.w) db += (F.zero ? 1 : -1) * (F.pair ? 40 : 20) * Math.log10(w / F.w)
  return db
}

/** Straight-line phase (°) at f: a real corner ramps ±90° over ω/10 to 10ω; a pair ±180° over ω0/4.81^ζ to ω0·4.81^ζ. */
export function asymPhase(tf, f) {
  const w = TAU * f
  let ph = 90 * tf.m + (tf.K < 0 ? 180 : 0)
  for (const F of tf.fac) {
    const sgn = (F.zero ? 1 : -1) * (F.rhp ? -1 : 1)
    if (F.pair) {
      const k = Math.max(4.81 ** Math.abs(F.zeta), 1.0001), a = Math.log10(F.w / k), b = Math.log10(F.w * k)
      ph += sgn * Math.sign(F.zeta || 1) * 180 * Math.min(1, Math.max(0, (Math.log10(w) - a) / (b - a)))
    } else ph += sgn * 90 * Math.min(1, Math.max(0, (Math.log10(w / F.w) + 1) / 2))
  }
  return ph
}

/** Breakpoints of the asymptotes inside [lo, hi] (Hz), with the ends. */
export function breaks(tf, lo, hi, phase) {
  const out = [lo, hi]
  for (const F of tf.fac) {
    const f = F.w / TAU
    if (!phase) out.push(f)
    else if (F.pair) { const k = Math.max(4.81 ** Math.abs(F.zeta), 1.0001); out.push(f / k, f * k) }
    else out.push(f / 10, f * 10)
  }
  return [...new Set(out.filter((f) => f >= lo && f <= hi))].sort((a, b) => a - b)
}

/** Exact |H| in dB and unwrapped phase on n log-spaced points, the phase aligned with the asymptote. */
export function sweep(tf, lo, hi, n = 480) {
  const pts = []
  let prev = null, shift = 0
  for (let k = 0; k <= n; k++) {
    const f = lo * (hi / lo) ** (k / n)
    const h = tf.H(f)
    let ph = arg(h)
    if (prev === null) shift = 360 * Math.round((asymPhase(tf, f) - ph) / 360)
    else { while (ph + shift - prev > 180) shift -= 360; while (ph + shift - prev < -180) shift += 360 }
    ph += shift
    prev = ph
    pts.push({ f, db: 20 * Math.log10(abs(h)), ph })
  }
  return pts
}

/** Frequencies where |H| is 3.01 dB under its largest value in [lo, hi], refined by bisection. */
export function minus3(tf, pts) {
  const top = Math.max(...pts.map((p) => p.db).filter(Number.isFinite))
  const lvl = top - 10 * Math.log10(2)
  const g = (f) => 20 * Math.log10(abs(tf.H(f))) - lvl
  const out = []
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k]
    if (!Number.isFinite(a.db) || !Number.isFinite(b.db) || (a.db - lvl) * (b.db - lvl) > 0 || a.db === b.db) continue
    let x = Math.log10(a.f), y = Math.log10(b.f)
    for (let it = 0; it < 60; it++) { const mid = (x + y) / 2; if (g(10 ** x) * g(10 ** mid) <= 0) y = mid; else x = mid }
    const f = 10 ** ((x + y) / 2)
    if (!out.length || f / out[out.length - 1] > 1.0001) out.push(f)
  }
  return { top, lvl, f: out }
}
