# circuit

Schematics with IEC 60617 symbols, drawn turtle-style: each part starts where the last
ended. Grid units (1 = 26 px), x right, y down. Check `summary` against the intended nets.

## Fields

- `parts` (required): drawn in order. Part fields:
  - `t`: R, C, Cp (polarized), L, V, I, AC, battery, switch, diode, led, zener, lamp,
    voltmeter, ammeter, fuse, pot, vcvs, vccs, ccvs, cccs (diamonds), opamp, npn, pnp,
    nmos, pmos, wire, ground, dot (junction), terminal (open circle), label (text).
  - `id` to refer to it (unnamed parts show as `R#3`). Start: `at` [x, y], `from` an
    anchor, else the cursor (first [0, 0]).
  - `dir`: up, down, left, right, or degrees (0 right, 90 up). Default: the previous
    part's direction (right at first); ground defaults to down.
  - `len`: two-terminal parts 3, wires 1. `to` (anchor or [x, y]): a part runs straight
    to it, at any angle; a wire routes there orthogonally, horizontal first
    (`"via":"v"`, or `dir` up/down, for vertical first).
  - `label` (name, e.g. `R_{1}`) and `value` (e.g. `4\,\Omega`): stacked beside the part,
    on the free side away from the drawing's center; `side`: left/right/above/below forces it.
  - `closed` (switch, default false); `flip` mirrors (inductor humps, pot wiper, op-amp
    + on top, transistor); `pin`: which multi-terminal pin sits at the start.
- Anchors: `"R1.end"`. Two-terminal: start, end, mid (diodes also a, k; V-type also plus,
  minus; pot also w). opamp: in-, in+, out (in- on top unless flip). npn: b, c, e; pnp: b,
  e (top), c. nmos: g, d, s; pmos: g, s (top), d. Point parts: bare id (`"a"`). Node names
  from `nodes` work too. Anchors name only parts drawn earlier.
- Cursor after a part: its end (two-terminal, wire); opamp out; transistor c or d; point
  parts move it to their point without turning. Default `pin`: opamp in-, BJT b, MOSFET g.
- Polarity: V, battery, Cp, vcvs, ccvs have + at the end (draw V up for + on top); I,
  vccs, cccs point start to end; diodes have the anode at start.
- `nodes`: {"a": "R1.start"} names a net and labels it there.
- `currents`: [{"on": "R1", "label": "i_{1}", "reverse": false}]: arrowhead on the end lead
  (a wire: its longest run), along the part's direction.
- `voltages`: [{"across": "R2", "label": "v_{R}", "reverse": false}]: + and − at the ends,
  label between, opposite the part label; + at start (passive sign), V-type at their +.
- `loops`: [{"in": ["V1", "R1", "R2"], "label": "I_{1}", "dir": "cw"}]: a loop-current
  arc centered in the mesh's box; `dir` cw (default) or ccw; optional `color`.
- `standard`: "iec" (default) or "ansi" (zigzag resistors). `highlight`: ids to emphasize.
  Steps can `set` a part by id (`{"S1": {"closed": true}}`) and `highlight` ids.

## Summary and checks

`circuit: 5 parts; nets: a{V1+,R1} b{R1,R2} 0{R2,V1-}; S1 open; currents: i_{1} a→b;
voltages: v_{R} +a -b; loops: ...`. Nets are named from `nodes`, then `0` for ground,
then n1, n2 in drawing order. Pins: plain id for unpolarized parts, `V1+`/`V1-`,
`I1.start`/`.end`, `D1.a`/`.k`, `U1.in-`, `Q1.b`, `P1.w`. Dots appear where 3+ conductors
meet; crossing wires don't connect. Errors: unknown type, bad or later anchor. Warnings:
an end touching nothing (terminals exempt), an end on a part's middle, parts drawn over
each other, a shorted part, overlapping labels, a loop that isn't one closed mesh, a part
too short for its symbol, unknown part fields.

## Examples

```json
{"v":1,"kind":"circuit","parts":[{"id":"V1","t":"V","dir":"up","label":"V_{s}","value":"12 V"},
 {"id":"S1","t":"switch","dir":"right","value":"t = 0"},
 {"id":"R1","t":"R","label":"R","value":"2\\,k\\Omega"},
 {"id":"C1","t":"C","dir":"down","label":"C","value":"100\\,\\mu F"},
 {"t":"wire","to":"V1.start"}],
 "currents":[{"on":"R1","label":"i"}],"voltages":[{"across":"C1","label":"v_{C}"}]}
```

```json
{"v":1,"kind":"circuit","parts":[{"id":"vin","t":"terminal","label":"v_{in}"},
 {"id":"R1","t":"R","dir":"right","label":"R_{1}"},{"t":"wire"},{"id":"U1","t":"opamp"},
 {"t":"wire","len":2},{"id":"vo","t":"terminal","label":"v_{o}"},
 {"t":"wire","from":"U1.in+","dir":"down"},{"t":"ground"},
 {"t":"wire","from":"R1.end","dir":"up","len":3},
 {"id":"Rf","t":"R","dir":"right","len":6,"label":"R_{f}"},{"t":"wire","dir":"down","len":4}]}
```
