# breadboard: breadboard wiring as built, hole by hole (any board shape, or the NI myDAQ protoboard): parts, jumpers, leads, header pins, nets checked

A breadboard as built in lab: parts by the holes their leads go in, jumpers, off-board posts (instrument or supply leads), and header blocks
beside the board. The strips plus the jumpers give the nets, tinted on the board and listed in `summary`: check them against the schematic.

## Holes
- Terminal holes: letter `a`-`j` and number, like `"c12"` (either case; on a vertical board the numbers are the rows people count). Each number's
  `a`-`e` is one strip (`12a-e`), `f`-`j` another (`12f-j`).
- Rails: `t+`, `t-`, `b-`, `b+` (top, bottom) with a number, like `"t-3"`; on a vertical board `l+`, `l-`, `r+`, `r-` (left, right). Each rail is one
  strip, gaps and all: every 6th number (6, 12, 18...) just has no rail hole (an error names the ones beside it); `railGaps: false` fills them.
- Header pins: `"<header id>.<pin>"`, like `"AJ2.5V"`: the pin's id, or its label when only one pin has it. A hole or socket takes one lead or
  wire, so a wire to a part's strip uses a free hole of it. Pin n of a header sits at number `at` + n − 1 (`AJ1.AO0` is row 18).

## Board
- `preset`: `"mydaq"` is the NI myDAQ protoboard (Digilent): vertical, 60 rows, letters A-J, rails `+ −` on each side, and on its blue PCB at the
  right three header blocks (pin ids, printed labels in parentheses): `AJ1` rows 11-22: `S1 T1 R1 +15V -15V PWRGND AOGND AO0 AO1 AI0GND AI0+ AI0-` (S1
  T1 R1 +15V −15V GND GND 0 1 GND 0+ 0−); `DIG` rows 25-36 (printed AI1 DIGITAL): `AI1GND AI1+ AI1- DGND DIO0`...`DIO7` (GND 1+ 1− GND DIO0...); `AJ2`
  rows 39-50: `G Y R CCW Wiper CW 5V GND Vext S2 T2 R2`; `SW5V` row 52, the +5V ON/OFF switch. The spec's own fields override the preset's; its
  `headers` add to them (same id replaces).
- `orient`: `"horizontal"` (default; numbers left to right) or `"vertical"` (numbers run down, rows a-j read left to right, the top rails become the
  left ones). Match the real board so it needs no turning. `caps`: true prints A-J (strips as `12A-E`).
- `cols` (or `rows`): numbered strips, default 30 (half size, 610 px); 63 is full. A smaller count trims the board for a narrow panel (a header
  starting past the end is left off). `half: "top"` (horizontal only) draws rows a-e and the top rails, about 60% of the height.
- `rails`: each side's signs in page order, `""` for none: default `{"top": "+-", "bottom": "-+"}`, or when vertical `{"left": "+-", "right": "-+"}`.
- `headers`: `{id, label, pins, at, side}`: a female header beside the board, `label` its printed name. `pins`: labels (`"5V"`) or `{"id": "AO0",
  "label": "0"}` where labels repeat. `at`: the number pin 1 lines up with (default 1); pins run along the board. `side`: bottom or top (vertical:
  right or left; default bottom or right). No `pins` draws a pinless block (a switch).

## Fields
- `parts`: `{id, t, pins, label, value, bands}`. Types and `pins` order:
  - two leads: `R`, `C`, `L`, `switch`; `Cp` (electrolytic: +, −); `diode`, `led` (anode, cathode; `led` takes `color`, default red). Flat between
    holes 2+ apart, else standing. Summary pins: `R1`, `C1+`, `D1.a`.
  - `R` shows its `value`'s color bands from pin 1 (4, or 5 when the value needs 3 digits; `bands: 5` forces a 1% part's five).
  - three leads: `npn`, `pnp` (e, b, c: TO-92), `pot` (a, w, b) → `Q1.e`, `P1.w`.
  - `box`: any device or module, `pins` any length, `label` written on it; pins `DUT.1`... or `pinNames`.
  - `ic`: a DIP across the channel: `col` (number of pin 1), `pins` (count, default 8), `pinNames` (written on the chip, used in the summary:
    `U1.OUT`). Pin 1 is by the notch: horizontal, bottom left in row f, notch left; vertical, top left in row e, notch up. Pins run counterclockwise.
  - `label` and `value` (light TeX: `R_{s}`, `16.2\,\Omega`) go beside the part, off the holes.
- `wires`: `{id, from, to, color}`: jumpers between holes or header pins. Default red to a + rail or supply pin, black to a − rail or GND pin, else a
  palette color. Colors: blue, teal, coral, purple, amber, green, pink, red, gray, `black`, `white`, or a #hex.
- `posts`: `{id, to, label, side, color}`: a lead leaving the board edge to a labeled terminal. `label` is a string or lines (`["LO", "gen LO", "CH1
  probe"]`: name, then notes). `side` as for headers (default the nearer edge). A post names its net. On a myDAQ board, wire to header pins.
- `nodes`: `{"v_{C}": "f13"}` names the net at that hole and labels it beside the strip. `highlight`: ids. Steps `add`, `set`, `remove` by id.

## Summary and checks
`breadboard: 30 columns; 2 parts, 2 wires, 3 posts; bands: Rs brown-blue-red-gold-brown; nets: LO[5a-e]{DUT.1, LO} MID[9a-e,12a-e]{DUT.2, Rs, MID}
GND[18a-e,t-]{Rs, GND}; open: U1.8`. Nets are named by `nodes`, then posts, then header pins (`AJ2.5V`), then n1, n2. `open` lists chip pins alone on
their strip. The nets also come as a note, so `check_panel` lists them. Errors (all at once): a hole or header pin that doesn't exist, unknown type,
wrong pin count. Warnings: two leads in one hole, a two-lead part shorted, a lead, post, or header pin with nothing else on its net, a wire that
connects nothing, a label with no clear spot, an `R` value with no code.

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

An LED on myDAQ DIO0 on its own protoboard, trimmed to 36 rows:

```json
{"v":1,"kind":"breadboard","preset":"mydaq","rows":36,"parts":[{"id":"R1","t":"R","pins":["h26","h30"],
 "value":"330\\,\\Omega"},{"id":"D1","t":"led","pins":["i30","i28"],"color":"green"}],
 "wires":[{"from":"DIG.DIO0","to":"j26"},{"from":"DIG.DGND","to":"r-27"},{"from":"r-29","to":"j28"}]}
```
