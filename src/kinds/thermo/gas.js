// The ideal-gas engine: the gas (C_V in units of R, γ), states from any two of P, V, T (with
// n), processes that fix the next state from one given variable, and each leg's W, Q, ΔE_int,
// and ΔS in OpenStax University Physics Vol. 2's convention: ΔE_int = Q − W, W the work done
// by the gas (positive on expansion), Q positive into the gas. Named cycles (Carnot, Otto,
// Diesel, Brayton, Stirling, rectangle, triangle) build their states and legs here too.

import { SpecError } from '../../diag.js'
import { qty, sig } from './units.js'

export const R = 8.314 // J/(mol·K), as OpenStax rounds it

/** Gases by name: cv is C_V/R, M the molar mass in kg/mol. */
export const GASES = {
  monatomic: { cv: 1.5 }, diatomic: { cv: 2.5 }, polyatomic: { cv: 3 },
  He: { cv: 1.5, M: 4.003e-3 }, Ne: { cv: 1.5, M: 20.18e-3 }, Ar: { cv: 1.5, M: 39.95e-3 },
  H2: { cv: 2.5, M: 2.016e-3 }, N2: { cv: 2.5, M: 28.01e-3 }, O2: { cv: 2.5, M: 32.00e-3 }, air: { cv: 2.5, M: 28.97e-3 },
  CO2: { M: 44.01e-3 }, H2O: { M: 18.02e-3 },
}
const KIND_OF = { 1.5: 'monatomic', 2.5: 'diatomic', 3: 'polyatomic' }

/** { cv, gamma, M, name, text } from spec.gas: a name, or {"gamma": 1.3}, {"Cv": 3.5} (in R), {"M": "28 g/mol"}. */
export function readGas(spec, env, { needCv = true } = {}) {
  const g = spec.gas ?? 'monatomic'
  let cv, M = null, name
  if (typeof g === 'string') {
    const hit = GASES[g] ?? Object.entries(GASES).find(([k]) => k.toLowerCase() === g.toLowerCase())?.[1]
    if (!hit) throw new SpecError('gas', `gas is ${Object.keys(GASES).join(', ')}, or {"gamma": 1.3}`)
    cv = hit.cv; M = hit.M ?? null; name = g
  } else if (g && typeof g === 'object' && !Array.isArray(g)) {
    if (g.gamma !== undefined) {
      const [y] = qty(g.gamma, '', env, 'gas.gamma')
      if (!(y > 1)) throw new SpecError('gas.gamma', 'γ = C_p/C_V is above 1 (5/3 monatomic, 7/5 diatomic)')
      cv = 1 / (y - 1)
    }
    if (g.Cv !== undefined) {
      const [c] = qty(g.Cv, '', env, 'gas.Cv')
      if (!(c > 0)) throw new SpecError('gas.Cv', 'C_V is in units of R and positive: 1.5 monatomic, 2.5 diatomic')
      cv = c
    }
    if (g.M !== undefined) M = qty(g.M, 'M', env, 'gas.M', { positive: true, bare: 1e-3 })[0]
    name = 'gas'
  } else throw new SpecError('gas', 'gas is a name like "diatomic" or "N2", or {"gamma": 1.3}')
  if (cv === undefined && needCv) throw new SpecError('gas', `${name}'s C_V isn't a simple multiple of R; give {"gamma": …} or {"Cv": …}`)
  const gamma = cv === undefined ? null : 1 + 1 / cv
  const kind = KIND_OF[cv]
  const text = cv === undefined ? name : `${kind && name !== kind ? `${name} (${kind})` : kind ?? name} ideal gas, C_V = ${frac(cv)}R, γ = ${sig(gamma, 4)}`
  return { cv, gamma, M, name, text }
}
const frac = (x) => (Math.abs(x * 2 - Math.round(x * 2)) < 1e-9 ? (Math.round(x * 2) % 2 ? `${Math.round(x * 2)}/2 ` : `${Math.round(x)}`) : `${sig(x, 3)} `).trim()

export const PROCESSES = {
  isobaric: 'P', isochoric: 'V', isovolumetric: 'V', isothermal: 'T', adiabatic: 'S', isentropic: 'S', line: 'line', straight: 'line',
}
const PROC_NAME = { P: 'isobaric', V: 'isochoric', T: 'isothermal', S: 'adiabatic', line: 'line' }

/** n in mol from spec.n (a number or "2.0 mol"), or null. */
export function readN(v, env, path = 'n') {
  if (v === undefined) return null
  return qty(v, 'n', env, path, { positive: true })[0]
}

/**
 * States and legs from the spec (or a named cycle), solved: every state gets P and V (and T when
 * n is known or found), every leg its W, Q, ΔE_int, ΔS, and sampled path. Returns the model the
 * drawing and the tables read; `units` holds the units the author wrote for P and V.
 */
export function solveModel(spec, env, diag) {
  const gas = readGas(spec, env)
  let n = readN(spec.n, env)
  const units = { P: null, V: null }
  const note = (dim, u) => { if (u && !units[dim]) units[dim] = u }
  let raw
  if (spec.cycle !== undefined) {
    if (spec.states !== undefined || spec.legs !== undefined) throw new SpecError('cycle', 'give either a named cycle or states and legs, not both')
    raw = buildCycle(spec.cycle, gas, n, env, note)
    if (raw.n !== undefined) n = raw.n
  } else {
    if (!Array.isArray(spec.states) || !spec.states.length) throw new SpecError('states', 'states is a list like [{"id": "A", "P": "1.0 atm", "V": "10 L"}], or give a named "cycle"')
    raw = { states: spec.states.map((s, i) => readState(s, i, env, note)), legs: spec.legs ?? [] }
  }
  const states = raw.states
  const byId = new Map()
  states.forEach((s, i) => { if (byId.has(s.id)) throw new SpecError(`states[${i}].id`, `state "${s.id}" appears twice`); byId.set(s.id, s) })

  // n from a state that gives all three, else as given; a full state that disagrees warns.
  for (const s of states) {
    if (s.P === null || s.V === null || s.T === null) continue
    const nHere = (s.P * s.V) / (R * s.T)
    if (n === null) { n = nHere; s.defines = true }
    else if (Math.abs(nHere - n) > 0.01 * n) diag.warn(`${s.path}`, `P V/(nR) = ${sig((s.P * s.V) / (n * R), 4)} K at ${s.id}, not the T given (${sig(s.T, 4)} K); drop one of P, V, T or fix n`)
  }
  const complete = (s) => {
    const k = [s.P, s.V, s.T].filter((x) => x !== null).length
    if (s.P !== null && s.V !== null) { if (s.T === null && n !== null) s.T = (s.P * s.V) / (n * R); return true }
    if (k < 2) return false
    if (n === null) throw new SpecError(s.path, `state ${s.id} is given by T, so n is needed: give "n" (mol) or a state with P, V, and T`)
    if (s.P === null) s.P = (n * R * s.T) / s.V
    else s.V = (n * R * s.T) / s.P
    return true
  }
  for (const s of states) s.done = complete(s)

  // Legs: from defaults to the previous leg's end (the first state for the first leg).
  const legs = raw.legs.map((L, i) => {
    const path = L.path ?? `legs[${i}]`
    if (!L || typeof L !== 'object') throw new SpecError(path, 'a leg is {"to": "B", "process": "isobaric"}')
    const fromId = L.from ?? (i ? (raw.legs[i - 1].to) : states[0].id)
    const from = byId.get(fromId), to = byId.get(L.to)
    if (!from) throw new SpecError(`${path}.from`, `no state "${fromId}"; states are ${[...byId.keys()].join(', ')}`)
    if (!to) throw new SpecError(`${path}.to`, `no state "${L.to}"; states are ${[...byId.keys()].join(', ')}`)
    if (from === to) throw new SpecError(path, `a leg needs two different states, not ${from.id} to itself`)
    const proc = PROCESSES[L.process ?? 'line']
    if (!proc) throw new SpecError(`${path}.process`, `process is isobaric, isochoric, isothermal, adiabatic, or line (a straight line on the P-V diagram)`)
    return { from, to, proc, process: PROC_NAME[proc], path, id: L.id ?? `${from.id}${to.id}` }
  })

  // Each leg into an unfinished state fixes it from the one variable given there.
  for (let pass = 0; pass < legs.length + 1; pass++) {
    let progress = false
    for (const L of legs) {
      for (const [a, b, back] of [[L.from, L.to, false], [L.to, L.from, true]]) {
        if (!a.done || b.done) continue
        fixState(a, b, L, gas, n, back)
        b.done = complete(b)
        progress = true
      }
    }
    if (!progress) break
  }
  for (const s of states) {
    if (!s.done) throw new SpecError(s.path, `state ${s.id} needs ${[s.P, s.V, s.T].some((x) => x !== null) ? 'one more of P, V, T, or a leg (not a line) into it from a known state' : 'two of P, V, T, or one and a leg into it'}`)
  }
  for (const L of legs) { checkProcess(L, gas, diag); legEnergy(L, gas, n) }
  return { gas, n, states, legs, units, ...cycleOf(legs, states, gas, n) }
}

function readState(s, i, env, note) {
  const path = `states[${i}]`
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new SpecError(path, 'a state is {"id": "A", "P": "1.0 atm", "V": "10 L"} (any two of P, V, T)')
  const id = String(s.id ?? String.fromCharCode(65 + i))
  const get = (k, dim) => {
    if (s[k] === undefined) return null
    const [x, u] = qty(s[k], dim, env, `${path}.${k}`, { positive: true })
    note(k, u)
    return x
  }
  return { id, P: get('P', 'P'), V: get('V', 'V'), T: get('T', 'T'), path, given: ['P', 'V', 'T'].filter((k) => s[k] !== undefined) }
}

/** Fix state b from a (both directions work: every process here is reversible). */
function fixState(a, b, L, gas, n, back) {
  const given = ['P', 'V', 'T'].filter((k) => b[k] !== null)
  const g = gas.gamma
  const where = `${L.path}`
  if (L.proc === 'line') throw new SpecError(where, `a line leg needs both ends known; give ${b.id} two of P, V, T`)
  if (given.length !== 1) throw new SpecError(b.path, `state ${b.id} needs one of P, V, T for the ${L.process} leg to fix the rest`)
  const k = given[0]
  if (k === PROC_KEY[L.proc]) throw new SpecError(b.path, `the ${L.process} leg already fixes ${k} at ${b.id}; give ${b.id} ${['P', 'V', 'T'].filter((x) => x !== k).join(' or ')} instead`)
  const need = (what) => { if (n === null) throw new SpecError(b.path, `finding ${b.id} from its T needs n; give "n" (mol)`); return what }
  const PV = a.P * a.V
  if (L.proc === 'P') { b.P = a.P; if (k === 'T') b.V = need((n * R * b.T) / b.P) }
  else if (L.proc === 'V') { b.V = a.V; if (k === 'T') b.P = need((n * R * b.T) / b.V) }
  else if (L.proc === 'T') { if (k === 'P') b.V = PV / b.P; else b.P = PV / b.V }
  else if (L.proc === 'S') {
    if (k === 'P') b.V = a.V * (a.P / b.P) ** (1 / g)
    else if (k === 'V') b.P = a.P * (a.V / b.V) ** g
    else { need(); b.V = a.V * ((a.P * a.V) / (n * R * b.T)) ** (1 / (g - 1)); b.P = (n * R * b.T) / b.V }
  }
  b.via = { leg: L, from: a, back }
}
const PROC_KEY = { P: 'P', V: 'V', T: 'T' }

/** A leg between two given states that isn't the process it claims warns. */
function checkProcess(L, gas, diag) {
  const a = L.from, b = L.to
  const off = (x, y) => Math.abs(x - y) > 0.01 * Math.max(Math.abs(x), Math.abs(y))
  const bad = L.proc === 'P' ? off(a.P, b.P) && `P_${a.id} ≠ P_${b.id}`
    : L.proc === 'V' ? off(a.V, b.V) && `V_${a.id} ≠ V_${b.id}`
      : L.proc === 'T' ? off(a.P * a.V, b.P * b.V) && `P V changes (T_${a.id} ≠ T_${b.id})`
        : L.proc === 'S' ? off(a.P * a.V ** gas.gamma, b.P * b.V ** gas.gamma) && `P V^γ changes (γ = ${sig(gas.gamma, 3)})`
          : false
  if (bad) diag.warn(L.path, `${a.id}→${b.id} is ${L.process}, but ${bad}; fix a state or the process`)
}

/** P along the leg at volume V (P-explicit processes) or the path as a function of t ∈ [0, 1]. */
export function pathAt(L, gas, t) {
  const a = L.from, b = L.to
  if (L.proc === 'V') return [a.V, a.P + (b.P - a.P) * t]
  if (L.proc === 'line') return [a.V + (b.V - a.V) * t, a.P + (b.P - a.P) * t]
  // Geometric in V keeps the samples even on a log-like curve.
  const V = a.V * (b.V / a.V) ** t
  if (L.proc === 'P') return [a.V + (b.V - a.V) * t, a.P]
  if (L.proc === 'T') return [V, (a.P * a.V) / V]
  return [V, a.P * (a.V / V) ** gas.gamma]
}

/** W, Q, ΔE_int (J), ΔS (J/K, with n), the sampled path, and heat in and out along the leg. */
function legEnergy(L, gas, n) {
  const a = L.from, b = L.to, cv = gas.cv
  const W = L.proc === 'V' ? 0
    : L.proc === 'P' ? a.P * (b.V - a.V)
      : L.proc === 'T' ? a.P * a.V * Math.log(b.V / a.V)
        : L.proc === 'S' ? (a.P * a.V - b.P * b.V) / (gas.gamma - 1)
          : ((a.P + b.P) / 2) * (b.V - a.V)
  const dE = cv * (b.P * b.V - a.P * a.V)
  const Q = L.proc === 'S' ? 0 : dE + W
  const dS = n === null ? null : n * R * (cv * Math.log((b.P * b.V) / (a.P * a.V)) + Math.log(b.V / a.V))
  const N = 64
  const pts = Array.from({ length: N + 1 }, (_, k) => pathAt(L, gas, k / N))
  // Heat in and out along the way: dQ = n C_V dT + P dV = cv d(PV) + P dV, summed by sign.
  // Also the hottest spot where heat enters and the coldest where it leaves (as P V, ∝ T).
  let qin = 0, qout = 0, inMax = -Infinity, outMin = Infinity
  if (L.proc !== 'S') for (let k = 1; k <= N; k++) {
    const [V0, P0] = pts[k - 1], [V1, P1] = pts[k]
    const dq = cv * (P1 * V1 - P0 * V0) + ((P0 + P1) / 2) * (V1 - V0)
    const pv = Math.max(P0 * V0, P1 * V1), pvLo = Math.min(P0 * V0, P1 * V1)
    if (dq > 0) { qin += dq; inMax = Math.max(inMax, pv) } else if (dq < 0) { qout -= dq; outMin = Math.min(outMin, pvLo) }
  }
  Object.assign(L, { W, Q, dE, dS, pts, qin, qout, inMax, outMin, split: L.proc === 'line' && Math.min(qin, qout) > 0.01 * Math.max(qin, qout) })
}

/** Whether the legs close into one loop, and the cycle's totals: W, Q_in, Q_out, e or K, Carnot. */
function cycleOf(legs, states, gas, n) {
  const chain = legs.length > 0 && legs.every((L, i) => i === 0 || legs[i - 1].to === L.from)
  const closed = chain && legs.length >= 2 && legs[legs.length - 1].to === legs[0].from
  const W = legs.reduce((s, L) => s + L.W, 0), Q = legs.reduce((s, L) => s + L.Q, 0), dE = legs.reduce((s, L) => s + L.dE, 0)
  const out = { closed, chain, W, Q, dE }
  if (!closed) return out
  const Qin = legs.reduce((s, L) => s + Math.max(0, L.Q), 0), Qout = legs.reduce((s, L) => s - Math.min(0, L.Q), 0)
  const pv = legs.flatMap((L) => L.pts.map(([V, P]) => P * V))
  const hot = Math.max(...pv), cold = Math.min(...pv)
  const ratio = cold / hot // T_c/T_h, which needs no n
  const Th = n === null ? null : hot / (n * R), Tc = n === null ? null : cold / (n * R)
  Object.assign(out, { Qin, Qout, ratio, Th, Tc, engine: W > 0, eC: 1 - ratio })
  if (W > 0) out.e = W / Qin
  else if (W < 0) {
    out.KR = Qin / -W; out.KP = Qout / -W
    // Run backward, the cycle is bounded by a Carnot cycle only when every bit of heat enters
    // colder than any leaves: T_c is the hottest intake, T_h the coldest exhaust.
    const inMax = Math.max(...legs.map((L) => L.inMax)), outMin = Math.min(...legs.map((L) => L.outMin))
    out.coldIn = inMax; out.hotOut = outMin
    if (inMax < outMin * (1 - 1e-9)) {
      out.KRC = inMax / (outMin - inMax); out.KPC = outMin / (outMin - inMax)
      out.TcK = n === null ? null : inMax / (n * R); out.ThK = n === null ? null : outMin / (n * R)
    } else if (inMax <= outMin * (1 + 1e-9)) { out.KRC = Infinity; out.KPC = Infinity }
  }
  // A line leg whose heat changes sign: the inflow along all legs, counted piece by piece.
  out.split = legs.filter((L) => L.split)
  if (out.split.length) out.QinTrue = legs.reduce((s, L) => s + L.qin, 0)
  return out
}

/** A cycle by name, as states and legs (A first); "reverse": true runs it the other way. */
function buildCycle(c, gas, n0, env, note) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new SpecError('cycle', 'cycle is {"type": "carnot", …}')
  const type = String(c.type ?? '').toLowerCase()
  const g = gas.gamma
  const T = (k) => (c[k] === undefined ? null : qty(c[k], 'T', env, `cycle.${k}`, { positive: true })[0])
  const one = (k, dim) => { if (c[k] === undefined) return null; const [x, u] = qty(c[k], dim, env, `cycle.${k}`, { positive: true }); note(k, u); return x }
  const pair = (k, dim) => {
    const v = c[k]
    if (!Array.isArray(v) || v.length !== 2) throw new SpecError(`cycle.${k}`, `${k} is [low, high], like ${dim === 'P' ? '["1.0 atm", "3.0 atm"]' : '["1.0 L", "3.0 L"]'}`)
    const xs = v.map((x, i) => { const [y, u] = qty(x, dim, env, `cycle.${k}[${i}]`, { positive: true }); note(k, u); return y })
    if (!(xs[1] > xs[0])) throw new SpecError(`cycle.${k}`, `${k} is [low, high] with high above low`)
    return xs
  }
  const ratio = (k, what) => {
    if (c[k] === undefined) return null
    const [r] = qty(c[k], '', env, `cycle.${k}`)
    if (!(r > 1)) throw new SpecError(`cycle.${k}`, `${what} is above 1`)
    return r
  }
  const need = (x, k, msg) => { if (x === null) throw new SpecError(`cycle.${k}`, msg); return x }
  let n = n0
  const nFrom = (P, V, Tk, where) => {
    // State A from two of P, V, T and n.
    const k = [P, V, Tk].filter((x) => x !== null).length + (n !== null ? 1 : 0)
    if (P !== null && V !== null && Tk !== null) { n = (P * V) / (R * Tk); return [P, V, Tk] }
    if (k < 3) throw new SpecError('cycle', `${where} needs two of P, V, T and n (give "n" beside the cycle, or a third of P, V, T)`)
    if (n === null) n = (P * V) / (R * Tk)
    if (P === null) P = (n * R * Tk) / V
    else if (V === null) V = (n * R * Tk) / P
    else Tk = (P * V) / (n * R)
    return [P, V, Tk]
  }
  const st = (id, P, V) => ({ id, P, V, T: null, path: `cycle (state ${id})`, given: [] })
  const ids = Array.isArray(c.names) ? c.names.map(String) : ['A', 'B', 'C', 'D']
  let S, procs
  if (type === 'carnot' || type === 'stirling') {
    const Th = need(T('Th'), 'Th', 'give Th, the hot temperature'), Tc = need(T('Tc'), 'Tc', 'give Tc, the cold temperature')
    if (!(Th > Tc)) throw new SpecError('cycle.Tc', 'Tc is below Th')
    let [VA, VB] = c.V !== undefined && Array.isArray(c.V) ? pair('V', 'V') : [one('V', 'V'), null]
    const r = ratio('r', type === 'carnot' ? 'r = V_B/V_A, the isothermal expansion ratio,' : 'r = V_max/V_min')
    if (VB === null && r !== null && VA !== null) VB = VA * r
    const PA = one('P', 'P')
    if (VA === null && PA !== null && n !== null) VA = (n * R * Th) / PA
    if (VA === null || VB === null) throw new SpecError('cycle.V', 'give V as [V_A, V_B] (the hot isotherm\'s start and end), or V and r')
    ;[, , ] = nFrom(PA, VA, Th, `state ${ids[0]}`)
    if (type === 'carnot') {
      const k = (Th / Tc) ** (1 / (g - 1))
      const Vs = [VA, VB, VB * k, VA * k], Ts = [Th, Th, Tc, Tc]
      S = Vs.map((V, i) => st(ids[i], (n * R * Ts[i]) / V, V))
      procs = ['isothermal', 'adiabatic', 'isothermal', 'adiabatic']
    } else {
      const Vs = [VA, VB, VB, VA], Ts = [Th, Th, Tc, Tc]
      S = Vs.map((V, i) => st(ids[i], (n * R * Ts[i]) / V, V))
      procs = ['isothermal', 'isochoric', 'isothermal', 'isochoric']
    }
  } else if (type === 'otto' || type === 'diesel') {
    const r = need(ratio('r', 'the compression ratio r = V_A/V_B'), 'r', 'give r, the compression ratio V_max/V_min')
    const [PA, VA] = nFrom(one('P', 'P'), one('V', 'V'), T('T'), `state ${ids[0]} (the start of compression)`)
    const VB = VA / r, PB = PA * r ** g
    let VC, PC
    if (type === 'otto') {
      VC = VB
      const Tmax = T('Tmax'), Qin = c.Qin === undefined ? null : qty(c.Qin, 'E', env, 'cycle.Qin', { positive: true })[0]
      const TB = (PB * VB) / (n * R)
      const TC = Tmax ?? (Qin !== null ? TB + Qin / (n * gas.cv * R) : null)
      need(TC, 'Tmax', 'give Tmax (the peak temperature, at C) or Qin (the heat added at constant volume)')
      if (!(TC > TB)) throw new SpecError('cycle.Tmax', `Tmax is above T_${ids[1]} = ${sig(TB, 4)} K, the temperature after compression`)
      PC = (n * R * TC) / VC
    } else {
      const rc = need(ratio('rc', 'the cutoff ratio rc = V_C/V_B'), 'rc', 'give rc, the cutoff ratio V_C/V_B')
      if (rc >= r) throw new SpecError('cycle.rc', 'the cutoff ratio rc is below the compression ratio r')
      VC = VB * rc; PC = PB
    }
    const PD = PC * (VC / VA) ** g
    S = [st(ids[0], PA, VA), st(ids[1], PB, VB), st(ids[2], PC, VC), st(ids[3], PD, VA)]
    procs = ['adiabatic', type === 'otto' ? 'isochoric' : 'isobaric', 'adiabatic', 'isochoric']
  } else if (type === 'brayton') {
    const rp = need(ratio('rp', 'the pressure ratio rp = P_B/P_A'), 'rp', 'give rp, the pressure ratio P_max/P_min')
    const [PA, VA] = nFrom(one('P', 'P'), one('V', 'V'), T('T'), `state ${ids[0]} (the compressor inlet)`)
    const PB = PA * rp, VB = VA * rp ** (-1 / g)
    const Tmax = need(T('Tmax'), 'Tmax', 'give Tmax, the turbine inlet temperature (at C)')
    const VC = (n * R * Tmax) / PB
    if (!(VC > VB)) throw new SpecError('cycle.Tmax', `Tmax is above T_${ids[1]} = ${sig((PB * VB) / (n * R), 4)} K, the temperature after compression`)
    const VD = VC * rp ** (1 / g)
    S = [st(ids[0], PA, VA), st(ids[1], PB, VB), st(ids[2], PB, VC), st(ids[3], PA, VD)]
    procs = ['adiabatic', 'isobaric', 'adiabatic', 'isobaric']
  } else if (type === 'rectangle' || type === 'triangle') {
    const [P1, P2] = pair('P', 'P'), [V1, V2] = pair('V', 'V')
    if (type === 'rectangle') {
      S = [st(ids[0], P1, V1), st(ids[1], P2, V1), st(ids[2], P2, V2), st(ids[3], P1, V2)]
      procs = ['isochoric', 'isobaric', 'isochoric', 'isobaric']
    } else {
      S = [st(ids[0], P1, V1), st(ids[1], P2, V1), st(ids[2], P1, V2)]
      procs = ['isochoric', 'line', 'isobaric']
    }
    if (T('T') !== null) nFrom(P1, V1, T('T'), `state ${ids[0]}`)
  } else throw new SpecError('cycle.type', 'type is carnot, otto, diesel, brayton, stirling, rectangle, or triangle')
  if (ids.length < S.length) throw new SpecError('cycle.names', `names lists ${S.length} state names`)
  let legs = S.map((s, i) => ({ from: s.id, to: S[(i + 1) % S.length].id, process: procs[i], path: `cycle (leg ${s.id}→${S[(i + 1) % S.length].id})` }))
  if (c.reverse) legs = legs.reverse().map((L) => ({ ...L, from: L.to, to: L.from, path: `cycle (leg ${L.to}→${L.from})` }))
  return { states: S, legs, n: n ?? undefined, type }
}
