// C type sizes and struct layout for the memory and layout kinds.
// ABIs: lp64 (x86-64 / AArch64 Linux), llp64 (64-bit Windows), ilp32 (i386
// System V: double and long long align to 4 inside structs), rv32 (RISC-V
// ilp32: natural alignment, double and long long align to 8).

const ABIS = {
  lp64: { ptr: 8, long: 8, ll: 8, llAlign: 8, dAlign: 8, ld: [16, 16] },
  llp64: { ptr: 8, long: 4, ll: 8, llAlign: 8, dAlign: 8, ld: [8, 8] },
  ilp32: { ptr: 4, long: 4, ll: 8, llAlign: 4, dAlign: 4, ld: [12, 4] },
  rv32: { ptr: 4, long: 4, ll: 8, llAlign: 8, dAlign: 8, ld: [16, 16] },
}
export const ABI_NAMES = Object.keys(ABIS)

function baseType(name, a) {
  const words = name.replace(/\b(const|volatile|static|extern|register|signed|unsigned)\b/g, ' ').trim().split(/\s+/).filter(Boolean)
  const w = words.join(' ')
  const longs = words.filter((x) => x === 'long').length
  if (w === '' || w === 'int' && longs === 0 && !words.includes('short')) return [4, 4] // "unsigned" alone is int
  if (words.includes('short')) return [2, 2]
  if (words.includes('double')) return longs ? a.ld : [8, a.dAlign]
  if (longs >= 2) return [8, a.llAlign]
  if (longs === 1) return [a.long, a.long]
  const T = {
    char: [1, 1], bool: [1, 1], _Bool: [1, 1], int8_t: [1, 1], uint8_t: [1, 1],
    int16_t: [2, 2], uint16_t: [2, 2], float: [4, 4], int32_t: [4, 4], uint32_t: [4, 4],
    int64_t: [8, a.llAlign], uint64_t: [8, a.llAlign],
    size_t: [a.ptr, a.ptr], ssize_t: [a.ptr, a.ptr], ptrdiff_t: [a.ptr, a.ptr], intptr_t: [a.ptr, a.ptr], uintptr_t: [a.ptr, a.ptr],
  }
  return T[w] ?? null
}

/**
 * Parse a C type like "int", "int *", "int *[3]", "int[3][4]", "int (*)[4]".
 * Returns { size, align, elem: { size, align, ptr }, dims, ptr } or null when
 * the base type is unknown (a struct without a definition, say). `dims` are
 * the array dimensions (empty for a scalar); `[]` gives 0.
 */
export function typeInfo(type, abiName = 'lp64') {
  const a = ABIS[abiName] ?? ABIS.lp64
  let t = String(type ?? '').trim()
  if (/\(\s*\*+\s*\)/.test(t)) return { size: a.ptr, align: a.ptr, elem: { size: a.ptr, align: a.ptr, ptr: true }, dims: [], ptr: true }
  const dims = []
  let m
  while ((m = /\[\s*(\d*)\s*\]\s*$/.exec(t))) { dims.unshift(m[1] === '' ? 0 : Number(m[1])); t = t.slice(0, m.index).trim() }
  const ptr = t.includes('*')
  const base = ptr ? [a.ptr, a.ptr] : baseType(t, a)
  if (!base) return null
  const count = dims.reduce((p, d) => p * d, 1)
  return { size: base[0] * count, align: base[1], elem: { size: base[0], align: base[1], ptr }, dims, ptr: ptr && !dims.length }
}

const alignUp = (n, a) => Math.ceil(n / a) * a

/**
 * Lay out struct fields by the C rules: each field at the next multiple of its
 * alignment, the struct's alignment is its largest field's, and its size
 * rounds up to that. Fields: { name, type, fields? (a nested struct) }.
 * Returns { fields: [{ name, type, offset, size, align, index }], pads: [{ offset, size }], size, align }.
 * Throws Error(`fields[i]: ...`) for an unknown type.
 */
export function structLayout(fields, abiName = 'lp64', packed = false, prefix = 'fields') {
  let off = 0, maxAlign = 1
  const out = [], pads = []
  fields.forEach((f, i) => {
    let size, align
    if (Array.isArray(f.fields)) {
      const inner = structLayout(f.fields, abiName, packed, `${prefix}[${i}].fields`)
      const dims = typeInfo(`int${String(f.type ?? '').match(/(\[\s*\d+\s*\])+\s*$/)?.[0] ?? ''}`, abiName).dims
      size = inner.size * dims.reduce((p, d) => p * d, 1); align = inner.align
    } else {
      const ti = typeInfo(f.type, abiName)
      if (!ti) throw new Error(`${prefix}[${i}].type: unknown type "${f.type}"; use a C scalar (char, short, int, long, long long, float, double, a pointer, intN_t, size_t), an array like char[3], or give a nested struct's "fields"`)
      size = ti.size; align = ti.align
    }
    if (packed) align = 1
    const at = alignUp(off, align)
    if (at > off) pads.push({ offset: off, size: at - off })
    out.push({ name: f.name ?? `f${i}`, type: f.type ?? 'struct', offset: at, size, align, index: i })
    off = at + size
    maxAlign = Math.max(maxAlign, align)
  })
  const size = alignUp(off, maxAlign)
  if (size > off) pads.push({ offset: off, size: size - off, tail: true })
  return { fields: out, pads, size, align: maxAlign }
}

/** Field order with the least padding: largest alignment first, stable otherwise. */
export function bestOrder(fields, abiName = 'lp64', packed = false) {
  const lay = structLayout(fields, abiName, packed)
  return fields.map((f, i) => ({ f, i, a: lay.fields[i].align, s: lay.fields[i].size }))
    .sort((x, y) => y.a - x.a || x.i - y.i).map((x) => x.f)
}

/** Parse an address or size: 4096, "0x1000", "64K", "64KiB", "1M", "2G". Returns a BigInt or null. */
export function parseAddr(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v)
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/_/g, '')
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s)
  const m = /^(\d+)\s*([KMGT]?)(i?B)?$/i.exec(s)
  if (!m) return null
  const k = { '': 0n, K: 10n, M: 20n, G: 30n, T: 40n }[m[2].toUpperCase()]
  return BigInt(m[1]) << k
}

/** "64 KiB", "256 MiB", "4 GiB", "48 B", or ≈ and one decimal when inexact ("≈255.9 MiB"). */
export function fmtSize(n) {
  for (const [name, sh] of [['TiB', 40n], ['GiB', 30n], ['MiB', 20n], ['KiB', 10n]]) {
    if (n < 1n << sh) continue
    return n % (1n << sh) === 0n ? `${n >> sh} ${name}` : `≈${(Number(n) / 2 ** Number(sh)).toFixed(1)} ${name}`
  }
  return `${n} B`
}
