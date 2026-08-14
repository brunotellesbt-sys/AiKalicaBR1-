# Real game assets: sources, formats, wiring

The project's visual direction is authentic art from the games rather than art
drawn for the occasion. This file is where that art comes from, what is
actually reachable, and how to add more without breaking the fallback chain.

**Contents**

1. [What is reachable](#1-what-is-reachable)
2. [The sources](#2-the-sources)
3. [Sheet and palette formats](#3-sheet-and-palette-formats)
4. [The fallback chain](#4-the-fallback-chain)
5. [Adding a new asset](#5-adding-a-new-asset)
6. [Maps](#6-maps)

---

## 1. What is reachable

Check this before planning anything that fetches. The egress policy in the
agent environment allows very little, and the obvious sources are all denied:

| Host | Result |
|---|---|
| `raw.githubusercontent.com` | **200 — works** |
| `api.github.com` | 200, but scoped to this session's own repo; **no search, no other repos' contents** |
| `github.com` | 403 |
| `pokeapi.co` | 403 |
| `bulbapedia.bulbagarden.net`, `archives.bulbagarden.net` | 403 |
| `serebii.net` | 403 |
| `pokemon.fandom.com` | 403 |
| `img.pokemondb.net`, `play.pokemonshowdown.com` | 403 |

So: **anything fetched at build time has to be a file in a public GitHub repo,
pulled through `raw.githubusercontent.com`.** You cannot browse or search for
it — you must already know the path, or find it in a file that lists paths
(see §2 for the trick that makes this workable).

Two consequences worth internalising:

- `tools/fetch-maps.mjs` pulls from the Fandom wiki and **cannot run from
  here** any more. The 162 maps already in `maps/` were collected when that was
  reachable. Expanding map coverage needs either a machine with open egress or
  a GitHub-hosted mirror.
- The **runtime** picture is different and much better. The deployed game runs
  in the player's browser with no proxy, so the PokéAPI sprite and cry URLs in
  `js/core.js` work fine in production. If a remote sprite looks broken while
  you are testing locally through the proxy, verify before "fixing" it — it is
  usually the proxy, not the game. Driving a headless browser needs
  `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }`,
  and without that bypass even `http://localhost` is intercepted and returns
  405.

## 2. The sources

**The pret decompilation projects are the good one.** `pret/pokefirered` and
`pret/pokeemerald` keep the original games' graphics as ordinary PNGs in the
repo — already indexed, mostly already carrying a transparency chunk.

```
graphics/object_events/pics/people/<name>.png     overworld NPCs
graphics/object_events/pics/misc/<name>.png       item ball, cuttable tree, boulder
graphics/field_effects/pics/<name>.png            tall grass, long grass, ash, ripples
data/tilesets/primary|secondary/<set>/tiles.png   tileset atlas (greyscale)
data/tilesets/.../palettes/NN.pal                 JASC-PAL colour tables
```

**How to discover paths without directory listing.** You cannot list a
directory over `raw`, and the contents API is blocked. The way through is to
fetch a source file that enumerates the graphics and read the paths out of it:

```bash
curl -sS https://raw.githubusercontent.com/pret/pokefirered/master/src/data/object_events/object_event_graphics.h \
  | grep -oE '"graphics/object_events/pics/people/[^"]+"' | sort -u
```

That one request yields the whole roster. FireRed is the better fit for this
game (it opens in Kanto, and its cast includes Team Rocket, bikers and the
eight Kanto leaders by name); Emerald fills the gaps.

Note the INCBIN paths in those headers name `.4bpp` files — those are build
artifacts. The repo file is the `.png` next to it.

**Other confirmed-reachable repos**: `PokeAPI/sprites` (Pokémon and 30×30 item
icons), `PokeAPI/cries`, `msikma/pokesprite` (32×32 item icons, an
alternative).

**When no real sprite exists for a concept, borrow the item that means it.**
Nothing in any Pokémon game depicts a "random event" or a "rest stop", and an
invented signpost looks invented next to authentic art. Real items carrying the
same meaning read better and stay in style: the Escape Rope for *leave this
area*, the Up-Grade (the trade item) for a trade offer, Moomoo Milk for a rest
stop, the Odd Keystone for something strange. That is how the last hand-drawn
markers were retired — see `ITEMS_GFX` in `tools/fetch-overworld.mjs`.

Item icons are **shipped, not hot-linked**. Pokémon sprites and cries still
stream at runtime (there are 1025 of them; bundling is not an option), but the
handful of fixed marker icons are small enough to include, and doing so takes
the map screen off the network entirely.

## 3. Sheet and palette formats

**Overworld people** are horizontal strips of 16×32 frames, in a fixed order:
frame 0 faces the camera, 1 faces away, 2 faces left, then the walk cycle. A
standard NPC sheet is 160×32 (10 frames); named characters are often 48×32
(3 frames); the player characters are a *directory* of animations
(`brendan/walking.png`) rather than one strip.

**Field effects** are vertical strips of 16×16 — tall grass is 16×80, five
frames of rustle animation. Guessing the frame box from height alone gets this
wrong, so key off the shape: `h === 32 && w > 32` is a people strip,
`w === 16 && h > 16` is a vertical prop strip, anything else is a single frame.

**Nothing needs cutting.** The sheet ships whole and CSS shows one frame by
scaling the background and leaving it at origin (`.ow-sprite` in `style.css`).
That costs a few hundred bytes over a cropped frame and leaves the walk cycle
available to animate later.

**Tilesets are the awkward case.** The atlas PNG is greyscale — the real
colours live in separate `.pal` files, which are JASC-PAL: plain text, magic
line, version, count, then `R G B` per line. Apply one with
`Image.putpalette()` and the atlas comes to life.

The useful discovery: **the Pokémon Center and the Poké Mart are the same
building graphic with two different palettes** — red (`02`) for the Center,
blue (`03`) for the Mart. That is normal GBA practice and it means one crop
plus two palettes yields both sprites. The crop lives in
`tools/extract-buildings.py` with the box recorded so it is reproducible.

To find a building in an atlas: render it with each palette over a labelled 8px
tile grid, and read the bounds off the picture. Buildings are not laid out
contiguously in general — you are looking for the region that happens to be.

## 4. The fallback chain

Every asset lookup degrades instead of breaking, which is what lets the
manifest stay partial:

```
named character sprite   (OW_NAMED['Brock'])
  → trainer class sprite (OW_SPRITES['leader'])
    → generated canvas NPC (SpriteGen.npc)
```

`UI.owSprite()` returns `null` when the manifest has no entry, and `UI.npc()`
chains the three with `||`. Props do the same via `UI.owProp(key) || <old>`.
Preserve that shape when adding markers — a missing PNG should cost you the
upgrade, never the screen.

`data/overworld.js` is **generated**: `fetch-overworld.mjs` rebuilds it by
scanning `sprites/ow/`, so an interrupted run never drops entries a previous
run collected. Do not hand-edit it.

## 5. Adding a new asset

1. Find the path (§2) and add it to the right table in
   `tools/fetch-overworld.mjs` — `TRAINERS`, `NAMED` or `PROPS`.
2. Run `node tools/fetch-overworld.mjs`. It skips what exists, so it is safe to
   re-run; `--force` re-downloads, `--only=<substr>` narrows.
3. Use it from `UI.nodeIcon` (or wherever) via `UI.owProp` / `UI.npc`, keeping
   the `|| <existing generated sprite>` fallback.
4. Size it in `style.css`. `--ow-scale` must stay an **integer** or the pixels
   come out uneven: people render at 2, the battle trainer at 3, buildings at 1
   because the source art is already 32×48.
5. `node .claude/skills/pokelike-dev/scripts/check.mjs .pokelike-src`, then look
   at it in the browser. Art you have not displayed is a guess.

Keep an eye on bytes. The whole overworld set is ~220 KB for 54 sprites; the
zip is 22 MB and almost all of it is `maps/`. Sprites are cheap, map pictures
are not.

## 6. Maps

190 of 373 areas have a real map picture in `maps/`, keyed by `data/maps.js`.
The rest fall back to the tile engine automatically — an area with no entry, or
an entry whose file fails to load, just gets tiles.

There are two collectors, and they solve different halves of the problem.

**`tools/fetch-maps.mjs`** downloads finished pictures from the Fandom wiki.
Cheaper when it works, but the wiki is unreachable from CI (§1), so it cannot
run here at all. The 162 maps it gathered are still the prettier ones for
Kanto and Johto — several came from HGSS, which is a generation newer and
richer than the Gen 3 equivalent.

**`tools/render-maps.py`** rebuilds maps from the games' own data instead:
the decomp repos publish tile atlases, metatile definitions, palettes and the
block layout of every map, so the output is pixel-identical to the real map
because it *is* the real map. It has a backend per generation:

| Region | Source | Format |
|---|---|---|
| Kanto | `pret/pokefirered` | Gen 3 |
| Hoenn | `pret/pokeemerald` | Gen 3 |
| Johto | `pret/pokecrystal` | Gen 2 |

Together they closed all 47 gaps in those three regions.

**Gen 3** composes 16×16 blocks from two-layer metatiles; the tileset atlas is
greyscale and the colours live in sibling `.pal` files. Two constants differ
per game and **fail silently** if you assume them:

| | FireRed | Emerald |
|---|---|---|
| `NUM_TILES_IN_PRIMARY` | 640 | 512 |
| `NUM_METATILES_IN_PRIMARY` | 640 | 512 |
| `NUM_PALS_IN_PRIMARY` | 7 | 6 |

A wrong tile split draws nothing; a wrong palette split draws everything in the
wrong colours — Hoenn's caves came out pure black that way, and looked like
ordinary small files rather than errors. Both games publish these in
`include/fieldmap.h`, so the tool reads them per source rather than guessing,
and refuses to write a render that came out a single flat colour.

**Do not `--force` over existing maps** without looking at the result. It
re-renders everything, including the HGSS-sourced Kanto maps, which is a
downgrade in visual richness even though it is more faithful to Gen 1/3.

**Gen 2** shares nothing with that but the idea: 32×32 blocks of 4×4 tiles, no
layers, 2bpp tiles (four grey levels) that take their colour from a palette
*name* per tile, resolved against the Game Boy Color's eight background
palettes in `gfx/tilesets/bg_tiles.pal` (5-bit channels — scale by 255/31).
Neither a map's tileset nor its dimensions live in one place; you have to cross
`data/maps/maps.asm` (label → tileset), `data/maps/attributes.asm` (label →
map constant) and `constants/map_constants.asm` (constant → width, height).
Watch the `map_attributes` macro: its third field is the *border block*, not
the tileset, which is an easy and quiet mistake.

Black voids in a Gen 2 cave render are usually authentic — GBC cave maps use a
black out-of-bounds tile — so do not "fix" them without comparing to the game.

What is left, and why:

- **Sinnoh (6), Unova (9)** — real 2D maps exist, but these are NDS decomps,
  a bigger step again than either backend here.
- **Kalos, Alola, Galar, Paldea (149)** — impossible, not merely unfinished.
  Those games are 3D and never had a 2D top-down map to extract. The tile
  engine is the only option there, which makes `references/pixel-art.md` §4
  (autotiling) the highest-value work for them.
