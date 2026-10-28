import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const spec = (rest) => ({ v: 1, kind: 'optics', ...rest })
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
const errors = (r) => r.diagnostics.filter((d) => d.level === 'error').map((d) => `${d.path}: ${d.msg}`).join('\n')
const air = { n: 1.0, label: 'air' }

test('double slit example: θ1 = sin⁻¹(λ/d) = 0.3438°, y1 = D tan θ1 = 6.00 mm, Δy = λD/d = 6.00 mm, in every theme', async () => {
  // λ/d = 600e-9 / 1.0e-4 = 0.006, θ1 = sin⁻¹ 0.006 = 0.006000036 rad = 0.3438°;
  // y1 = 1.0 m · tan θ1 = 6.000 mm; Δy = 600e-9 · 1.0 / 1.0e-4 = 6.000 mm; m_max = floor(166.7) = 166.
  for (const theme of ['paper', 'dark', 'light', 'host']) {
    const r = await renderAsync(load('double-slit.json'), { theme })
    assert.deepEqual(problems(r), [], theme)
    assert.ok(r.width <= 320 && r.height <= 320, `${theme}: ${r.width} × ${r.height}`)
  }
  const s = (await renderAsync(load('double-slit.json'))).summary
  assert.match(s, /θ_1 = 0\.3438°, θ_2 = 0\.6876°, θ_3 = 1\.031°/)
  assert.match(s, /y_1 = 6\.000 mm, y_2 = 12\.00 mm, y_3 = 18\.00 mm/)
  assert.doesNotMatch(s, /small-angle/) // within 1% at these angles
  assert.match(s, /Δy = λD\/d = 6\.000 mm/)
  assert.match(s, /m_max = floor\(d\/λ\) = 166/)
  assert.match(s, /expect: theta1 ok, y1 ok, dy ok/)
})

test('grating, 600 lines/mm at 500 nm: θ1 17.46°, θ2 36.87°, θ3 64.16°, m_max 3, drawn for N = 20', async () => {
  // d = 1/600 mm = 1.667 μm; sin θm = m · 0.5/1.6667 = 0.3, 0.6, 0.9: θ = 17.46°, 36.87°, 64.16°.
  // d/λ = 3.333, so m_max = 3. y1 = tan 17.46° = 0.3145 m against the small-angle mλD/d = 0.3000 m.
  const r = await renderAsync(spec({ mode: 'slits', N: 600, d: '1/600 mm', lambda: '500 nm', expect: { theta1: 17.46, theta2: 36.87, theta3: 64.16, mmax: 3 } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /grating N = 600: d = 1\.667 μm \(600\.0 lines\/mm\)/)
  assert.match(r.summary, /θ_1 = 17\.46°, θ_2 = 36\.87°, θ_3 = 64\.16°/)
  assert.match(r.summary, /y_1 = 314\.5 mm \(small-angle mλD\/d = 300\.0 mm\)/)
  assert.match(r.summary, /m_max = floor\(d\/λ\) = 3/)
  assert.match(r.summary, /intensity drawn for N = 20 slits/)
  assert.match(r.summary, /expect: theta1 ok, theta2 ok, theta3 ok, mmax ok/)
  // Orders past sin θ = 1 aren't marked: asking for order 4 is an error.
  const r4 = await renderAsync(spec({ mode: 'slits', N: 600, d: '1/600 mm', lambda: '500 nm', show: 4 }))
  assert.match(errors(r4), /show: order 4 would need \|sin θ\| = 1\.20 > 1; this pattern has orders up to ±3/)
})

test('single slit, a = 0.050 mm, λ = 500 nm, D = 2.0 m: θ1 0.5730°, y1 20.0 mm, central width 40.0 mm', async () => {
  // sin θ1 = λ/a = 500e-9/5.0e-5 = 0.01, θ1 = 0.5730°; y1 = 2.0 tan θ1 = 20.00 mm; w0 = 2y1 = 40.00 mm.
  const r = await renderAsync(spec({ mode: 'slits', N: 1, a: '0.050 mm', lambda: '500 nm', D: '2.0 m', expect: { theta1: 0.573, y1: '20.0 mm', w0: '40.0 mm' } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /single slit: a = 50\.00 μm/)
  assert.match(r.summary, /minima a sin θ = mλ: θ_1 = 0\.5730°/)
  assert.match(r.summary, /y_1 = 20\.00 mm/)
  assert.match(r.summary, /central maximum width 2y_1 = 40\.00 mm/)
  assert.match(r.summary, /expect: theta1 ok, y1 ok, w0 ok/)
})

test('double slit with d/a = 4: order 4 (and 8, 12, …) is missing, and the envelope is drawn', async () => {
  // d sin θ = 4λ puts the maximum at a sin θ = (a/d)·4λ = λ, the envelope's first zero.
  const r = await renderAsync(spec({ mode: 'slits', d: '0.20 mm', a: '0.050 mm', lambda: '550 nm', orders: 5, show: -2 }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /missing orders \(d\/a = 4\.000\): m = 4, 8, 12, 16, …/)
  assert.match(r.svg, /stroke-dasharray="3 2"/) // the dashed envelope
  // d/a = 2.5: every 5th order (5 · a/d = 2, the envelope's second zero).
  const r25 = await renderAsync(spec({ mode: 'slits', d: '0.25 mm', a: '0.10 mm', lambda: '550 nm' }))
  assert.match(r25.summary, /missing orders \(d\/a = 2\.500\): m = 5, 10, 15, 20, …/)
  // d/a = 20/7: order 20 falls on the 7th zero, too far out to count.
  const none = await renderAsync(spec({ mode: 'slits', d: '0.20 mm', a: '0.07 mm', lambda: '550 nm' }))
  assert.match(none.summary, /no missing orders/)
})

test('soap film (1.33) in air at 600 nm: one shift, bright t_min = λ/4n = 112.8 nm, dark t = λ/2n = 225.6 nm', async () => {
  // Top: 1.33 > 1.00, a π shift; bottom: 1.00 < 1.33, none. One shift, so bright is 2t = (m + ½)λn.
  // λn = 600/1.33 = 451.1 nm; bright t = λn/4 = 112.8 nm (m = 0); dark t = λn/2 = 225.6 nm (m = 1).
  const media = [air, { n: 1.33, label: 'soap' }, air]
  const r = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', expect: { t: '112.8 nm', lambda_n: '451.1 nm' } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /top reflection π shift \(1\.330 > 1\.000\), bottom no shift \(1\.000 < 1\.330\): 1 shift/)
  assert.match(r.summary, /λ_n = λ\/n = 451\.1 nm/)
  assert.match(r.summary, /bright in reflection: 2t = \(m \+ ½\)λ_n, t = \(2m \+ 1\)λ_n\/4; m = 0 to 3: 112\.8 nm, 338\.3 nm, 563\.9 nm, 789\.5 nm/)
  assert.match(r.summary, /t_min = 112\.8 nm \(m = 0\)/)
  assert.match(r.summary, /dark: 2t = mλ_n, t_min = 225\.6 nm/)
  assert.match(r.summary, /expect: t ok, lambda_n ok/)
  const dark = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', want: 'dark', expect: { t: '225.6 nm' } }))
  assert.match(dark.summary, /t_min = 225\.6 nm \(m = 1; t → 0 is also dark, the m = 0 limit\)/)
  assert.match(dark.summary, /expect: t ok/)
})

test('MgF2 (1.38) on glass (1.50) at 550 nm: two shifts, dark t_min = λ/(4n) = 99.64 nm', async () => {
  // Both surfaces reflect off a higher index: two π shifts cancel, so dark is 2t = (m + ½)λn.
  // λn = 550/1.38 = 398.6 nm; t = λn/4 = 99.64 nm.
  const media = [air, { n: 1.38, label: 'MgF_{2}' }, { n: 1.5, label: 'glass' }]
  const r = await renderAsync(spec({ mode: 'film', media, lambda: '550 nm', want: 'dark', expect: { t: '99.64 nm' } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /2 shifts/)
  assert.match(r.summary, /dark in reflection: 2t = \(m \+ ½\)λ_n/)
  assert.match(r.summary, /t_min = 99\.64 nm \(m = 0\)/)
  assert.match(r.summary, /bright: 2t = mλ_n, t_min = 199\.3 nm/)
  assert.match(r.summary, /expect: t ok/)
})

test('film with t given: the phase difference, bright or dark at λ, and the visible λ reflected', async () => {
  // Soap, t = 112.8 nm: 2t/λn = 0.5, plus ½ for one shift, is 1 cycle (2π): bright at 600 nm.
  // Strongly reflected: 2nt = (m + ½)λ, 2 · 1.33 · 112.8 = 300.0 nm → λ = 600 nm (m = 0), 200 nm (UV).
  const media = [air, { n: 1.33, label: 'soap' }, air]
  const r = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', t: '112.78 nm' }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /phase difference 2π\(2t\/λ_n\) \+ π = 2\.000π ≡ 0 \(mod 2π\): 600 nm is bright in reflection/)
  assert.match(r.summary, /strongly reflected visible λ \(380 to 750 nm\): 600\.0 nm/)
  // t = 500 nm: 2nt = 1330 nm = (m + ½)λ gives 532.0 nm (m = 2) and 380.0 nm (m = 3).
  const r2 = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', t: '500 nm' }))
  assert.match(r2.summary, /visible λ \(380 to 750 nm\): 532\.0 nm, 380\.0 nm/)
})

test('expect misses name the likely mistake', async () => {
  // Slits at a large angle: the small-angle y, a dark fringe, and a slit width used for d.
  const g = await renderAsync(spec({ mode: 'slits', d: '2 um', a: '0.5 um', lambda: '500 nm', expect: { y1: 0.25, theta1: 7.181, y2: '0.5 m', dy: '0.125 m', mmax: 9 } }))
  const w = warnings(g)
  // λ/d = 0.25: θ1 = 14.48°, y1 = tan θ1 = 0.2582 m against mλD/d = 0.2500 m.
  assert.match(w, /expect\.y1: 0\.2500 is the small-angle mλD\/d; at θ_1 = 14\.48°, y = D tan θ: y_1 = 258\.2 mm/)
  // (m − ½)λ/d = 0.125: 7.181° is the first dark fringe.
  assert.match(w, /expect\.theta1: 7\.181 is a dark fringe, d sin θ = \(m \+ ½\)λ/)
  assert.match(w, /expect\.y2: 0\.5 m is the small-angle/)
  assert.match(w, /expect\.dy: 0\.125 m is half the spacing/)
  assert.match(w, /expect\.mmax: 9\.000 counts every maximum/)
  const a = await renderAsync(spec({ mode: 'slits', d: '0.10 mm', a: '0.02 mm', lambda: '600 nm', expect: { y1: '30 mm' } }))
  assert.match(warnings(a), /expect\.y1: 30 mm uses the slit width a in place of the separation d/)
  // Film: the other condition, a later order, and λ in vacuum.
  const media = [air, { n: 1.33, label: 'soap' }, air]
  const f = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', expect: { t: '225.6 nm' } }))
  assert.match(warnings(f), /expect\.t: 225\.6 nm is the dark thickness; want is bright: t_min = 112\.8 nm/)
  const f2 = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', expect: { t: '338.3 nm' } }))
  assert.match(warnings(f2), /is the m = 1 thickness, not the minimum/)
  const f3 = await renderAsync(spec({ mode: 'film', media, lambda: '600 nm', expect: { t: '150 nm', lambdan: '600 nm' } }))
  assert.match(warnings(f3), /expect\.t: 150 nm uses λ in vacuum; λ_n = λ\/n in the film/)
  assert.match(warnings(f3), /expect\.lambdan: 600 nm is λ in vacuum/)
  assert.match(f3.summary, /expect: t WRONG, lambdan WRONG/)
})

test('bad input: errors say what to write, and implausible amounts warn', async () => {
  const err = async (s) => errors(await renderAsync(spec(s)))
  assert.match(await err({ mode: 'slits', N: 1, lambda: '500 nm' }), /a: a is the slit width, like "0\.050 mm"/)
  assert.match(await err({ mode: 'slits', d: '0.1 mm' }), /lambda: lambda is the wavelength, like "600 nm"/)
  assert.match(await err({ mode: 'slits', d: '0.1 mm', a: '0.2 mm', lambda: '600 nm' }), /a: the slit width a = 200 μm must be smaller than the separation d = 100 μm/)
  assert.match(await err({ mode: 'slits', d: '400 nm', lambda: '600 nm' }), /d: d = 400 nm is no larger than λ = 600 nm/)
  assert.match(await err({ mode: 'slits', N: 2.5, d: '0.1 mm', lambda: '600 nm' }), /N: N is the number of slits, a whole number/)
  assert.match(await err({ mode: 'slits', N: 1, a: '0.05 mm', lambda: '500 nm', show: 0 }), /show must not be 0/)
  assert.match(await err({ mode: 'slits', d: '0.1 mm', lambda: '30 deg' }), /lambda: "30 deg" is an angle/)
  assert.match(await err({ mode: 'film', media: [1, 1.33], lambda: '600 nm' }), /media: media is three layers/)
  assert.match(await err({ mode: 'film', media: [1, 1.33, 1], lambda: '600 nm', want: 'max' }), /want: want is "bright"/)
  const bare = await renderAsync(spec({ mode: 'slits', d: '0.1 mm', lambda: 600 }))
  assert.match(warnings(bare), /lambda: lambda = 600 m is implausible here; write it with its unit, like "600 nm"/)
  const nd = await renderAsync(spec({ mode: 'slits', N: 1, a: '0.05 mm', d: '0.1 mm', lambda: '500 nm' }))
  assert.match(warnings(nd), /d: a single slit \(N = 1\) has no separation/)
})
