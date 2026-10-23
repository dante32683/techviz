# fsm: state machines and directed graphs (Graphviz)

Either `states` + `edges` (a state machine) or `dot` (any directed graph).

## State machine fields

- `machine`: `"moore"` (outputs in states) or `"mealy"` (outputs on edges). Default: moore if
  any state has `out`, mealy if any edge has `out`, else plain.
- `states`: `{id, init?, accept?, out?, label?}`. `init: true` draws an entry arrow;
  `accept: true` a double circle. `out` (Moore): `"y=1"` or `{"tx": 1, "busy": 0}`, drawn as
  a second line in the state. `label` replaces the shown name (id stays the key).
- `edges`: `{from, to, on?, out?, act?, id?}`. Label is `on`, then ` / out` (Mealy) and/or
  `act` (an action such as `i++`): `1 / 0`, `tick & i<7 / i++`. No `on` means always.
- `inputs`: the input values used in `on`, like `["0", "1"]`. With inputs, an `on` of
  `"0,1"` or `"0|1"` covers both; `*`, `else`, `default` cover all.
- `complete: true` (needs `inputs`): warn about states missing a transition for some input.
- `rankdir`: `LR` (default), `TB`, `RL`, `BT`. `engine`: `dot` (default), `circo`, `neato`.
- `highlight`: state ids and edge ids; draws the current state and the edge taken in the
  highlight color. `collections`: `states`, `edges`, so `steps` can animate a run.
- Labels use techviz TeX-like syntax (`d_{i}`, `\overline{Q}`). Write `\_` for a literal
  underscore. State names without markup stay upright (`S0`, `IDLE`).

Checks: edge endpoints exist, duplicate state ids (errors); no or several `init` states,
unreachable states, Moore states without `out` when others have one, Mealy edges without
`out` when others have one, outputs on the wrong side, `on` values outside `inputs`, two
transitions on one input from the same state, and missing transitions when `complete` (warnings).

Summary: `fsm moore: 4 states (init S0), 8 transitions: S0 -0-> S0, S0 -1-> S1, ...; outputs
S0[y=0] ...; unreachable: none`.

## dot

- `dot`: DOT source (`digraph { ... }`), for block diagrams and datapaths. Defaults: Helvetica
  13 for layout, edge labels 12. Labels are plain text (not TeX). Clusters are drawn.
- Colors are themed: black becomes the foreground, white fills vanish, other colors snap to the
  nearest palette color (fills as tints). `style=dashed|dotted|bold|rounded|filled` works.
- `highlight`: node names and edge `id` attributes. `engine` applies. Graphviz syntax errors
  are reported at `dot`. Summary: node and edge counts and the edge list.

## Examples

```json
{"v":1,"kind":"fsm","machine":"moore","inputs":["0","1"],"complete":true,
 "states":[{"id":"S0","init":true,"out":"y=0"},{"id":"S1","out":"y=1"}],
 "edges":[{"from":"S0","to":"S1","on":"1"},{"from":"S0","to":"S0","on":"0"},
          {"from":"S1","to":"S0","on":"0"},{"from":"S1","to":"S1","on":"1"}]}
```

```json
{"v":1,"kind":"fsm","dot":"digraph { rankdir=LR; node [shape=box, style=rounded]; PC -> IMem -> RF -> ALU; }"}
```
