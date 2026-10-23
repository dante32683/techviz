# memory

Stack frames, heap blocks, and globals with pointer arrows (Python Tutor style) for C and C++.
Stack on the left (newest frame on top, globals above it), heap to the right in columns by
pointer depth; arrows are routed around boxes. A pointer's box shows its target's address.

## Fields

- `frames`: `[{id, name?, vars: [item...]}]`, oldest first (main first); drawn newest on top.
  `name` is the label (default id), so recursive calls can share a name with different ids.
- `heap`: `[item...]`, in allocation order (sets auto addresses). Header shows `type` (and `name` if given).
- `globals`: `[item...]`, drawn as a "globals" box above the stack.
- Item: `{id, type, name?, value? | ptr? | cells?, text?, tint?, freed?, addr?, dir?, rowlen?}`.
  Ids are unique across everything. Vars show `name type` above the box, `&name = addr` below.
  - `value`: what a non-pointer holds (`"5"`, `"'A'"`, `"?"` for garbage).
  - `ptr`: target `"x"`, cell `"r1[2]"`, row-and-column `"a[1][2]"` (needs `rowlen` or a `T[R][C]` type),
    field `"node.next"`; `null` (or `"NULL"`) draws NULL; `"dangling"` draws a dashed stub to `?`.
    A pointer to a block with `"freed": true` draws a dashed amber arrow and is flagged DANGLING.
  - `cells`: an array. Values `[1, 2, 3]`, or objects `{value | ptr, name?, type?, tint?, text?}`.
    Values-only arrays run horizontally with indices above; arrays holding pointers, and structs
    (cells with `name`), run vertically with `[i]` or field names at the left.
  - `rowlen`: cells per row for one malloc'd strip used as 2D; draws `row 0`, `row 1` brackets.
    A type like `int[3][4]` sets it. With rowlen, `a[1]` means row 1 (its first cell).
  - `text`: overrides what the box shows. `tint`: palette name (blue, coral, teal, purple, amber,
    green, pink, red, gray); default purple for pointers, blue for values.
  - `freed: true`: dashed, hatched block, header says "freed". Keep freed blocks (don't `remove`)
    so later addresses stay put.
  - `addr`: fixed address `"0x7ffc1000"`.
- `addresses`: `"auto"` (default; stack 0x7ffd0ffc down, heap 0x55a042a0 up with malloc-like
  spacing, globals 0x404010; rv32/ilp32 use RARS-style 0x7fffeffc, 0x10040000, 0x10010000),
  `"small"` (stack below 0x400, heap 0x200, globals 0x100), `"off"` (arrows only).
- `abi`: `lp64` (default, 8-byte pointers), `llp64`, `ilp32`, `rv32`. Sizes set auto addresses.
- `code`: list of source lines, drawn at the left with line numbers. `line`: 1-based current line.
- `highlight`: ids, cells (`"r1[2]"`), rows (`"a[1]"`), fields, or frame ids; drawn in red.
- `steps`: `{label, line, set: {id: patch}, add: {heap: [...]}, remove: [ids], highlight}`.
  `set` reaches vars inside frames. Declare a function's locals in its frame from the start with
  `"value": "?"` (they exist, uninitialized, from entry), then `set` them; `add` frames on calls,
  `remove` them on return; `set` `{"freed": true}` on free.

Summary lists frames, heap blocks, every pointer `src -> target (address)` with NULL and DANGLING
flagged, and all addresses; check it against the code. Errors: unknown target (lists ids), index
out of range, duplicate id, `[r][c]` on a 1D array. Warnings: item without id or type.

## Examples

```json
{"v":1,"kind":"memory",
 "frames":[{"id":"main","vars":[{"id":"x","type":"int","value":"5"},
   {"id":"p","type":"int *","ptr":"x"},{"id":"pp","type":"int **","ptr":"p"}]}],
 "code":["int x = 5;","int *p = &x;","int **pp = &p;"],"line":3}
```

```json
{"v":1,"kind":"memory","addresses":"off",
 "frames":[{"id":"main","vars":[{"id":"grid","type":"int **","ptr":"rows"},{"id":"q","type":"int *","value":"?"}]}],
 "heap":[{"id":"rows","type":"int *[2]","cells":[{"ptr":"r0"},{"ptr":"r1"}]},
   {"id":"r0","type":"int[3]","cells":[0,0,0]},{"id":"r1","type":"int[3]","cells":[0,7,0]}],
 "steps":[{"label":"q = &grid[1][1]","set":{"q":{"ptr":"r1[1]"}},"highlight":["r1[1]"]},
   {"label":"free(grid[1])","set":{"r1":{"freed":true}}}]}
```
