import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderAsync } from '../../index.js'
import { solve, principal } from './rays.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const problems = (r) => r.diagnostics.filter((d) => d.level !== 'note').map((d) => `${d.path}: ${d.msg}`)
const warnings = (r) => r.diagnostics.filter((d) => d.level === 'warning').map((d) => `${d.path}: ${d.msg}`).join('\n')
const spec = (rest) => ({ v: 1, kind: 'optics', ...rest })
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`)
const lens = (f, at) => ({ type: 'lens', f, at, plane: false })

// Thin lens and mirror, by hand (OpenStax: 1/d_o + 1/d_i = 1/f, m = −d_i/d_o):
//   converging f 10, d_o 30: 1/d_i = 1/10 − 1/30 = 1/15, d_i 15, m −0.5 (real, inverted)
//   converging f 10, d_o 6 (a magnifier): 1/d_i = 1/10 − 1/6 = −1/15, d_i −15, m 2.5 (virtual, upright)
//   diverging f −10, d_o 20: 1/d_i = −1/10 − 1/20 = −3/20, d_i −6.667, m 0.3333
//   concave mirror R 20 (f 10), d_o 30: d_i 15, m −0.5; convex R −20 (f −10), d_o 15: 1/d_i = −1/10 − 1/15, d_i −6, m 0.4
test('single lenses and mirrors: d_i, m, h_i, and the image type match the hand values', async () => {
  const cases = [
    [{ elements: [{ type: 'lens', f: 10 }], object: { d: 30, h: 2 } }, 'd_i 15.00 cm, m −0.5000, h_i −1.000 cm, real, inverted, reduced'],
    [{ elements: [{ type: 'lens', f: 10 }], object: { d: 6, h: 1.5 } }, 'd_i −15.00 cm, m 2.500, h_i 3.750 cm, virtual, upright, enlarged'],
    [{ elements: [{ type: 'lens', f: -10 }], object: { d: 20, h: 2 } }, 'd_i −6.667 cm, m 0.3333, h_i 0.6667 cm, virtual, upright, reduced'],
    [{ elements: [{ type: 'mirror', R: 20 }], object: { d: 30, h: 2 } }, 'd_i 15.00 cm, m −0.5000, h_i −1.000 cm, real, inverted, reduced'],
    [{ elements: [{ type: 'mirror', R: -20 }], object: { d: 15, h: 2 } }, 'd_i −6.000 cm, m 0.4000, h_i 0.8000 cm, virtual, upright, reduced'],
    [{ elements: [{ type: 'mirror' }], object: { d: 10, h: 3 } }, 'd_i −10.00 cm, m 1.000, h_i 3.000 cm, virtual, upright, same size'],
  ]
  for (const [s, want] of cases) {
    const r = await renderAsync(spec(s))
    assert.deepEqual(problems(r), [])
    assert.ok(r.summary.includes(want), `${JSON.stringify(s)}: ${r.summary}`)
  }
  for (const f of ['converging-lens.json', 'diverging-lens.json', 'concave-mirror.json', 'two-lens.json']) {
    const ex = load(f)
    for (const step of ex.steps ? ex.steps.keys() : [undefined]) {
      const r = await renderAsync(ex, { step })
      assert.match(r.summary, /expect: (\w+ ok, )*\w+ ok$/, `${f} step ${step}: ${r.summary}`)
    }
  }
})

// Two lenses, each image the next lens's object:
//   f1 10, f2 10 at 50, d_o 20: I1 d_i 20 (at 20), m1 −1; d_o2 = 50 − 20 = 30, d_i2 15 (at 65), m2 −0.5; M 0.5 upright
//   f1 10, f2 −10 at 15, d_o 20: I1 at 20 lies 5 past L2, so d_o2 = −5 (virtual); 1/d_i2 = −1/10 + 1/5, d_i2 10, m2 2; M −2
//   microscope, objective 1.0 and eyepiece 2.5 at 8.0, d_o 1.2: d_i1 6, m1 −5; d_o2 2, d_i2 −10, m2 5; M −25
test('two-lens systems: intermediate images, a virtual object, and the total magnification', async () => {
  const two = await renderAsync(load('two-lens.json'))
  assert.match(two.summary, /I1: d_o 20\.00 cm from L1, d_i 20\.00 cm, m −1\.000/)
  assert.match(two.summary, /I2: d_o 30\.00 cm from L2, d_i 15\.00 cm, m −0\.5000/)
  assert.match(two.summary, /final image: d_i 15\.00 cm from L2 \(65\.00 cm past L1\), M = m1·m2 = 0\.5000, h_i 1\.000 cm, real, upright, reduced/)
  const virt = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }, { type: 'lens', f: -10, at: 15 }], object: { d: 20, h: 2 } }))
  assert.deepEqual(problems(virt), [])
  assert.match(virt.summary, /I2: d_o −5\.000 cm \(a virtual object, past the lens\) from L2, d_i 10\.00 cm, m 2\.000/)
  assert.match(virt.summary, /M = m1·m2 = −2\.000/)
  assert.match(virt.summary, /rays from L1 are traced on through L2/)
  const micro = await renderAsync(spec({ elements: [{ type: 'lens', f: 1, label: 'objective' }, { type: 'lens', f: 2.5, at: 8, label: 'eyepiece' }], object: { d: 1.2, h: 0.2 }, expect: { di1: 6, m1: -5, do2: 2, di2: -10, m: -25 } }))
  assert.match(micro.summary, /expect: di1 ok, m1 ok, do2 ok, di2 ok, m ok$/)
})

// Every principal ray leaves the element through the image point (paraxial optics is exact for
// thin elements), so the drawn rays meet where the equation puts the image.
test('each principal ray passes through the image the equation gives', () => {
  const configs = [[lens(10, 0), 30], [lens(10, 0), 6], [lens(-10, 0), 20], [lens(-4, 0), 3], [{ type: 'mirror', f: 10, at: 0 }, 25], [{ type: 'mirror', f: -10, at: 0 }, 15]]
  for (const [E, d] of configs) {
    const [st] = solve([E], { d, h: 2 })
    for (const name of ['parallel', 'center', 'focal', 'vertex']) {
      const r = principal(st, name)
      if (!r) continue
      // Unfolded: the outgoing line y = yH + sOut·(x − x_E) reaches the image at x = x_E + d_i.
      near(r.yH + r.sOut * st.dI, st.yQ, 1e-9, `${E.type} f ${E.f} d_o ${d}: ${name} ray at the image`)
    }
  }
})

test('expect names a wrong value and says why: the sign, the first element, m of one lens', async () => {
  const r = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }], object: { d: 6 }, expect: { di: 15, m: -2.5, image: 'real, upright' } }))
  const w = warnings(r)
  assert.match(w, /expect\.di: 15\.00 has the wrong sign: d_i is positive for a real image and negative for a virtual one: d_i = −15\.00 cm/)
  assert.match(w, /expect\.m: −2\.500 has the wrong sign: m < 0 is an inverted image: m = 2\.500/)
  assert.match(w, /expect\.image: "real, upright" is wrong: the image is virtual, upright, enlarged/)
  const sys = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }, { type: 'lens', f: 10, at: 50 }], object: { d: 20 }, expect: { di: 65, m: -0.5 } }))
  assert.match(warnings(sys), /expect\.di: 65\.00 is measured from L1; d_i is from the last element/)
  assert.match(warnings(sys), /expect\.m: −0\.5000 is m_2 alone; the total is the product M = m1·m2/)
})

test('bad input says what to write instead', async () => {
  const err = async (s) => (await renderAsync(spec(s))).diagnostics.find((d) => d.level === 'error')
  assert.match((await err({ elements: [{ type: 'lens' }], object: { d: 10 } })).msg, /a lens needs f: positive for a converging lens/)
  assert.match((await err({ elements: [{ type: 'lens', f: 10 }, { type: 'mirror', f: 5, at: 20 }], object: { d: 30 } })).msg, /a mirror must be the only element/)
  assert.match((await err({ elements: [{ type: 'lens', f: 10 }, { type: 'lens', f: 5 }], object: { d: 30 } })).msg, /give each element after the first its place on the axis/)
  assert.match((await err({ elements: [{ type: 'lens', f: 10 }], object: { d: -5 } })).msg, /d is the object distance from the first element, positive/)
  const atF = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }], object: { d: 10 } }))
  assert.match(atF.summary, /at the focal point: d_i = ∞, the rays leave parallel/)
})

// A distant object focuses on the focal plane: h_i = −f tan θ = −50 tan 2° = −1.746 cm. With the
// eyepiece's F on that image (separation f_obj + f_eye = 60), the rays leave parallel and the
// angular magnification is θ′/θ = −f_obj/f_eye = −50/10 = −5 (OpenStax 2.8). A magnifier with the
// object at F gives M = 25 cm/f = 2.5 (OpenStax 2.7, the image at infinity).
test('telescope and magnifier: a distant object, the image at infinity, and angular magnification', async () => {
  const scope = await renderAsync(spec({ elements: [{ type: 'lens', f: 50 }, { type: 'lens', f: 10, at: 60 }], object: { d: 'inf', angle: 2 }, expect: { di1: 50, angular: -5 } }))
  assert.deepEqual(problems(scope), [])
  assert.match(scope.summary, /I1: d_o ∞, d_i 50\.00 cm \(= f, the focal plane\) from L1, h_i = f tan θ = −1\.746 cm, real, inverted/)
  assert.match(scope.summary, /angular magnification M = θ′\/θ = −5\.000/)
  assert.match(scope.summary, /expect: di1 ok, angular ok$/)
  const mag = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }], object: { d: 10, h: 1 } }))
  assert.match(mag.summary, /angular magnification M = 25 cm\/f \(near point 25 cm\) = 2\.500/)
  // An intermediate image at infinity: lens 2 sees parallel rays at slope −h/f_1 = −0.1 and
  // images them at its focal plane, h_i = −0.1 × 15 = −1.5 cm.
  const relay = await renderAsync(spec({ elements: [{ type: 'lens', f: 10 }, { type: 'lens', f: 15, at: 25 }], object: { d: 10, h: 1 } }))
  assert.match(relay.summary, /I2: d_o ∞, d_i 15\.00 cm \(= f, the focal plane\) from L2, h_i = f tan θ = −1\.500 cm/)
})
