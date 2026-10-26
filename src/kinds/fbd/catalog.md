# fbd: free-body and system diagrams: forces, inclines, ropes, pulleys, springs, supports and reactions, beam loads, dimensions, fields, right-hand rule

No pixel coordinates: layout, labels, and arrow scale are automatic. Angles: degrees CCW from +x.

- `body` or `bodies`: `{id (default body, body2...), type, label, angle}`. `type`: `block` (default;
  `w`, `h` 1.3 × 0.9 units), `bar` (beam or wire: `length` 4, `span` for ΣM, `current: "right"`
  adds an `I` arrow), `disk` (`r`), `pulley` (`r`, `mount`: up|down|left|right|none), `point`.
- Placement: on a `surface`, blocks and disks sit in list order (`gap` 1.1 units); else `at: [x, y]`
  (units, ~a block width), a pulley `at: "edge"`, `hang: "P"` below pulley P (`side`, `drop` 1.6), or a row.
- `surface`: `{angle, label, edge}`: ground (0) or an incline (positive rises right) drawn as a
  wedge with its angle arc labeled `label`; `edge: "right"|"left"` ends level ground at a table edge.
- `forces`: `{id, on, at, dir, mag, label, push, color, components, vector}`.
  - `on`: body id (default the first). `at`: center (default), top, bottom, left, right, corners
    like top-left; on a bar also start, end, or a fraction 0 to 1.
  - `dir`: up, down, left, right, in, out (of the page), normal (out of the body's face, along
    the incline normal), uphill, downhill, degrees, `{"rel": deg}` from the body's own axis, or
    `[x, y]` / `[x, y, z]`. `cross: ["v", "B"]` (`sign: "-"` for a negative charge) points along
    a × b of two earlier ids: a right-hand-rule triad is a `point` with `"axes": "3d"`.
  - `mag` (number or expression) sets length and enters ΣF. `push: true`: head at the point.
  - `components: ["mg\\sin\\theta", "mg\\cos\\theta"]` (or true): dashed components along
    the axes (the surface's when on one), ids `mg.x`, `mg.y`. `vector: true`: not a force (v, B).
- `connections`: `{type: rope|spring|rod, from: "A.right", to: "B.top", over: ["P"], label,
  tension}`. No `to`: it runs `dir` for `length` units (1.5) to a hatched mount, or with
  `end: "free"` stops loose (a hand pull). `tension: "T"` (or `["T_{1}", "T_{2}"]`, or `{labels,
  mag, push}`) adds the pull on each body along the rope; `force` does the same for a spring.
- `supports`: `{type: pin|roller|fixed, on, at, dir, id, reactions, labels, mags}`. At defaults to
  a bar's start then end. Without `reactions` it draws the symbol; `reactions: true` draws the
  reactions instead (pin `A_{x}`, `A_{y}`; roller `B_{y}`; fixed adds the couple `M_{A}`).
- `loads`: distributed on a bar: `{on, from: 0, to: 1, w, label, mag, resultant}`. `w`: a number
  or `[w1, w2]` (linear); `mag` is the total; `resultant: "W"` draws it at the centroid.
  `moments`: `{on, at, dir: ccw|cw, label, mag}`: a couple as an arc arrow.
- `dims`: dimension lines along a bar: `{on, from: "start", to: "end", label: "2 m", side: below|above}`.
  Ends: start, end, a fraction, or a force or support id (supports are A, B... unless given `id`).
  Overlaps stack outward. With the bar's `span`, a number label is checked; no `label` writes it (`unit`).
- `angles`: `{force, from, label}`: an arc from `horizontal` (default), `vertical`, `surface`,
  degrees, or a force or component id. Same-line arrows at one point fan apart on their own.
- `axes`: true, `"3d"` (oblique x, y, z; +z out of the page draws down-left), or `{angle, labels,
  on}`; `angle: "surface"` tilts them along the incline. `net: true` draws ΣF dashed per body.
- `field`: `{dir: in|out|degrees, label}` fills the background with ⊗/⊙ or arrows. `panels`: scenes side
  by side, each with a `caption`; top-level fields are defaults. `unit`, `mono: true` (black), `highlight`.

Summary: forces per body, ΣF when all have `mag` (ΣM about a bar's start with `span`), dims. Check it.

## Examples
Hanging wire (12 g) in a field into the page; panel 2 with the current reversed:
```json
{"v":1,"kind":"fbd","unit":"N","field":{"dir":"in","label":"B"},"panels":[
 {"caption":"T = 0","body":{"type":"bar","label":"12 g","current":"right"},
  "forces":[{"dir":"up","mag":0.1176,"label":"F_{B}"},{"dir":"down","mag":0.1176,"label":"mg"}]},
 {"caption":"I \\text{ reversed}","body":{"type":"bar","label":"12 g","current":"left"},
  "forces":[{"at":"start","dir":"up","mag":0.1176,"label":"T"},{"at":"end","dir":"up","mag":0.1176,"label":"T"},
   {"dir":"down","mag":0.1176,"label":"mg"},{"dir":"down","mag":0.1176,"label":"F_{B}"}]}]}
```
Block on a 30° incline with static friction, tilted axes, mg components and the angle:
```json
{"v":1,"kind":"fbd","unit":"N","surface":{"angle":30,"label":"30°"},"body":{"label":"m"},"axes":{"angle":"surface"},
 "forces":[{"dir":"normal","mag":16.97,"label":"N"},{"dir":"uphill","mag":9.8,"label":"f_{s}"},
  {"id":"mg","dir":"down","mag":19.6,"label":"mg","components":["mg\\sin\\theta","mg\\cos\\theta"]}],
 "angles":[{"force":"mg","from":"mg.y","label":"\\theta"}]}
```
Simply supported beam (6 m) with dimensions; panel 2 is the free body with reactions:
```json
{"v":1,"kind":"fbd","unit":"kN","body":{"type":"bar","id":"beam","length":5,"span":6},
 "forces":[{"id":"P","at":0.25,"dir":"down","push":true,"mag":10,"label":"10 kN"}],
 "dims":[{"to":"P","label":"1.5 m"},{"from":"P","to":0.5,"label":"1.5 m"},{"from":0.5,"label":"3 m"}],
 "loads":[{"from":0.5,"to":1,"w":1,"mag":12,"label":"4\\text{ kN/m}"}],"panels":[
 {"caption":"beam","supports":[{"type":"pin"},{"type":"roller"}]},
 {"caption":"free body","supports":[{"type":"pin","reactions":true,"mags":[0,10.5]},{"type":"roller","reactions":true,"mags":[11.5]}],
  "loads":[{"from":0.5,"to":1,"w":1,"mag":12,"label":"4\\text{ kN/m}","resultant":"12 kN"}]}]}
```
