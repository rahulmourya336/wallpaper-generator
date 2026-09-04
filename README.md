# Wallpaper Studio

A generative wallpaper studio that runs entirely in the browser. Pick a
category, tune a few parameters, shuffle through styles, and export at your
device's exact resolution. No backend, no auth, no database, no analytics.

Twenty-eight styles across ten families. React 19 + Vite + TypeScript, with no
runtime dependencies beyond React.

By **Rahul Mourya**.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview
```

Node 20+.

Deployed at <https://wallpaper-genx.vercel.app/>.

`VITE_SITE_URL` in `.env` is the single source of truth for the canonical link,
the Open Graph and Twitter tags, and the generated `robots.txt` and
`sitemap.xml`. Change that one line to point at a different domain.

## How it fits together

```
src/
  engine/
    rng.ts          seeded PRNG with per-stage forks
    noise.ts        seeded gradient noise and fbm
    palette.ts      ten palettes, six dark, ramps ordered by contrast
    focal.ts        the dominant form and its clip geometry
    compositor.ts   the pipeline every renderer runs through
    sampling.ts     shared packing, streamline and lighting helpers
    registry.ts     category -> family -> renderer
    renderers/      ten family folders
  export/           rasterizer and device presets
  ui/               two stages, rail, bottom sheet, export dialog
  state/            one store, synced to the URL hash
  dev/              contact sheet (dev only)
```

### Two stages, one set of candidates

Desktop puts the three candidates side by side; a phone stacks the same three
into a full-bleed swipe deck, because three compositions across a 390px screen
are stamps nobody can choose between. Both read the set from `useCandidates`, so
turning a phone sideways does not swap the alternates out from under you.

The phone path has one rule behind every decision in it: **while a finger is
down, nothing may change that costs layout.** Drags are written straight onto the
element rather than through React state, the sheet lifts the deck with a
transform instead of resizing it, and compositions are flattened to a single
bitmap before they reach the DOM — a busy vector style is close to four thousand
SVG nodes, and three of those live at once is a page that re-lays-out on every
frame of every gesture. What is left for the browser to do during a swipe is move
three layers.

The flattening cuts both ways on resolution, so the preview size depends on the
backend. A vector family gets pixels, because hairlines need them and the SVG
costs the same whatever it is rasterised into. The scene-graph family gets far
fewer, because the post pipeline allocates full-frame buffers and blurs them, so
its cost *is* the pixel count — and its output is the lit, soft kind of image
that upscales without anyone noticing. It is also the default style, so three of
them paint on every cold load.

### Determinism

Every renderer is a pure function of `(seed, styleId, params, dimensions)`.
Nothing under `engine/` calls `Math.random`. The same URL hash reproduces the
same wallpaper on any machine, which is what lets the thumbnails, the main
canvas and a 4x export all draw the same composition at different sample
densities.

Each pipeline stage draws from its own forked stream, and skeleton decisions
(where the columns are, which palette, which element is the accent) come from
streams whose draw count does not vary with quality. Without that split, a
filmstrip thumbnail would show a *different* composition from the canvas it is
meant to restyle.

### The compositor

Renderers supply a field function and a focal-adjacent shape, returning a
layered `Scene` of SVG source strings. The compositor owns everything else, in
order: ground, far field clipped outside the focal form, elements passing
behind it, the form itself with a misregistered outline, the field at full
density clipped inside it, ghost geometry, elements crossing in front, the one
accent, vignette, grain.

That is what keeps ten families in one visual language, and why adding a style
is a file plus a registry line.

### Two things worth knowing before editing a renderer

- **Work in design units.** `ctx.u(n)` converts design units (1000 across the
  short edge) to pixels and `ctx.n(px)` goes back. Sampling noise in pixel
  space makes the composition change shape between the thumbnail and the 4x
  export.
- **Poll `ctx.expired()` in any growth or packing loop.** An uncapped loop
  freezes the slider; bailing out with fewer elements does not.

## Development

`/?sheet` renders a contact sheet of every style across a fixed seed set.
Output drawn from a distribution cannot be judged one sample at a time — a
single composition never tells you whether what you are looking at is the
design or the draw.

## Licence

MIT.
