// The netlist: parts from the spec (or compiled from Boolean expressions), the nets between
// them with widths, a 0/1/x/z simulator with clocked state, and the analyses the summary
// reports: diagnostics, truth tables, and the critical path.

import { SpecError } from '../../diag.js'
import { parseExpr, exprVars, minimize, mintermsOf, literals } from './bool.js'

// --- Values --------------------------------------------------------------------------

export const X = 'x', Z = 'z'
const known = (v) => typeof v === 'number'
export const maskOf = (w) => (w >= 32 ? 0xffffffff : 2 ** w - 1)
const fit = (v, w) => (known(v) ? (w >= 32 ? v >>> 0 : (v >>> 0) & maskOf(w)) : v)

/** A value as text: 1-bit 0/1, up to 4 bits binary, wider in hex. */
export function valueText(v, w) {
  if (v === X) return w > 1 ? 'x…' : 'x'
  if (v === Z) return 'z'
  if (w <= 1) return String(v)
  if (w <= 4) return v.toString(2).padStart(w, '0')
  return '0x' + v.toString(16).toUpperCase()
}

// --- Part types ----------------------------------------------------------------------

export const GATES = new Set(['and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not', 'buf', 'tri'])
const SEQ = new Set(['reg', 'dff', 'counter', 'shift', 'regfile', 'mem'])
export const BLOCKS = ['mux', 'dec', 'enc', 'ha', 'fa', 'add', 'cmp', 'alu', 'latch', 'reg', 'dff', 'counter', 'shift', 'regfile', 'mem', 'rom']
const ALIASES = { inv: 'not', buffer: 'buf', tristate: 'tri', decoder: 'dec', encoder: 'enc', adder: 'add', comparator: 'cmp', register: 'reg', flop: 'dff', rf: 'regfile', memory: 'mem' }
const log2 = (n) => Math.ceil(Math.log2(Math.max(2, n)))

/**
 * Ports of a part. Inputs: {name, ref, side: 'L' | 'T', label?, data?}; outputs: {name, label?}.
 * `in` lists the data inputs in order; control inputs are named keys (sel, en, rst, we, op).
 */
function portsOf(p, path) {
  const t = p.t
  const ins = (p.in ?? []).map((ref, k) => ({ name: `in${k}`, ref, side: 'L', data: true }))
  const ctl = (key, label = key, side = 'T') => {
    if (p[key] === undefined) return []
    const refs = Array.isArray(p[key]) ? p[key] : [p[key]]
    return refs.map((ref, k) => ({ name: refs.length > 1 ? `${key}${refs.length - 1 - k}` : key, ref, side, label: refs.length > 1 ? null : label, ctl: key }))
  }
  const need = (lo, hi, what) => {
    if (ins.length < lo || ins.length > hi) throw new SpecError(`${path}.in`, `a ${t} takes ${what} in "in"; got ${ins.length}`)
  }
  const named = (names, labels = names) => ins.forEach((q, k) => { q.name = names[k]; q.label = labels[k] })
  if (GATES.has(t)) {
    if (t === 'not' || t === 'buf' || t === 'tri') need(1, 1, 'one input')
    else need(2, 8, '2 to 8 inputs')
    if (t === 'tri' && p.en === undefined) throw new SpecError(`${path}.en`, 'a tri-state buffer needs "en", its enable net ("~E" for active-low)')
    return { ins: [...ins, ...ctl('en', null)], outs: [{ name: 'y' }] }
  }
  switch (t) {
    case 'mux': {
      need(2, 16, '2 to 16 data inputs')
      if (p.sel === undefined) throw new SpecError(`${path}.sel`, 'a mux needs "sel": one bus net, or a list of 1-bit nets MSB first')
      ins.forEach((q, k) => { q.name = `d${k}`; q.label = String(k) })
      return { ins: [...ins, ...ctl('sel', null)], outs: [{ name: 'y' }] }
    }
    case 'dec': {
      need(1, 5, 'the select bits, MSB first (or one bus)')
      ins.forEach((q, k) => { q.name = `a${ins.length - 1 - k}`; q.label = null })
      return { ins: [...ins, ...ctl('en', 'en')], outs: null } // outputs depend on the input width
    }
    case 'enc': need(2, 16, '2 to 16 inputs, d0 first'); ins.forEach((q, k) => { q.name = `d${k}`; q.label = String(k) }); return { ins, outs: [{ name: 'y' }, { name: 'v', label: 'v' }] }
    case 'ha': need(2, 2, 'a and b'); named(['a', 'b']); return { ins, outs: [{ name: 's', label: 'S' }, { name: 'c', label: 'C' }] }
    case 'fa': need(3, 3, 'a, b, and cin'); named(['a', 'b', 'cin'], ['A', 'B', 'C_{in}']); return { ins, outs: [{ name: 's', label: 'S' }, { name: 'cout', label: 'C_{out}' }] }
    case 'add': need(2, 3, 'a, b, and optionally cin'); named(['a', 'b', 'cin'], [null, null, 'C_{in}']); if (ins[2]) ins[2].side = 'T'; return { ins, outs: [{ name: 's' }, ...(p.cout ? [{ name: 'cout', label: 'C_{out}' }] : [])] }
    case 'cmp': need(2, 2, 'a and b'); named(['a', 'b'], ['A', 'B']); return { ins, outs: [{ name: 'eq', label: '=' }, { name: 'lt', label: '<' }, { name: 'gt', label: '>' }] }
    case 'alu': {
      need(2, 2, 'a and b')
      named(['a', 'b'], ['A', 'B'])
      if (p.op === undefined) throw new SpecError(`${path}.op`, 'an alu needs "op", the 3-bit ALUControl net (000 add, 001 sub, 010 and, 011 or, 101 slt)')
      return { ins: [...ins, ...ctl('op', null)], outs: [{ name: 'y' }, { name: 'zero', label: 'Zero' }] }
    }
    case 'latch': need(1, 1, 'd'); named(['d'], ['D']); if (p.en === undefined) throw new SpecError(`${path}.en`, 'a latch needs "en" (its clock or enable net)'); return { ins: [...ins, ...ctl('en', 'E', 'L')], outs: [{ name: 'q', label: 'Q' }] }
    case 'reg': case 'dff': need(1, 1, 'd'); named(['d'], [p.t === 'dff' ? 'D' : null]); return { ins: [...ins, ...ctl('en', 'en'), ...ctl('rst', 'rst')], outs: [{ name: 'q', label: p.t === 'dff' ? 'Q' : null }], clocked: true }
    case 'counter': need(0, 0, 'no data inputs'); return { ins: [...ctl('en', 'en'), ...ctl('rst', 'rst')], outs: [{ name: 'q' }], clocked: true }
    case 'shift': need(1, 1, 'the serial input'); named(['sin'], ['in']); return { ins: [...ins, ...ctl('en', 'en'), ...ctl('rst', 'rst')], outs: [{ name: 'q' }, { name: 'sout', label: 'out' }], clocked: true }
    case 'regfile': need(4, 4, 'A1, A2, A3, and WD3'); named(['a1', 'a2', 'a3', 'wd3'], ['A1', 'A2', 'A3', 'WD3']); return { ins: [...ins, ...ctl('we', 'WE3')], outs: [{ name: 'rd1', label: 'RD1' }, { name: 'rd2', label: 'RD2' }], clocked: true }
    case 'mem': need(1, 2, 'A, and WD to write'); named(['a', 'wd'], ['A', 'WD']); return { ins: [...ins, ...ctl('we', 'WE')], outs: [{ name: 'rd', label: 'RD' }], clocked: ins.length === 2 }
    case 'rom': need(1, 1, 'A'); named(['a'], ['A']); return { ins, outs: [{ name: 'rd', label: 'RD' }] }
    default: throw new SpecError(`${path}.t`, `unknown part "${p.t}"; gates: ${[...GATES].join(', ')}; blocks: ${BLOCKS.join(', ')}`)
  }
}

// --- References ----------------------------------------------------------------------

/**
 * A reference to a net from a pin: "A", "~A" (inverted, drawn as a bubble), "A[3]", "A[3:0]",
 * "g1.cout", or a constant: 0, 1, 4, "4'b0001", "32'h4", "0x10".
 */
export function parseRef(raw, path) {
  let s = String(raw).trim()
  let inv = false
  if (/^[~!]/.test(s)) { inv = true; s = s.slice(1).trim() }
  let m = /^(\d+)'([bdh])([0-9a-fA-F_]+)$/.exec(s)
  if (m) return { konst: parseInt(m[3].replace(/_/g, ''), { b: 2, d: 10, h: 16 }[m[2]]), width: Number(m[1]), inv, text: s }
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(s)) return { konst: Number(s), width: null, inv, text: s }
  m = /^([A-Za-z_][\w.]*)(?:\[(\d+)(?::(\d+))?\])?$/.exec(s)
  if (!m) throw new SpecError(path, `"${raw}" isn't a net name; write A, ~A, A[3], A[3:0], g1.cout, or a constant like 1 or 32'h4`)
  const hi = m[2] === undefined ? null : Number(m[2])
  const lo = m[3] === undefined ? hi : Number(m[3])
  if (hi !== null && lo > hi) throw new SpecError(path, `write the slice high bit first: ${m[1]}[${lo}:${hi}]`)
  return { net: m[1], hi, lo, inv, text: s }
}

/** An input declaration: "A" or "A[3:0]". */
function parseDecl(s, path) {
  const m = /^([A-Za-z_]\w*)(?:\[(\d+):(\d+)\])?$/.exec(String(s).trim())
  if (!m) throw new SpecError(path, `"${s}" isn't an input name; write A, or A[3:0] for a 4-bit bus`)
  if (m[2] !== undefined && Number(m[3]) !== 0) throw new SpecError(path, `buses start at bit 0: write ${m[1]}[${Number(m[2]) - Number(m[3])}:0]`)
  return { name: m[1], width: m[2] === undefined ? 1 : Number(m[2]) + 1 }
}

// --- Expressions to parts ------------------------------------------------------------

/**
 * Parts for `expr` ({Y: "AB + C'"}): flat AND/OR/XOR gates, NAND/NOR/XNOR for a complemented
 * gate, one shared NOT per complemented input (or input bubbles with `bubbles`). With
 * `simplify`, each output is first replaced by its minimal SOP.
 */
export function compileExprs(spec, inputNames) {
  const exprs = typeof spec.expr === 'string' ? { Y: spec.expr } : spec.expr
  if (!exprs || typeof exprs !== 'object' || Array.isArray(exprs)) throw new SpecError('expr', 'expr is {"Y": "AB + C\'"} (an output name to an expression), or one expression string for Y')
  const asts = Object.entries(exprs).map(([name, src]) => [name, parseExpr(src, { names: inputNames, path: `expr.${name}` })])
  const vars = inputNames ?? []
  for (const [, ast] of asts) for (const v of exprVars(ast)) if (!vars.includes(v)) vars.push(v)
  const parts = [], outputs = {}
  let n = 0
  const nots = new Map()
  const lit = (name, neg) => {
    if (!neg) return name
    if (spec.bubbles) return `~${name}`
    if (!nots.has(name)) { const id = `${name}_n`; nots.set(name, id); parts.push({ id, t: 'not', in: [name] }) }
    return nots.get(name)
  }
  const flat = (op, args) => args.flatMap((a) => (a.op === op ? flat(op, a.args) : [a]))
  function build(ast, out) {
    if (ast.op === 'var') return ast.name
    if (ast.op === 'const') return String(ast.v)
    if (ast.op === 'not' && ast.a.op === 'var') return lit(ast.a.name, true)
    let t, args
    if (ast.op === 'not') {
      if (ast.a.op === 'not') return build(ast.a.a, out)
      if (ast.a.op === 'const') return String(1 - ast.a.v)
      t = { and: 'nand', or: 'nor', xor: 'xnor' }[ast.a.op]; args = flat(ast.a.op, ast.a.args)
    } else { t = ast.op; args = flat(ast.op, ast.args) }
    const ins = args.map((a) => build(a))
    const id = out ?? `g${++n}`
    parts.push({ id, t, in: ins })
    return id
  }
  for (let [name, ast] of asts) {
    if (spec.simplify) ast = sopAst(ast, vars)
    const ref = build(ast, name)
    outputs[name] = ref
  }
  return { parts, outputs, vars }
}

/** The minimal SOP of an expression, as an AST over `vars`. */
function sopAst(ast, vars) {
  const ones = mintermsOf(ast, vars)
  if (!ones.length) return { op: 'const', v: 0 }
  if (ones.length === 1 << vars.length) return { op: 'const', v: 1 }
  const { cover } = minimize(ones, [], vars.length)
  const terms = cover.map((p) => {
    const ls = literals(p, vars).map((l) => (l.neg ? { op: 'not', a: { op: 'var', name: l.name } } : { op: 'var', name: l.name }))
    return ls.length === 1 ? ls[0] : { op: 'and', args: ls }
  })
  return terms.length === 1 ? terms[0] : { op: 'or', args: terms }
}

// --- The netlist ---------------------------------------------------------------------

/**
 * Build the netlist: { inputs: [{name, width, value}], parts, nets: Map, outputs: [{label, ref}] }.
 * Each part gets ins (with parsed refs), outs (with net names), and a width.
 */
export function buildNetlist(spec, diag) {
  // Inputs: a list of names, or an object of name -> value.
  let decls = [], values = {}
  if (Array.isArray(spec.inputs)) decls = spec.inputs.map((s, i) => parseDecl(s, `inputs[${i}]`))
  else if (spec.inputs && typeof spec.inputs === 'object') {
    decls = Object.keys(spec.inputs).map((s) => parseDecl(s, `inputs.${s}`))
    Object.keys(spec.inputs).forEach((k, i) => { values[decls[i].name] = spec.inputs[k] })
  } else if (spec.inputs !== undefined) throw new SpecError('inputs', 'inputs is a list of names (["A", "B", "D[3:0]"]) or an object of name -> value ({"A": 1, "B": 0})')

  let rawParts = spec.parts ?? []
  let outputs = spec.outputs
  let exprVarsOrder = null
  if (spec.expr !== undefined) {
    if (spec.parts) diag.warn('parts', 'with "expr" the parts come from the expressions; "parts" is ignored')
    const c = compileExprs(spec, decls.length ? decls.map((d) => d.name) : null)
    rawParts = c.parts
    exprVarsOrder = c.vars
    outputs = outputs ?? c.outputs
    if (!decls.length) decls = c.vars.map((name) => ({ name, width: 1 }))
  }
  if (!Array.isArray(rawParts)) throw new SpecError('parts', 'parts is a list of {"id", "t", "in"}')

  const parts = []
  const byId = new Map()
  rawParts.forEach((raw, i) => {
    const path = `parts[${i}]`
    if (!raw || typeof raw !== 'object') throw new SpecError(path, 'each part is an object like {"id": "g1", "t": "and", "in": ["A", "B"]}')
    if (raw.id === undefined || raw.id === '') throw new SpecError(`${path}.id`, 'every part needs an "id" (its output net is named after it)')
    const id = String(raw.id)
    if (!/^[A-Za-z_]\w*$/.test(id)) throw new SpecError(`${path}.id`, `id "${id}" must be a name (letters, digits, _), since nets are named after it`)
    if (byId.has(id)) throw new SpecError(`${path}.id`, `part "${id}" is listed twice`)
    const t = ALIASES[raw.t] ?? raw.t
    if (raw.in !== undefined && !Array.isArray(raw.in)) throw new SpecError(`${path}.in`, '"in" is a list of nets, like ["A", "B"]')
    const p = { ...raw, id, t, path, index: i }
    const ports = portsOf(p, path)
    p.ins = ports.ins.map((q, k) => ({ ...q, r: parseRef(q.ref, q.data ? `${path}.in[${k}]` : `${path}.${q.ctl}`) }))
    p.clocked = !!ports.clocked
    p.outPorts = ports.outs
    p.seq = SEQ.has(t) && (t !== 'mem' || p.clocked)
    byId.set(id, p)
    parts.push(p)
  })

  // Nets: each input, and each part output. A part's first output is named by its "out"
  // (default its id); others are id.port. id.port also names the first output.
  const nets = new Map()
  const alias = new Map()
  const addNet = (name, driver, width) => {
    if (!nets.has(name)) nets.set(name, { name, width, drivers: [], sinks: [] })
    const n = nets.get(name)
    if (driver) n.drivers.push(driver)
    return n
  }
  for (const d of decls) addNet(d.name, { input: d.name }, d.width)

  // Widths: inputs declared; parts from "width", else their data inputs (resolved lazily).
  const widthOfRef = (r, seen) => {
    if (r.konst !== undefined) return r.width
    if (r.hi !== null) return r.hi - r.lo + 1
    const name = alias.get(r.net) ?? r.net
    const n = nets.get(name)
    if (n?.width) return n.width
    const drv = n?.drivers.find((d) => d.part)
    return drv ? partWidth(byId.get(drv.part), seen) : 1
  }
  const partWidth = (p, seen = new Set()) => {
    if (p.width !== undefined) return p.width
    if (seen.has(p.id)) return 1
    seen.add(p.id)
    const data = p.ins.filter((q) => q.data && (q.r.konst === undefined || q.r.width))
    let w = data.length ? Math.max(...data.map((q) => widthOfRef(q.r, seen) ?? 1)) : 1
    if (p.t === 'regfile' || p.t === 'mem' || p.t === 'rom') w = 32
    if (p.t === 'dec' || p.t === 'cmp' || p.t === 'ha' || p.t === 'fa') w = 1
    if (p.t === 'shift' || p.t === 'counter') w = 4
    if (p.t === 'reg' && p.ins[0]?.r.konst !== undefined && !p.ins[0].r.width) w = 1
    return w
  }
  for (const p of parts) {
    if (p.width !== undefined && !(Number.isInteger(p.width) && p.width >= 1 && p.width <= 32)) throw new SpecError(`${p.path}.width`, 'width is a whole number of bits from 1 to 32')
    if (p.t === 'dec') {
      const n = p.ins.length === 1 ? null : p.ins.length
      p.outPorts = n ? Array.from({ length: 1 << n }, (_, k) => ({ name: `y${k}`, label: String(k) })) : null
    }
    p.outPorts?.forEach((o, k) => {
      o.net = k === 0 ? String(p.out ?? p.id) : `${p.id}.${o.name}`
      if (k === 0) { alias.set(`${p.id}.${o.name}`, o.net); if (p.out !== undefined) alias.set(p.id, o.net) }
      addNet(o.net, { part: p.id, port: o.name }, null)
    })
  }
  for (const p of parts) {
    p.width ??= partWidth(p)
    if (p.t === 'dec' && !p.outPorts) {
      const n = widthOfRef(p.ins[0].r, new Set())
      p.outPorts = Array.from({ length: 1 << n }, (_, k) => ({ name: `y${k}`, label: String(k) }))
      p.outPorts.forEach((o, k) => { o.net = k === 0 ? String(p.out ?? p.id) : `${p.id}.${o.name}`; addNet(o.net, { part: p.id, port: o.name }, 1) })
      if (p.out === undefined) alias.set(`${p.id}.y0`, p.id)
    }
    p.outPorts.forEach((o, k) => {
      const n = nets.get(o.net)
      n.width = outWidth(p, o.name)
      o.width = n.width
    })
  }

  // Sinks.
  const unknownNet = (r, path) => {
    const near = [...nets.keys()].filter((k) => k.toLowerCase() === r.net.toLowerCase())
    diag.warn(path, `net "${r.net}" has no driver${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}; ${Array.isArray(spec.inputs) || spec.inputs ? 'add it to inputs or fix the name' : 'it becomes an input'}`)
  }
  const inferred = []
  for (const p of parts) {
    for (const q of p.ins) {
      const r = q.r
      if (r.konst !== undefined) continue
      r.net = alias.get(r.net) ?? r.net
      if (!nets.has(r.net)) {
        if (decls.length || spec.inputs) { unknownNet(r, `${p.path}.${q.data ? 'in' : q.ctl}`); addNet(r.net, null, 1).undriven = true }
        else { inferred.push(r.net); addNet(r.net, { input: r.net }, r.hi !== null ? r.hi + 1 : 1); decls.push({ name: r.net, width: nets.get(r.net).width }) }
      }
      nets.get(r.net).sinks.push({ part: p.id, port: q.name })
    }
  }
  if (inferred.length) diag.note('inputs', `inputs inferred from undriven nets: ${inferred.join(', ')}; list "inputs" to fix their order and catch typos`)

  // Outputs: a list of nets, or an object of label -> net.
  let outs = []
  if (outputs === undefined) {
    // Default: every net no part reads.
    outs = parts.filter((p) => p.outPorts.every((o) => !nets.get(o.net).sinks.length)).map((p) => ({ label: p.outPorts[0].net, ref: p.outPorts[0].net }))
  } else if (Array.isArray(outputs)) outs = outputs.map((r) => ({ label: String(r).replace(/^[~!]/, ''), ref: String(r) }))
  else if (typeof outputs === 'object') outs = Object.entries(outputs).map(([label, ref]) => ({ label, ref: String(ref) }))
  else throw new SpecError('outputs', 'outputs is a list of nets (["S", "Cout"]) or an object of label -> net ({"S": "fa.s"})')
  outs.forEach((o, i) => {
    const path = Array.isArray(outputs) ? `outputs[${i}]` : `outputs.${o.label}`
    o.r = parseRef(o.ref, path)
    if (o.r.konst !== undefined) return
    o.r.net = alias.get(o.r.net) ?? o.r.net
    if (!nets.has(o.r.net)) throw new SpecError(path, `no net "${o.r.net}"; nets are ${[...nets.keys()].join(', ')}`)
    nets.get(o.r.net).sinks.push({ output: o.label })
    o.width = o.r.hi !== null ? o.r.hi - o.r.lo + 1 : nets.get(o.r.net).width
  })

  const inputs = decls.map((d) => ({ ...d, value: values[d.name] }))
  return { inputs, parts, byId, nets, outputs: outs, alias, exprVars: exprVarsOrder, simplified: spec.expr !== undefined && !!spec.simplify }
}

function outWidth(p, port) {
  if (GATES.has(p.t)) return p.width
  switch (p.t) {
    case 'enc': return port === 'v' ? 1 : log2(p.ins.length)
    case 'add': return port === 'cout' ? 1 : p.width
    case 'alu': return port === 'zero' ? 1 : p.width
    case 'shift': return port === 'sout' ? 1 : p.width
    case 'cmp': case 'dec': case 'ha': case 'fa': return 1
    default: return p.width
  }
}

// --- Checks --------------------------------------------------------------------------

/** Diagnostics: multiple drivers, unused outputs and inputs, width mismatches, combinational loops. */
export function checkNetlist(nl, diag) {
  const { nets, parts, byId } = nl
  for (const n of nets.values()) {
    if (n.drivers.length > 1) {
      const allTri = n.drivers.every((d) => d.part && byId.get(d.part).t === 'tri')
      if (!allTri) diag.warn(n.drivers.map((d) => d.part ? byId.get(d.part).path : 'inputs').find((x) => x !== 'inputs') ?? 'inputs', `net "${n.name}" has ${n.drivers.length} drivers (${n.drivers.map((d) => d.part ?? `input ${d.input}`).join(', ')}); only tri-state buffers may share a net`)
    }
  }
  for (const p of parts) {
    if (!p.outPorts.some((o) => nets.get(o.net).sinks.length)) diag.warn(p.path, `the output of ${p.id} is unused; connect it or list it in outputs`)
  }
  nl.inputs.forEach((d) => {
    if (nets.get(d.name).sinks.length) return
    if (nl.simplified) diag.note('inputs', `the minimal SOP doesn't use input ${d.name}`)
    else diag.warn('inputs', `input ${d.name} is unused`)
  })
  // Width checks on gates: bitwise gates want equal widths; an inverted (bubbled) pin is 1 bit.
  for (const p of parts) {
    const ws = p.ins.filter((q) => q.data).map((q) => refWidth(nl, q.r, p))
    if (GATES.has(p.t) && ws.some((w) => w !== p.width)) diag.warn(`${p.path}.in`, `${p.id} mixes widths ${ws.join(', ')}; a gate is bitwise, so give its inputs one width`)
    if (p.t === 'mux') {
      const sw = p.ins.filter((q) => q.ctl === 'sel').reduce((s, q) => s + refWidth(nl, q.r, p), 0)
      const need = log2(p.ins.filter((q) => q.data).length)
      if (sw !== need) diag.warn(`${p.path}.sel`, `a ${p.ins.filter((q) => q.data).length}:1 mux needs a ${need}-bit select; "sel" is ${sw} bit${sw === 1 ? '' : 's'}`)
    }
    for (const q of p.ins) if (q.r.inv && refWidth(nl, q.r, p) > 1) diag.warn(`${p.path}.in`, `~ (a bubble) inverts one bit; ${q.r.text} is ${refWidth(nl, q.r, p)} bits`)
  }
  const loops = combLoops(nl)
  for (const cyc of loops) diag.warn(byId.get(cyc[0]).path, `combinational loop: ${[...cyc, cyc[0]].join(' → ')}; break it with a register, or it may oscillate`)
  nl.loops = loops
}

export function refWidth(nl, r, part) {
  if (r.konst !== undefined) return r.width ?? (part && !GATES.has(part.t) ? part.width : 1)
  if (r.hi !== null) return r.hi - r.lo + 1
  return nl.nets.get(r.net)?.width ?? 1
}

/** Combinational edges: part -> parts reading its outputs, not counting clocked parts' inputs. */
export function combEdges(nl) {
  const adj = new Map(nl.parts.map((p) => [p.id, []]))
  for (const p of nl.parts) {
    if (p.seq) continue // a clocked part's outputs come from state
    for (const o of p.outPorts) for (const s of nl.nets.get(o.net).sinks) if (s.part && !adj.get(p.id).includes(s.part)) adj.get(p.id).push(s.part)
  }
  return adj
}

/** Strongly connected components of size > 1 (or self-loops) in the combinational graph. */
function combLoops(nl) {
  const adj = combEdges(nl)
  const seqIds = new Set(nl.parts.filter((p) => p.seq).map((p) => p.id))
  let idx = 0
  const index = new Map(), low = new Map(), stack = [], on = new Set(), out = []
  const visit = (v) => {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v)
    for (const w of adj.get(v) ?? []) {
      if (seqIds.has(w)) continue
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
    }
    if (low.get(v) === index.get(v)) {
      const comp = []
      let w
      do { w = stack.pop(); on.delete(w); comp.push(w) } while (w !== v)
      if (comp.length > 1 || (adj.get(v) ?? []).includes(v)) out.push(comp.reverse())
    }
  }
  for (const p of nl.parts) if (!p.seq && !index.has(p.id)) visit(p.id)
  return out
}

// --- Simulation ----------------------------------------------------------------------

function bitwise(t, vals, w) {
  const m = maskOf(w)
  const one = w === 1
  if (t === 'and' || t === 'nand') {
    let r
    if (vals.every(known)) r = vals.reduce((a, b) => (a & b) >>> 0, m)
    else if (one && vals.some((v) => v === 0)) r = 0
    else return X
    return t === 'nand' ? (~r & m) >>> 0 : r
  }
  if (t === 'or' || t === 'nor') {
    let r
    if (vals.every(known)) r = vals.reduce((a, b) => (a | b) >>> 0, 0)
    else if (one && vals.some((v) => v === 1)) r = 1
    else return X
    return t === 'nor' ? (~r & m) >>> 0 : r
  }
  if (!vals.every(known)) return X
  const r = vals.reduce((a, b) => (a ^ b) >>> 0, 0)
  return t === 'xnor' ? (~r & m) >>> 0 : r
}

const ALU_OPS = { 0: 'add', 1: 'sub', 2: 'and', 3: 'or', 5: 'slt' }
const signed = (v, w) => (w >= 32 ? v | 0 : v >= 2 ** (w - 1) ? v - 2 ** w : v)

/** Outputs of a part from its input values (by port name) and its state. */
function evalPart(p, iv, state) {
  const w = p.width
  const d = p.ins.filter((q) => q.data).map((q) => iv[q.name])
  const ctl = (key) => {
    const qs = p.ins.filter((q) => q.ctl === key)
    if (!qs.length) return undefined
    if (qs.length === 1) return iv[qs[0].name]
    let v = 0
    for (const q of qs) { const b = iv[q.name]; if (!known(b)) return X; v = v * 2 + (b & 1) }
    return v
  }
  if (GATES.has(p.t)) {
    if (p.t === 'not') return { y: known(d[0]) ? (~d[0] & maskOf(w)) >>> 0 : X }
    if (p.t === 'buf') return { y: d[0] === Z ? X : d[0] }
    if (p.t === 'tri') { const en = ctl('en'); return { y: en === 1 ? (d[0] === Z ? X : d[0]) : en === 0 ? Z : X } }
    return { y: bitwise(p.t, d, w) }
  }
  switch (p.t) {
    case 'mux': {
      const s = ctl('sel')
      if (known(s)) return { y: s < d.length ? d[s] : X }
      return { y: d.every((v) => v === d[0]) ? d[0] : X }
    }
    case 'dec': {
      const en = ctl('en')
      let a = 0
      const bits = p.ins.filter((q) => q.data).map((q) => iv[q.name])
      const n = p.outPorts.length
      if (!bits.every(known) || en === X || en === Z) return Object.fromEntries(p.outPorts.map((o) => [o.name, X]))
      for (const b of bits) a = bits.length === 1 ? b : a * 2 + (b & 1)
      return Object.fromEntries(p.outPorts.map((o, k) => [o.name, en === 0 ? 0 : k === a % n ? 1 : 0]))
    }
    case 'enc': {
      if (!d.every(known)) return { y: X, v: X }
      let hi = -1
      d.forEach((v, k) => { if (v) hi = k })
      return { y: hi < 0 ? 0 : hi, v: hi < 0 ? 0 : 1 }
    }
    case 'ha': return d.every(known) ? { s: d[0] ^ d[1], c: d[0] & d[1] } : { s: X, c: X }
    case 'fa': {
      if (!d.every(known)) return { s: X, cout: X }
      const t = d[0] + d[1] + d[2]
      return { s: t & 1, cout: t >> 1 }
    }
    case 'add': {
      if (!d.every(known)) return { s: X, cout: X }
      const t = d[0] + d[1] + (d[2] ?? 0)
      return { s: fit(t, w), cout: t >= 2 ** w ? 1 : 0 }
    }
    case 'cmp': return d.every(known) ? { eq: +(d[0] === d[1]), lt: +(d[0] < d[1]), gt: +(d[0] > d[1]) } : { eq: X, lt: X, gt: X }
    case 'alu': {
      const op = ctl('op')
      if (!d.every(known) || !known(op)) return { y: X, zero: X }
      const [a, b] = d
      const y = { add: fit(a + b, w), sub: fit(a - b + 2 ** w, w), and: fit(a & b, w), or: fit(a | b, w), slt: +(signed(a, w) < signed(b, w)) }[ALU_OPS[op]]
      return y === undefined ? { y: X, zero: X } : { y, zero: +(y === 0) }
    }
    case 'latch': { const en = ctl('en'); const q = en === 1 ? d[0] : en === 0 ? state : X; return { q } }
    case 'reg': case 'dff': case 'counter': return { q: ctl('rst') === 1 ? 0 : state }
    case 'shift': { const q = ctl('rst') === 1 ? 0 : state; return { q, sout: known(q) ? (p.dir === 'right' ? q & 1 : (q >>> (w - 1)) & 1) : X } }
    case 'regfile': {
      const rd = (a) => (known(a) ? (a % 32 === 0 ? 0 : fit(state[a % 32] ?? 0, w)) : X)
      return { rd1: rd(d[0]), rd2: rd(d[1]) }
    }
    case 'mem': case 'rom': return { rd: known(d[0]) ? fit(state[d[0]] ?? 0, w) : X }
  }
  return {}
}

/** State after a clock edge. */
function nextState(p, iv, state) {
  const w = p.width
  const d = p.ins.filter((q) => q.data).map((q) => iv[q.name])
  const one = (key) => { const q = p.ins.find((x) => x.ctl === key); return q ? iv[q.name] : undefined }
  const rst = one('rst'), en = one('en')
  if (rst === 1) return Array.isArray(state) || typeof state === 'object' ? state : 0
  if (en === 0) return state
  if (en === X || en === Z) return typeof state === 'object' ? state : X
  switch (p.t) {
    case 'reg': case 'dff': return d[0] === Z ? X : d[0]
    case 'counter': return known(state) ? fit(state + 1, w) : X
    case 'shift': {
      if (!known(state) || !known(d[0])) return X
      return p.dir === 'right' ? fit((state >>> 1) | ((d[0] & 1) * 2 ** (w - 1)), w) : fit(state * 2 + (d[0] & 1), w)
    }
    case 'regfile': {
      const we = one('we')
      if (we !== 1 || !known(d[2]) || d[2] % 32 === 0) return state
      return { ...state, [d[2] % 32]: d[3] }
    }
    case 'mem': {
      const we = one('we')
      if (we !== 1 || !known(d[0])) return state
      return { ...state, [d[0]]: d[1] }
    }
  }
  return state
}

/** Initial state of each stateful part, from "init". */
export function initialState(nl) {
  const st = new Map()
  for (const p of nl.parts) {
    if (p.t === 'regfile' || p.t === 'mem' || p.t === 'rom') {
      const m = {}
      if (p.init !== undefined) {
        if (Array.isArray(p.init)) p.init.forEach((v, k) => { m[p.t === 'regfile' ? k : k * 4] = Number(v) })
        else if (typeof p.init === 'object') for (const [k, v] of Object.entries(p.init)) m[Number(String(k).replace(/^x/, ''))] = Number(v)
        else throw new SpecError(`${p.path}.init`, p.t === 'regfile' ? 'init is {"5": 7} (register number -> value) or a list from x0' : 'init is {"0x10": 5} (byte address -> word) or a list of words from address 0')
      }
      st.set(p.id, m)
    } else if (p.seq || p.t === 'latch') {
      const v = p.init ?? 0
      st.set(p.id, v === 'x' ? X : fit(Number(v), p.width))
    }
  }
  return st
}

function refValue(nl, r, vals, part) {
  let v
  if (r.konst !== undefined) v = fit(r.konst, refWidth(nl, r, part))
  else {
    v = vals.get(r.net)
    if (v === undefined) v = X
    if (r.hi !== null && known(v)) v = fit(Math.floor(v / 2 ** r.lo), r.hi - r.lo + 1)
    else if (r.hi !== null && v === Z) v = Z
  }
  if (r.inv) v = known(v) ? (~v & 1) >>> 0 : X
  return v
}

/** Normalize an input value: 0/1, a number, a bit string "0101", or "x". */
function inputValue(v, w, path) {
  if (v === undefined || v === null || v === 'x' || v === 'X') return X
  if (typeof v === 'string' && /^[01_]+$/.test(v) && w > 1) return fit(parseInt(v.replace(/_/g, ''), 2), w)
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new SpecError(path, `"${v}" isn't a value; give 0, 1, a whole number, a bit string like "0101", or "x"`)
  if (n > maskOf(w)) throw new SpecError(path, `${v} doesn't fit in ${w} bit${w === 1 ? '' : 's'}`)
  return n
}

/**
 * Settle every net for the given input values and state. Returns Map net -> value.
 * Loops relax until nothing changes (x where they don't settle).
 */
export function settle(nl, inVals, state) {
  const vals = new Map()
  for (const d of nl.inputs) vals.set(d.name, inVals[d.name] ?? X)
  const order = nl.order ?? nl.parts
  for (let iter = 0; iter < nl.parts.length + 3; iter++) {
    const drv = new Map()
    for (const p of order) {
      const iv = {}
      for (const q of p.ins) iv[q.name] = refValue(nl, q.r, vals, p)
      const out = evalPart(p, iv, state.get(p.id))
      for (const o of p.outPorts) {
        const v = out[o.name] === undefined ? X : out[o.name]
        if (!drv.has(o.net)) drv.set(o.net, [])
        drv.get(o.net).push(v)
        // Single drivers update at once so one pass settles a DAG in topological order.
        if (nl.nets.get(o.net).drivers.length === 1) vals.set(o.net, v)
      }
    }
    let changed = false
    for (const [net, vs] of drv) {
      const live = vs.filter((v) => v !== Z)
      const v = vs.length === 1 ? vs[0] : live.length === 0 ? Z : live.length === 1 ? live[0] : live.every((x) => x === live[0]) ? live[0] : X
      if (vals.get(net) !== v) changed = true
      vals.set(net, v)
    }
    if (!changed && iter > 0) return vals
  }
  for (const c of nl.loops ?? []) for (const id of c) for (const o of nl.byId.get(id).outPorts) vals.set(o.net, X)
  return vals
}

/** Clock edge: every clocked part loads from the settled values. Latches keep their output. */
export function clock(nl, vals, state) {
  const next = new Map(state)
  for (const p of nl.parts) {
    const iv = {}
    for (const q of p.ins) iv[q.name] = refValue(nl, q.r, vals, p)
    if (p.seq) next.set(p.id, nextState(p, iv, state.get(p.id)))
    else if (p.t === 'latch') next.set(p.id, evalPart(p, iv, state.get(p.id)).q)
  }
  return next
}

/** A topological order of the parts (DFS over combinational edges), used to settle in one pass. */
export function topoOrder(nl) {
  const adj = combEdges(nl)
  const seen = new Set(), done = [], onStack = new Set()
  const visit = (id) => {
    if (seen.has(id)) return
    seen.add(id); onStack.add(id)
    for (const w of adj.get(id)) if (!onStack.has(w)) visit(w)
    onStack.delete(id); done.push(id)
  }
  for (const p of nl.parts) visit(p.id)
  return done.reverse().map((id) => nl.byId.get(id))
}

/** Input values from the spec's inputs object or a vector ("101", or {A: 1}). */
export function inputValues(nl, vec, path = 'inputs') {
  const out = {}
  if (typeof vec === 'string') {
    const bits = vec.replace(/[\s_]/g, '')
    const total = nl.inputs.reduce((s, d) => s + d.width, 0)
    if (!/^[01xX]*$/.test(bits) || bits.length !== total) throw new SpecError(path, `vector "${vec}" needs ${total} bits, one per input bit in order (${nl.inputs.map((d) => d.width > 1 ? `${d.name}[${d.width - 1}:0]` : d.name).join(', ')})`)
    let k = 0
    for (const d of nl.inputs) { const s = bits.slice(k, k + d.width); k += d.width; out[d.name] = /x/i.test(s) ? X : parseInt(s, 2) }
    return out
  }
  for (const d of nl.inputs) out[d.name] = inputValue(vec?.[d.name] ?? d.value, d.width, `${path}.${d.name}`)
  if (vec && typeof vec === 'object') for (const k of Object.keys(vec)) if (!nl.inputs.some((d) => d.name === k)) throw new SpecError(`${path}.${k}`, `no input "${k}"; inputs are ${nl.inputs.map((d) => d.name).join(', ')}`)
  return out
}

// --- Analysis ------------------------------------------------------------------------

/**
 * The combinational function: pseudo-inputs are the inputs and every clocked part's state
 * (named by its output net), pseudo-outputs the outputs and every clocked part's D input
 * (named "next q"). Only for 1-bit signals and at most `limit` input bits.
 */
export function truthTable(nl, limit = 10) {
  const seqs = nl.parts.filter((p) => p.seq)
  const vars = [...nl.inputs.map((d) => ({ name: d.name, width: d.width, input: true })), ...seqs.map((p) => ({ name: p.outPorts[0].net, width: p.width, part: p }))]
  if (vars.some((v) => v.width > 1)) return null
  if (seqs.some((p) => !['reg', 'dff'].includes(p.t))) return null
  if (vars.length > limit || !vars.length) return null
  const outs = [...nl.outputs.filter((o) => o.width === 1).map((o) => ({ name: o.label, r: o.r })),
    ...seqs.map((p) => ({ name: `next ${p.outPorts[0].net}`, r: p.ins.find((q) => q.data).r, part: p }))]
  const n = vars.length
  const rows = []
  const ones = outs.map(() => []), xs = outs.map(() => [])
  for (let m = 0; m < 1 << n; m++) {
    const iv = {}, st = new Map()
    vars.forEach((v, k) => { const b = (m >> (n - 1 - k)) & 1; if (v.input) iv[v.name] = b; else st.set(v.part.id, b) })
    const vals = settle(nl, iv, st)
    const row = outs.map((o, k) => {
      let v = refValue(nl, o.r, vals, o.part)
      // A reset or enable on a flop changes what loads: fold them in.
      if (o.part) v = nextState(o.part, Object.fromEntries(o.part.ins.map((q) => [q.name, refValue(nl, q.r, vals, o.part)])), st.get(o.part.id))
      if (v === 1) ones[k].push(m)
      else if (v !== 0) xs[k].push(m)
      return v
    })
    rows.push(row)
  }
  return { vars: vars.map((v) => v.name), outs: outs.map((o) => o.name), rows, ones, xs }
}

/**
 * Critical path: the longest chain of part delays from an input or a clocked part's output to
 * an output or a clocked part's input. Each part counts 1 unless it sets "delay".
 */
export function criticalPath(nl) {
  const arrival = new Map() // net -> {t, via}
  for (const d of nl.inputs) arrival.set(d.name, { t: 0, from: d.name })
  const order = nl.order ?? nl.parts
  const loopIds = new Set((nl.loops ?? []).flat())
  for (const p of order) if (p.seq) for (const o of p.outPorts) arrival.set(o.net, { t: 0, from: p.id })
  for (let pass = 0; pass < 2; pass++) {
    for (const p of order) {
      if (p.seq || loopIds.has(p.id)) continue
      let best = { t: 0, prev: null }
      for (const q of p.ins) {
        if (q.r.konst !== undefined) continue
        const a = arrival.get(q.r.net)
        if (a && a.t >= best.t) best = { t: a.t, prev: q.r.net }
      }
      const delay = typeof p.delay === 'number' ? p.delay : 1
      for (const o of p.outPorts) arrival.set(o.net, { t: best.t + delay, prev: best.prev, part: p.id })
    }
  }
  let end = null
  const consider = (net, label) => { const a = arrival.get(net); if (a && (!end || a.t > end.t)) end = { t: a.t, net, label } }
  for (const o of nl.outputs) if (o.r.konst === undefined) consider(o.r.net, o.label)
  for (const p of nl.parts) if (p.seq) for (const q of p.ins) if (q.r.konst === undefined) consider(q.r.net, `${p.id}.${q.name}`)
  if (!end) return null
  const path = []
  let net = end.net
  const nodes = []
  for (let guard = 0; net && guard < 200; guard++) {
    const a = arrival.get(net)
    if (!a) break
    if (a.part) { nodes.push(a.part); path.unshift(a.part) } else { path.unshift(a.from ?? net); break }
    net = a.prev
  }
  if (end.label && end.label !== path[path.length - 1]) path.push(end.label)
  const blocks = nodes.some((id) => !GATES.has(nl.byId.get(id).t))
  return { t: end.t, path, parts: nodes, unit: blocks ? 'levels' : 'gate delays' }
}
