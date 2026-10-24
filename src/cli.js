#!/usr/bin/env node
// techviz CLI: render a spec to SVG and PNG files.
//   node src/cli.js render <spec.json | -> [--out <dir>] [--name <base>] [--theme paper|dark|light|host]
//                          [--scale 2] [--step N] [--no-png]
//   node src/cli.js check <spec.json | ->
// Prints one JSON line: { ok, svg, png, width, height, diagnostics, summary }.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { renderAsync } from './index.js'

const [cmd, file, ...rest] = process.argv.slice(2)
const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt }
const flag = (name) => rest.includes(`--${name}`)

function out(o) { process.stdout.write(JSON.stringify(o) + '\n') }

if (!['render', 'check'].includes(cmd) || !file) {
  process.stderr.write('usage: techviz render|check <spec.json|-> [--out dir] [--name base] [--theme paper|dark|light|host] [--scale 2] [--step N] [--no-png]\n')
  process.exit(2)
}

let spec
try {
  spec = JSON.parse(file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8'))
} catch (err) {
  out({ ok: false, diagnostics: [{ level: 'error', path: '', msg: `spec is not valid JSON: ${err.message}` }] })
  process.exit(1)
}

const theme = opt('theme', 'paper')
const step = opt('step') !== undefined ? Number(opt('step')) : undefined
const r = await renderAsync(spec, { theme, step, uid: 'tv' })
if (!r.svg || cmd === 'check') {
  out({ ok: !!r.svg, diagnostics: r.diagnostics, summary: r.summary, controls: r.controls })
  process.exit(r.svg ? 0 : 1)
}

const dir = resolve(opt('out', join(tmpdir(), 'techviz')))
mkdirSync(dir, { recursive: true })
const base = opt('name') ?? `${spec.kind}-${createHash('sha1').update(JSON.stringify(spec) + theme + (step ?? '')).digest('hex').slice(0, 10)}`
const svgPath = join(dir, `${base}.svg`)
writeFileSync(svgPath, r.svg)
let pngPath = null, px = null
if (!flag('no-png')) {
  const { svgToPng } = await import('./raster.js')
  const p = svgToPng(r.svg, { scale: Number(opt('scale', 2)) })
  pngPath = join(dir, `${base}.png`)
  writeFileSync(pngPath, p.png)
  px = { width: p.width, height: p.height }
}
out({ ok: true, svg: svgPath, png: pngPath, width: r.width, height: r.height, pixels: px, diagnostics: r.diagnostics, summary: r.summary, controls: r.controls })
