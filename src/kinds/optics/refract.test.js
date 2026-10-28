import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { Diag } from '../../diag.js'
import { getTheme } from '../../theme.js'
import { Canvas } from '../fbd/draw.js'
import { refractionMode, prismMode, depthMode, fiberMode } from './refract.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const spec = (rest) => ({ v: 1, kind: 'optics', ...rest })
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
/** Run a mode directly for its vals (full precision). */
const run = (mode, s) => mode(s, { theme: getTheme('paper'), diag: new Diag(), env: {} }, new Canvas())
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)
const air = { n: 1.0, label: 'air' }, glass = { n: 1.5, label: 'glass' }, water = { n: 1.33, label: 'water' }

test('Snell: air→glass at 30° gives 19.47°, air→water at 40° gives 28.90°', async () => {
  // sin θ2 = sin 30° / 1.50 = 0.3333, θ2 = 19.47°; sin θ2 = sin 40° / 1.33 = 0.4833, θ2 = 28.90°.
  near(run(refractionMode, { media: [air, glass], angle: 30 }).vals.theta2.v, 19.47, 0.005, 'air→glass')
  near(run(refractionMode, { media: [air, water], angle: 40 }).vals.theta2.v, 28.90, 0.005, 'air→water')
  const r = await renderAsync(spec({ mode: 'refraction', media: [air, water], angle: 40, expect: { theta2: 28.9 } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /n sin θ = 0\.6428 in every layer \(Snell's law\): θ2 28\.90°/)
  assert.match(r.summary, /partial reflection drawn at surface 1/)
  assert.match(r.summary, /expect: theta2 ok/)
})

test('critical angles: glass–air 41.81°, water–air 48.75°; TIR detected, and the example renders cleanly in every theme', async () => {
  // θc = sin⁻¹(1.00/1.50) = 41.81°; sin⁻¹(1.00/1.33) = 48.75°.
  near(run(refractionMode, { media: [glass, air], angle: 30 }).vals.thetac.v, 41.81, 0.005, 'glass–air')
  near(run(refractionMode, { media: [water, air], angle: 30 }).vals.thetac.v, 48.75, 0.005, 'water–air')
  // Below θc the ray gets out: sin θ2 = 1.5 sin 30° = 0.75, θ2 = 48.59°.
  near(run(refractionMode, { media: [glass, air], angle: 30 }).vals.theta2.v, 48.59, 0.005, 'glass→air at 30°')
  for (const theme of ['paper', 'dark', 'light', 'host']) {
    const r = await renderAsync(load('tir.json'), { theme })
    assert.deepEqual(problems(r), [], theme)
    assert.ok(!r.diagnostics.some((d) => /crowded/.test(d.msg)), `${theme}: ${r.text}`)
    assert.ok(r.width <= 320 && r.height <= 320, `${theme}: ${r.width} × ${r.height}`)
  }
  const r = await renderAsync(load('tir.json'))
  // 1.50 sin 50° = 1.149 > 1.00: total internal reflection, the reflected ray at 50°.
  assert.match(r.summary, /total internal reflection at surface 1: θ1 50\.00° > θc \(n1 sin θ1 = 1\.149 > n2 = 1\.000\)/)
  assert.match(r.svg, /total internal reflection/) // the caption
  const out = run(refractionMode, load('tir.json'))
  assert.equal(out.vals.theta2, undefined) // no transmitted ray
  assert.equal(out.caption[0], '\\theta_{c} = 41.8°: total internal reflection')
})

test('slab: t = 2 cm, n = 1.5, θ1 = 40° gives θ2 = 25.37° and d = 0.559 cm; layers of one index shift the same', async () => {
  // sin θ2 = sin 40°/1.5 = 0.4285, θ2 = 25.374°; d = t sin(θ1 − θ2)/cos θ2 = 2 · sin 14.626° / cos 25.374°
  // = 2 · 0.25249 / 0.90354 = 0.5589 cm. The exit ray is parallel: θ3 = 40°.
  const slab = { media: [air, { ...glass, t: 2 }, air], angle: 40 }
  const v = run(refractionMode, slab).vals
  near(v.theta2.v, 25.37, 0.005, 'θ2'); near(v.theta3.v, 40, 1e-9, 'θ3')
  near(v.shift.v, 0.5589, 0.0001, 'd')
  assert.equal(v.shift.base, 'cm')
  // Split into 0.5 cm + 1.5 cm of the same glass, the perpendicular distance is the same.
  near(run(refractionMode, { ...slab, media: [air, { ...glass, t: 0.5 }, { ...glass, t: '15 mm' }, air] }).vals.shift.v, v.shift.v, 1e-9, 'split slab')
  const r = await renderAsync(spec({ mode: 'refraction', ...slab, expect: { shift: '5.59 mm', theta2: 25.37 } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /lateral shift d 0\.5589 cm = t sin\(θ1 − θ2\)\/cos θ2/)
  assert.match(r.summary, /expect: shift ok, theta2 ok/)
  // The sideways offset along the surface is a different length: Δx = d/cos θ1 = 0.7297 cm.
  const dx = await renderAsync(spec({ mode: 'refraction', ...slab, expect: { shift: 0.7297 } }))
  assert.match(warnings(dx), /expect\.shift: 0\.7297 is the sideways offset along the surface; d is measured perpendicular to the rays: d = 0\.5589 cm/)
})

test('TIR inside a layer: glass → water → air at 50° reflects at the water–air surface (θc 48.75°)', async () => {
  // n sin θ = 1.5 sin 50° = 1.149: into water at sin⁻¹(1.149/1.33) = 59.76°, then 1.149 > 1.00: TIR.
  const out = run(refractionMode, { media: [glass, { ...water, t: 1 }, air], angle: 50 })
  near(out.vals.theta2.v, 59.76, 0.01, 'θ2'); near(out.vals.thetac.v, 48.75, 0.005, 'θc water–air')
  assert.equal(out.vals.theta3, undefined)
  assert.match(out.facts.join('; '), /total internal reflection at surface 2/)
})

test('prism A = 60°, n = 1.5, θ1 = 50°: θ2 30.71°, θ3 29.29°, θ4 47.21°, δ 37.21°, δ_min 37.18°', async () => {
  // sin θ2 = sin 50°/1.5 = 0.5107, θ2 = 30.71°; θ3 = A − θ2 = 29.29°; sin θ4 = 1.5 sin 29.29° = 0.7339,
  // θ4 = 47.21°; δ = θ1 + θ4 − A = 37.21°; δ_min = 2 sin⁻¹(1.5 sin 30°) − 60° = 2 · 48.59° − 60° = 37.18°.
  const v = run(prismMode, { apex: 60, n: 1.5, angle: 50 }).vals
  near(v.theta2.v, 30.71, 0.005, 'θ2'); near(v.theta3.v, 29.29, 0.005, 'θ3'); near(v.theta4.v, 47.21, 0.005, 'θ4')
  near(v.delta.v, 37.21, 0.005, 'δ'); near(v.dmin.v, 37.18, 0.005, 'δ_min')
  // The default θ1 is the minimum-deviation angle, 48.59°, where δ = δ_min and θ2 = θ3 = A/2.
  const m = run(prismMode, { n: 1.5 })
  near(m.vals.delta.v, m.vals.dmin.v, 1e-9, 'δ at minimum deviation'); near(m.vals.theta2.v, 30, 1e-9, 'θ2 = A/2')
  const r = await renderAsync(spec({ mode: 'prism', apex: 60, n: 1.5, angle: 50, expect: { theta4: 47.21, delta: 37.21, dmin: 37.18 } }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /θ4 47\.21°, δ 37\.21° = θ1 \+ θ4 − A/)
  assert.match(r.summary, /expect: theta4 ok, delta ok, dmin ok/)
  // At θ1 = 60°: θ2 = 35.26°, θ3 = 24.74°, θ4 = sin⁻¹(1.5 sin 24.74°) = 38.88°, δ = 38.88°, well above δ_min.
  const off = await renderAsync(spec({ mode: 'prism', n: 1.5, angle: 60, expect: { delta: 37.18 } }))
  assert.match(warnings(off), /expect\.delta: 37\.18 is δ_min; at θ1 = 60\.00° the deviation is larger: δ = 38\.88°/)
})

test('prism dispersion and TIR at the second face', async () => {
  // At red's minimum deviation (θ1 = sin⁻¹(1.513 · 0.5) = 49.16°), violet: θ2 = sin⁻¹(sin 49.16°/1.532)
  // = 29.59°, θ3 = 30.41°, θ4 = sin⁻¹(1.532 sin 30.41°) = 50.85°, δ = 40.00°; red δ = 38.31°.
  const s = { mode: 'prism', n: { red: 1.513, violet: 1.532 } }
  const r = await renderAsync(spec(s))
  assert.deepEqual(problems(r), [])
  const v = run(prismMode, s).vals
  near(v.delta_red.v, 38.31, 0.005, 'δ red'); near(v.delta_violet.v, 40.00, 0.01, 'δ violet')
  near(v.spread.v, v.delta_violet.v - v.delta_red.v, 1e-9, 'spread')
  assert.match(r.summary, /spread δ_violet − δ_red = 1\.69\d°/)
  assert.match(r.svg, /violet/)
  // θ1 = 20°: θ2 = sin⁻¹(sin 20°/1.5) = 13.18°, θ3 = 46.82° > θc = 41.81°.
  const t = await renderAsync(spec({ mode: 'prism', n: 1.5, angle: 20 }))
  assert.deepEqual(problems(t), [])
  assert.match(t.summary, /θ3 46\.82° = A − θ2, TIR at the second face \(θ3 > θc 41\.81°\)/)
})

test('apparent depth: 2.00 m of water looks 1.504 m deep, and the dashed extensions meet at the drawn image', async () => {
  // n1/d_o + n2/d_i = 0: d_i = −(1.00/1.33) · 2.00 m = −1.504 m.
  const s = spec({ mode: 'depth', unit: 'm', media: [water, air], depth: 2, expect: { depth: '150.4 cm', di: -1.504 } })
  const r = await renderAsync(s)
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /d_i = −\(n2\/n1\) d_o = −1\.504 m \(virtual, above the object\); apparent depth \|d_i\| 1\.504 m/)
  assert.match(r.summary, /expect: depth ok, di ok/)
  // The image circle and the dashed extensions' ends agree within 1.5 px.
  const cy = +/<circle cx="0" cy="([\d.]+)" r="3.5" fill="none"/.exec(r.svg)[1]
  const ends = [...r.svg.matchAll(/<line [^>]*y2="([\d.]+)"[^>]*stroke-dasharray="5 3"/g)].map((m) => +m[1])
  assert.equal(ends.length, 2)
  for (const y of ends) near(y, cy, 1.5, 'extension meets the image')
  const bad = await renderAsync(spec({ ...s, expect: { depth: 2.66, di: 1.504 } }))
  assert.match(warnings(bad), /expect\.depth: 2\.660 uses n1\/n2; the apparent depth is d_o·n2\/n1/)
  assert.match(warnings(bad), /expect\.di: 1\.504 has the wrong sign: the image is virtual/)
})

test('fiber 1.50/1.40: NA 0.5385, θmax 32.58°; 30° is guided (φ 70.53° > θc 68.96°), 50° escapes', async () => {
  // NA = √(1.50² − 1.40²) = √0.29 = 0.5385; θmax = sin⁻¹ 0.5385 = 32.58°.
  // θ = 30°: θr = sin⁻¹(sin 30°/1.5) = 19.47°, φ = 70.53°, θc = sin⁻¹(1.4/1.5) = 68.96°.
  const v = run(fiberMode, { core: 1.5, clad: 1.4, angle: 30 }).vals
  near(v.NA.v, 0.5385, 5e-5, 'NA'); near(v.accept.v, 32.58, 0.005, 'θmax')
  near(v.thetar.v, 19.47, 0.005, 'θr'); near(v.phi.v, 70.53, 0.005, 'φ'); near(v.thetac.v, 68.96, 0.005, 'θc')
  const r = await renderAsync(spec({ mode: 'fiber', core: 1.5, clad: 1.4, angle: 30 }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /φ > θc: TIR at every wall/)
  // θ = 50°: θr = 30.71°, φ = 59.29° < 68.96°: out at sin⁻¹(1.5 sin 59.29°/1.4) = 67.10°.
  const e = await renderAsync(spec({ mode: 'fiber', core: 1.5, clad: 1.4, angle: 50 }))
  assert.deepEqual(problems(e), [])
  assert.match(e.summary, /φ ≤ θc: the ray escapes at its first wall hit, refracted out at 67\.10°/)
  // A bare glass rod in air: NA = √(2.25 − 1) = 1.118 ≥ 1, so every angle is accepted.
  near(run(fiberMode, { core: 1.5, angle: 60 }).vals.accept.v, 90, 0, 'bare rod θmax')
})

test('expect misses name the slip: from the surface, radians, or φ taken from the axis', async () => {
  const w = { mode: 'refraction', media: [air, water], angle: 40 }
  // 90° − 28.90° = 61.10° is the angle from the surface; 41.81° in radians is 0.7297.
  const r = await renderAsync(spec({ ...w, expect: { theta2: 61.1 } }))
  assert.match(warnings(r), /expect\.theta2: 61\.10 is measured from the surface; angles here are from the normal: θ2 = 28\.90°/)
  assert.match(r.summary, /expect: theta2 WRONG/)
  const rad = await renderAsync(spec({ mode: 'refraction', media: [glass, air], angle: 50, expect: { 'θ_c': 0.7297 } }))
  assert.match(warnings(rad), /is in radians; angles here are in degrees: θ_c = 41\.81°/)
  const f = await renderAsync(spec({ mode: 'fiber', core: 1.5, clad: 1.4, angle: 30, expect: { phi: 19.47 } }))
  assert.match(warnings(f), /expect\.phi: 19\.47 is θr, from the axis; φ is from the wall's normal/)
})

test('bad input says what to write', async () => {
  const bad = async (s, re) => { const r = await renderAsync(spec(s)); assert.equal(r.svg, null, JSON.stringify(s)); assert.match(r.text, re) }
  await bad({ mode: 'refraction', media: [air], angle: 30 }, /media is 2 or more layers/)
  await bad({ mode: 'refraction', media: [air, glass, air], angle: 30 }, /media\[1\]\.t: a middle layer needs its thickness t/)
  await bad({ mode: 'refraction', media: [air, glass], angle: 95 }, /angle \(θ1, from the normal\) is from 0 up to 90 degrees/)
  await bad({ mode: 'refraction', media: [air, glass] }, /angle is θ1, the angle of incidence from the normal/)
  await bad({ mode: 'refraction', media: [air, { label: 'glass' }], angle: 30 }, /each medium is \{"n": 1\.50/)
  await bad({ mode: 'refraction', media: [air, glass], angle: '30 cm' }, /is a length; this takes an angle/)
  await bad({ mode: 'refraction', unit: 'inch', media: [air, glass], angle: 30 }, /unit is a length unit/)
  await bad({ mode: 'prism' }, /n is the prism's index/)
  await bad({ mode: 'prism', n: 1.5, apex: 170 }, /apex is the prism angle A/)
  await bad({ mode: 'depth', media: [water, air] }, /depth is the object's real depth/)
  await bad({ mode: 'fiber', angle: 30 }, /core is the core's index/)
  // Drawable but suspicious: a cladding at or above the core guides nothing.
  const c = await renderAsync(spec({ mode: 'fiber', core: 1.4, clad: 1.5, angle: 10 }))
  assert.match(warnings(c), /clad: TIR needs the cladding below the core/)
  const half = await renderAsync(spec({ mode: 'refraction', media: [{ ...air, t: 3 }, glass], angle: 30 }))
  assert.match(warnings(half), /media\[0\]\.t: the first medium is a half-space; its t is ignored/)
})
