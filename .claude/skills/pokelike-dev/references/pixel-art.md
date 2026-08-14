# Original pixel art and visual effects

Everything you see in Pokelike that is not a streamed PokéAPI sprite is drawn
by code — tiles, props, buildings, NPCs, node markers. That is the project's
best property: art that ships as a few kilobytes of JavaScript, is trivially
recolourable, and belongs to the project. This file is how to make it good.

**Contents**

1. [The rendering contract](#1-the-rendering-contract)
2. [Colour — the single biggest lever](#2-colour--the-single-biggest-lever)
3. [Four upgrades that lift any sprite](#3-four-upgrades-that-lift-any-sprite)
4. [Tiles: edges, occlusion, dithering](#4-tiles-edges-occlusion-dithering)
5. [Animation](#5-animation)
6. [The battle screen](#6-the-battle-screen)
7. [Reviewing your own work](#7-reviewing-your-own-work)
8. [Where the art currently falls short](#8-where-the-art-currently-falls-short)

---

## 1. The rendering contract

Break this and art looks smeared no matter how good the drawing is.

Maps are painted into an **offscreen buffer of 272×448** on an **8px tile grid**
(`TILE = 8`, `COLS = 34`, `ROWS = 56` in `js/map.js`), then blitted to the
544×896 display canvas at **2× with `imageSmoothingEnabled = false`**. Every
buffer pixel becomes a crisp 2×2 block. Consequences:

- **Draw on integer coordinates.** A rect at `x = 3.5` gets antialiased by the
  canvas and then doubled, producing a soft 1px seam that reads as blur. Round
  before you fill.
- **A "pixel" of detail is 2 screen pixels.** Detail finer than one buffer pixel
  cannot exist. Do not try to shade a 4px-wide tree trunk with three tones.
- **Props are placed at tile multiples.** `paintProps` walks the grid and calls
  painters with `x * TILE, y * TILE`. A prop wider than its footprint must be
  bounds-checked (`if (x < COLS - 2)`) or it clips at the edge.

Node markers are a separate system: `SpriteGen.make(key, w, h, draw)` renders a
small canvas once, caches it as a data URL, and the UI drops it in as an
`<img>`. Those are 16×16 or 16×20 and scaled by CSS, so they follow the same
integer rule.

The one primitive you need is already there:

```js
function px(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
```

Use it for everything. `fillRect` on integers is exact; `arc`, `bezierCurveTo`
and `lineTo` all antialias and will fight the aesthetic.

---

## 2. Colour — the single biggest lever

Look at the existing palettes on the artboard. Most ramps step down in
lightness only: `#8fe0a5 → #6ccb8a → #4fae6e → #3d8f5b`. Same hue, same-ish
saturation, just darker. That is why the art reads as *dimmed* rather than
*shaded*.

**Real shading shifts hue as it darkens.** Shadows pick up the ambient colour of
the sky (cool, blue/purple); lights pick up the light source (warm, yellow).
Shifting hue 10–25° across a 4-step ramp is the difference between amateur and
professional pixel art, and it costs nothing.

```js
// Build a 4-step ramp from one base colour, shifting hue toward warm in the
// highlights and cool in the shadows. Drop this next to PALETTES in map.js and
// generate ramps instead of hand-picking four hexes that happen to be close.
function ramp(h, s, l, { warm = 38, cool = 232, shift = 18 } = {}) {
  const mix = (hue, target, amt) => {
    let d = ((target - hue + 540) % 360) - 180;   // shortest way round the wheel
    return (hue + d * amt + 360) % 360;
  };
  return [
    hsl(mix(h, warm, shift / 100 * 1.0), s * 0.88, l + 16),  // g0 highlight
    hsl(h,                               s,        l),        // g1 base
    hsl(mix(h, cool, shift / 100 * 0.7), s * 1.05, l - 15),  // g2 shadow
    hsl(mix(h, cool, shift / 100 * 1.2), s * 1.12, l - 27),  // g3 outline
  ];
}
function hsl(h, s, l) {
  s = Math.max(0, Math.min(100, s)); l = Math.max(0, Math.min(100, l));
  const a = s / 100 * Math.min(l / 100, 1 - l / 100);
  const f = n => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
```

Rules that hold across every palette here:

- **Four steps is the budget** (`g0` light, `g1` base, `g2` dark, `g3` outline).
  A fifth tone at 8px does not resolve; it just muddies the ramp.
- **Never pure black or pure white.** `#000` outlines look like holes punched in
  the screen. The darkest tone should be a very dark, saturated version of the
  object's hue — `#144a26` for foliage, not `#111111`.
- **Keep saturation up as you darken.** Desaturated shadows look like fog.
- **A theme's palette should agree with its `THEME_TYPES`.** A cave that spawns
  rock/ground/steel should not be painted in the same greens as a meadow. Palette
  is how the player reads what they are walking into before the label loads.
- **Validate.** `map.js` already fails loudly on a malformed hex at load, and
  `check.mjs` re-checks it. If you generate colours, generate valid 6-digit hex.

---

## 3. Four upgrades that lift any sprite

Compare the NPC sprites on the artboard to any handheld-era overworld sprite.
The gap is not draughtsmanship, it is these four things, none of which is hard.

**1. A dark outline.** Sprites sit on a busy tile background. Without a 1px dark
edge they dissolve into it. Outline in a dark version of the sprite's own hue,
not black.

```js
// Silhouette-first: fill the shape one pixel larger in the outline colour,
// then draw the sprite inside it. Cheaper and more reliable than tracing edges.
const outline = (c, draw, col) => {
  for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    c.save(); c.translate(dx, dy);
    c.globalCompositeOperation = 'source-over';
    draw(c, col);          // draw() takes an override colour for every fill
    c.restore();
  }
  draw(c);                 // real colours on top
};
```

**2. A contact shadow.** A sprite with no shadow floats. One flattened dark
ellipse — or at this scale, a 2px-tall rounded rect — under the feet at ~35%
alpha grounds it instantly.

```js
px(c, 3, h - 2, w - 6, 2, 'rgba(0,0,0,.30)');
px(c, 4, h - 1, w - 8, 1, 'rgba(0,0,0,.18)');
```

**3. A hue-shifted ramp instead of flat fills.** The current NPCs are one solid
colour per garment. Give each garment three tones from a ramp: lit top edge,
base, shadowed underside. Two extra `px()` calls per garment.

**4. A readable silhouette.** Squint at the 1× column on the artboard. If two
trainer classes are indistinguishable as blobs, colour will not save them —
change a shape. Hats, hair, bag, stance. `grassPatch()` already gets this right:
the silhouette with glowing eyes reads at 16px because the *shape* is distinct,
not because of its palette.

---

## 4. Tiles: edges, occlusion, dithering

**Autotiling is the biggest available win for the map.** Right now every ground
tile is painted the same regardless of neighbours, so grass meets sand meets
water at a hard rectangular step — the giveaway that a map is generated. Real
tilesets use a bitmask of the four neighbours to pick an edge tile.

```js
// 4-bit neighbour mask: 1 up, 2 right, 4 down, 8 left. Compute once per tile,
// then paint a matching edge overlay. Sixteen cases, but they collapse into
// "draw a 2px lip on each side that differs" — no 47-tile Wang set needed.
function edgeMask(grid, x, y, isSame) {
  return (isSame(grid, x, y - 1) ? 0 : 1)
       | (isSame(grid, x + 1, y) ? 0 : 2)
       | (isSame(grid, x, y + 1) ? 0 : 4)
       | (isSame(grid, x - 1, y) ? 0 : 8);
}

function edgeLip(c, bx, by, mask, lit, dark) {
  if (mask & 1) px(c, bx, by, TILE, 1, lit);              // top catches light
  if (mask & 8) px(c, bx, by, 1, TILE, lit);
  if (mask & 2) px(c, bx + TILE - 1, by, 1, TILE, dark);
  if (mask & 4) px(c, bx, by + TILE - 1, TILE, 1, dark);  // bottom falls away
}
```

`paintGround` already does exactly this for one case — the foam where water
meets land. Generalise that pattern to grass/path, path/sand and floor/wall and
the whole map stops looking like a spreadsheet.

**Ambient occlusion.** A 1–2px dark band on the ground where a wall, tree line
or building meets it sells depth for almost nothing. `THEME_CFG` already carries
a `shade` value for the themes that want it — use it as the alpha.

**Dithering.** With four tones you cannot make a smooth gradient, but a 2×2
checker of two adjacent tones reads as an intermediate step. Use it for sand
fading into water, lava glow falloff, and cave light pools. Keep the checker
aligned to the tile grid or it shimmers when the map repaints.

**Keep texture stable.** `paintGround` derives a per-tile variant from
`hashStr(\`${x},${y}\`)` rather than `rng()` precisely so the texture does not
crawl on redraw. Any texture you add must do the same — derive from position,
not from a stream.

---

## 5. Animation

There is no animation loop today. Adding one is the single most noticeable
upgrade available, and also the easiest way to wreck battery life on the phones
this is mostly played on. The rules:

- **One `requestAnimationFrame` loop, owned by the screen that needs it, and
  cancelled when that screen goes away.** `UI.show()` is the natural place to
  stop the previous screen's loop. A leaked rAF loop repainting a 544×896 canvas
  behind a modal is a real battery drain and the bug will not be obvious.
- **Check `Profile.data.settings.animations` before starting.** Players turn it
  off for a reason.
- **Never re-run the expensive path per frame.** `MapGen.paintTiles` builds a
  grid, paints ~1900 tiles and scatters props — that is a one-time cost. Animate
  by compositing a cheap overlay on top of a cached base, not by repainting.

```js
// Paint the static map once into an offscreen canvas, then per frame blit it
// and draw only the moving parts. 60fps on a phone comes from doing almost
// nothing per frame, not from optimising the thing you do every frame.
let raf = null, base = null;
function startMapAnim(canvas, stage, nodes) {
  if (!Poke.Profile.data.settings.animations) return;
  base = document.createElement('canvas');
  base.width = canvas.width; base.height = canvas.height;
  MapGen.paint(base, stage, nodes);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const t0 = performance.now();
  const frame = now => {
    ctx.drawImage(base, 0, 0);
    drawWaterShimmer(ctx, (now - t0) / 1000);   // only the animated layer
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
function stopMapAnim() { if (raf) cancelAnimationFrame(raf); raf = null; }
```

Worth animating, cheapest first: water shimmer (shift the foam row every ~400ms),
tall grass sway (2-frame offset), lava glow (pulse the `flower` ramp), the
player marker's step bob, flower/cloud drift on `sky`.

For battle, prefer CSS transitions and keyframes over canvas — the battle screen
is DOM, `UI.flash` and `UI.shake` already exist as class toggles, and the browser
composites those on the GPU for free.

---

## 6. The battle screen

The battle screen is plain DOM (`#battle-screen` in `index.html`), so the art
budget here is CSS, and it is currently the flattest part of the game. High-value
additions, roughly in order of impact per line of code:

- **A background per theme.** The battle happens in a void. Reuse the area's
  palette to paint a two-band gradient (sky above, ground below) plus a horizon
  line. `Game.stage().painter` gives you the palette key.
- **Platforms under the fighters.** An ellipse of the ground tone under each
  sprite is what makes the two Pokémon share a space rather than hover.
- **HP bars that tween.** The bar currently snaps. A `transition: width .4s` plus
  a colour ramp green→amber→red at the 50%/20% thresholds does more for battle
  feel than any particle effect.
- **Hit feedback.** `UI.shake()` and `UI.flash()` exist — make them land harder:
  a 2-frame white flash on the sprite for a normal hit, a stronger shake plus a
  brief scale pop for super effective, a desaturating fade for a faint.
- **Weather as a particle layer.** Rain streaks, sand haze, hail specks and a
  sun warm-tint overlay, driven off `Battle.state.weather`. One absolutely
  positioned div with a CSS animation each — no canvas needed.
- **Status tints.** A subtle colour overlay on the affected sprite (purple for
  poison, orange for burn, yellow flicker for paralysis) communicates state
  faster than the `BRN`/`PSN` label.

All of it must honour `settings.animations` and collapse under `fastBattle` —
route timing through `UI.pace()`.

---

## 7. Reviewing your own work

Do not judge pixel art by reading the code. Render it.

```bash
cp .claude/skills/pokelike-dev/assets/artboard.html .pokelike-src/
cd .pokelike-src && python3 -m http.server 8123
# open http://localhost:8123/artboard.html
```

The artboard renders every palette as swatches, every theme's map with the same
node graph (so differences are the painter's, not the layout's), and every
canvas sprite at 1× beside a magnified copy. The **1× column is the one that
matters** — that is the size players see. The magnified copy is for finding the
stray pixel, not for judging the drawing.

The tile-grid toggle overlays the 8px buffer grid on the maps; a prop that looks
subtly smeared is nearly always one that drifted off it.

If Playwright is available you can screenshot it headlessly (Chromium is
preinstalled at `/opt/pw-browsers`; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i
playwright` gets the bindings — never run `playwright install`). Looking at the
render is not optional; art changes that were never displayed are guesses.

Delete `artboard.html` from the source tree before repacking.

---

## 8. Where the art currently falls short

An honest list of what is still drawn by code and still looks it, in rough
order of visible impact.

Note first what is **no longer** on this list: map markers for trainers,
buildings, the Poké Ball and tall grass are now real game sprites, and the
generated versions survive only as the fallback layer. See
`references/assets.md`. That changes the target for everything below — new
canvas art has to sit next to authentic GBA sprites without looking out of
place, which mostly means matching their palette depth and their 1px dark
edges.

1. **Signposts and the exit gate are still generated** (`SpriteGen.sign`,
   `exitGate`, `stairs`) and are the last obviously hand-made markers on the
   map. Either find real equivalents (§2 of `assets.md`) or bring them up to
   the standard of §3 here.
1. **Signposts and the exit gate are still generated canvas sprites**, the last
   obviously hand-made markers on the map.
2. **Areas with a real map picture do not animate.** `MapGen._live` is only set
   by the tile path, because a photograph of a route has no idea where its
   water is. Not obviously worth fixing — but know it before wondering why
   Kanto is still while Alola shimmers.

Items that came off this list, worth knowing as precedent rather than as
outstanding work:

- **Tile edge transitions exist now.** `MapGen.paintEdges` runs between the
  ground and prop passes and draws seams from a four-neighbour comparison
  rather than a Wang set (§4). Light falls from the top-left everywhere — north
  and west seams catch light, south and east fall into shadow — and keeping
  that consistent is what gives the terrain thickness. Anything new that draws
  terrain should follow the same convention.
- **Ramps hue-shift.** `huedRamp` post-processes `PALETTES` at load, rotating
  highlights warm and shadows cool while leaving lightness and saturation as
  authored, so each theme keeps its identity and only gains depth (§2). Grey
  ramps are skipped — rotating a hue into them tints the whole theme.
- **The battle arena is themed.** `UI.applyArena` sets CSS custom properties on
  `.battle-stage` from the current area's palette, with the sky half coming
  from `THEME_SKY` in map.js because a cave ceiling cannot be derived from a
  ground ramp. Both fighters stand on the ground band — the horizon sits high,
  at 28%, precisely because the opposing Pokémon occupies the upper third and
  any lower a horizon leaves it hanging in mid-air.
- **HP bars tween.** `renderBattle` rewrites the whole card, so a fresh element
  would start at the new width with nothing to animate. `UI.hpBar` takes a key,
  renders at the *previous* value, and `UI.settleHpBars` moves it on the next
  frame. Reuse that pattern for any bar that needs to glide across a full
  re-render.
- **Animation is one body class.** `UI.applyPrefs` toggles `body.no-anim` from
  the setting, and CSS switches every keyframe and transition off there rather
  than each call site checking. New animation should be disabled under that
  selector too.
- **The map animates, and the loop is owned.** `MapGen.startAnim` ticks at
  ~6fps (`TICK_MS`), restores a pristine copy of the finished buffer and
  repaints only water and tall grass — never the grid, the tiles or the props,
  which cost far too much to redo per frame. It refuses to start when the
  setting is off *or when the area has nothing that moves*, and `UI.show`
  cancels it on any screen change. Copy all three habits: a leaked rAF loop
  repainting 544×896 behind a modal is a real battery drain and an invisible
  one.
- **NPC markers walk.** Pure CSS stepping the sprite sheet's own frames
  (0-3-0-4, the games' own standing animation), staggered off each other so a
  row of trainers does not step in unison. Only sheets that have those frames
  get the class — a three-frame character would otherwise flick between
  facings.
