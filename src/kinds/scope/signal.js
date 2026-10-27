// Signal terms: each becomes a function of time (s) in volts at the probe tip, with what is
// known about it in closed form (its mean, highest frequency, fundamental). Noise terms are
// kept apart and added per sample at acquisition.

import { compileFor } from '../../expr.js'
import { SpecError } from '../../diag.js'
import { qty } from './units.js'

const TYPES = ['sine', 'square', 'triangle', 'pulse', 'rc', 'ring', 'am', 'fm', 'noise', 'dc']
const TAU = 2 * Math.PI
const frac = (x) => x - Math.floor(x)

/** A 0-to-1 square: rising edge at t = 0, falling at d/f, linear edges 2h long centered on each. */
function sq01(t, f, d, h) {
  const T = 1 / f
  const x = ((((t + h) % T) + T) % T) - h
  const ramp = (y) => (h > 0 ? Math.min(1, Math.max(0, (y + h) / (2 * h))) : y >= 0 ? 1 : 0)
  return ramp(x) - ramp(x - d * T)
}

function term(tm, env, path, diag) {
  if (!tm || typeof tm !== 'object' || Array.isArray(tm)) throw new SpecError(path, 'a signal term is an object like {"type": "sine", "f": "1 kHz", "vpp": 4}')
  const q = (k, want, dflt) => (tm[k] === undefined ? dflt : qty(tm[k], env, `${path}.${k}`, want, diag))
  const offset = q('offset', ['V'], 0)
  if (tm.expr !== undefined) {
    let c
    try { c = compileFor(String(tm.expr), [...Object.keys(env), 't']) } catch (err) { throw new SpecError(`${path}.expr`, err.message) }
    const scope = { ...env }
    return { fn: (t) => { scope.t = t; return c.fn(scope) + offset }, mean: null, fmax: null, f: tm.f === undefined ? null : q('f', ['Hz']), desc: 'expr' }
  }
  if (tm.points !== undefined) {
    if (!Array.isArray(tm.points) || tm.points.length < 2) throw new SpecError(`${path}.points`, 'points is a list of at least two [t, v] pairs (t in s, v in V)')
    const pts = tm.points.map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2) throw new SpecError(`${path}.points[${i}]`, 'each point is [t, v]')
      return [qty(p[0], env, `${path}.points[${i}][0]`, ['s']), qty(p[1], env, `${path}.points[${i}][1]`, ['V'])]
    }).sort((a, b) => a[0] - b[0])
    const period = tm.period === undefined ? null : q('period', ['s'])
    const t0 = pts[0][0], span = pts[pts.length - 1][0] - t0
    const at = (t) => {
      if (period) t = t0 + ((((t - t0) % period) + period) % period)
      if (t <= pts[0][0]) return pts[0][1]
      if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
      let lo = 0, hi = pts.length - 1
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid }
      const [ta, va] = pts[lo], [tb, vb] = pts[hi]
      return tb === ta ? vb : va + ((vb - va) * (t - ta)) / (tb - ta)
    }
    return { fn: (t) => at(t) + offset, mean: null, fmax: null, f: period ? 1 / period : null, desc: `${pts.length} points${period ? '' : ` over ${span} s`}` }
  }
  const type = tm.type
  if (!TYPES.includes(type)) throw new SpecError(`${path}.type`, `type is one of ${TYPES.join(', ')}; or give "expr" (in t, seconds) or "points"`)
  if (type === 'noise') return { noise: { rms: q('rms', ['V'], 0.01), seed: tm.seed ?? 1 }, fn: () => 0, mean: 0, fmax: 0, f: null, desc: 'noise' }
  if (type === 'dc') { const v = q('v', ['V'], 0) + offset; return { fn: () => v, mean: v, fmax: 0, f: null, desc: 'dc' } }
  if (tm.f === undefined) throw new SpecError(`${path}.f`, `a ${type} needs its frequency f, like "1 kHz"`)
  const f = q('f', ['Hz'])
  if (!(f > 0)) throw new SpecError(`${path}.f`, 'f must be above 0')
  const amp = tm.amp !== undefined ? q('amp', ['V']) : tm.vpp !== undefined ? q('vpp', ['V']) / 2 : 1
  const ph = q('phase', ['deg', '°'], 0) / 360
  const tp = (t) => t + ph / f // phase as a time shift: positive leads
  const T = 1 / f
  const duty = q('duty', ['%'], 0.5)
  const rise = q('rise', ['s'], 0)
  const h = rise / 0.8 / 2 // a linear edge 0-100% in rise/0.8 has 10-90% in rise
  if (rise && rise / 0.8 > Math.min(duty, 1 - duty) * T) diag?.warn(`${path}.rise`, `the edges (${rise} s) are longer than a half period; lower rise or f`)
  switch (type) {
    case 'sine': return { fn: (t) => offset + amp * Math.sin(TAU * f * tp(t)), mean: offset, fmax: f, f, desc: 'sine' }
    case 'triangle': return { fn: (t) => offset + amp * (1 - 4 * Math.abs(frac(f * tp(t) + 0.25) - 0.5)), mean: offset, fmax: f, f, desc: 'triangle' }
    case 'square': return { fn: (t) => offset + amp * (2 * sq01(tp(t), f, duty, h) - 1), mean: offset + amp * (2 * duty - 1), fmax: f, f, rise, desc: 'square' }
    case 'pulse': {
      if (tm.width === undefined) throw new SpecError(`${path}.width`, 'a pulse needs its width, like "100 ns"')
      const d = q('width', ['s']) * f
      if (!(d > 0 && d < 1)) throw new SpecError(`${path}.width`, 'the width must be shorter than the period 1/f')
      const vpp = 2 * amp
      return { fn: (t) => offset + vpp * sq01(tp(t), f, d, h), mean: offset + vpp * d, fmax: f, f, rise, desc: 'pulse' }
    }
    case 'rc': {
      // A ±amp square through a series RC, in steady state: v_C charges and discharges toward
      // each level; across R it is v_in − v_C, the spikes at each edge.
      const tau = q('tau', ['s'])
      if (!(tau > 0)) throw new SpecError(`${path}.tau`, 'tau = RC must be above 0, like "100 us"')
      const T1 = duty * T, a = Math.exp(-T1 / tau), b = Math.exp(-(T - T1) / tau)
      const lo = (amp * (-1 + 2 * b - a * b)) / (1 - a * b), hi = amp + (lo - amp) * a
      const acrossR = tm.across === 'R'
      if (tm.across !== undefined && !['C', 'R'].includes(tm.across)) diag?.warn(`${path}.across`, 'across is "C" (default) or "R"')
      const fn = (t) => {
        const x = frac(f * tp(t)) * T
        const vin = x < T1 ? amp : -amp
        const vc = x < T1 ? amp + (lo - amp) * Math.exp(-x / tau) : -amp + (hi + amp) * Math.exp(-(x - T1) / tau)
        return offset + (acrossR ? vin - vc : vc)
      }
      return { fn, mean: offset + (acrossR ? 0 : amp * (2 * duty - 1)), fmax: f, f, tau, desc: acrossR ? 'rc (R)' : 'rc (C)' }
    }
    case 'ring': {
      // A ±amp square through a second-order low-pass ringing at fr (damped), superposed over past edges.
      const fr = q('fr', ['Hz'], 10 * f), zeta = q('zeta', [], 0.1)
      if (!(zeta > 0 && zeta < 1)) throw new SpecError(`${path}.zeta`, 'zeta (damping) is between 0 and 1 for ringing')
      const wd = TAU * fr, sigma = (zeta * wd) / Math.sqrt(1 - zeta * zeta)
      const g = (x) => Math.exp(-sigma * x) * (Math.cos(wd * x) + (sigma / wd) * Math.sin(wd * x)) // 1 − step response
      const J = Math.min(400, Math.ceil(14 / (sigma * T)) + 1), T1 = duty * T
      const fn = (t) => {
        const x = frac(f * tp(t)) * T
        let v = x < T1 ? amp - 2 * amp * g(x) : -amp // since the last rising edge
        for (let j = x < T1 ? 1 : 0; j <= J; j++) {
          const r = x + j * T, fl = x - T1 + j * T
          if (fl < 0) continue
          v += 2 * amp * (g(fl) - g(r))
        }
        return offset + v
      }
      return { fn, mean: offset + amp * (2 * duty - 1), fmax: Math.max(f, fr), f, desc: 'ring' }
    }
    case 'am': {
      const fm = q('fm', ['Hz']), m = q('m', ['%'], 0.5)
      return { fn: (t) => offset + amp * (1 + m * Math.cos(TAU * fm * t)) * Math.sin(TAU * f * tp(t)), mean: offset, fmax: f + fm, f, desc: 'am' }
    }
    case 'fm': {
      const fm = q('fm', ['Hz']), beta = q('beta', [], 1)
      return { fn: (t) => offset + amp * Math.sin(TAU * f * tp(t) + beta * Math.sin(TAU * fm * t)), mean: offset, fmax: f + (beta + 1) * fm, f, desc: 'fm' }
    }
  }
}

/** A channel's signal: one term or a list, summed. */
export function readSignal(sig, env, path, diag) {
  if (sig === undefined) return { fn: () => 0, mean: 0, fmax: 0, f: null, noise: [], terms: [] }
  const list = Array.isArray(sig) ? sig : [sig]
  const terms = list.map((tm, i) => term(tm, env, Array.isArray(sig) ? `${path}[${i}]` : path, diag))
  const live = terms.filter((t) => !t.noise)
  const fn = live.length === 1 ? live[0].fn : (t) => { let s = 0; for (const x of live) s += x.fn(t); return s }
  const known = (k) => (terms.every((t) => t[k] !== null) ? terms.reduce((s, t) => (k === 'mean' ? s + t[k] : Math.max(s, t[k])), 0) : null)
  return {
    fn, terms, mean: known('mean'), fmax: known('fmax'),
    f: terms.find((t) => t.f)?.f ?? null,
    noise: terms.filter((t) => t.noise).map((t) => t.noise),
    rise: Math.max(0, ...terms.map((t) => t.rise ?? 0)),
  }
}
