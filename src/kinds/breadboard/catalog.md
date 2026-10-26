# breadboard: solderless breadboard wiring: parts in holes, jumpers, instrument leads, nets checked

A breadboard as it is built in lab: parts by the holes their leads go in, jumper wires, and
off-board posts (generator, scope, myDAQ, or supply leads). The board's strips plus the jumpers
give the nets, tinted on the board and listed in `summary`: check them against the schematic.

## Holes

- Terminal holes: row `a`-`j` and column, like `"c12"`. Each column's `a`-`e` is one strip
  (`12a-e`), `f`-`j` another (`12f-j`); the center channel separates them.
- Rails: `t+`, `t-` (top, outer first) and `b-`, `b+` (bottom, outer last) with a column, like
  `"t-3"`. Each rail is one strip along the board. Every 6th column (6, 12, 18...) is a gap with
  no rail hole: an error names the holes beside it.
- `cols`: board columns, default 30 (half size); 63 for full. Fewer trims the board to the
  columns used (the figure is about 20 px per column, 610 px at 30).
- `half: "top"` draws only rows `a`-`e` and the top rails, at about 60% of the height: use it
  when nothing goes in rows `f`-`j` or the bottom rails, and with a small `cols` for a figure
  beside text in a narrow panel. Holes off that half are errors.

## Fields

- `parts`: `{id, t, pins, label, value}`. Types and `pins` order:
  - two leads: `R`, `C`, `L`, `switch`; `Cp` (electrolytic: +, −); `diode`, `led` (anode,
    cathode; `led` takes `color`, default red). Lying flat between holes 2+ columns apart,
    else standing with splayed leads. Pins in the summary: `R1` (both ends), `C1+`, `D1.a`/`D1.k`.
  - three leads: `npn`, `pnp` (e, b, c: TO-92), `pot` (a, w, b) → `Q1.e`, `P1.w`.
  - `box`: any device or module, `pins` any length; its `label` is written on it. Pins are
    `DUT.1`, `DUT.2`... or names from `pinNames`.
  - `ic`: a DIP across the channel: `col` (column of pin 1), `pins` (count, default 8),
    `pinNames` (written on the chip and used in the summary, e.g. `U1.OUT`; repeats use numbers).
    Pin 1 is bottom left in row f, notch left; pins run right along f, then back along e.
  - `label` and `value` (light TeX: `R_{s}`, `16.2\,\Omega`) go beside the part, off the holes.
- `wires`: `{id, from, to, color}`: jumpers between two holes. Default color red to a + rail,
  black to a − rail, else a palette color. Colors: palette names, `black`, `white`.
- `posts`: `{id, to, label, side, color}`: a lead leaving the board edge to a labeled terminal.
  `label` is a string or lines (`["LO", "gen LO", "CH1 probe"]`: name, then smaller notes).
  `side`: top or bottom (default the nearer edge). A post names its net.
- `nodes`: `{"v_{C}": "f13"}` names the net at that hole and labels it beside the strip.
- `highlight`: ids. Steps can `add`, `set`, or `remove` parts, wires, and posts by id.

## Summary and checks

`breadboard: 30 columns; 2 parts, 2 wires, 3 posts; nets: LO[5a-e]{DUT.1, LO} MID[9a-e,12a-e]{DUT.2,
Rs, MID} GND[18a-e,t-]{Rs, GND}; open: U1.8`. Nets are named by `nodes`, then posts, then n1, n2.
`open` lists chip pins with nothing else on their strip. The same nets come as a note, so a
techviz-panel `check_panel` lists them too. Errors (all reported at once): a hole that doesn't
exist, unknown type, wrong pin count. Warnings: two leads in one hole, a two-lead part shorted (both
leads in one net), a lead or post alone on its strip, a wire that connects nothing, a label
with no clear spot.

## Examples

PHYS 42 IV curve: generator LO → device → 16.2 Ω sense resistor → ground rail, with probe posts.

```json
{"v":1,"kind":"breadboard","parts":[{"id":"DUT","t":"box","pins":["c5","c9"],"label":"DUT"},
 {"id":"Rs","t":"R","pins":["c12","c18"],"label":"R_{s}","value":"16.2\\,\\Omega"}],
 "wires":[{"from":"a9","to":"a12"},{"from":"a18","to":"t-17"}],
 "posts":[{"id":"LO","to":"a5","label":["LO","gen LO","CH1 probe"],"color":"red"},
  {"id":"MID","to":"b12","label":["MID","CH2 probe"],"color":"amber"},
  {"id":"GND","to":"t-25","label":["GND","gen GND","CH1, CH2 ground"],"color":"black"}]}
```

An LED on a myDAQ digital line, on a trimmed board:

```json
{"v":1,"kind":"breadboard","cols":12,"parts":[{"id":"R1","t":"R","pins":["c2","c6"],"value":"330\\,\\Omega"},
 {"id":"D1","t":"led","pins":["d6","d8"],"color":"green"}],"wires":[{"from":"a8","to":"t-8"}],
 "posts":[{"id":"DIO0","to":"a2","label":"DIO 0","color":"red"},{"id":"DGND","to":"t-11","label":"DGND","color":"black"}]}
```
