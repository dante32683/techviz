import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../../index.js'

const load = (f) => JSON.parse(readFileSync(new URL(`examples/${f}`, import.meta.url), 'utf8'))
const notes = (r) => r.diagnostics.filter((d) => d.level === 'note').map((d) => d.msg)

test('hanging wire: both panels balance, the field is drawn', async () => {
  const r = await renderAsync(load('hanging-wire.json'))
  assert.match(r.summary, /^fbd: 2 panels; \[1 T = 0\] body \(bar\): F_\{B\} up 0.1176, mg down 0.1176; ΣF = 0 N \(balanced\)/)
  assert.match(r.summary, /T up 0.1176, T up 0.1176, mg down 0.1176, F_\{B\} down 0.1176; ΣF = 0 N \(balanced\); field drawn$/)
  assert.equal((r.svg.match(/<circle[^>]*r="5.5"/g) ?? []).length > 20, true)
})

test('incline: normal, uphill and components follow the surface', async () => {
  const r = await renderAsync(load('incline.json'))
  assert.match(r.summary, /N 120° 16.97, mg down 19.6, f_\{s\} 30° 9.8/)
  assert.match(notes(r)[0], /\|ΣF\| = 0.004/)
})

test('beam: reactions balance forces and moments, resultant at the load centroid', async () => {
  const r = await renderAsync(load('beam.json'))
  assert.match(r.summary, /\[2 free body\] .*A_\{x\} right 0, A_\{y\} up 10.5, B_\{y\} up 11.5, 12 kN down 12; ΣF = 0 kN \(balanced\); ΣM\(start\) = 0; load on beam from 0.5 to 1, resultant at 0.75/)
  assert.match(r.summary, /\[1 beam\] .*ΣF = \(0, -22\) kN.*ΣM\(start\) = -69/)
})

test('right-hand rule: F = v × B with B into the page points up', async () => {
  const r = await renderAsync(load('rhr.json'))
  assert.match(r.summary, /F = v×B up; vectors: v right, B in/)
  const neg = await renderAsync({ v: 1, kind: 'fbd', forces: [{ id: 'v', dir: 'right', label: 'v', vector: true }, { id: 'B', dir: 'in', label: 'B', vector: true }, { cross: ['v', 'B'], sign: '-', label: 'F' }] })
  assert.match(neg.summary, /F = −v×B down/)
})

test('net force and its sum', async () => {
  const r = await renderAsync(load('charge.json'))
  assert.match(r.summary, /ΣF = \(1.368, 1.474\) N, \|ΣF\| = 2.011 N 47.14°/)
  assert.match(r.svg, /F<\/tspan><tspan[^>]*>net/)
})

test('two forces on the same point and line are fanned apart', async () => {
  const r = await renderAsync({ v: 1, kind: 'fbd', body: { type: 'block' }, forces: [{ dir: 'down', label: 'mg' }, { dir: 'down', label: 'F' }] }, { uid: 'f' })
  const shafts = [...r.svg.matchAll(/<line x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"[^>]*stroke-width="2.2"/g)].map((m) => +m[1])
  assert.equal(shafts.length, 2)
  assert.ok(Math.abs(shafts[0] - shafts[1]) >= 14, `shafts at ${shafts}`)
  assert.ok(Math.abs(shafts[0] + shafts[1]) < 1, 'the pair sits either side of the point')
})

test('ropes over a pulley add tension on both bodies, pointing along the rope', async () => {
  const r = await renderAsync(load('pulley.json'))
  assert.match(r.summary, /A \(block\): N up, m_\{A\}g down, f_\{k\} left, T right, F_\{s\} left; B \(block\): m_\{B\}g down, T up/)
})

test('mistakes come back with a path and a fix', async () => {
  const cases = [
    [{ forces: [{ on: 'X', dir: 'up', label: 'F' }] }, /forces\[0\]\.on: no body "X"/],
    [{ forces: [{ dir: 'uphill', label: 'f' }] }, /forces\[0\]\.dir: uphill needs an inclined surface/],
    [{ forces: [{ dir: 'sideways', label: 'f' }] }, /dir is up, down, left, right/],
    [{ forces: [{ id: 'a', dir: 'right', label: 'a' }, { id: 'b', dir: 'left', label: 'b' }, { cross: ['a', 'b'], label: 'c' }] }, /parallel/],
    [{ body: { type: 'bar' }, forces: [{ at: 1.5, dir: 'up', label: 'F' }] }, /from 0 \(start\) to 1 \(end\)/],
    [{ body: { type: 'wedge' } }, /type is one of point, block, bar, disk, pulley/],
  ]
  for (const [spec, re] of cases) {
    const r = await renderAsync({ v: 1, kind: 'fbd', ...spec })
    assert.equal(r.svg, null, JSON.stringify(spec))
    assert.match(r.text, re)
  }
})

test('a rope tension arrow stops before the rope mount, with a note that it is shortened', async () => {
  const r = await renderAsync({ v: 1, kind: 'fbd', unit: 'N', body: { type: 'bar' },
    connections: [{ type: 'rope', from: 'body.start', dir: 'up', length: 1, tension: { labels: 'T', mag: 10 } }],
    forces: [{ dir: 'down', mag: 10, label: 'mg' }] })
  assert.ok(notes(r).some((n) => /drawn shorter than to scale to end before the rope's mount or pulley: T/.test(n)))
  const free = await renderAsync({ v: 1, kind: 'fbd', unit: 'N', body: { type: 'bar' },
    connections: [{ type: 'rope', from: 'body.start', dir: 'up', length: 3, tension: { labels: 'T', mag: 10 } }],
    forces: [{ dir: 'down', mag: 10, label: 'mg' }] })
  assert.ok(!notes(free).some((n) => /shorter than to scale/.test(n)), 'a long rope leaves the arrow to scale')
})

// ---- Layout checks at the sizes Dante reads figures: a panel shows one 300 px wide, a widget
// grid about 260 px. A gap in SVG units shrinks by width / W on screen.
import fbd from './index.js'
import { Diag } from '../../diag.js'
import { getTheme } from '../../theme.js'

const layoutOf = (spec, theme = 'dark') => {
  const diag = new Diag()
  const out = fbd.render(spec, { theme: getTheme(theme), diag, env: {}, uid: 't' })
  return { ...out, diag: diag.items }
}
const WIDTHS = [300, 260]
const warnings = (o) => o.diag.filter((d) => d.level !== 'note').map((d) => d.msg)
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

const incline = (angle, extra = {}) => ({ v: 1, kind: 'fbd', unit: 'N', surface: { angle, label: '\\theta' }, body: { label: 'm' }, axes: { angle: 'surface' },
  forces: [{ dir: 'normal', mag: 39.2 * Math.cos((angle * Math.PI) / 180), label: 'N' }, { dir: 'uphill', mag: 39.2 * Math.sin((angle * Math.PI) / 180), label: 'f_{s}' },
    { id: 'mg', dir: 'down', mag: 39.2, label: 'mg', components: ['mg\\sin\\theta', 'mg\\cos\\theta'] }],
  angles: [{ force: 'mg', from: 'mg.y', label: '\\theta' }], ...extra })

test('incline: the mg label sits above the base line, beside its arrow, not under the hatching', () => {
  for (const angle of [15, 30, 45]) {
    const o = layoutOf(incline(angle))
    const [p] = o.layout, groundY = p.ground[0][1]
    const mg = p.labels.find((q) => q.label === 'mg'), tip = p.arrows.find((a) => a.label === 'mg').tip
    // The box has 2 px of padding round the text, so 1.5 px of box gap shows as a clear gap.
    for (const w of WIDTHS) assert.ok((groundY - mg.box[3]) * (w / o.width) >= 1.5, `${angle}°: mg label ${(groundY - mg.box[3]).toFixed(1)} units above the base at ${w} px`)
    assert.ok(Math.hypot((mg.box[0] + mg.box[2]) / 2 - tip[0], (mg.box[1] + mg.box[3]) / 2 - tip[1]) < 45, `${angle}°: mg label near its tip`)
    for (const q of p.labels) assert.ok(q.box[1] < groundY, `${angle}°: ${q.label} is not under the ground line`)
  }
})

test('steep incline (45° to 65°): every label clears the dashed components and the other labels', () => {
  for (const angle of [45, 55, 65, -55]) {
    const o = layoutOf(incline(angle))
    assert.deepEqual(warnings(o), [], `${angle}°`)
    const { labels } = o.layout[0]
    for (const q of labels) assert.ok(!q.backed, `${angle}°: ${q.label} sits on a line`)
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      assert.ok(!overlap(labels[i].box, labels[j].box), `${angle}°: ${labels[i].label} and ${labels[j].label} overlap`)
    }
  }
})

test('friction along a block\'s bottom: its label clears the hatching and the block at panel and widget widths', () => {
  const spec = { v: 1, kind: 'fbd', unit: 'N', surface: { angle: 0 }, body: { label: 'm' },
    forces: [{ id: 'T', dir: 25, at: 'right', mag: 50, label: 'T', components: true }, { dir: 'up', mag: 76.9, label: 'N' },
      { dir: 'down', mag: 98, label: 'mg' }, { dir: 'left', at: 'bottom', mag: 23.1, label: 'f_{k}' }], angles: [{ force: 'T', label: '25°' }] }
  const o = layoutOf(spec)
  const [p] = o.layout, groundY = p.ground[0][1]
  const f = p.labels.find((q) => q.label === 'f_{k}')
  assert.ok(!f.backed, 'f_k sits on a line (inside the block or on the hatching)')
  for (const w of WIDTHS) {
    const k = w / o.width
    const above = (groundY - f.box[3]) * k, below = (f.box[1] - groundY - 7) * k
    assert.ok(above >= 2 || below >= 4, `f_k is ${above.toFixed(1)} px above the ground, ${below.toFixed(1)} px below the hatching at ${w} px`)
  }
})

test('dimension lines: chained and overall spans in rows, labels checked against the span', async () => {
  const beam = { v: 1, kind: 'fbd', unit: 'kN', body: { type: 'bar', id: 'beam', length: 6, span: 8 },
    forces: [{ id: 'P', at: 0.25, dir: 'down', push: true, mag: 20, label: '20 kN' }],
    supports: [{ type: 'pin' }, { type: 'roller' }],
    dims: [{ to: 'P', label: '2 m' }, { from: 'P', to: 0.5, label: '2 m' }, { from: 0.5, label: '4 m' }, { label: '8 m' }, { from: 'A', to: 'B', unit: 'm' }] }
  const r = await renderAsync(beam)
  assert.match(r.summary, /dims: beam 0–0.25 = 2 "2 m", beam 0.25–0.5 = 2 "2 m", beam 0.5–1 = 4 "4 m", beam 0–1 = 8 "8 m", beam 0–1 = 8 "8 m"$/)
  assert.deepEqual(r.diagnostics.filter((d) => d.level === 'warning'), [])
  const bad = await renderAsync({ ...beam, dims: [{ to: 'P', label: '3 m' }] })
  assert.match(bad.diagnostics.find((d) => d.level === 'warning').msg, /label says 3 but the span gives 2/)
  const unknown = await renderAsync({ ...beam, dims: [{ to: 'Q' }] })
  assert.match(unknown.diagnostics[0].msg, /force or support id \(P, A, B\)/)
  // The overall dimension sits a row further out than the chain, and labels stay clear of lines.
  const o = layoutOf(beam)
  for (const q of o.layout[0].labels) assert.ok(!q.backed, `${q.label} sits on a line`)
})

test('a rope can end free (a hand pull): no mount, and its tension arrow stays to scale', async () => {
  const rope = (end) => ({ v: 1, kind: 'fbd', unit: 'N', surface: { angle: 0 }, body: {},
    connections: [{ type: 'rope', from: 'body.right', dir: 25, length: 1, end, tension: { labels: 'T', mag: 50 } }], forces: [{ dir: 'down', mag: 50, label: 'mg' }] })
  const free = await renderAsync(rope('free')), mount = await renderAsync(rope(undefined))
  const lines16 = (r) => (r.svg.match(/stroke-width="1.6"/g) ?? []).length
  assert.equal(lines16(mount) - lines16(free), 1, 'the mount draws one more hatched line')
  assert.ok(!notes(free).some((n) => /shorter than to scale/.test(n)))
  assert.ok(notes(mount).some((n) => /shorter than to scale/.test(n)))
  const bad = await renderAsync({ ...rope('loose') })
  assert.match(bad.diagnostics[0].msg, /end is "mount".*or "free"/)
})
