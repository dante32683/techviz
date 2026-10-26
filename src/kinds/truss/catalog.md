# truss: planar trusses solved by the method of joints: reactions, member forces (T/C), zero-force members, sections

Joints are problem geometry in length units (y up), not pixels; the drawing scales to fit.
Angles: degrees CCW from +x.

- `joints`: `{"A": [0, 0], "B": [3, 0], ...}`; coordinates are numbers or expressions of `params`.
- `members`: `"AB"` (two joint names run together, also `"L0U1"`), `["J1", "J2"]`, or
  `{"id": "U1", "ends": "AB"}`. A member's name is its id, else what you wrote.
- `supports`: `{at, type: pin|roller (default pin), dir}`. A pin gives `A_{x}`, `A_{y}`; a roller
  one reaction along `dir` (default up: `C_{y}`; left/right: `C_{x}`; an angle: `C_{n}`). `dir`
  points from the support into the truss and turns the symbol (a wall on the left is `"right"`).
- `loads`: `{at, mag, dir (default down), label}`: a point load at a joint. `dir`: up, down, left,
  right, or degrees; `mag` a number or expression (negative flips it). Label defaults to `mag unit`.
- `unit` (force, like `"kN"`), `length` (like `"m"`): text only. Default none.
- `forces: true`: writes each member's force beside it (`6.25 C`, `3.75 T`, `0`) and colors it:
  tension blue, compression red, zero-force dashed gray. Default false (plain members).
- `names: true`: writes each member's name beside it (with `forces`, `AB: 3.75 T`).
- `dims: true`: dimension lines for the gaps between distinct joint x (bottom) and y (left).
- `section: ["BC", "BD", "AD"]`: draws one straight dash-dot cut crossing exactly those members
  (by name, id, or joints in either order); warns when no straight line does.
- `highlight`: member names or ids drawn thicker.

Solved as one linear system (2 equations per joint; unknowns: member forces, tension positive,
and reactions). Warnings: m + r ≠ 2j (indeterminate or unstable: drawn without forces), singular
equations (geometrically unstable), duplicate or zero-length members, joints with no members.

Summary: counts and determinacy, ΣF of the loads, every reaction (signed, along +x/+y or the
roller's dir), and every member force with T, C, or zero-force; the section's members. Check it
against the answer key.

## Examples
King-post truss, 3-4-5 geometry, load at the apex (BD is zero-force), with a section:
```json
{"v":1,"kind":"truss","unit":"kN","length":"m",
 "joints":{"A":[0,0],"B":[3,0],"C":[6,0],"D":[3,4]},
 "members":["AB","BC","AD","BD","CD"],
 "supports":[{"at":"A","type":"pin"},{"at":"C","type":"roller"}],
 "loads":[{"at":"D","mag":10,"dir":"down","label":"10 kN"}],
 "dims":true,"forces":true,"section":["BC","BD","AD"]}
```
Pratt bridge truss with three deck loads:
```json
{"v":1,"kind":"truss","unit":"kN","length":"m",
 "joints":{"A":[0,0],"B":[3,0],"C":[6,0],"D":[9,0],"E":[12,0],"F":[3,3],"G":[6,3],"H":[9,3]},
 "members":["AB","BC","CD","DE","FG","GH","AF","EH","BF","CG","DH","FC","HC"],
 "supports":[{"at":"A","type":"pin"},{"at":"E","type":"roller"}],
 "loads":[{"at":"B","mag":10},{"at":"C","mag":20},{"at":"D","mag":10}],
 "dims":true,"forces":true}
```
Cantilever off a wall (pin above, roller below, both pushing right):
```json
{"v":1,"kind":"truss","unit":"kN",
 "joints":{"A":[0,0],"B":[0,3],"C":[3,3],"D":[3,0],"E":[6,3]},
 "members":["AB","BC","CE","AD","DE","CD","BD"],
 "supports":[{"at":"B","dir":"right"},{"at":"A","type":"roller","dir":"right"}],
 "loads":[{"at":"E","mag":10}],"forces":true}
```
