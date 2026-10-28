// thermo: ideal-gas thermodynamics with the energy bookkeeping computed, in OpenStax University
// Physics Volume 2's convention: ΔE_int = Q − W, W the work done by the gas, Q positive into it.
// Modes: pv (states joined by isobaric, isochoric, isothermal, adiabatic, or straight legs, or a
// named cycle, with the work shaded and the W, Q, ΔE_int, ΔS table, e against Carnot, or K_R and
// K_P), ts (the same cycle on T-S axes), flow (heat engine, refrigerator, and heat pump energy
// flows with widths to scale), heating (a heating curve with phase-change plateaus), and speeds
// (the Maxwell–Boltzmann distribution with v_p, v_avg, v_rms). `expect` names any wrong value.

import { el } from '../../svg.js'
import { SpecError } from '../../diag.js'
import { Canvas } from '../fbd/draw.js'
import { checkExpect } from './expect.js'
import { pvMode } from './pv.js'
import { flowMode } from './flow.js'
import { heatingMode } from './heating.js'
import { speedsMode } from './speeds.js'

const MARGIN = 14
const MODES = {
  pv: (spec, ctx, cv) => pvMode(spec, ctx, cv),
  ts: (spec, ctx, cv) => pvMode(spec, ctx, cv, { ts: true }),
  flow: flowMode,
  heating: heatingMode,
  speeds: speedsMode,
}

export default {
  kind: 'thermo',
  fields: ['mode', 'gas', 'n', 'states', 'legs', 'cycle', 'units', 'isotherms', 'processes', 'table', 'entropy', 'expect', 'highlight',
    'device', 'Th', 'Tc', 'Qh', 'Qc', 'W', 'e', 'K', 'substance', 'm', 'from', 'to', 'Q', 'end', 'T'],
  collections: [],
  render(spec, ctx) {
    const { diag, env } = ctx
    const mode = spec.mode ?? 'pv'
    const run = MODES[mode]
    if (!run) throw new SpecError('mode', `mode is ${Object.keys(MODES).join(', ')} (default pv)`)
    const cv = new Canvas()
    const { facts, vals, ids } = run(spec, ctx, cv)
    const ex = checkExpect(spec, vals, env, diag, ids)
    if (ex) facts.push(ex)
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: `thermo ${mode}: ${facts.join('; ')}`, alt: `thermo ${mode} diagram` }
  },
}
