import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { renderAsync } from '../src/index.js'

const load = (f) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'))
const notes = (r) => r.diagnostics.filter((d) => d.level === 'note').map((d) => d.msg)

for (const f of readdirSync('examples').filter((f) => f.startsWith('fbd-'))) {
  for (const theme of ['paper', 'dark', 'light', 'host']) {
    test(`${f} renders in ${theme} with no warnings`, async () => {
      const r = await renderAsync(load(f), { theme, uid: 'f' })
      assert.ok(r.svg, r.text)
      assert.deepEqual(r.diagnostics.filter((d) => d.level !== 'note'), [])
      if (theme === 'host') assert.doesNotMatch(r.svg, /(fill|stroke)="var\(/)
    })
  }
}

test('hanging wire: both panels balance, the field is drawn', async () => {
  const r = await renderAsync(load('fbd-hanging-wire.json'))
  assert.match(r.summary, /^fbd: 2 panels; \[1 T = 0\] body \(bar\): F_\{B\} up 0.1176, mg down 0.1176; ΣF = 0 N \(balanced\)/)
  assert.match(r.summary, /T up 0.1176, T up 0.1176, mg down 0.1176, F_\{B\} down 0.1176; ΣF = 0 N \(balanced\); field drawn$/)
  assert.equal((r.svg.match(/<circle[^>]*r="5.5"/g) ?? []).length > 20, true)
})

test('incline: normal, uphill and components follow the surface', async () => {
  const r = await renderAsync(load('fbd-incline.json'))
  assert.match(r.summary, /N 120° 16.97, mg down 19.6, f_\{s\} 30° 9.8/)
  assert.match(notes(r)[0], /\|ΣF\| = 0.004/)
})

test('beam: reactions balance forces and moments, resultant at the load centroid', async () => {
  const r = await renderAsync(load('fbd-beam.json'))
  assert.match(r.summary, /\[2 free body\] .*A_\{x\} right 0, A_\{y\} up 10.5, B_\{y\} up 11.5, 12 kN down 12; ΣF = 0 kN \(balanced\); ΣM\(start\) = 0; load on beam from 0.5 to 1, resultant at 0.75/)
  assert.match(r.summary, /\[1 beam\] .*ΣF = \(0, -22\) kN.*ΣM\(start\) = -69/)
})

test('right-hand rule: F = v × B with B into the page points up', async () => {
  const r = await renderAsync(load('fbd-rhr.json'))
  assert.match(r.summary, /F = v×B up; vectors: v right, B in/)
  const neg = await renderAsync({ v: 1, kind: 'fbd', forces: [{ id: 'v', dir: 'right', label: 'v', vector: true }, { id: 'B', dir: 'in', label: 'B', vector: true }, { cross: ['v', 'B'], sign: '-', label: 'F' }] })
  assert.match(neg.summary, /F = −v×B down/)
})

test('net force and its sum', async () => {
  const r = await renderAsync(load('fbd-charge.json'))
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
  const r = await renderAsync(load('fbd-pulley.json'))
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
