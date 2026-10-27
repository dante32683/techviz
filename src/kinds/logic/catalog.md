# logic: gate-level schematics and RTL block diagrams (gates, muxes, adders, flip-flops, registers, ALU, register file, memory), simulated, with truth tables, minimal SOP, and the critical path

Drawn left to right by logic depth in ANSI (H&H) symbols, with orthogonal wires and junction dots;
never give coordinates. Karnaugh maps are the `kmap` kind; transistor-level CMOS is `circuit`.

## Netlist

- `inputs`: names in order, top to bottom (`"D[3:0]"` is a 4-bit bus); or an object of name to value
  (`{"A": 1, "B": 0}`; a bus takes a number or a bit string) to simulate: every wire shows its value
  (1 red, 0 blue, x gray, z amber, buses teal in hex).
- `parts`: `{id, t, in}` plus a part's own keys. A part's output net is its `id` (or `out`); a block's
  other outputs are `id.port`. `in` lists the data inputs in order. A pin takes a net name, `~A` (an
  inversion bubble on that pin), a slice `A[3]` or `A[7:4]`, or a constant (`1`, `4`, `"4'b0001"`,
  `"32'h4"`), drawn as a short labeled stub.
- `outputs`: nets in order, or `{label: net}` (`{"Sum": "fa.s"}`). Default: every net nothing reads.
- Gates: `and`, `or`, `xor`, `nand`, `nor`, `xnor` (2 to 8 inputs), `not`, `buf`, and `tri` (`en`;
  `"~E"` for active low). On a bus they're bitwise.
- Blocks (control pins enter from the top):
  - `mux`: `in` d0, d1, ...; `sel`: a bus, or a list of 1-bit nets MSB first.
  - `dec`: `in` the select bits MSB first, or one bus; outputs `id` (y0), `id.y1`, ...; `en` optional.
  - `enc` (priority): `in` d0, d1, ... → `id` (index of the highest 1), `id.v`.
  - `ha` [a, b] → `id.s`, `id.c`; `fa` [a, b, cin] → `id.s`, `id.cout`.
  - `add` [a, b, cin?] → `id` (sum), `id.cout` with `"cout": true`; `cmp` [a, b] → `id.eq`, `id.lt`, `id.gt` (unsigned).
  - `alu` [a, b], `op` (3-bit ALUControl: 000 add, 001 sub, 010 and, 011 or, 101 slt) → `id`, `id.zero`.
  - `latch` [d], `en`. `reg` [d] (`dff` is a reg drawn with D and Q), `en` and `rst` optional (reset is
    asynchronous, to 0). `counter` (`en`, `rst`). `shift` [serial in], `dir` `"left"` (default) or `"right"` → `id`, `id.sout`.
  - `regfile` [A1, A2, A3, WD3], `we` → `id.rd1`, `id.rd2` (x0 reads 0); `mem` [A, WD], `we` → `id`; `rom` [A] → `id`.
    `init`: a regfile's `{"5": 7}` (register to value); a mem's or rom's `{"0x10": 5}` (byte address to word) or a list of words.
- Part keys: `width` (bits; default from the data inputs; regfile, mem, and rom 32; counter and shift 4), `init`
  (a register's start value, default 0), `delay` (default 1), `label` (a block's inner text), `clk` (the clock stub's label).

## Expressions

- `expr`: `{"Y": "AB + A'C"}` in place of parts: one AND, OR, or XOR gate per level, NAND, NOR, or XNOR for a
  complemented group, and one NOT per complemented input (`bubbles: true` puts bubbles on the gate pins instead).
  `simplify: true` draws the minimal SOP. Syntax: AND `AB`, `A*B`, `A&B`; OR `A + B`, `A|B`; XOR `A ^ B`, `A ⊕ B`;
  NOT `A'`, `~A`, `!A`; parentheses; 0 and 1. A name is a letter plus lowercase letters and digits (Cin, S0), so AB
  is A·B; list `inputs` to use other names (then each matches the longest listed name).

## Checks and steps

- `expect`: `{"S": "A ^ B ^ Cin"}`. Checked row by row; a mismatch warns with the first bad row.
- `vectors`: `"all"` (every input combination, up to 6 input bits) or a list of bit strings in input order (`"101"`)
  or objects (`{"Sel": 1}`; inputs left out keep their `inputs` value), one step each. With registers each vector is
  a clock cycle: the step shows the values during it, and registers load at its end. `cycles: N` steps N clock edges
  (the last vector holds).
- `table: true`: the truth table under the schematic, with the current input row shaded.
- `highlight`: part ids or net names, or `"critical"` for the critical path.

Summary: inputs, outputs, and part counts; each 1-bit output's minterms and minimal SOP (with `reg` or `dff`
state, a register's output counts as an input and `next q` as an output, giving next-state equations); the
expect results; the critical path in gate delays (in levels when blocks are on it); and, when simulating, the
input and output values, each register's state now and after the next edge, and memory writes. Warnings: undriven
nets, several drivers on a net (tri-state buffers may share one), combinational loops, unused outputs and inputs,
and width mismatches. Up to about 10 parts with short names stays readable at panel width (300 px).

## Examples

```json
{"v":1,"kind":"logic","inputs":{"A":1,"B":1,"Cin":0},
 "parts":[{"id":"x1","t":"xor","in":["A","B"]},{"id":"S","t":"xor","in":["x1","Cin"]},
  {"id":"a1","t":"and","in":["A","B"]},{"id":"a2","t":"and","in":["x1","Cin"]},{"id":"Cout","t":"or","in":["a1","a2"]}],
 "outputs":["S","Cout"],"expect":{"Cout":"AB + ACin + BCin"}}
```

```json
{"v":1,"kind":"logic","inputs":{"reset":0},
 "parts":[{"id":"sum","t":"add","in":["q","1"]},{"id":"q","t":"reg","width":4,"in":["sum"],"rst":"reset"}],
 "outputs":{"Q":"q"},"vectors":["1","0"],"cycles":5}
```
