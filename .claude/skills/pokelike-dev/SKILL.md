---
name: pokelike-dev
description: Build, improve and ship the Pokelike game — the fan-made Pokémon roguelike that lives inside pokelike-site-for-actions.zip in this repo. Covers the unpack/check/repack workflow the GitHub Pages deploy depends on, the engine's architecture and data formats, writing original pixel art and canvas visual effects, and adding game systems (regions, areas, node types, passives, traits, abilities, moves, challenges, battle mechanics). Use this skill whenever the request touches the game in any way — improving or redesigning the graphics, adding original art or animations, tuning battle balance, adding content, fixing a bug, changing the map or battle screen, or deploying — and also whenever someone says "the game", "Pokelike", "poke-like", "o jogo", "melhorar os gráficos", "novo sistema", or points at the zip, js/, data/ or maps/ files, even if they never name the skill.
---

# Pokelike development

Pokelike is a Pokémon-style roguelike: 9 regions, 373 areas, 1025 species, real
damage maths, and a run structure where each area is a small graph of nodes you
pick a path through. It is plain HTML + CSS + five classic `<script>` files.
No build step, no framework, no npm dependencies — and that is a feature, not
an accident. Keep it that way; everything below assumes it.

## The one thing that will bite you

**The repo does not contain the game. It contains a zip of the game.**

`.github/workflows/deploy-pokelike-pages.yml` runs on every push to `main`:
it unzips `pokelike-site-for-actions.zip` into `dist/`, asserts
`test -f dist/index.html`, and publishes that to GitHub Pages. So `index.html`
must sit at the **root of the zip**, not inside a folder. Editing files without
repacking changes nothing; repacking the wrong way breaks the deploy.

Use the bundled scripts and this is handled for you:

```bash
S=.claude/skills/pokelike-dev/scripts

bash $S/unpack.sh            # zip -> .pokelike-src/ (gitignored working tree)
#    ... make your edits in .pokelike-src/ ...
node $S/check.mjs .pokelike-src      # lint + headless battle smoke test
bash $S/repack.sh            # runs check, then packs .pokelike-src/ -> the zip
git add -A && git commit && git push
```

`repack.sh` refuses to write a zip whose `index.html` is not at the root, and
runs `check.mjs` first. `unpack.sh` refuses to overwrite a working tree holding
edits you have not packed yet, because that tree is the only copy of them.

## Verify before you pack

Two levels, both cheap. Do at least the first on every change.

**1. Headless check** — parses every file, loads the whole engine in a DOM
shim, cross-checks the data tables against the code that reads them, and fights
seven scripted battles (level 5 to level 100, every passive at once, maxed
traits, inverse + nuzlocke) asserting HP and stats stay finite and the turn loop
terminates:

```bash
node .claude/skills/pokelike-dev/scripts/check.mjs .pokelike-src
```

It catches the failure modes that are otherwise invisible until someone plays:
a passive wired into the engine but missing from `PASSIVES` (silently dead), a
malformed hex that paints black, a gym stage count that no longer matches the
leader list, a `MAP_IMAGES` entry pointing at a file that is not in the zip, an
encounter pool that came out empty, NaN leaking into the damage formula.

**2. Play it** — the sprites are fetched over HTTPS, so `file://` will not do:

```bash
cd .pokelike-src && python3 -m http.server 8123
```

Then open `http://localhost:8123`. If Playwright is available you can drive it
headlessly; Chromium is preinstalled at `/opt/pw-browsers` and
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright` is enough to get the
bindings. Never run `playwright install`.

For visual work specifically, copy `assets/artboard.html` into `.pokelike-src/`
and open it — it renders every palette, every theme's generated map, and every
canvas sprite at 8× magnification on one page. Judging pixel art at 16px in a
running game is guesswork; judging it on the artboard is not. Delete it before
packing (it is dev-only, and `check.mjs` will not complain either way).

## Where things live

```
index.html      screens: title, region, trainer, starter, map, battle
style.css       retro theme, responsive 320px → desktop
data/pokedex.js GENERATED — TYPES, DEX(1025), EVOLVES, MOVES, MEGAS
data/content.js type chart, items, passives, traits, abilities, achievements
data/regions.js the 9 campaigns: stages, gyms, Elite Four, champions
data/maps.js    GENERATED — area → real map picture manifest
js/core.js      RNG, species, sprites, cries, audio, save/profile, encounter pools
js/map.js       map picture + node graph + tile painters + sprite generator
js/battle.js    the battle engine
js/ui.js        screen rendering and modals
js/game.js      run flow, node router, modes
```

Two files are generated and should not be hand-edited: `data/pokedex.js` (from
the PokéAPI CSV dump) and the manifest block of `data/maps.js` (rewritten by
`tools/fetch-maps.mjs` from whatever is present in `maps/`).

## Pick your reference

Read the one that matches the task. They are detailed and there is no reason to
load all three.

| Task | Read |
|---|---|
| Anything visual: pixel art, palettes, tiles, sprites, animation, battle FX, the look of a screen | `references/pixel-art.md` |
| Adding or changing content and mechanics: regions, areas, node types, passives, traits, abilities, moves, items, challenges, battle rules, balance | `references/systems.md` |
| Finding your way around: what a function does, data row formats, run/profile state shape, how a screen is wired | `references/architecture.md` |

`references/architecture.md` is also the fastest way to answer "where is X?"
without grepping five files.

## House rules

These are the constraints that keep the project shippable. Breaking one is
sometimes right, but do it deliberately and say so.

**Original art only.** This matters twice over. Legally, the project already
ships 162 map pictures that are Nintendo/Game Freak property and streams
sprites from PokéAPI — that is the fan-game norm, but it is the part most
exposed, and every original asset that replaces one reduces it. Aesthetically,
scraped art from five different games never cohered; art you generate to one
palette and one grid does. When you add visuals, generate them in canvas or
draw them as code. Do not add scraped image files.

**No build step, no dependencies.** Classic scripts in load order, globals
shared between them. That is why the game is one zip and deploys in 40 seconds.
Adding a bundler would be a bigger change than any feature it enables — do not
do it as a side effect of something else.

**Data before code.** `index.html` loads the four `data/*.js` files before the
five `js/*.js` files, and `regions.js` expands its stage tables at load time.
New tables go in `data/`, new behaviour in `js/`. `check.mjs` enforces the
order.

**Everything is seeded.** Maps, daily runs and challenges use `mulberry(seed)`
so the same area always looks the same and a daily run is the same for
everyone. When you add anything random that should be stable — a layout, a
crop, a palette variation — derive it from `hashStr(stage.id)` or the run's
`seedSalt`, never from bare `Math.random()`.

**Mobile is the default, not the fallback.** The layout runs from 320px up and
most play happens on a phone. Test narrow. A new panel that only works at
desktop width is a regression.

**Respect the settings.** `Profile.data.settings` has `animations`, `fastBattle`,
`sfx`, `cries`, `volume`, `spriteStyle`. Animation and audio you add must check
them — `UI.pace(ms)` already collapses battle delays when `fastBattle` is on,
so route timings through it rather than hardcoding `sleep()`.

**Saves must survive.** `Profile.load()` backfills defaults over whatever was
in `localStorage`, so adding a field is safe; renaming or removing one silently
breaks players mid-run. If a run-state field has to change shape, handle the old
shape in `Game.continueRun()`, which is already where legacy runs are patched
up.

## Traps worth knowing

- **A stage tagged `:gym` consumes the next entry of that region's `gyms` array.**
  Insert an area in the wrong place and every later badge shifts. `check.mjs`
  catches the count mismatch but not a wrong order — verify the pairing by eye.
- **`Game._nodeCache` is keyed on `stage.id + seedSalt`.** If you change how
  node graphs are generated, that cache will happily serve you the old graph
  until the key changes.
- **Megas are temporary.** `Battle.finish` reverts every mega on the team. Stat
  changes that should outlive a battle cannot live on `p.mega`.
- **Taking a node closes its siblings** (`Game.clearNode`) — a run is a path,
  not a checklist. Any new node type must call `Game.clearNode()` on every exit
  path, or the player is stranded with no available nodes.
- **Losing a battle does not clear the node.** Only a full team wipe ends the
  run, so a defeat leaves the node replayable. Know this before "fixing" it —
  it is load-bearing for difficulty.
- **The zip is 22 MB and mostly `maps/`.** Adding image files is the one way to
  make this project meaningfully worse. Generated art costs bytes of code.
