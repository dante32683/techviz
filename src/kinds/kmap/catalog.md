# kmap: Karnaugh maps of 2 to 5 variables in Gray-code order, with prime implicants, a minimum cover drawn as loops (wraparound and corners included), minimal SOP or POS, and answer checks

The kind finds the groups; never place loops yourself. Gate schematics of the result are the `logic`
kind (its `expr` with `simplify: true` draws the minimal SOP).

- `vars`: names, first = most significant bit (default A, B, C, ... sized to the largest index, or
  the variables of `expr` in alphabetical order).
- The function, exactly one of: `minterms` (indices of the 1s), `maxterms` (indices of the 0s), or
  `expr` (`"AB + C'"`; the logic kind's syntax: AND `AB`, OR `+`, XOR `^`, NOT `A'` or `~A`).
- `dc`: don't-care indices, drawn X; a group uses them only when that makes it bigger.
- `form`: `"sop"` (default; loops the 1s) or `"pos"` (loops the 0s; the summary adds the minimal POS).
- `expect`: an answer to check, like `"B'D' + BD"`; the cells it gets wrong are a warning, and a
  correct answer with more terms than the minimum is noted.
- `name`: the output's name (default Y). `highlight`: minterm indices to shade.

Layout (H&H): the first half of the variables across the top, the rest down the side, each in Gray
order (00 01 11 10); every cell shows its minterm index in the corner. Five variables draw two
4-variable maps stacked, one for each value of the first variable; a group can span both.

Steps: the bare map, then one group per step, essential prime implicants first; each loop's term
is written under the map in the loop's color, with overbars.

Summary: Σm and d; the prime implicants and the essential ones; the minimal SOP with term and
literal counts (and the minimal POS with `form: "pos"`); the groups that wrap around an edge or the
corners, with their cells; and the expect result.

## Examples

```json
{"v":1,"kind":"kmap","vars":["A","B","C","D"],"minterms":[0,2,5,7,8,10,13],"dc":[15],"expect":"B'D' + BD"}
```

```json
{"v":1,"kind":"kmap","vars":["A","B","C","D"],"maxterms":[0,1,2,3,4,6,12,14],"dc":[8],"form":"pos"}
```

```json
{"v":1,"kind":"kmap","expr":"A'B'C' + A'BC' + AB'C' + ABC + AB'C"}
```
