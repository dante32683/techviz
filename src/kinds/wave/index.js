// wave: digital timing diagrams and register bitfields (WaveJSON, drawn by
// WaveDrom and restyled to the theme), and pipeline diagrams (drawn here).

import { SpecError } from '../../diag.js'
import { loadWavedrom, wavedrom } from './engine.js'
import { restyle } from './restyle.js'
import { checkSignals, checkReg, flatten } from './check.js'
import { renderPipeline } from './pipeline.js'

export default {
  kind: 'wave',
  fields: ['signal', 'edge', 'head', 'foot', 'config', 'reg', 'pipeline', 'stages', 'forward', 'cycle', 'highlight'],
  collections: ['signal', 'pipeline', 'forward'],
  async prepare(spec) { if (spec?.pipeline === undefined) await loadWavedrom() },
  render(spec, ctx) {
    const { theme, diag, uid } = ctx
    const modes = ['signal', 'reg', 'pipeline'].filter((k) => spec[k] !== undefined)
    if (!modes.length) throw new SpecError('signal', 'give "signal" (a timing diagram), "reg" (a bitfield), or "pipeline" (instructions by cycle)')
    if (modes.length > 1) throw new SpecError(modes[1], `use one of signal, reg, or pipeline per diagram (got ${modes.join(' and ')})`)
    if (spec.pipeline !== undefined) {
      for (const k of ['edge', 'head', 'foot', 'config']) if (spec[k] !== undefined) diag.warn(k, `"${k}" is for signal diagrams; a pipeline ignores it`)
      return renderPipeline(spec, ctx)
    }
    for (const k of ['stages', 'forward', 'cycle']) if (spec[k] !== undefined) diag.warn(k, `"${k}" is for pipeline diagrams`)

    const wd = wavedrom()
    if (!wd) throw new SpecError('kind', 'the WaveDrom engine is not loaded; call prepare(spec) or renderAsync() first')
    if (spec.head?.text !== undefined || spec.foot?.text !== undefined) diag.warn(spec.head?.text !== undefined ? 'head.text' : 'foot.text', 'titles and captions go in the chat text; head and foot are for tick/tock cycle numbers')

    let checked, src
    if (spec.reg !== undefined) {
      checked = checkReg(spec, diag)
      const lanes = spec.config?.lanes ?? 1
      const perLane = checked.bits / lanes
      src = {
        reg: spec.reg,
        config: { hspace: Math.min(900, Math.max(320, Math.round(perLane * 26))), fontsize: theme.size, fontfamily: 'sans-serif', bits: checked.bits, ...spec.config },
      }
    } else {
      checked = checkSignals(spec, diag)
      // Strip techviz-only keys so WaveDrom sees plain WaveJSON.
      const strip = (list) => list.map((s) => (Array.isArray(s) ? strip(s) : s && typeof s === 'object' ? (({ id, ...rest }) => rest)(s) : s))
      src = { signal: strip(spec.signal), edge: spec.edge, head: spec.head ? { ...spec.head, text: undefined } : undefined, foot: spec.foot ? { ...spec.foot, text: undefined } : undefined, config: spec.config }
      for (const k of Object.keys(src)) if (src[k] === undefined) delete src[k]
    }
    const hlIds = new Set((spec.highlight ?? []).map(String))
    const hlNames = new Set()
    if (spec.signal !== undefined) for (const { s } of flatten(spec.signal)) if (s.id !== undefined && hlIds.has(String(s.id))) hlNames.add(String(s.name ?? '').trim())

    let tree
    try { tree = wd.renderAny(0, src, wd.waveSkin) } catch (err) { throw new SpecError(spec.reg ? 'reg' : 'signal', `WaveDrom could not draw this: ${err?.message ?? err}`) }
    const out = restyle(tree, { theme, uid, highlight: hlNames })
    return { ...out, summary: checked.summary, alt: spec.reg ? 'register bitfield' : 'timing diagram' }
  },
}
