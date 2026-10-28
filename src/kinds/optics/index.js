// optics: ray and wave optics with the images and angles computed, in OpenStax University
// Physics Volume 3's conventions (1/d_o + 1/d_i = 1/f, m = −d_i/d_o, real distances positive).
// Modes: rays (thin lenses and mirrors, alone or in systems, with the principal rays traced),
// refraction (Snell's law across layers, partial and total internal reflection, slabs), prism
// (deviation and dispersion), depth (apparent depth), fiber (TIR down a light pipe), slits
// (single slit, double slit, and grating geometry, fringes, and intensity), and film (thin-film
// interference with the phase shifts). The summary states every computed value, and `expect`
// names any wrong one.

import { el } from '../../svg.js'
import { labelSvg, measure } from '../../label.js'
import { SpecError } from '../../diag.js'
import { Canvas } from '../fbd/draw.js'
import { checkExpect } from './expect.js'
import { raysMode } from './rays.js'
import { refractionMode, prismMode, depthMode, fiberMode } from './refract.js'
import { slitsMode, filmMode } from './waves.js'

const MARGIN = 14
const MODES = { rays: raysMode, refraction: refractionMode, prism: prismMode, depth: depthMode, fiber: fiberMode, slits: slitsMode, film: filmMode }

export default {
  kind: 'optics',
  fields: ['mode', 'unit', 'values', 'expect', 'elements', 'object', 'rays', 'media', 'angle', 'reflect', 'apex', 'n', 'outside',
    'depth', 'core', 'clad', 'N', 'd', 'a', 'lambda', 'D', 'orders', 'show', 't', 'want'],
  collections: [],
  render(spec, ctx) {
    const { theme, diag, env } = ctx
    const mode = spec.mode ?? 'rays'
    const run = MODES[mode]
    if (!run) throw new SpecError('mode', `mode is ${Object.keys(MODES).join(', ')} (default rays)`)
    const cv = new Canvas()
    const { facts, vals, caption = [] } = run(spec, ctx, cv)
    const ex = checkExpect(spec, vals, env, diag)
    if (ex) facts.push(ex)
    const xs = cv.ext.map((p) => p[0]), ys = cv.ext.map((p) => p[1])
    let x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys)
    const cx = (x0 + x1) / 2
    for (const c of caption) {
      const y = y1 + 18
      cv.front.push(labelSvg(c, cx, y, theme, { size: theme.size - 1, fill: theme.muted }))
      const w = measure(c, theme.size - 1)
      x0 = Math.min(x0, cx - w / 2); x1 = Math.max(x1, cx + w / 2); y1 = y + 4
    }
    const body = el('g', { transform: `translate(${(MARGIN - x0).toFixed(1)},${(MARGIN - y0).toFixed(1)})` }, [...cv.back, ...cv.mid, ...cv.front])
    return { body, width: x1 - x0 + 2 * MARGIN, height: y1 - y0 + 2 * MARGIN, summary: `optics ${mode}: ${facts.join('; ')}`, alt: `optics ${mode} diagram` }
  },
}
