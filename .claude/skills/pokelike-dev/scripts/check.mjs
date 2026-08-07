#!/usr/bin/env node
/* Headless sanity check for the Pokelike source tree.
 *
 * The game has no build step and no test runner, so a typo in a data table
 * ships silently and only shows up as a blank canvas or a NaN in a damage
 * roll. This script is the substitute: it parses every file, loads the whole
 * engine in a DOM shim, cross-checks the data tables against the code that
 * reads them, and then actually fights a few battles to prove the turn loop
 * still terminates.
 *
 * Usage:  node check.mjs [source-dir]        (default: .pokelike-src)
 * Exit:   0 = clean (warnings allowed), 1 = at least one error
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(process.argv[2] || '.pokelike-src');
const errors = [];
const warnings = [];
const notes = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

const DATA_FILES = ['data/pokedex.js', 'data/content.js', 'data/regions.js', 'data/maps.js'];
const CODE_FILES = ['js/core.js', 'js/map.js', 'js/battle.js', 'js/ui.js', 'js/game.js'];

/* ---------------------------------------------------------------- structure */
for (const f of ['index.html', 'style.css', ...DATA_FILES, ...CODE_FILES]) {
  if (!fs.existsSync(path.join(SRC, f))) err(`missing required file: ${f}`);
}
if (errors.length) { report(); process.exit(1); }

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
for (const f of [...DATA_FILES, ...CODE_FILES]) {
  if (!html.includes(f)) err(`${f} exists but index.html never loads it — add a <script src="${f}">`);
}
// Load order matters: data tables are read at load time by regions.js and by
// the palette validator in map.js, so a file pulled in too early throws.
const order = [...DATA_FILES, ...CODE_FILES];
const positions = order.map(f => ({ f, at: html.indexOf(f) })).filter(x => x.at >= 0);
for (let i = 1; i < positions.length; i++) {
  if (positions[i].at < positions[i - 1].at) {
    err(`index.html loads ${positions[i].f} before ${positions[i - 1].f} — data must load before code`);
  }
}

/* ------------------------------------------------------------------ parsing */
// Parse each file on its own first, so a syntax error reports the real file
// and line instead of an offset into the concatenated blob below.
const sources = {};
for (const f of [...DATA_FILES, ...CODE_FILES]) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  sources[f] = code;
  try {
    new vm.Script(code, { filename: f });
  } catch (e) {
    err(`${f}: syntax error — ${e.message}`);
  }
}
if (errors.length) { report(); process.exit(1); }

/* -------------------------------------------------------------- DOM shim */
// Enough of a browser for the engine to load and for a battle to run. The UI
// layer is replaced wholesale further down, so nothing here has to paint.
const store = new Map();
const stubCanvas = () => ({
  width: 0, height: 0,
  getContext: () => new Proxy({}, { get: () => () => {} }),
  toDataURL: () => 'data:image/png;base64,',
});
const stubEl = () => new Proxy({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  children: [], innerHTML: '', textContent: '', value: '',
  appendChild() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
  getContext: () => new Proxy({}, { get: () => () => {} }),
}, { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => (t[k] = v, true) });

globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  querySelector: () => stubEl(), querySelectorAll: () => [],
  createElement: tag => (tag === 'canvas' ? stubCanvas() : stubEl()),
  body: stubEl(), documentElement: stubEl(),
};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.Image = class { set src(_) {} };
globalThis.Audio = class { play() { return Promise.resolve(); } };
globalThis.location = { reload() {} };
globalThis.scrollTo = () => {};
globalThis.getComputedStyle = () => new Proxy({}, { get: () => '' });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.btoa = s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);
globalThis.alert = () => {};
globalThis.confirm = () => true;

// Top-level `const` in a classic script is shared across scripts in a browser
// but not across separate vm runs, so load everything as one program — the
// per-file parse above already isolated syntax errors. Those consts stay in
// the script's lexical scope rather than landing on globalThis, so an epilogue
// running in that same scope hands the tables back out. A table that has been
// renamed or deleted comes back undefined instead of throwing, so the checks
// below can report it properly.
const EXPORTS = [
  'TYPES', 'DEX', 'MOVES', 'MOVES_BY_TYPE', 'EVOLVES', 'MEGAS',
  'TYPE_CHART', 'TYPE_COLORS', 'ITEMS', 'MART_STOCK', 'PASSIVES', 'TRAIT_TIERS',
  'ABILITIES', 'ABILITY_BY_TYPE', 'TRAINER_CLASSES', 'NODE_LABELS', 'ACHIEVEMENTS',
  'CHALLENGES', 'THEME_TYPES', 'THEME_PAINTER', 'THEME_TRAINER', 'REGIONS',
  'REGION_ORDER', 'MAP_IMAGES', 'Poke', 'Battle', 'UI', 'Game', 'MapGen', 'SpriteGen',
];
const epilogue = `
;globalThis.__PK__ = {};
for (const __n of ${JSON.stringify(EXPORTS)}) {
  try { globalThis.__PK__[__n] = eval(__n); } catch (e) { globalThis.__PK__[__n] = undefined; }
}`;

const consoleErrors = [];
const realError = console.error;
console.error = (...a) => consoleErrors.push(a.map(String).join(' '));
try {
  vm.runInThisContext(order.map(f => sources[f]).join('\n;\n') + epilogue, { filename: 'pokelike-bundle.js' });
} catch (e) {
  console.error = realError;
  err(`engine failed to load: ${e.message}\n    ${(e.stack || '').split('\n')[1] || ''}`);
  report();
  process.exit(1);
}
console.error = realError;
// map.js validates its own palettes at load and reports through console.error.
consoleErrors.forEach(m => err(`load-time error: ${m}`));

/* ------------------------------------------------------------- data tables */
const T = globalThis.__PK__;
for (const name of EXPORTS) {
  if (T[name] === undefined) err(`the engine loaded but "${name}" is not defined — a data table was renamed or removed`);
}
if (errors.length) { report(); process.exit(1); }
const typeSet = new Set(T.TYPES);

for (const t of T.TYPES) {
  if (!T.TYPE_CHART[t]) err(`TYPE_CHART has no row for type "${t}" — every type needs one, even if empty`);
  if (!T.TYPE_COLORS[t]) err(`TYPE_COLORS is missing "${t}" — type pills would render colourless`);
}
for (const [atk, row] of Object.entries(T.TYPE_CHART)) {
  if (!typeSet.has(atk)) err(`TYPE_CHART has unknown attacking type "${atk}"`);
  for (const [def, mult] of Object.entries(row)) {
    if (!typeSet.has(def)) err(`TYPE_CHART.${atk} references unknown defending type "${def}"`);
    if (![0, 0.5, 1, 2].includes(mult)) warn(`TYPE_CHART.${atk}.${def} = ${mult} is not a canonical multiplier`);
  }
}
for (const [k, v] of Object.entries(T.TYPE_COLORS)) {
  if (!/^#[0-9a-f]{6}$/i.test(v)) err(`TYPE_COLORS.${k} = "${v}" is not a 6-digit hex colour`);
}

// Dex rows are positional; a short row silently reads undefined stats.
const DEX_COLS = 12;
T.DEX.forEach((row, i) => {
  if (row.length !== DEX_COLS) err(`DEX[${i}] (${row[0]}) has ${row.length} columns, expected ${DEX_COLS}`);
  if (row[1] < 0 || row[1] >= T.TYPES.length) err(`DEX[${i}] (${row[0]}) primary type index ${row[1]} out of range`);
  if (row[2] !== -1 && (row[2] < 0 || row[2] >= T.TYPES.length)) err(`DEX[${i}] (${row[0]}) secondary type index ${row[2]} out of range`);
  for (let s = 3; s <= 8; s++) if (!(row[s] > 0)) err(`DEX[${i}] (${row[0]}) has non-positive base stat at column ${s}`);
});

T.MOVES.forEach((m, i) => {
  if (m[1] < 0 || m[1] >= T.TYPES.length) err(`MOVES[${i}] (${m[0]}) has type index ${m[1]} out of range`);
  if (!(m[2] >= 0)) err(`MOVES[${i}] (${m[0]}) has invalid power ${m[2]}`);
  if (!(m[3] > 0 && m[3] <= 100)) err(`MOVES[${i}] (${m[0]}) has accuracy ${m[3]} outside 1..100`);
});
// Every type needs at least one move, or Moves.buildFor loops and falls back.
T.TYPES.forEach((t, i) => {
  const pool = T.MOVES_BY_TYPE[i] || [];
  if (!pool.length) err(`MOVES_BY_TYPE has no moves for "${t}" — movesets for that type fall back to Tackle`);
  else if (!pool.some(idx => T.MOVES[idx][2] <= 60)) {
    warn(`type "${t}" has no move at or below 60 power — level-5 Pokémon of that type get an overpowered opener`);
  }
});

for (const [from, evos] of Object.entries(T.EVOLVES)) {
  for (const [to, lvl] of evos) {
    if (!T.DEX[to - 1]) err(`EVOLVES[${from}] points at dex id ${to}, which does not exist`);
    if (!(lvl >= 1 && lvl <= 100)) err(`EVOLVES[${from}] -> ${to} has evolution level ${lvl}`);
  }
}
for (const [from, forms] of Object.entries(T.MEGAS)) {
  for (const f of forms) {
    if (!T.DEX[from - 1]) err(`MEGAS has an entry for dex id ${from}, which does not exist`);
    if (f[2] < 0 || f[2] >= T.TYPES.length) err(`MEGAS[${from}] "${f[1]}" primary type index out of range`);
    for (let s = 4; s <= 9; s++) if (!(f[s] > 0)) err(`MEGAS[${from}] "${f[1]}" has a non-positive base stat`);
  }
}

for (const [t, list] of Object.entries(T.ABILITY_BY_TYPE)) {
  if (!typeSet.has(t)) err(`ABILITY_BY_TYPE has unknown type "${t}"`);
  for (const a of list) if (!T.ABILITIES[a]) err(`ABILITY_BY_TYPE.${t} references unknown ability "${a}"`);
}
for (const t of T.TYPES) {
  if (!T.ABILITY_BY_TYPE[t]) err(`ABILITY_BY_TYPE has no list for "${t}" — Species.ability falls back to normal`);
}
for (const [k, a] of Object.entries(T.ABILITIES)) {
  if (a.type && !typeSet.has(a.type)) err(`ABILITIES.${k}.type = "${a.type}" is not a real type`);
  if (a.absorb && !typeSet.has(a.absorb)) err(`ABILITIES.${k}.absorb = "${a.absorb}" is not a real type`);
  if (a.weather && !T.Poke.WEATHER[a.weather]) err(`ABILITIES.${k}.weather = "${a.weather}" is not a defined weather`);
}

for (const k of T.MART_STOCK) if (!T.ITEMS[k]) err(`MART_STOCK lists "${k}", which is not in ITEMS`);
for (const [k, it] of Object.entries(T.ITEMS)) {
  if (!['heal', 'revive', 'status', 'ball', 'boost', 'utility'].includes(it.kind)) {
    err(`ITEMS.${k}.kind = "${it.kind}" is not a kind the bag knows how to use`);
  }
}
if (T.TRAIT_TIERS.length !== 3) err(`TRAIT_TIERS has ${T.TRAIT_TIERS.length} tiers; the trait UI assumes 3`);

/* --------------------------------------- cross-check code against the data */
// The classic way to break this game is to add a passive to the engine and
// forget the entry in content.js (silently dead) or the reverse (a relic you
// can pick that does nothing). Scan the engine for the keys it actually reads.
const engineSrc = CODE_FILES.map(f => sources[f]).join('\n');
const usedPassives = new Set([...engineSrc.matchAll(/Battle\.has\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]));
for (const p of usedPassives) {
  if (!T.PASSIVES[p]) err(`the engine calls Battle.has('${p}') but PASSIVES has no such entry — that effect can never fire`);
}
for (const p of Object.keys(T.PASSIVES)) {
  const wiredElsewhere = new RegExp(`passives\\.includes\\(\\s*['"]${p}['"]`).test(engineSrc);
  if (!usedPassives.has(p) && !wiredElsewhere) {
    warn(`PASSIVES.${p} ("${T.PASSIVES[p].name}") is offered as a reward but no code reads it — it does nothing`);
  }
}
const usedAbilities = new Set([...engineSrc.matchAll(/ability\s*===\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]));
for (const a of usedAbilities) {
  if (!T.ABILITIES[a]) err(`the engine checks for ability '${a}' but ABILITIES has no such entry`);
}
for (const k of Object.keys(T.NODE_LABELS)) {
  if (!new RegExp(`case\\s*['"]${k}['"]`).test(sources['js/game.js'])) {
    warn(`NODE_LABELS has "${k}" but Game.handleNode has no case for it — that node would do nothing when clicked`);
  }
}
for (const c of T.CHALLENGES) {
  if (!new RegExp(`challenge\\s*===\\s*['"]${c.id}['"]`).test(engineSrc)) {
    warn(`CHALLENGES "${c.id}" is selectable but no code branches on it — it has no effect`);
  }
}

/* ---------------------------------------------------------------- regions */
let totalStages = 0;
for (const key of T.REGION_ORDER) {
  const r = T.REGIONS[key];
  if (!r) { err(`REGION_ORDER lists "${key}" but REGIONS has no such region`); continue; }
  totalStages += r.stages.length;

  const [lo, hi] = r.dex;
  if (!(lo >= 1 && hi <= T.DEX.length && lo < hi)) err(`${key}: dex range ${lo}-${hi} is outside 1..${T.DEX.length}`);
  for (const s of r.starters) if (!T.DEX[s - 1]) err(`${key}: starter ${s} is not a real species`);

  const gymStages = r.stages.filter(s => s.gym);
  if (gymStages.length !== r.gyms.length) {
    err(`${key}: ${gymStages.length} gym stages but ${r.gyms.length} leaders — a ":gym" stage consumes one leader, so the counts must match`);
  }
  for (const [name, type] of r.gyms) if (!typeSet.has(type)) err(`${key}: gym leader ${name} has unknown type "${type}"`);
  for (const [name, type] of r.elite) if (!typeSet.has(type)) err(`${key}: Elite Four ${name} has unknown type "${type}"`);
  if (!typeSet.has(r.champion[1])) err(`${key}: champion ${r.champion[0]} has unknown type "${r.champion[1]}"`);

  const league = r.stages.filter(s => s.league);
  if (league.length !== 1) err(`${key}: ${league.length} league stages — exactly one is needed to end the campaign`);
  if (league.length && r.stages[r.stages.length - 1] !== league[0]) err(`${key}: the league stage is not last`);
  if (r.elite.length !== 4) err(`${key}: ${r.elite.length} Elite Four members — the league map has exactly 4 elite nodes`);

  for (const s of r.stages) {
    if (!T.THEME_TYPES[s.theme]) err(`${key}: stage "${s.name}" has theme "${s.theme}", which has no THEME_TYPES entry`);
    if (!T.Poke.MapGen && !s.painter) err(`${key}: stage "${s.name}" has no painter`);
  }
  const ids = new Set(r.stages.map(s => s.id));
  if (ids.size !== r.stages.length) err(`${key}: duplicate stage ids`);
}
for (const [theme, types] of Object.entries(T.THEME_TYPES)) {
  for (const t of types) if (!typeSet.has(t)) err(`THEME_TYPES.${theme} lists unknown type "${t}"`);
  if (!T.THEME_PAINTER[theme]) err(`THEME_PAINTER has no painter for theme "${theme}"`);
  if (!T.THEME_TRAINER[theme]) err(`THEME_TRAINER has no trainer class for theme "${theme}"`);
}
for (const [theme, cls] of Object.entries(T.THEME_TRAINER)) {
  if (!T.TRAINER_CLASSES[cls]) err(`THEME_TRAINER.${theme} = "${cls}" is not in TRAINER_CLASSES`);
}
notes.push(`${T.REGION_ORDER.length} regions · ${totalStages} areas · ${T.DEX.length} species · ${T.MOVES.length} moves`);

/* ---------------------------------------------- encounter pools are usable */
// An empty pool means rollEncounter picks from nothing and returns undefined,
// which becomes a blank sprite and a crash in the damage formula.
for (const key of T.REGION_ORDER) {
  const themes = new Set(T.REGIONS[key].stages.map(s => s.theme));
  for (const theme of themes) {
    for (const rare of [false, true]) {
      const pool = T.Poke.encounterPool(key, theme, { rare });
      if (!pool || !pool.length) err(`${key}/${theme} has an empty ${rare ? 'rare' : 'normal'} encounter pool`);
    }
  }
}

/* ------------------------------------------------------------------ assets */
const mapDir = path.join(SRC, 'maps');
const onDisk = fs.existsSync(mapDir) ? new Set(fs.readdirSync(mapDir)) : new Set();
const referenced = new Set();
for (const [key, file] of Object.entries(T.MAP_IMAGES || {})) {
  if (/^(https?:)?\/\//.test(file)) continue;
  referenced.add(file);
  if (!onDisk.has(file)) err(`MAP_IMAGES["${key}"] points at maps/${file}, which is not in the zip`);
}
const orphans = [...onDisk].filter(f => !referenced.has(f) && !f.startsWith('.'));
if (orphans.length) warn(`${orphans.length} file(s) in maps/ are not referenced by MAP_IMAGES (dead weight in the zip): ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '…' : ''}`);
// Every MAP_IMAGES key must resolve to a real stage, or it never gets used.
const stageKeys = new Set();
for (const key of T.REGION_ORDER) for (const s of T.REGIONS[key].stages) { stageKeys.add(s.id); stageKeys.add(s.imageKey); }
for (const key of Object.keys(T.MAP_IMAGES || {})) {
  if (!stageKeys.has(key)) warn(`MAP_IMAGES key "${key}" matches no stage id or imageKey — that picture is never shown`);
}

/* -------------------------------------------------------------- smoke test */
// Data can be perfectly consistent and the turn loop still hang or produce
// NaN damage. Fight real battles with the real engine to prove otherwise.
// The real UI object is kept — rendering against the DOM shim is free extra
// coverage, and a broken template string in renderBattle is exactly the kind
// of bug worth catching here. Only the two methods that would drag the whole
// game flow in are neutralised, by mutating the object rather than rebinding
// it, so the engine's own `UI` reference sees the change.
const RUI = T.UI;
RUI.pace = () => 0;                     // battles run at full speed
RUI.closeBattle = () => {};             // stop before Game.afterBattle
const realToast = RUI.toast;
RUI.toast = () => {};
void realToast;

const P = T.Poke;
P.Profile.load();
P.Profile.data.settings.sfx = false;
P.Profile.data.settings.cries = false;

function makeRun(over = {}) {
  const team = (over.teamIds || [1, 4, 7]).map(id => P.createPokemon(id, over.level || 30));
  return Object.assign({
    version: 9, mode: 'story', rawMode: 'story', submode: 'classic', challenge: null,
    monotype: null, region: 'kanto', player: 'CHECK', gender: 'boy', seedSalt: 'smoke',
    stageIndex: 10, towerFloor: 0, towerRegion: 'kanto', currentNode: 'start',
    cleared: ['start'], available: [], team, box: [],
    bag: { potion: 4, pokeball: 8, revive: 1, fullHeal: 1 },
    passives: [], traits: {}, badges: [], money: 800, eliteIndex: 0, repel: 0,
    pendingEvolutions: [], startedAt: Date.now(),
  }, over.run || {});
}

const finite = n => typeof n === 'number' && Number.isFinite(n);

async function fight(label, opts = {}) {
  P.Run.state = makeRun(opts);
  const run = P.Run.state;
  const enemy = P.createPokemon(opts.enemyId || 25, opts.level || 30);
  const B = T.Battle;
  const started = B.start({
    kind: opts.kind || 'wild', title: label, trainer: opts.kind === 'wild' ? null : { name: 'Test', cls: 'ace' },
    enemyTeam: opts.enemyTeam || [enemy], canRun: true, canCatch: opts.kind === 'wild', reward: 100,
  });
  if (!started) { err(`smoke [${label}]: Battle.start refused a healthy team`); return; }

  for (let turn = 0; turn < 200 && !B.state.over; turn++) {
    const me = B.player();
    if (!me) { err(`smoke [${label}]: no active Pokémon mid-battle`); return; }
    const slot = me.moves.findIndex(m => m.pp > 0);
    await B.playerMove(slot >= 0 ? slot : 0);

    for (const side of [B.player(), B.enemy()]) {
      if (!side) continue;
      if (!finite(side.hp)) { err(`smoke [${label}]: ${side.name} has non-finite HP (${side.hp})`); return; }
      if (side.hp < 0) { err(`smoke [${label}]: ${side.name} has negative HP (${side.hp})`); return; }
      if (side.hp > side.stats.hp) { err(`smoke [${label}]: ${side.name} is above max HP (${side.hp}/${side.stats.hp})`); return; }
      for (const [k, v] of Object.entries(side.stats)) {
        if (!finite(v) || v <= 0) { err(`smoke [${label}]: ${side.name} has invalid ${k} stat (${v})`); return; }
      }
    }
  }
  if (!B.state.over) err(`smoke [${label}]: battle did not finish in 200 turns — the turn loop may not terminate`);
  if (B.state.log.some(l => /undefined|NaN|\[object/.test(l))) {
    err(`smoke [${label}]: battle log contains a broken line — ${B.state.log.find(l => /undefined|NaN|\[object/.test(l))}`);
  }
  void run;
}

/* ------------------------------------------------------------------ report */
function report() {
  for (const n of notes) console.log(`  ${n}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach(w => console.log(`  ! ${w}`));
  }
  if (errors.length) {
    console.log(`\n${errors.length} error(s):`);
    errors.forEach(e => console.log(`  x ${e}`));
    console.log('');
  } else {
    console.log(`\nOK — ${warnings.length ? `clean apart from ${warnings.length} warning(s)` : 'no problems found'}\n`);
  }
}

const scenarios = [
  ['wild battle', {}],
  ['trainer battle, full party', { kind: 'trainer', enemyTeam: [25, 6, 9].map(id => T.Poke.createPokemon(id, 32)) }],
  ['level 5 starters', { level: 5, enemyId: 16 }],
  ['level 100 legendary', { level: 100, enemyId: 150, teamIds: [149] }],
  ['every passive at once', { run: { passives: Object.keys(T.PASSIVES) } }],
  ['maxed traits', { run: { traits: Object.fromEntries(T.TYPES.map(t => [t, 3])) } }],
  ['inverse + nuzlocke', { run: { challenge: 'inverse', submode: 'nuzlocke' } }],
];

for (const [label, opts] of scenarios) await fight(label, opts);
if (!errors.length) notes.push(`smoke test: ${scenarios.length} battles fought, all terminated cleanly`);

report();
process.exit(errors.length ? 1 : 0);
