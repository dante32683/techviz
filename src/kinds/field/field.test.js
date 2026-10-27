import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)

// σ = 55.5 pC/m²: E = σ/2ε₀ = 3.134 V/m. B is 4.50 m straight above A and the plane runs at
// −45°, so d∥ = 4.50 cos 45° = 3.18 m and V_B − V_A = −E d∥ = −9.97 V.
test('tilted plane: E = σ/2ε₀, d∥ = 3.18 m, V_B − V_A = −9.97 V', async () => {
  const r = await renderAsync(load('tilted-plane.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /^field: plane \+55\.5 pC\/m\^2 at -45° \(E = σ\/2ε₀ = 3\.13 V\/m\)/)
  assert.match(r.summary, /A \(2, 1\) \|E\| = 3\.13 V\/m at 45°/)
  assert.match(r.summary, /V_\{B\} − V_\{A\} = -9\.97 V/)
  assert.match(r.summary, /A→B: 4\.5 m at 90°, d_∥ = 3\.18 m along E, d_⊥ = 3\.18 m, −E d_∥ = -9\.97 V/)
  assert.match(r.summary, /2 equipotentials$/)
  assert.match(r.svg, /stroke-dasharray="6 4"/)
})

test('the same plane on the far side of the points flips the sign of E·d', async () => {
  const spec = load('tilted-plane.json')
  spec.sources[0].sigma = '-55.5 pC/m^2'
  const r = await renderAsync(spec)
  assert.match(r.summary, /V_\{B\} − V_\{A\} = 9\.97 V/)
  assert.match(r.summary, /d_∥ = -3\.18 m along E/)
})

// Dipole ±2 nC at ±2 cm: at the midpoint E = 2kq/r² = 89 900 V/m toward the − charge, V = 0.
test('dipole: E at the midpoint is 2kq/r² toward −q, and the bisector is at V = 0', async () => {
  const r = await renderAsync(load('dipole.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /P \(0, 0\) \|E\| = 89900 V\/m at 0°, V = 0 V/)
  assert.match(r.summary, /V = 0 at infinity; V_\{Q\} − V_\{P\} = 0 V/)
  assert.match(r.summary, /\d+ field lines, 6 equipotentials$/)
})

test('parallel plates: σ/ε₀ between, the path drops −E d∥, the gap is dimensioned', async () => {
  const r = await renderAsync(load('capacitor.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /E = σ\/ε₀ = 1000 V\/m between, 0 outside/)
  assert.match(r.summary, /V_\{B\} − V_\{A\} = -3 V; A→B: 4\.61 mm at 319°, d_∥ = 3 mm along E, d_⊥ = 3\.5 mm, −E d_∥ = -3 V/)
  assert.match(r.summary, /dims C gap 4 mm/)
  // Outside, E = 0; from one side to the other V drops by E × gap = 4 V.
  const out = await renderAsync({ ...load('capacitor.json'), points: { A: [0, 3], B: [0, -3] }, displacements: [] })
  assert.match(out.summary, /A \(0, 3\) \|E\| = 0 V\/m, V = 2 V; B \(0, -3\) \|E\| = 0 V\/m, V = -2 V/)
  assert.match(out.summary, /V_\{B\} − V_\{A\} = -4 V/)
})

// Rod of length 2a = 6 cm, λ = 5 nC/m, P at d = 4 cm on the bisector:
// E = 2kλa/(d√(a² + d²)) = 1350 V/m, V = 2kλ asinh(a/d) = 62.3 V.
test('finite rod: E and V on the bisector match the closed forms', async () => {
  const r = await renderAsync(load('rod.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /P \(0, 4\) \|E\| = 1350 V\/m at 90°, V = 62\.3 V/)
  assert.match(r.summary, /dims P–rod 4 cm/)
})

test('two line charges: E cancels midway; ΔV = −2kλ·2 ln(r_B/r_A)', async () => {
  const r = await renderAsync(load('line-charges.json'))
  assert.match(r.summary, /A \(0, 0\) \|E\| = 0 V\/m; B \(0, 2\) \|E\| = 46 V\/m at 90°/)
  assert.match(r.summary, /V_\{B\} − V_\{A\} = -73\.5 V/)
})

test('mistakes come back with a path and a fix', async () => {
  const base = load('tilted-plane.json')
  const noSrc = await renderAsync({ ...base, sources: [] })
  assert.match(noSrc.text, /sources: sources lists the charges/)
  const unit = await renderAsync({ ...base, sources: [{ type: 'plane', sigma: '2 nC' }] })
  assert.match(unit.text, /sources\[0\]\.sigma: a plane takes sigma in C\/m\^2/)
  const missing = await renderAsync({ ...base, sources: [{ type: 'point', at: [0, 0] }] })
  assert.match(missing.text, /sources\[0\]\.q: a point needs q/)
  const badPt = await renderAsync({ ...base, displacements: [{ from: 'A', to: 'C' }] })
  assert.match(badPt.text, /displacements\[0\]\.to: no point "C"; points: A, B/)
  const onCharge = await renderAsync({ v: 1, kind: 'field', sources: [{ type: 'point', q: 1e-9 }], points: { A: [0, 0], B: [1, 0] } })
  assert.match(problems(onCharge).join('\n'), /points\.A: point A sits on a source/)
  const vals = await renderAsync({ ...base, sources: [...base.sources, { type: 'point', at: [3, 3], q: 1e-9 }], equipotentials: { values: [1] } })
  assert.match(problems(vals).join('\n'), /equipotentials\.values: values need a zero of potential/)
  const mode = await renderAsync({ ...base, E: 'grid' })
  assert.match(mode.text, /E: E is "arrows"/)
})
