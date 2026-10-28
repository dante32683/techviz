# linalg: linear algebra in Lay's notation with exact fractions: 2×2 maps on the grid (det as signed area, compositions stepped, rotations, reflections, shears, projections), vectors (sums, combinations, span, projections, ℝ³), eigenvectors, row reduction to RREF with the solution set, least squares

Numbers stay exact fractions while the inputs are rational: entries are numbers, strings like
"3/4" or "-1.5", or expressions ("sqrt(2)/2", params). The summary gives det, the inverse, the
eigenvalues (surds like (5 ± √13)/2 and a ± bi exactly) with eigenspace bases, rank, nullity,
pivot columns, bases for Col A and Nul A, and the RREF. `mode` is inferred when left out.

## transform (2×2)
- `A`: rows `[[1, 1], [0, 1]]`, or a named map: `{"rotate": 90}` (degrees, counterclockwise),
  `{"reflect": "x" | "y" | "y=x" | "y=-x" | "origin" | θ | [a, b]}` (across that line),
  `{"shear": k}` (x + ky; `"axis": "y"` for y + kx), `{"scale": 2 | [kx, ky]}`,
  `{"project": "x" | "y" | θ | [a, b]}` (onto that line); any of them with `"name": "R"`.
- `compose`: maps applied in order (the first acts first, so [R, S] is SR), one step per map;
  a single `A` steps from the identity to A.
- `shape`: "square" (default; det inside, an orientation arc), "F", "none", or a polygon.
- `vectors`: [{id, v: [x, y]}] with their images. `grid: false` hides the grid. `range`: [x0, x1, y0, y1].
Drawn: the image of the grid, the shape before (dashed) and after (teal, or pink when det < 0
flips it), Ae₁ and Ae₂ colored like the matrix columns, and Nul A for a singular map.

## vectors (ℝ² at 1:1, or ℝ³ isometric)
- `vectors`: [{id, v, label, color}]; v is coordinates or a combination of earlier ids, "2u - v".
- `sum`: ids, head to tail. `combo`: {of: [ids], c: [weights]}, or {of, target: id or [..]}
  (weights solved exactly; it says when the target is outside the span).
- `span`: ids (a line, a plane in ℝ³, or all of ℝⁿ). `angle`: [id, id] (dot, lengths, cos θ, θ).
- `project`: {of: "y", onto: "u"} or onto ["u1", "u2"] (W): ŷ, z = y − ŷ, the right angle.

## eigen
`A` square. A 2×2 draws the eigenvector lines (dashed, labeled with λ), the unit circle and its
image, sample vectors x and Ax, and each eigenvector v with Av = λv, in two steps (before, after).
Complex λ: r = |λ|, φ, and C, P with A = PCP⁻¹ (Lay §5.5). Larger A: the eigenpairs as readouts.

## rref
- `A` (m×n) and optional `b`: reduces [A | b] by Lay's algorithm (forward phase to echelon form,
  then backward to RREF), one step per pivot's operations, each changed row labeled
  R₂ ← R₂ − 2R₁ and the pivots boxed. It ends with the free columns tinted and x = p + x₃v
  (parametric vector form), or 0 = 1 (inconsistent); with no `b`, Nul A in parametric form,
  rank, nullity, and the Col A basis (pivot columns of A). `"b": "I"` reduces [A | I] to [I | A⁻¹].
- `ops`: your own steps instead: ["R2 - 2R1", "R1 <-> R3", "(1/2)R2", ["R3 + R1", "R2 - R1"]]
  (an inner list is one step). It says when they stop short of RREF.
- `all: true`: every step stacked in one figure (use it in panels, which show the last step).

## lsq
- `data`: [[x, y], ...] and `degree` (1, the default, 2, or 3): the fit from XᵀXβ = Xᵀy with the
  residuals drawn; readouts give XᵀX, Xᵀy, β̂, the residuals, and ‖y − Xβ̂‖.
- `A` and `b`: x̂ from AᵀAx = Aᵀb, Ax̂, b − Ax̂, and the least-squares error ‖b − Ax̂‖.

## expect
`{"det": -2, "rank": 2}`: each wrong value warns with the right one. Any matrix: det, inverse
(or "none"), trace, rank, nullity, pivots (column numbers), rref, col and nul (bases, checked as
bases), eigenvalues (a list; "1+2i"), eigenvectors (each checked Av = λv). transform: matrix
(the whole map). rref: x (a solution), solutions ("none", "one", "infinite"), free (variable
numbers). vectors: c (weights), dot, angle (°), proj, perp. lsq: fit or xhat, error.

## Examples

Shear the F; a rotation then a scaling, one map per step.
```json
{"v":1,"kind":"linalg","A":{"shear":1},"shape":"F"}
```
```json
{"v":1,"kind":"linalg","compose":[{"rotate":90,"name":"R"},{"scale":[2,1],"name":"S"}]}
```
Ax = b with one free variable, every step stacked; weights that reach b.
```json
{"v":1,"kind":"linalg","A":[[2,4,-2],[1,3,2],[3,7,0]],"b":[2,4,6],"all":true,"expect":{"x":[-5,3,0]}}
```
```json
{"v":1,"kind":"linalg","vectors":[{"id":"a_1","v":[1,-2]},{"id":"a_2","v":[2,1]},{"id":"b","v":[7,1]}],"combo":{"of":["a_1","a_2"],"target":"b"}}
```
