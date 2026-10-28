# optics: ray and wave optics: thin lenses and mirrors (and systems) with principal rays and images, Snell's law, TIR, slabs, prisms, apparent depth, fibers, double slits, gratings, single slits, and thin films, every value computed and checked

Conventions are OpenStax University Physics Vol. 3: 1/d_o + 1/d_i = 1/f and m = −d_i/d_o = h_i/h_o;
f > 0 for a converging lens or concave mirror; d_i > 0 real, < 0 virtual; m < 0 inverted. Snell:
n_1 sin θ_1 = n_2 sin θ_2 from the normal; θ_c = sin⁻¹(n_2/n_1). Lengths are numbers in `unit` (cm,
the default, mm, or m) or strings like "30 cm", "600 nm", "0.10 mm", "1/600 mm"; in slits and film
a bare number is meters. Angles are degrees. `values: false` drops the numbers from the labels.
`expect` checks values, like `{"di": 15, "m": -0.5, "image": "real, inverted"}`, to 1% (angles 0.1°);
a miss warns with the computed value and the likely slip (sign, radians, from the surface).

- `mode`: `rays` (default), `refraction`, `prism`, `depth`, `fiber`, `slits`, or `film`.

## rays
- `elements`, left to right: `{"type": "lens", "f": 10}` or `{"type": "mirror", "R": 20}` (or `f`;
  neither is a plane mirror), `at` (axis position; the first is at 0), `label`. A mirror is the only element.
- `object`: `{"d": 30, "h": 2}`: d_o from the first element (positive) and the height (default 1);
  `{"d": "inf", "angle": 2}` is a distant object whose rays tilt 2° (a telescope).
- Each element images the image before it. A real image between two lenses gets the next lens's own
  principal rays; a virtual object (that image lies past the lens) has the rays traced on through.
- `rays`: any of parallel, center (a mirror's: through C), focal, vertex (mirrors). Default the three;
  a mirror's C ray swaps to vertex when it runs off; a plane mirror draws parallel and vertex.
- Draws F (a mirror's C), O, each image (I, or I_1, I_2: solid real, dashed virtual), dashed virtual
  extensions and construction lines, and a caption of d_i, m, and the image type.
- expect keys: di, m, hi, image (real|virtual, upright|inverted, enlarged|reduced); with 2+ elements
  di1, m1, do2, di2, m2, …, and di, m are the final image and the total M = m_1 m_2 ⋯. An image at
  infinity gives `angular`: θ′/θ (telescope, −f_obj/f_eye) or 25 cm/f (magnifier).

## refraction
- `media`: 2+ `{n, label, t}` in the order the light meets them, drawn top to bottom (the ray goes
  down); middle layers need `t` (in `unit`). `angle`: θ_1 from the normal (required). `reflect: false`
  drops the partial reflection. Past θ_c: TIR, the critical direction dotted. When the last n equals
  the first: the lateral shift d. Keys: theta2, theta3, … (angle in medium k), thetac, shift.

## prism, depth, fiber
- prism: `apex` A (default 60), `n` (or indices by color for dispersion: `{"red": 1.513, "violet": 1.532}`),
  `outside` n_0 (default 1.00), `angle` θ_1 (default: minimum deviation). Draws θ_1, θ_4, A, and
  δ = θ_1 + θ_4 − A; TIR at the second face reflects inside. Keys: theta2–4, delta, dmin, delta_red, spread.
- depth: `media` (the object's, then the viewer's, default air) and `depth` d_o; d_i = −(n_2/n_1) d_o,
  so the apparent depth is |d_i|. Keys: depth, di.
- fiber: `core` n (required), `clad` (default 1.00: a bare light pipe), `outside` (1.00), `angle` θ from
  the axis (required); TIR when φ = 90° − θ_r > θ_c. Keys: thetar, phi, thetac, NA, accept.

## slits
- `N`: 1 (single slit), 2 (default), or more (a grating). `d`: slit separation ("0.10 mm", "1/600 mm");
  `a`: slit width (N = 1; with N ≥ 2 it adds the envelope and missing orders). `lambda` ("600 nm"),
  `D` (screen distance, default "1.0 m"), `orders` marked each side (default 3), `show`: the order
  whose rays, θ, and path difference (d sin θ, or a sin θ to the m-th minimum) are drawn (default 1).
- Screen marks sit at the true y = D tan θ; slit spacing and small θ are exaggerated.
  Keys: theta1–3, y1–3, dy (λD/d), w0 (single slit: 2y_1), mmax.

## film
- `media`: [above, film, below], each `{"n": 1.33, "label": "soap"}`; `lambda` (in vacuum); `want`:
  "bright" (constructive in reflection, the default) or "dark"; `t` (optional: the phase at λ and the
  visible λ reflected). A π shift wherever n rises; near normal, path 2t. Keys: t (the minimum), lambdan.

## Examples
Two lenses (the first image is the second lens's object), and a telescope on a distant object.
```json
{"v":1,"kind":"optics","elements":[{"type":"lens","f":10},{"type":"lens","f":10,"at":50}],"object":{"d":20,"h":2},"expect":{"di":15,"m":0.5}}
```
```json
{"v":1,"kind":"optics","elements":[{"type":"lens","f":50},{"type":"lens","f":10,"at":60}],"object":{"d":"inf","angle":2}}
```
A glass slab's lateral shift, and an antireflection coating.
```json
{"v":1,"kind":"optics","mode":"refraction","media":[{"n":1.00,"label":"air"},{"n":1.50,"label":"glass","t":2},{"n":1.00,"label":"air"}],"angle":40}
```
```json
{"v":1,"kind":"optics","mode":"film","media":[{"n":1.00,"label":"air"},{"n":1.38,"label":"MgF_{2}"},{"n":1.50,"label":"glass"}],"lambda":"550 nm","want":"dark"}
```
