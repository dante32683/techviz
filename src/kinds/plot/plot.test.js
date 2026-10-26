import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../../index.js'

test('unknown variable is reported', async () => {
  const r = await renderAsync({ v: 1, kind: 'plot', x: { range: [0, 1] }, series: [{ y: 'k*x' }] })
  assert.equal(r.svg, null)
  assert.match(r.text, /unknown variable k/)
})

// The Desktop widget host grows an SVG's viewBox to its children's getBBox(), which ignores
// clip-path, so geometry past the frame shows as blank space. Curves must stay inside.
const sf = (dydx, isoclines) => ({
  v: 1, kind: 'plot', x: { label: 'x', range: [-3, 3] }, y: { label: 'y', range: [-3, 3] }, size: [460, 420],
  slopefield: { dydx, density: 15 }, ...(isoclines && { isoclines }),
  solutions: [{ from: [0, 1.5] }, { from: [0, 0.5] }, { from: [0, -0.5] }, { from: [-2, -2.5] }, { from: [-2, 0.5] }],
})
for (const [name, spec] of [
  ['slope field with isocline', sf('y - x', [{ value: 1, label: 'y = x + 1' }])],
  ['slope field with parabola isocline', sf('0.2x^2 + y', [{ value: 0 }])],
  ['slope field without isoclines', sf('x')],
  ['isocline method', { ...sf('x', [-2, -1, 0, 1, 2]), slopefield: { dydx: 'x', only: 'isoclines' } }],
  ['steep series', { v: 1, kind: 'plot', x: { range: [-3, 3] }, y: { range: [-2, 2] }, series: [{ y: 'exp(x)' }, { y: '-x^3' }, { points: [[0, 0], [1, 9], [2, -9]], connect: true }] }],
]) {
  test(`${name}: geometry stays inside the viewBox`, async () => {
    const r = await renderAsync(spec, { theme: 'paper' })
    assert.ok(r.svg, r.text)
    const [, , W, H] = r.svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
    const pts = []
    for (const [, d] of r.svg.matchAll(/ d="([^"]+)"/g)) for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) pts.push([+x, +y])
    for (const [, x, y] of r.svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) pts.push([+x, +y])
    assert.ok(pts.length > 0)
    for (const [x, y] of pts) assert.ok(x >= 0 && x <= W && y >= 0 && y <= H, `point ${x},${y} is outside 0 0 ${W} ${H}`)
  })
}

test('clipPolyline splits a curve where it leaves and re-enters', async () => {
  const { clipPolyline } = await import('../../geom.js')
  const parts = clipPolyline([[0, 0], [2, 0], [2, 5], [4, 5], [4, 1], [6, 1]], [0, 5, 0, 2])
  assert.deepEqual(parts, [[[0, 0], [2, 0], [2, 2]], [[4, 2], [4, 1], [5, 1]]])
})

test('a slope field defaults to a compact frame; other plots stay wide', async () => {
  const field = await renderAsync({ v: 1, kind: 'plot', x: { range: [-3, 3] }, y: { range: [-3, 3] }, slopefield: { dydx: 'x - y' } })
  assert.match(field.svg, /viewBox="0 0 300 290"/)
  const fn = await renderAsync({ v: 1, kind: 'plot', x: { range: [0, 1] }, series: [{ y: 'x' }] })
  assert.match(fn.svg, /viewBox="0 0 560 330"/)
})

// Isocline method: slope marks only along chosen isoclines, as sketched by hand.
const isoSpec = (dydx, isoclines, extra = {}) => ({ v: 1, kind: 'plot', x: { range: [-3, 3] }, y: { range: [-3, 3] }, slopefield: { dydx, only: 'isoclines', ...extra }, isoclines })
const slopeMarks = (svg) => [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="[^"]*" stroke-width="1.6"/g)].map((m) => m.slice(1).map(Number))

test('only: "isoclines" draws marks along each isocline and no grid', async () => {
  const r = await renderAsync(isoSpec('x', [-2, -1, 0, 1, 2]))
  assert.ok(r.svg, r.text)
  assert.equal((r.svg.match(/stroke-width="1.1"/g) ?? []).length, 0)
  const marks = slopeMarks(r.svg)
  assert.equal(marks.length, 30)
  // Equal on-screen length, and on x = 1 (c = 1) a slope of 1 in data units (the frame is square here).
  const lens = marks.map(([a, b, c, d]) => Math.hypot(c - a, d - b))
  assert.ok(Math.max(...lens) - Math.min(...lens) < 0.05, `lengths ${lens}`)
})

test('isocline marks sit on a curved isocline with slope c', async () => {
  const r = await renderAsync({ ...isoSpec('0.2x^2 + y', [{ value: 1, marks: 5 }]), size: [300, 290] })
  const [, , W, H] = r.svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number)
  const marks = slopeMarks(r.svg)
  assert.equal(marks.length, 5)
  // Recover the plot frame from the clip rect, then check each mark's midpoint is on y = 1 - 0.2x^2.
  const [L, T, w, h] = r.svg.match(/<clipPath[^>]*><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number)
  for (const [a, b, c, d] of marks) {
    const x = -3 + (((a + c) / 2 - L) / w) * 6, y = 3 - (((b + d) / 2 - T) / h) * 6
    assert.ok(Math.abs(y - (1 - 0.2 * x * x)) < 0.05, `midpoint ${x},${y} is off the isocline`)
    const slope = (-(d - b) / h * 6) / ((c - a) / w * 6)
    assert.ok(Math.abs(slope - 1) < 0.02, `slope ${slope}`)
    for (const v of [a, c]) assert.ok(v >= 0 && v <= W)
    for (const v of [b, d]) assert.ok(v >= 0 && v <= H)
  }
})

test('marks on an isocline also work with the full field, and only takes "isoclines"', async () => {
  const r = await renderAsync({ v: 1, kind: 'plot', x: { range: [-3, 3] }, y: { range: [-3, 3] }, slopefield: { dydx: 'x - y' }, isoclines: [0, { value: 1, marks: 4 }] })
  assert.equal(slopeMarks(r.svg).length, 4)
  assert.ok((r.svg.match(/stroke-width="1.1"/g) ?? []).length > 50)
  const bad = await renderAsync(isoSpec('x', [0], { only: 'curves' }))
  assert.equal(bad.svg, null)
  assert.match(bad.text, /only takes "isoclines"/)
})

// Isocline and solution labels sit clear of the strokes on a backing box, and print minus as −.
test('isocline labels avoid strokes and use real minus signs', async () => {
  const spec = { ...isoSpec('x - y', [-2, -1, 0, 1, 2]), solutions: [{ from: [0, 2] }, { from: [0, -1], label: 'y = x - 1' }] }
  const r = await renderAsync(spec, { theme: 'dark' })
  assert.ok(r.svg, r.text)
  assert.equal((r.svg.match(/class="tv-label-bg"/g) ?? []).length, 6)
  const labels = [...r.svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
  assert.ok(labels.some((t) => t.includes('x − 1')), labels.join(', '))
  assert.ok(labels.some((t) => t.includes('= −2')), labels.join(', '))
})
