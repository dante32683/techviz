// techviz: render a compact JSON spec to SVG, with diagnostics for the author.
//
// A spec is { v: 1, kind, ...kind fields, params?, steps? }. `params` are named
// numbers the spec's expressions use; the widget draws a slider for each.
// `steps` change the spec one stage at a time (a code trace, a clock cycle);
// the widget draws back and next buttons. Static renders use each param's
// value and the step given (default the last, the finished picture).

import { Diag, SpecError } from './diag.js'
import { ExprError } from './expr.js'
import { getTheme } from './theme.js'
import { doc } from './svg.js'
import { KINDS } from './kinds/registry.js'

export { parseLabel, measure } from './label.js'
export { compile } from './expr.js'
export { THEMES } from './theme.js'
export { KINDS }

const ENVELOPE = new Set(['v', 'kind', 'params', 'steps', 'step', 'width', 'height', 'alt', 'note'])

function paramEnv(spec, diag, overrides = {}) {
  const env = {}
  const meta = []
  for (const [name, p] of Object.entries(spec.params ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { diag.error(`params.${name}`, 'param names are letters, digits and _'); continue }
    const def = typeof p === 'number' ? { value: p } : p
    if (typeof def?.value !== 'number') { diag.error(`params.${name}`, 'needs a numeric value'); continue }
    const min = def.min ?? (def.value === 0 ? -1 : def.value - Math.abs(def.value))
    const max = def.max ?? (def.value === 0 ? 1 : def.value + Math.abs(def.value))
    const step = def.step ?? (max - min) / 100
    env[name] = typeof overrides[name] === 'number' ? overrides[name] : def.value
    meta.push({ name, value: env[name], min, max, step, unit: def.unit ?? '', label: def.label ?? name })
  }
  return { env, meta }
}

/** The spec as of step `k` (0-based, cumulative). Collections are arrays of items with `id`. */
export function applySteps(spec, k, collections) {
  const steps = spec.steps ?? []
  let cur = structuredClone(spec)
  delete cur.steps
  let highlight
  for (let i = 0; i <= k && i < steps.length; i++) {
    const s = steps[i]
    for (const [key, val] of Object.entries(s)) {
      if (['label', 'set', 'add', 'remove', 'highlight', 'params'].includes(key)) continue
      cur[key] = structuredClone(val)
    }
    if (s.set) {
      for (const [id, patch] of Object.entries(s.set)) {
        let found = false
        for (const c of collections) for (const item of walkItems(cur[c])) if (item.id === id) { Object.assign(item, structuredClone(patch)); found = true }
        if (!found) cur.__missing = [...(cur.__missing ?? []), `steps[${i}].set.${id}`]
      }
    }
    if (s.add) for (const [c, items] of Object.entries(s.add)) cur[c] = [...(cur[c] ?? []), ...structuredClone(items)]
    if (s.remove) for (const c of collections) if (Array.isArray(cur[c])) cur[c] = cur[c].filter((it) => !s.remove.includes(it.id))
    if (s.params) cur.__paramValues = { ...(cur.__paramValues ?? {}), ...s.params }
    highlight = i === k ? s.highlight : undefined
  }
  if (highlight) cur.highlight = highlight
  return cur
}

// Items in a collection, including ones nested one level (memory frames hold vars).
function* walkItems(list) {
  if (!Array.isArray(list)) return
  for (const it of list) {
    if (it && typeof it === 'object') {
      yield it
      for (const v of Object.values(it)) if (Array.isArray(v)) for (const sub of v) if (sub && typeof sub === 'object' && 'id' in sub) yield sub
    }
  }
}

// Steps a kind computes from the spec when it has none of its own (ds: one per op). A spec the
// kind can't step through gets none here; its render reports the problem.
function derivedSteps(kind, spec) {
  if (!kind.steps) return []
  try { return kind.steps(spec) ?? [] } catch { return [] }
}

/**
 * Load what a spec's kind needs before a synchronous render (a WASM engine, say).
 * Kinds with nothing to load resolve at once. Call it before the first render.
 */
export async function prepare(spec) {
  const kind = KINDS[spec?.kind]
  if (kind?.prepare) await kind.prepare(spec)
}

/** prepare() then render(). */
export async function renderAsync(spec, opts = {}) {
  try { await prepare(spec) } catch (err) {
    return { svg: null, width: 0, height: 0, diagnostics: [{ level: 'error', path: 'kind', msg: `could not load the ${spec?.kind} engine: ${err?.message ?? err}` }], text: '', controls: null, summary: '' }
  }
  return render(spec, opts)
}

/**
 * Render a spec. Options: theme ('paper' | 'dark' | 'light' | 'host'), params (overrides),
 * step (index; default the last), uid (prefix for ids in the SVG).
 * Returns { svg?, width, height, diagnostics: [{level, path, msg}], text, controls, summary, parts? }.
 * parts, for a figure of side-by-side panels (fbd panels), is each panel's [x0, x1] in viewBox units.
 */
export function render(spec, opts = {}) {
  const diag = new Diag()
  const theme = getTheme(opts.theme)
  const fail = () => ({ svg: null, width: 0, height: 0, diagnostics: diag.items, text: diag.text(), controls: null, summary: '' })
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { diag.error('', 'the spec must be a JSON object'); return fail() }
  if (spec.v !== 1) diag.warn('v', 'set "v": 1 (the spec version)')
  const kind = KINDS[spec.kind]
  if (!kind) { diag.error('kind', `unknown kind "${spec.kind}"; known: ${Object.keys(KINDS).join(', ')}`); return fail() }
  for (const key of Object.keys(spec)) {
    if (!ENVELOPE.has(key) && !(kind.fields ?? []).includes(key)) diag.warn(key, `"${spec.kind}" doesn't use "${key}"`)
  }
  const steps = Array.isArray(spec.steps) ? spec.steps : derivedSteps(kind, spec)
  const stepIndex = Math.min(Math.max(opts.step ?? (typeof spec.step === 'number' ? spec.step : steps.length - 1), -1), steps.length - 1)
  const staged = steps.length ? applySteps({ ...spec, steps }, stepIndex, kind.collections ?? []) : spec
  for (const m of staged.__missing ?? []) diag.error(m, 'no item with that id')
  const { env, meta } = paramEnv(spec, diag, { ...(staged.__paramValues ?? {}), ...(opts.params ?? {}) })
  const uid = opts.uid ?? 'tv' + Math.random().toString(36).slice(2, 7)
  let out
  try {
    out = kind.render(staged, { theme, diag, env, uid })
  } catch (err) {
    if (err instanceof SpecError) diag.error(err.path, err.message)
    else if (err instanceof ExprError) diag.error('', err.message)
    else diag.error('', `renderer failed: ${err?.stack ?? err}`)
    return fail()
  }
  if (diag.hasErrors) return fail()
  const width = spec.width ?? out.width
  const height = out.height * (spec.width ? spec.width / out.width : 1)
  const svg = doc(out.width, out.height, out.body, theme, { alt: spec.alt ?? out.alt ?? '', defs: out.defs })
    .replace(/^<svg([^>]*) width="[^"]*" height="[^"]*"/, `<svg$1 width="${Math.round(width)}" height="${Math.round(height)}"`)
  return {
    svg, width, height, diagnostics: diag.items, text: diag.text(), summary: out.summary ?? '', parts: out.parts,
    controls: { params: meta, steps: steps.map((s, i) => s.label ?? `step ${i + 1}`), step: stepIndex },
  }
}
