# Adding content and mechanics

Recipes for the things people actually ask for. Almost every one touches more
than one file, and the classic bug is landing three of the four edits — a relic
you can pick that does nothing, a node type that freezes the run. Each recipe
lists every place, and notes which omissions `check.mjs` catches for you.

**Contents**

1. [Passive relics](#1-passive-relics)
2. [Abilities](#2-abilities)
3. [Items](#3-items)
4. [Node types](#4-node-types)
5. [Challenges](#5-challenges)
6. [Areas and regions](#6-areas-and-regions)
7. [Achievements](#7-achievements)
8. [Battle mechanics](#8-battle-mechanics)
9. [Balance levers](#9-balance-levers)

---

## 1. Passive relics

The roguelike layer: picked one-of-three at a `passive` node, kept for the run.

**Two places.**

1. `data/content.js` → `PASSIVES` — `{ name, icon, desc }`. The `desc` is the
   whole contract with the player, so make it precise: "Physical moves deal 30%
   more damage", not "boosts attack".
2. `js/battle.js` (or wherever it applies) — read it with `Battle.has('key')`.

Where to hook depends on what it does:

| Effect | Hook |
|---|---|
| Damage multiplier | `computeDamage`, in the `atkWho === 'player'` branch |
| Damage reduction | `computeDamage`, in the `else` branch (enemy is attacking) |
| Stat multiplier | `effStat`, guarded by `who === 'player'` |
| Accuracy | `accuracyOf` |
| Per-turn effect | `endOfTurn`, in the `who === 'player'` block |
| On-hit effect | `useMove`, after damage is applied |
| Survival check | `useMove`, in the `dmg >= target.hp` block |
| Reward/economy | `Battle.finish`, or the relevant `Game.node*` |
| Catch rate | `Battle.catchChance` |
| EXP | `Battle.grantExp` / `addExp` |

`check.mjs` errors if the engine calls `Battle.has('x')` with no `PASSIVES.x`,
and warns if a `PASSIVES` entry is never read by any code — which is exactly the
"relic that does nothing" bug.

## 2. Abilities

**Two places**, and unlike passives, abilities are assigned automatically.

1. `data/content.js` → `ABILITIES` — `{ name, desc }` plus optional declarative
   fields the engine already understands: `type` (pinch boost, like Blaze),
   `absorb` (heal instead of taking damage), `status` (contact inflicts it),
   `weather` (summon on entry).
2. `data/content.js` → `ABILITY_BY_TYPE` — add the key to the lists for the
   types that should get it. `Species.ability(id)` picks deterministically by
   hashing the dex id against that list, so every species keeps one stable
   ability and you never store it.

If the four declarative fields cover your ability, you are done — `onEntry` and
`computeDamage` already handle them. Anything else needs an explicit
`p.ability === 'key'` check in the engine; follow `sturdy`, `multiscale` or
`regenerator` as models.

`check.mjs` errors on an `ABILITY_BY_TYPE` entry with no `ABILITIES` record, on
an engine check for an ability that does not exist, and on `type`/`absorb`
/`weather` values that are not real types or weathers.

## 3. Items

**Two or three places.**

1. `data/content.js` → `ITEMS` — `{ name, kind, value, price, desc }`. `kind`
   must be one of `heal | revive | status | ball | boost | utility`; the bag and
   `Battle.useItem` branch on it.
2. `data/content.js` → `MART_STOCK` — add the key if it should be purchasable.
   `Game.nodeItem` also draws from this list (minus `megaStone`).
3. `js/battle.js` → `useItem` only if `kind` is new behaviour. A new `heal` or
   `ball` needs no code at all — just the row.

Starting inventory is in `Game.beginRun`'s `bag: {...}`.

## 4. Node types

The one with four places, and the one that strands players if you miss one.

1. `js/map.js` → `MapGen.kindBag` — push the kind into the bag so it can appear.
   Weight it by theme the way the others are.
2. `data/content.js` → `NODE_LABELS` — the caption under the marker.
3. `js/game.js` → `Game.handleNode` — a `case` calling your handler.
4. `js/ui.js` → `UI.nodeIcon` — the marker art (a `SpriteGen` sprite or a real
   PokéAPI item sprite via `UI.itemSprite`).

**Your handler must call `Game.clearNode()` on every exit path**, including
cancel and error paths. `clearNode` marks the node cleared and opens only its
successors — skip it and the player has no available nodes and no way forward.
If the node opens a modal, pass the continuation through: `UI.showMart(() =>
Game.clearNode())`, or call it in the button handler after
`UI.forceCloseOverlay()`.

`check.mjs` warns about a `NODE_LABELS` entry with no `handleNode` case.

## 5. Challenges

**Two places.**

1. `data/content.js` → `CHALLENGES` — `{ id, name, icon, desc }`.
2. Wherever it bites — branch on `run.challenge === 'yourId'`.

The existing six show the range of hook points: `randomizer` in
`Game.wildSpecies`, `hardcore` in `Game.nodeHeal` and `Battle.useItem`,
`speedrun` in `MapGen.nodes` and `Game.stageLevel`, `solo` and `monotype` in
`Game.addToTeam`, `inverse` in `effectiveness`. Prefer one clear branch over
several scattered ones.

Note `beginRun` stores `mode: 'story'` for challenge and daily runs and keeps
the real one in `rawMode` — so check `run.challenge`, not `run.mode`.

`check.mjs` warns about a challenge nothing branches on.

## 6. Areas and regions

Stages are compact `"Name:theme"` strings in `data/regions.js`, expanded at load
into objects with `id`, `imageKey`, `theme`, `painter`, `trainer` and `index`.

**Adding an area:** insert the string at the right point in the region's
`stages` array. Valid themes are the keys of `THEME_TYPES` (town, city, route,
meadow, forest, cave, mountain, water, beach, swamp, desert, volcano, ice,
tower, ruins, sky, league).

Two things to be careful about:

- **`:gym` consumes the next entry of that region's `gyms` array.** The order of
  `:gym` stages must match the order of `gyms`. Inserting a gym stage in the
  wrong place silently reassigns every later badge. `check.mjs` catches a count
  mismatch, not a wrong order — check the pairing by eye.
- **Numeric `stage.id` shifts** when you insert. Anything keyed on it moves with
  it; that is why `MAP_IMAGES` should use the readable `region|Name` key.

Stage index also drives difficulty — `stageLevel()` is a percentage through the
region — so inserting areas flattens the curve slightly and removing them
steepens it.

**Adding a theme** needs four entries: `THEME_TYPES` (which types spawn there),
`THEME_PAINTER` (which painter draws it), `THEME_TRAINER` (which trainer class
appears), and a `THEME_CFG` + `PALETTES` pair in `js/map.js` if the painter is
new. `check.mjs` errors on any of the first three missing.

**Adding a region** means a `REGIONS` entry (`name, gen, dex[lo,hi], starters,
rival, gyms[8], elite[4], champion, stages[]`) plus its key in `REGION_ORDER`.
The league stage must be last and there must be exactly one; the league map has
exactly four elite nodes, so `elite` must have four members. All checked.

Encounter pools are **not** written by hand — they derive from the dex range
plus theme type affinities. That is what keeps nine regions maintainable, and
`check.mjs` verifies every region/theme pair yields a non-empty pool.

## 7. Achievements

One place: `data/content.js` → `ACHIEVEMENTS`, as
`{ id, name, desc, check: (stats, profile) => boolean }`. `Achievements.check()`
runs after every state change and wraps each predicate in a try/catch, so a
throwing check disables itself silently rather than breaking the game — but it
also means a typo never surfaces. Test with a profile that should unlock it.

If your achievement needs a counter that does not exist yet, add it to
`DEFAULT_STATS` in `js/core.js` and bump it with `Profile.bump('key')` or
`Profile.atLeast('key', value)` for high-water marks. Existing profiles backfill
the new key automatically.

## 8. Battle mechanics

**A new status condition** touches: `STATUS_LABEL` (the badge text), the
pre-move gates at the top of `useMove` (does it prevent acting?), the chip
damage block in `endOfTurn`, `effStat` if it changes a stat the way burn and
paralysis do, `Battle.catchChance` if it should help capture, and `ITEMS`
`fullHeal` already cures everything.

**A new weather** is a `WEATHER` entry — `{ name, icon, boost, weaken, chip }`
covers damage boosts and per-turn chip already; `computeDamage` and `endOfTurn`
read those fields generically. Add an `ABILITIES` entry with `weather: 'key'` to
let a species summon it.

**A new move category or effect** is the expensive one. `MOVES` rows have no
room for effects — they are `[name, type, power, accuracy, category, priority]`
— so status moves, multi-hit and drain do not exist. Adding them means widening
the row (and regenerating `data/pokedex.js`) or a side table keyed by move
index. The side table is much cheaper and does not touch the generated file:

```js
// data/content.js — effects keyed by move index, only for moves that have one.
const MOVE_EFFECTS = {
  57:  { status: 'burn', chance: .1 },
  112: { drain: .5 },
  203: { multiHit: [2, 5] },
};
```

then read it in `useMove` after damage lands. Keep the default path allocation-
free — it runs several times per turn.

**Always route new player actions through `Battle.act(fn)`.** It owns the `busy`
flag and releases it in a `finally`, so a thrown error skips the turn instead of
freezing the battle forever.

## 9. Balance levers

Where the difficulty actually lives, so you change the right number:

| Lever | Location | Effect |
|---|---|---|
| `stageLevel()` | `js/game.js` | `4 + progress% × 62 + badges × 1.5`. The main curve. |
| Tower scaling | `js/game.js` | `18 + floor × 2` |
| Wild level jitter | `Game.makeWild` | `stageLevel ± 2` |
| Encounter strength | `rollEncounter` | target BST `220 + level × 5.5` |
| Trainer team size | `Game.nodeTrainer` | `1 + stageIndex/9`, capped at 6 |
| Gym team size / level | `Game.nodeGym` | `3 + badges/2`, level `+3`, ace `+3` |
| Elite / Champion | `Game.nodeElite` | floors of 50 / 56, `+2` per elite, `+1` per champion slot |
| Nuzlocke tax | `computeDamage` | flat `1.1×` enemy damage |
| Trait tiers | `TRAIT_TIERS` | `+12% / +25% / +40%` |
| Crit rate | `computeDamage` | `1/16`, doubled by `scopeLens` |
| Starting money / bag | `Game.beginRun` | `¥800`, 4 potions, 8 balls |
| Battle rewards | `Game.node*` `reward:` | wild `level×26 + BST/3`, gym `1400 + level×90` |
| Shiny rate | `Game.makeWild` | `1/512`, tripled by `shinyCharm` |
| Node counts | `MapGen.nodes` | 6 rows (5 for gym stages), −2 for Speedrun |
| Node mix | `MapGen.kindBag` | per-theme probabilities |

Two structural facts worth keeping in mind before rebalancing: **losing a battle
does not clear the node**, so only a total wipe ends a run — the game is
currently forgiving by design. And **the daily run is only partly seeded**: the
region, modifier and map layout come from the day's seed, but wild encounters
call bare `Math.random()` in `Game.makeWild` and `rollEncounter`, so "the same
rolls for everyone" is not actually true. Threading the seeded RNG through those
two calls is a small, self-contained fix if you want the promise to hold.
