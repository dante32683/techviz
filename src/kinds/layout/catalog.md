# layout: struct padding and offsets, endianness, address maps

Byte-level layouts. Give exactly one of `struct`, `bytes`, or `map`.

## struct: field offsets and padding

- `struct`: `{name?, fields: [{name, type, tint?} | {name, type, fields: [...]}], packed?}`.
  Types: char, short, int, long, long long, float, double, long double, any pointer (`int *`),
  intN_t/uintN_t, size_t, bool, arrays (`char[3]`, `int[2][2]`); a nested struct gives `fields`
  (and may end its type in `[n]`). Offsets, padding, sizeof, and alignof follow the C rules.
- `abi`: `lp64` (default; x86-64/AArch64 Linux), `llp64` (Windows: long 4), `ilp32` (i386 System V:
  double and long long align to 4), `rv32` (RISC-V: pointers and long 4, double 8 aligned to 8).
- `packed: true`: alignment 1, no padding (also accepted inside `struct`).
- `reorder: true`: also draws the padding-minimal order (largest alignment first) below.
- `row`: bytes per ruler row (default 8; 4 for ilp32/rv32).
- `highlight`: field names, outlined in red.

Each field is a colored span on a byte ruler (name and type inside); padding is hatched "pad".
Summary: `name @offset (size)` per field, each padding run, total padding, sizeof, alignof, and
for reorder the new order and bytes saved. Quote these numbers.

## bytes: endianness

- `bytes`: `{value, size?, type?, name?, endian?, addr?}`.
  `value`: integer (`"0x12345678"`, `305419896`, negatives as two's complement) or, with
  `type: "float" | "double"`, a number (IEEE 754 bits). `size`: bytes (default from the digits:
  1, 2, 4, or 8). `endian`: `"both"` (default), `"little"`, `"big"`. `addr`: first address
  (default `"0x1000"`). `name` and `type` label the value (`uint32_t x = 0x12345678`).
- Each byte keeps its color in both rows; MSB and LSB are marked under each row.

## map: address map

- `map`: `{regions: [{name, from, to | size, tint?, grows?}], marks?, scale?, low?}`.
  `from`/`to` are hex; `to` is the last address (inclusive). `size`: `"64K"`, `"1M"`, `"4KiB"`,
  `"0x1000"`, or a number. Regions may come in any order; overlaps are an error; gaps between
  regions are drawn hatched. `grows`: `"up"` or `"down"` draws a growth arrow (heap up, stack down).
- `marks`: `[{name, at}]` arrows at addresses (`sp`, `gp`, `pc`, a pointer).
- `scale`: `"auto"` (default: uniform when region sizes differ more than 12x, else linear),
  `"uniform"`, `"linear"`.
- `low`: `"bottom"` (default: high addresses at the top) or `"top"`.
- Each region's start is labeled at its low edge; its end at the high edge when a gap or the top follows.

## Examples

```json
{"v":1,"kind":"layout","abi":"lp64","reorder":true,
 "struct":{"name":"S","fields":[{"name":"c","type":"char"},{"name":"i","type":"int"},{"name":"s","type":"short"}]}}
```

```json
{"v":1,"kind":"layout","map":{"regions":[
  {"name":"text","from":"0x00400000","to":"0x0FFFFFFF"},
  {"name":"static data","from":"0x10000000","to":"0x1003FFFF"},
  {"name":"heap","from":"0x10040000","size":"1M","grows":"up"},
  {"name":"stack","from":"0x7FF00000","to":"0x7FFFFFFF","grows":"down"}],
 "marks":[{"name":"sp","at":"0x7FFFEFFC"},{"name":"gp","at":"0x10008000"}]}}
```
