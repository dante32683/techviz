import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const spec = (rest) => ({ v: 1, kind: 'bfield', ...rest })

// 4 A out at x = −4 cm and 6 A in at x = +4 cm: at the midpoint μ₀I/2πr = 2e-5 T and 3e-5 T, both
// up, so 5e-5 T at 90°; F/L = μ₀(4)(6)/2π(0.08) = 6e-5 N/m, and opposite currents repel.
test('two wires: B at the midpoint adds to 5e-5 T up; they repel with 6e-5 N/m', async () => {
  const r = await renderAsync(load('wires.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /P \(0, 0\): \|B\| = 5e-5 T at 90° \[1: 2e-5 T at 90°; 2: 3e-5 T at 90°\]/)
  assert.match(r.summary, /wires 1–2: d = 8 cm, F\/L = μ₀I₁I₂\/2πd = 6e-5 N\/m, repel/)
  assert.match(r.summary, /F\/L on 1 = 6e-5 N\/m toward 180°; F\/L on 2 = 6e-5 N\/m toward 0°/)
  assert.match(r.summary, /\d+ field lines$/)
})

// r = mv/qB = 1.6726e-27 (3e6) / (1.602e-19 × 0.5) = 6.26 cm; T = 2πm/qB = 1.31e-7 s. A positive
// charge in B into the page circles counterclockwise.
test('proton in B into the page: r = 6.26 cm, T = 1.31e-7 s, a closed ccw circle', async () => {
  const r = await renderAsync(load('proton.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /r = mv⊥\/\|q\|B = 6\.26 cm, T = 2πm\/\|q\|B = 1\.31e-7 s, f = 7\.62e6 Hz/)
  assert.match(r.summary, /circles ccw \(seen from \+z\), closes a full circle/)
})

// emf = Bℓv = 0.8 (0.25) (3) = 0.6 V, I = 0.3 A; flux out of the page grows, so I_ind is clockwise;
// F = IℓB = 0.06 N backward; P = I²R = Fv = 0.18 W; q v × B pushes + charge down, so the bottom is +.
test('sliding bar: emf = Bℓv = 0.6 V, clockwise, F = 0.06 N against v, bottom end +', async () => {
  const r = await renderAsync(load('rails.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /dΦ\/dt = 0\.6 Wb\/s \(bar sliding\), \|emf\| = \|dΦ\/dt\| = 0\.6 V, I = emf\/R = 0\.3 A/)
  assert.match(r.summary, /I_ind clockwise as viewed from \+z, so B_ind at the center points into the page \(−z\)/)
  assert.match(r.summary, /F_B on the bar = IℓB = 0\.06 N toward 180° \(opposes v\), P = I²R = 0\.18 W = Fv = 0\.18 W; bottom end of the bar is \+/)
})

// Life's Exam III practice A-03: N = 50, r = 4 cm, dB/dt = 2 T/s, R = 10 Ω: emf = Nπr² dB/dt =
// 0.503 V, I = 0.0503 A, clockwise from +z with B_ind into the page. Induced E = (r/2) dB/dt =
// 0.02 V/m at 2 cm; outside the 6 cm field, E = R²/(2r) dB/dt = 0.036 V/m at 10 cm.
test('coil in a growing field (A-03): 0.503 V, clockwise, induced E inside and outside', async () => {
  const r = await renderAsync(load('coil.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /\|emf\| = N\|dΦ\/dt\| = 0\.503 V, I = emf\/R = 0\.0503 A, I_ind clockwise as viewed from \+z, so B_ind at the center points into the page \(−z\)/)
  assert.match(r.summary, /path 1 \(circle r = 2 cm at \(0, 0\), ccw\): Φ = 1\.26e-4 Wb, dΦ\/dt = 0\.00251 Wb\/s, ∮E·dl = −dΦ\/dt, induced E = \|dΦ\/dt\|\/2πr = 0\.02 V\/m cw/)
  assert.match(r.summary, /induced E = \|dΦ\/dt\|\/2πr = 0\.036 V\/m cw/)
  // The same field falling: counterclockwise.
  const down = load('coil.json')
  down.sources[0].dBdt = 'decreasing'
  const d = await renderAsync(down)
  assert.match(d.summary, /flux along the normal decreasing \(B changing\), I_ind counterclockwise as viewed from \+z/)
  assert.doesNotMatch(d.summary, /emf = N/)
})

// Life's B-01: E/B = 2.4e4/0.12 = 2e5 m/s passes; then in 0.2 T, r = mv/qB = 4.17 cm, f = 7.63e5 Hz,
// a half circle (clockwise for + charge, B out) that leaves the magnet 2r = 8.34 cm lower.
test('velocity selector and mass spectrometer: balanced, then a half circle of r = 4.17 cm', async () => {
  const r = await renderAsync(load('spectrometer.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /in selector B = 0\.12 T and E = 24000 V\/m: E\/B = 2e5 m\/s vs v = 2e5 m\/s, qE balances qv×B: passes undeflected/)
  assert.match(r.summary, /in magnet B = 0\.2 T: r = mv⊥\/\|q\|B = 4\.17 cm, T = 2πm\/\|q\|B = 1\.31e-6 s, f = 7\.63e5 Hz/)
  assert.match(r.summary, /leaves it at \(-?0\.0\d+, -8\.34\) heading 180° \(turned 180° cw\)/)
  // Too fast for the selector: the magnetic force wins.
  const fast = load('spectrometer.json')
  fast.particles[0].v = '3e5 m/s'
  assert.match((await renderAsync(fast)).summary, /F_E = 3\.85e-15 N, F_B = 5\.77e-15 N: the magnetic force wins/)
})

// Life's A-07: τ = NIAB sin θ = 20 (0.5) (0.01) (0.2) sin 30° = 0.01 N·m, turning μ toward B.
test('torque on an edge-on loop: τ = NIAB sin θ = 0.01 N·m, clockwise', async () => {
  const r = await renderAsync(load('torque.json'))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /μ = NIA = 0\.1 A·m², B = 0\.2 T, angle\(μ, B\) = 30°, τ = μB sin θ = 0\.01 N·m, turning cw \(μ toward B\)/)
})

// Life's A-01: v = 3e6 x̂ + 4e6 ẑ in B = 0.2 ẑ, drawn side-on with B up: r = mv⊥/qB = 0.157 m,
// T = 3.28e-7 s, pitch = v∥T = 1.31 m; at the start F_B = qv × B leaves the page.
test('helix side-on (A-01): r = 0.157 m, T = 3.28e-7 s, pitch 1.31 m', async () => {
  const r = await renderAsync(spec({ sources: [{ type: 'region', B: '0.2 T', dir: 'up' }], particles: [{ type: 'proton', v: ['3e6 m/s', '4e6 m/s'] }] }))
  assert.deepEqual(problems(r), [])
  assert.match(r.summary, /r = mv⊥\/\|q\|B = 0\.157 m, T = 2πm\/\|q\|B = 3\.28e-7 s/)
  assert.match(r.summary, /helix: v∥ = 4e6 m\/s along B, v⊥ = 3e6 m\/s, pitch = v∥T = 1\.31 m/)
  assert.match(r.svg, /1\.31 m</)
})

// Life's A-02: B = μ₀I/(4πb) · 2a/√(a² + b²) = 6.66e-6 T, out of the page above a +x current.
test('finite segment (A-02): Biot–Savart gives 6.66e-6 T out of the page', async () => {
  const r = await renderAsync(spec({ sources: [{ type: 'segment', from: [-0.15, 0], to: [0.15, 0], I: '4 A' }], points: { P: { at: [0, 0.1], B: true } } }))
  assert.match(r.summary, /P \(0, 0\.1\): \|B\| = 6\.66e-6 T out of the page \(\+z\)/)
})

// Life's B-02: parallel wires in the page attract; a thick wire (a = 3 mm, 5 A) encloses I r²/a².
test('in-page wires attract; Ampère inside and outside a thick wire', async () => {
  const w = await renderAsync(spec({ unit: 'cm', sources: [{ id: 'L', type: 'segment', from: [0, 0], to: [0, 1], infinite: true, I: '4 A' }, { id: 'R', type: 'segment', from: [8, 0], to: [8, 1], infinite: true, I: '6 A' }], points: { M: { at: [4, 0], B: true } } }))
  assert.match(w.summary, /M \(4, 0\): \|B\| = 1e-5 T out of the page \(\+z\) \[L: 2e-5 T into the page \(−z\); R: 3e-5 T out of the page \(\+z\)\]/)
  assert.match(w.summary, /wires L–R: d = 8 cm, F\/L = μ₀I₁I₂\/2πd = 6e-5 N\/m, attract/)
  const c = await renderAsync(spec({ unit: 'mm', sources: [{ type: 'cylinder', r: 3, I: '5 A' }], paths: [{ r: 1.5 }, { r: 6 }] }))
  assert.match(c.summary, /path 1 \(circle r = 1\.5 mm at \(0, 0\), ccw\): I_enc = 1\.25 A, μ₀I_enc = 1\.57e-6 T·m, ∮B·dl = 1\.57e-6 T·m, average B along it = 1\.67e-4 T/)
  assert.match(c.summary, /path 2 \(circle r = 6 mm at \(0, 0\), ccw\): I_enc = 5 A, μ₀I_enc = 6\.28e-6 T·m, ∮B·dl = 6\.28e-6 T·m, average B along it = 1\.67e-4 T/)
})

// Life's B-05: N = 600, ℓ = 0.3 m, r = 1.2 cm, 2 A: B = μ₀nI = 5.03 mT, L = μ₀N²A/ℓ = 6.82e-4 H,
// U = ½LI² = 1.36e-3 J.
test('solenoid (B-05): B = μ₀nI, L = μ₀N²A/ℓ, U = ½LI²', async () => {
  const r = await renderAsync(spec({ unit: 'cm', sources: [{ type: 'solenoid', length: 30, r: 1.2, N: 600, I: '2 A' }] }))
  assert.match(r.summary, /B = μ₀nI = 0\.00503 T toward 0° inside .*L = μ₀N²A\/ℓ = 6\.82e-4 H, U = ½LI² = 0\.00136 J/)
})

test('solenoid: a box across one row encloses nℓI', async () => {
  const r = await renderAsync(spec({ unit: 'cm', sources: [{ type: 'solenoid', length: 12, r: 3, n: 2000, I: '2 A' }], paths: [{ box: [[-3, 1.5], [3, 6]] }] }))
  assert.match(r.summary, /n = 2000 turns\/m, B = μ₀nI = 0\.00503 T toward 0° inside/)
  assert.match(r.summary, /I_enc = 240 A, μ₀I_enc = 3\.02e-4 T·m, ∮B·dl = 3\.02e-4 T·m/)
})

test('Lenz from directions alone: entering a field, beside a growing current, turning', async () => {
  // A loop moving right into B into the page: inward flux grows, so I_ind is ccw (B_ind out).
  const entering = await renderAsync(spec({ sources: [{ type: 'region', B: '1 T', dir: 'in', box: [[0, -1], [3, 1]] }], induction: [{ at: [-0.2, 0], w: 1, h: 1, dir: 'right' }] }))
  assert.match(entering.summary, /I_ind counterclockwise as viewed from \+z, so B_ind at the center points out of the page/)
  // A loop above a +x current (B out of the page there) that is increasing: I_ind clockwise.
  const wire = await renderAsync(spec({ sources: [{ type: 'segment', from: [-1, 0], to: [1, 0], infinite: true, I: '10 A', dIdt: 'increasing' }], induction: [{ at: [0, 1], w: 1, h: 1 }] }))
  assert.match(wire.summary, /I_ind clockwise as viewed from \+z/)
  // B-04: 100 turns, 0.012 m², 20 rev/s in 0.3 T: peak NBAω = 45.2 V.
  const gen = await renderAsync(spec({ sources: [{ type: 'region', B: '0.3 T', dir: 'out' }], induction: [{ w: 0.1, h: 0.12, N: 100, omega: '20 rev/s', theta: 30 }] }))
  assert.match(gen.summary, /peak NBAω = 45\.2 V/)
  assert.match(gen.summary, /\|emf\| = N\|dΦ\/dt\| = 22\.6 V/)
})

test('mistakes come back with a path and a fix', async () => {
  const noI = await renderAsync(spec({ sources: [{ type: 'wire', at: [0, 0] }] }))
  assert.match(noI.text, /sources\[0\]\.I: a wire needs I/)
  const unit = await renderAsync(spec({ sources: [{ type: 'wire', I: '2 T' }] }))
  assert.match(unit.text, /sources\[0\]\.I: this takes A/)
  const noDir = await renderAsync(spec({ sources: [{ type: 'region', B: '1 T' }] }))
  assert.match(noDir.text, /sources\[0\]\.dir: a region with B needs dir/)
  const eCircle = await renderAsync(spec({ sources: [{ type: 'region', E: '1 V/m', circle: { r: 1 } }] }))
  assert.match(eCircle.text, /sources\[0\]\.E: E needs a box region/)
  const noM = await renderAsync(spec({ sources: [{ type: 'region', B: '1 T', dir: 'in' }], particles: [{ q: 'e', v: '1 m/s' }] }))
  assert.match(noM.text, /particles\[0\]: a particle needs type/)
  const arrows = await renderAsync(spec({ sources: [{ type: 'region', B: '1 T', dir: 'in' }], particles: [{ type: 'proton', v: '1e5 m/s', arrows: ['middle'] }] }))
  assert.match(arrows.text, /particles\[0\]\.arrows\[0\]: each is start, entry, exit, end/)
  const type = await renderAsync(spec({ sources: [{ type: 'magnet' }] }))
  assert.match(type.text, /sources\[0\]\.type: type is one of wire, segment, loop/)
  const mode = await renderAsync(spec({ sources: [{ type: 'wire', I: 1 }], B: 'grid' }))
  assert.match(mode.text, /B: B is "arrows"/)
  const onWire = await renderAsync(spec({ sources: [{ type: 'wire', I: 1 }], points: { A: [0, 0], B: [1, 0] } }))
  assert.match(problems(onWire).join('\n'), /points\.A: point A sits on a wire/)
})
