// NEOPOLIS — a tribute to Populous (Bullfrog, 1989)
// Copyright © 2026 Melvin Carvalho — AGPL-3.0-or-later
// Zero assets: every pixel and every sound is generated from code.

'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
const HUD_H = 118, MQ = 38;
const VW = W, VH = H - MQ - HUD_H;
const MONO = '"Courier New", monospace';

// ---------- deterministic RNG ----------
let _seed = 1;
function srand(s) { _seed = (s >>> 0) || 1; }
function rand() {
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5; _seed >>>= 0;
  return _seed / 4294967296;
}
function rng(a, b) { return a + rand() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------- audio (synth blips, muted in harness) ----------
let AC = null, AUDIO_ON = true;
function audio() { if (!AC && AUDIO_ON) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AUDIO_ON = false; } } }
function blip(f0, f1, dur, type, vol) {
  if (!AC || !AUDIO_ON) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol || 0.08, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  raise: () => blip(140, 220, 0.12, 'triangle', 0.1),
  lower: () => blip(220, 120, 0.12, 'triangle', 0.1),
  settle: () => { blip(320, 480, 0.14, 'square', 0.06); blip(640, 900, 0.18, 'sine', 0.05); },
  collapse: () => blip(300, 70, 0.3, 'sawtooth', 0.09),
  fight: () => blip(180, 140, 0.07, 'square', 0.05),
  die: () => blip(500, 90, 0.2, 'sawtooth', 0.06),
  swamp: () => blip(90, 40, 0.4, 'sawtooth', 0.1),
  quake: () => blip(60, 30, 0.7, 'sawtooth', 0.14),
  knight: () => { blip(500, 900, 0.2, 'square', 0.09); blip(900, 1400, 0.25, 'sine', 0.06); },
  flood: () => blip(200, 50, 0.8, 'sine', 0.12),
  magnet: () => blip(700, 1100, 0.15, 'sine', 0.07),
  gg: () => { blip(80, 40, 1.2, 'sawtooth', 0.16); blip(1200, 200, 1.0, 'square', 0.08); },
  win: () => { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => blip(f, f * 1.01, 0.3, 'triangle', 0.1), i * 130)); },
  fail: () => { [330, 311, 262, 196].forEach((f, i) => setTimeout(() => blip(f, f * 0.98, 0.35, 'sawtooth', 0.08), i * 160)); },
  tick: () => blip(900, 700, 0.04, 'square', 0.04),
};

// ---------- world ----------
const N = 44;                 // vertex grid N x N, tiles (N-1)^2
const TW = 30, TH = 15, HS = 8;  // iso tile width/height, height step in px
const HMAX = 10;
const STEP = 1 / 30;
const TEAM = [
  { name: 'CYAN', col: '#33d6ff', dim: '#0f5a70' },
  { name: 'MAGMA', col: '#ff2e6d', dim: '#701530' },
];

let G = null;

function isoX(gx, gy) { return (gx - gy) * (TW / 2); }
function isoY(gx, gy, h) { return (gx + gy) * (TH / 2) - h * HS; }

function genTerrain(seed) {
  srand(seed);
  const Hf = new Float32Array(N * N);
  // fractal bumps
  for (let o = 0; o < 60; o++) {
    const cx = rng(4, N - 4), cy = rng(4, N - 4), r = rng(3, 9), amp = rng(-2.6, 3.4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) Hf[y * N + x] += amp * (1 - d / r);
    }
  }
  const Hgt = new Int8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = Hf[y * N + x], b = Hf[(N - 1 - y) * N + (N - 1 - x)];
    Hgt[y * N + x] = clamp(Math.round((a + b) / 2), 0, HMAX);
  }
  // the wilderness is hostile: without a god's hand, almost nothing is flat enough to farm
  for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) {
    const mi = (N - 1 - y) * N + (N - 1 - x), i = y * N + x;
    if (i > mi) continue;                      // jitter once, mirror to keep the world fair
    if (rand() < 0.32 && Hgt[i] > 0) {
      const j = (rand() < 0.5 ? -1 : 1) * (rand() < 0.12 ? 2 : 1);
      Hgt[i] = clamp(Hgt[i] + j, Hgt[i] > 1 ? 1 : 0, HMAX);
      Hgt[mi] = Hgt[i];
    }
  }
  // ocean border
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = Math.min(x, y, N - 1 - x, N - 1 - y);
    if (b < 3) Hgt[y * N + x] = 0;
    else if (b < 5) Hgt[y * N + x] = Math.min(Hgt[y * N + x], b - 2);
  }
  return Hgt;
}
function hAt(x, y) { return G.H[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)]; }
function hVisAt(x, y) { return G.Hvis[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)]; }
function recalcCoast() {
  const d = new Uint8Array(N * N).fill(9);
  const q2 = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (G.H[y * N + x] > G.water) { d[y * N + x] = 0; q2.push(x, y); }
  for (let qi = 0; qi < q2.length; qi += 2) {
    const x = q2[qi], y = q2[qi + 1], dv = d[y * N + x];
    if (dv >= 7) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (d[ny * N + nx] > dv + 1) { d[ny * N + nx] = dv + 1; q2.push(nx, ny); }
    }
  }
  G.coast = d;
}
function tileFlat(tx, ty) {
  if (G.poison.has(ty * N + tx)) return -1;      // volcanic rock will not bear a roof
  const h = hAt(tx, ty);
  return h > G.water && h === hAt(tx + 1, ty) && h === hAt(tx, ty + 1) && h === hAt(tx + 1, ty + 1) ? h : -1;
}
function tileKey(tx, ty) { return ty * N + tx; }

// flat-area census around a tile: the canon rule — more flat land, bigger settlement
function flatScore(tx, ty) {
  const h = tileFlat(tx, ty);
  if (h < 0) return 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (tileFlat(tx + dx, ty + dy) === h) n++;
  }
  return n;   // 1..25
}
function levelOf(score) { return clamp(Math.ceil(score / 3.2), 1, 8); }

function newGame(seed, attract) {
  G = {
    seed, time: 0, tick: 0, attract: !!attract, showTitle: !!attract,
    H: genTerrain(seed), water: 0, poison: new Map(), waterVis: 0,
    walkers: [], setts: [], swamps: [], parts: [], pops: [],
    mana: [180, 180], magnet: [null, null], magnetOn: [false, false],
    mode: 'play', modeT: 0, endT: 0, armageddon: false,
    cam: { x: 0, y: -60 }, shake: 0,
    cursor: { vx: N >> 1, vy: N >> 1 },
    selPower: 'raise', behavior: 'settle',
    aiT: 0, hintT: 24, nextId: 1, cool: { quake: [0, 0], swamp: [0, 0], volcano: [0, 0] }, leaderId: [0, 0], aiDecreeT: 0, strikeT: [-1, -1],
    stats: { t: [], pop: [[], []], deform: [0, 0], powers: [{}, {}] },
  };
  // starting flats + seed walkers for both gods, mirrored for fairness
  seedStart(0, 10, 10);
  G.Hvis = Float32Array.from(G.H);
  recalcCoast();
  seedStart(1, N - 13, N - 13);
  G.cam.x = isoX(11, 11) - 0;
  G.cam.y = isoY(11, 11, hAt(11, 11)) - VH / 2 + 40;
}
function seedStart(team, cx, cy) {
  const h = Math.max(2, hAt(cx, cy));
  for (let y = -2; y <= 3; y++) for (let x = -2; x <= 3; x++) G.H[(cy + y) * N + (cx + x)] = h;
  for (let i = 0; i < 5; i++) spawnWalker(team, cx + 0.5 + rng(-1.5, 1.5), cy + 0.5 + rng(-1.5, 1.5), 30);
}
function spawnWalker(team, x, y, str, home) {
  G.walkers.push({
    id: G.nextId++, team, x, y, tx: x, ty: y, home: home || 0,
    str, age: 0, mode: 'settle', knight: false, fightT: 0, wanderT: 0, dir: rng(0, 6.28),
  });
}

// ---------- settlements ----------
function settleAt(w) {
  const tx = Math.floor(w.x), ty = Math.floor(w.y);
  if (tileFlat(tx, ty) < 0) return false;
  if (G.setts.some(s => Math.max(Math.abs(s.tx - tx), Math.abs(s.ty - ty)) <= (s.level >= 5 ? 2 : 1))) return false;
  if (G.swamps.some(s => s.tx === tx && s.ty === ty)) return false;
  const score = flatScore(tx, ty);
  if (score < 3) return false;
  G.setts.push({
    id: G.nextId++, team: w.team, tx, ty, h: tileFlat(tx, ty),
    level: levelOf(score), lastLevel: levelOf(score), spawnT: rng(2, 5), popT: 0, burnT: 0, occ: 0, growT: 0,
  });
  SFX.settle();
  addRing(tx + 0.5, ty + 0.5, TEAM[w.team].col);
  return true;
}
function collapseSett(s, silent) {
  // the people walk free; the building is gone — a city yields a crowd, a hut yields one soul
  const idx = G.setts.indexOf(s);
  if (idx >= 0) G.setts.splice(idx, 1);
  const n = Math.ceil(s.level / 2) + Math.ceil((s.occ || 0) / 3);
  for (let i = 0; i < n; i++) spawnWalker(s.team, s.tx + 0.5 + rng(-0.5, 0.5), s.ty + 0.5 + rng(-0.5, 0.5), 16 + s.level * 3);
  if (!silent) { SFX.collapse(); addBurst(s.tx + 0.5, s.ty + 0.5, TEAM[s.team].col, 10); }
}
function recalcSetts() {
  recalcCoast();
  for (const s of [...G.setts]) {
    const h = tileFlat(s.tx, s.ty);
    if (h < 0 || h <= G.water) { collapseSett(s); continue; }
    s.h = h;
    s.level = levelOf(flatScore(s.tx, s.ty));
    if (s.level > (s.lastLevel || 0)) {
      s.growT = 0.4;
      addRing(s.tx + 0.5, s.ty + 0.5, TEAM[s.team].col);
      addPop(s.tx + 0.5, s.ty + 0.5, 'LVL ' + s.level, TEAM[s.team].col);
    }
    s.lastLevel = s.level;
  }
}

// ---------- influence: gods act only near their own people (canon) ----------
function influence(team, vx, vy) {
  for (const s of G.setts) if (s.team === team && Math.abs(s.tx - vx) + Math.abs(s.ty - vy) < 12) return true;
  for (const w of G.walkers) if (w.team === team && Math.abs(w.x - vx) + Math.abs(w.y - vy) < 10) return true;
  return false;
}

// ---------- divine powers ----------
const POWERS = {
  raise: { cost: 6, key: 'Q', target: 'vertex', desc: 'Lift one vertex of land' },
  lower: { cost: 6, key: 'W', target: 'vertex', desc: 'Sink one vertex of land' },
  swamp: { cost: 180, key: 'E', target: 'tile', desc: 'Lay a bog that swallows walkers' },
  quake: { cost: 420, key: 'R', target: 'vertex', desc: 'Shatter and sink the land nearby' },
  knight: { cost: 650, key: 'T', target: 'global', desc: 'Anoint your leader a knight' },
  volcano: { cost: 900, key: 'V', target: 'vertex', desc: 'Raise a poisoned mountain of rock' },
  flood: { cost: 1400, key: 'F', target: 'global', desc: 'Raise the sea over the lowlands' },
  armageddon: { cost: 2600, key: 'G', target: 'global', desc: 'The final battle. No more powers.' },
};
function castRaise(team, vx, vy, dir) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  const p = POWERS[dir > 0 ? 'raise' : 'lower'];
  if (G.mana[team] < p.cost) { G.deny = `NEED ${p.cost} MANA`; return false; }
  if (!influence(team, vx, vy)) { G.deny = 'OUT OF INFLUENCE'; return false; }
  const i = vy * N + vx;
  const nh = clamp(G.H[i] + dir, 0, HMAX);
  if (nh === G.H[i]) { G.deny = 'LAND AT ITS LIMIT'; return false; }
  G.mana[team] -= p.cost;
  G.H[i] = nh;
  G.stats.deform[team]++;
  recalcSetts();
  (dir > 0 ? SFX.raise : SFX.lower)();
  addBurst(vx, vy, '#8a7d6a', 10);
  addRing(vx, vy, TEAM[team].col);
  logPower(team, dir > 0 ? 'raise' : 'lower');
  return true;
}
function castSwamp(team, tx, ty) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.mana[team] < POWERS.swamp.cost) { G.deny = `NEED ${POWERS.swamp.cost} MANA`; return false; }
  if (tileFlat(tx, ty) < 0) { G.deny = 'NEEDS FLAT LAND'; return false; }
  if (!influence(team, tx, ty)) { G.deny = 'OUT OF INFLUENCE'; return false; }
  G.mana[team] -= POWERS.swamp.cost;
  G.swamps.push({ tx, ty, team, kills: 0 });
  SFX.swamp(); logPower(team, 'swamp');
  return true;
}
function castQuake(team, vx, vy) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.mana[team] < POWERS.quake.cost) { G.deny = `NEED ${POWERS.quake.cost} MANA`; return false; }
  if (!influence(team, vx, vy)) { G.deny = 'OUT OF INFLUENCE'; return false; }
  G.mana[team] -= POWERS.quake.cost;
  srand((G.seed ^ (G.tick * 7919) ^ (vx * 131 + vy)) >>> 0);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = vx + dx, y = vy + dy;
    if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
    if (Math.hypot(dx, dy) > 3.4) continue;
    const i = y * N + x;
    G.H[i] = clamp(G.H[i] - (1 + ((x + y) & 1)), 0, HMAX);   // checkerboard drop: nothing stays flat
  }
  G.shake = 9;
  recalcSetts();
  SFX.quake(); logPower(team, 'quake');
  for (let i = 0; i < 9; i++) addBurst(vx + rng(-3, 3), vy + rng(-3, 3), '#8a7d6a', 5);
  return true;
}
function leaderOf(team) {
  let best = null;
  for (const w of G.walkers) if (w.team === team && !w.knight && (!best || w.age > best.age)) best = w;
  return best;
}
function castKnight(team) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.mana[team] < POWERS.knight.cost) { G.deny = `NEED ${POWERS.knight.cost} MANA`; return false; }
  const l = leaderOf(team);
  if (!l) { G.deny = 'NO LEADER LEFT'; return false; }
  G.mana[team] -= POWERS.knight.cost;
  l.knight = true; l.str = Math.max(l.str * 2, 120); l.mode = 'magnet';
  SFX.knight(); addRing(l.x, l.y, '#ffd12a'); logPower(team, 'knight');
  return true;
}
function castVolcano(team, vx, vy) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.mana[team] < POWERS.volcano.cost) { G.deny = `NEED ${POWERS.volcano.cost} MANA`; return false; }
  if (!influence(team, vx, vy)) { G.deny = 'OUT OF INFLUENCE'; return false; }
  G.mana[team] -= POWERS.volcano.cost;
  const peak = Math.min(HMAX, hAt(vx, vy) + 5);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = vx + dx, y = vy + dy;
    if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
    const d = Math.hypot(dx, dy);
    if (d > 4.2) continue;
    const i = y * N + x;
    G.H[i] = Math.max(G.H[i], Math.round(peak - d * 1.3));
    if (d < 3.4) G.poison.set(i, Infinity);      // volcanic rock is a permanent scar (canon)
  }
  G.shake = 8;
  recalcSetts();
  SFX.quake(); logPower(team, 'volcano');
  addBurst(vx, vy, '#ff8c42', 22);
  addRing(vx, vy, '#ff8c42');
  return true;
}
function castFlood(team) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.water >= 3) { G.deny = 'THE SEA IS AT ITS HEIGHT'; return false; }
  if (G.mana[team] < POWERS.flood.cost) { G.deny = `NEED ${POWERS.flood.cost} MANA`; return false; }
  G.mana[team] -= POWERS.flood.cost;
  G.water++;
  recalcSetts();
  for (const w of G.walkers) {
    const h = hAt(Math.floor(w.x), Math.floor(w.y));
    if (h <= G.water) { killWalker(w); }
  }
  SFX.flood(); logPower(team, 'flood');
  G.shake = 6;
  return true;
}
function castArmageddon(team) {
  if (G.armageddon) { G.deny = 'THE END HAS BEGUN'; return false; }
  if (G.mana[team] < POWERS.armageddon.cost) { G.deny = `NEED ${POWERS.armageddon.cost} MANA`; return false; }
  G.mana[team] -= POWERS.armageddon.cost;
  G.armageddon = true;
  G.argT = 0;
  // the world ends from the center outward
  G.argQueue = [...G.setts].sort((a, b) =>
    Math.hypot(a.tx - N / 2, a.ty - N / 2) - Math.hypot(b.tx - N / 2, b.ty - N / 2));
  for (const w of G.walkers) { w.mode = 'armageddon'; }
  SFX.gg(); logPower(team, 'armageddon');
  G.shake = 12;
  return true;
}
function logPower(team, p) { G.stats.powers[team][p] = (G.stats.powers[team][p] || 0) + 1; }
function killWalker(w, how) {
  w.dead = true;
  if (how === 'sink') G.parts.push({ kind: 'sink', x: w.x, y: w.y, color: TEAM[w.team].col, life: 0.5, t: 0 });
  else addBurst(w.x, w.y, TEAM[w.team].col, 6);
}

// ---------- simulation ----------
function sim(dt) {
  G.time += dt; G.modeT += dt; G.tick++;
  if (G.mode !== 'play') { tickFX(dt); return; }
  G.hintT = Math.max(0, G.hintT - dt);

  // armageddon staging: rumble, then the cities fall from the center outward
  if (G.armageddon) {
    G.argT += dt;
    G.shake = Math.max(G.shake, Math.min(9, 1.5 + G.argT * 1.2) + Math.sin(G.time * 7) * 1.5);
    G.argCollapseT = (G.argCollapseT || 0) - dt;
    if (G.argT > 1.4 && G.argCollapseT <= 0 && G.argQueue && G.argQueue.length) {
      G.argCollapseT = 0.25;                        // the world ends at a march, not a dump
      const s = G.argQueue.shift();
      if (G.setts.includes(s)) collapseSett(s);
    }
  }
  for (const w of G.walkers) w.fightT = Math.max(0, w.fightT - dt);
  // the land heaves toward its true shape; the sea climbs slowly
  const ease = Math.min(1, 5.5 * dt);
  for (let i = 0; i < N * N; i++) G.Hvis[i] += (G.H[i] - G.Hvis[i]) * ease;
  G.waterVis += (G.water - G.waterVis) * Math.min(1, 2.2 * dt);
  // mana income: worship flows from settlements (canon: population is mana)
  for (const s of G.setts) {
    G.mana[s.team] += (s.level * 0.7 + (s.occ || 0) * 0.2) * dt;
    s.spawnT -= dt * (0.6 + s.level * 0.12);
    if (s.spawnT <= 0 && countPop(s.team) < 110) {
      s.spawnT = rng(4, 7);
      spawnWalker(s.team, s.tx + 0.5 + rng(-0.4, 0.4), s.ty + 0.5 + rng(-0.4, 0.4), 14 + s.level * 7 + Math.min(5, s.occ || 0) * 4, s.id);
    }
  }
  for (const w of G.walkers) G.mana[w.team] += 0.05 * dt;
  for (const t of [0, 1]) G.mana[t] = Math.min(G.mana[t], 4000);

  // walkers
  for (const w of G.walkers) {
    if (w.dead) continue;
    w.age += dt;
    stepWalker(w, dt);
  }
  // canon: walkers who meet combine their strength
  for (let i = 0; i < G.walkers.length; i++) {
    const a = G.walkers[i];
    if (a.dead || a.knight || a.str >= 90 || a.age < 2) continue;
    for (let j = i + 1; j < G.walkers.length; j++) {
      const b = G.walkers[j];
      if (b.dead || b.knight || b.team !== a.team || b.str >= 90 || b.age < 2) continue;
      if (Math.abs(a.x - b.x) < 0.4 && Math.abs(a.y - b.y) < 0.4) {
        a.str = Math.min(160, a.str + b.str * 0.8);
        a.age = Math.max(a.age, b.age);
        b.dead = true;
        addRing(a.x, a.y, TEAM[a.team].col);
      }
    }
  }
  // canon: a wandering walker reaching a foreign friendly settlement joins it — but the young must first leave home
  for (const w of G.walkers) {
    if (w.dead || w.knight || w.mode !== 'settle' || w.age < 3) continue;
    for (const s of G.setts) {
      if (s.team === w.team && s.id !== w.home && (s.occ || 0) < Math.min(4, s.level) &&
          Math.abs(s.tx + 0.5 - w.x) < 0.6 && Math.abs(s.ty + 0.5 - w.y) < 0.6) {
        s.occ = Math.min(8, (s.occ || 0) + 1);
        w.dead = true;
        break;
      }
    }
  }
  G.walkers = G.walkers.filter(w => !w.dead);
  // fights: opposing walkers on the same tile
  for (let i = 0; i < G.walkers.length; i++) {
    const a = G.walkers[i];
    if (a.dead) continue;
    for (let j = i + 1; j < G.walkers.length; j++) {
      const b = G.walkers[j];
      if (b.dead || a.team === b.team) continue;
      if (Math.abs(a.x - b.x) < 0.7 && Math.abs(a.y - b.y) < 0.7) {
        const pa = a.knight ? 4 : 1, pb = b.knight ? 4 : 1;
        a.str -= 22 * pb * dt; b.str -= 22 * pa * dt;
        a.fightT = b.fightT = 0.3;
        if (G.tick % 18 === 0) SFX.fight();
        if (a.str <= 0) { killWalker(a); SFX.die(); }
        if (b.str <= 0) { killWalker(b); SFX.die(); }
      }
    }
  }
  // knights raze settlements they reach
  const burned = new Set();
  for (const w of G.walkers) {
    if (w.dead || !w.knight) continue;
    for (const s of G.setts) {
      if (s.team !== w.team && Math.abs(s.tx + 0.5 - w.x) < 1 && Math.abs(s.ty + 0.5 - w.y) < 1) {
        s.burnT += dt;
        burned.add(s);
        if (s.burnT > 1.2) { collapseSett(s); addBurst(w.x, w.y, '#ffd12a', 14); }
      }
    }
  }
  for (const s of G.setts) if (!burned.has(s) && s.burnT > 0) s.burnT = Math.max(0, s.burnT - dt);
  G.walkers = G.walkers.filter(w => !w.dead);

  // swamps swallow anyone — and persist until the land itself is changed (canon)
  for (const sw of [...G.swamps]) {
    for (const w of G.walkers) {
      if (Math.floor(w.x) === sw.tx && Math.floor(w.y) === sw.ty) {
        killWalker(w, 'sink'); SFX.die();
        sw.kills++;
      }
    }
    const h = hAt(sw.tx, sw.ty);
    if (h <= G.water || h !== hAt(sw.tx + 1, sw.ty) || h !== hAt(sw.tx, sw.ty + 1) || h !== hAt(sw.tx + 1, sw.ty + 1)) {
      G.swamps.splice(G.swamps.indexOf(sw), 1);   // raised or drowned away
    }
  }
  G.walkers = G.walkers.filter(w => !w.dead);
  // volcanic rock glitters with embers
  if (G.tick % 24 === 0 && G.poison.size) {
    let n3 = 0;
    for (const k2 of G.poison.keys()) {
      if (n3++ > 2) break;
      const px3 = k2 % N, py3 = (k2 / N) | 0;
      G.parts.push({ kind: 'chip', x: px3 + rng(0, 1), y: py3 + rng(0, 1), vx: 0, vy: 0, z: 2, vz: rng(25, 55), color: '#ff8c42', life: rng(0.5, 1), t: 0 });
    }
  }

  // knights leave a burning wake
  if (G.tick % 5 === 0) for (const w of G.walkers) {
    if (w.knight) G.parts.push({ kind: 'chip', x: w.x, y: w.y, vx: 0, vy: 0, z: 3, vz: 8, color: '#ffd12a', life: 0.45, t: 0 });
  }
  // crown the eldest: the leader wears the ankh
  for (const t of [0, 1]) {
    const l = leaderOf(t);
    G.leaderId[t] = l ? l.id : 0;
  }
  // AI god
  G.aiT += dt;
  if (G.aiT > 0.5) { G.aiT = 0; godPolicy(1, G.aiStyle || 'full'); if (G.botPlays) godPolicy(0, G.botStyle); }

  // telemetry
  if (G.tick % 90 === 0) {
    G.stats.t.push(Math.round(G.time));
    G.stats.pop[0].push(totalPop(0));
    G.stats.pop[1].push(totalPop(1));
  }

  // end conditions
  const p0 = totalPop(0), p1 = totalPop(1);
  if (G.time > 8 && (p0 === 0 || p1 === 0)) {
    G.mode = p1 === 0 ? 'won' : 'lost';
    G.modeT = 0;
    (p1 === 0 ? SFX.win : SFX.fail)();
  }
  tickFX(dt);
}
function countPop(team) { return G.walkers.filter(w => w.team === team).length + G.setts.filter(s => s.team === team).length; }
function totalPop(team) {
  // the census counts everyone: strong merged walkers, building levels, and the housed
  let p = 0;
  for (const w of G.walkers) if (w.team === team) p += Math.max(1, Math.round(w.str / 30));
  for (const s of G.setts) if (s.team === team) p += s.level + (s.occ || 0);
  return p;
}

function stepWalker(w, dt) {
  const speed = w.knight ? 2.6 : 1.7;
  let goal = null;
  if (G.armageddon || w.mode === 'armageddon') goal = [N / 2, N / 2];
  else if (w.mode === 'magnet' && G.magnet[w.team]) {
    const lead = G.walkers.find(w2 => w2.id === G.leaderId[w.team]);
    if (!lead || lead === w || w.knight) goal = G.magnet[w.team];   // the leader (and knights) walk to the magnet
    else goal = [lead.x, lead.y];                                    // the flock follows the leader
  }
  else if (w.knight) {
    // hunt nearest enemy settlement, then walkers
    let best = null, bd = 1e9;
    for (const s of G.setts) if (s.team !== w.team) { const d = Math.hypot(s.tx - w.x, s.ty - w.y); if (d < bd) { bd = d; best = [s.tx + 0.5, s.ty + 0.5]; } }
    if (!best) for (const e of G.walkers) if (e.team !== w.team && !e.dead) { const d = Math.hypot(e.x - w.x, e.y - w.y); if (d < bd) { bd = d; best = [e.x, e.y]; } }
    goal = best;
  } else {
    // settle mode: find a flat spot nearby
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (settleAt(w)) { w.dead = true; return; }
    let best = null, bd = 1e9;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 2 || y < 2 || x >= N - 3 || y >= N - 3) continue;
      if (tileFlat(x, y) < 0) continue;
      if (flatScore(x, y) < 3) continue;
      if (G.setts.some(s => Math.abs(s.tx - x) <= 1 && Math.abs(s.ty - y) <= 1)) continue;
      if (G.swamps.some(s2 => Math.abs(s2.tx - x) <= 1 && Math.abs(s2.ty - y) <= 1)) continue;   // nobody farms a bog
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
    }
    goal = best;
  }
  if (goal) {
    const dx = goal[0] - w.x, dy = goal[1] - w.y, d = Math.hypot(dx, dy);
    if (d > 0.05) {
      w.dir = Math.atan2(dy, dx);
      let nx = w.x + Math.cos(w.dir) * speed * dt;
      let ny = w.y + Math.sin(w.dir) * speed * dt;
      // walkers cannot cross water; slide along (armageddon boils the sea: everyone marches)
      if (!G.armageddon && hAt(Math.floor(nx), Math.floor(ny)) <= G.water) {
        if (hAt(Math.floor(w.x + Math.cos(w.dir) * speed * dt), Math.floor(w.y)) > G.water) ny = w.y;
        else if (hAt(Math.floor(w.x), Math.floor(ny)) > G.water) nx = w.x;
        else { nx = w.x; ny = w.y; w.dir += rng(2, 4); }
      }
      w.x = clamp(nx, 2, N - 2.5); w.y = clamp(ny, 2, N - 2.5);
    }
  } else {
    // wander the coastline of possibility
    w.wanderT -= dt;
    if (w.wanderT <= 0) { w.wanderT = rng(1, 3); w.dir += rng(-1.8, 1.8); }
    const nx = w.x + Math.cos(w.dir) * speed * 0.6 * dt;
    const ny = w.y + Math.sin(w.dir) * speed * 0.6 * dt;
    if (hAt(Math.floor(nx), Math.floor(ny)) > G.water) { w.x = clamp(nx, 2, N - 2.5); w.y = clamp(ny, 2, N - 2.5); }
    else w.dir += rng(2, 4);
  }
}

// ---------- god policy: shared by the AI opponent and the harness bots ----------
function godPolicy(team, style) {
  if (G.armageddon) return;
  style = style || 'full';
  const can = p => G.mana[team] >= POWERS[p].cost;
  const attacks = style === 'full' || style === 'noflat' || style === 'player';
  const aggro = style === 'player';    // the authored strategy: strike earlier, rally harder
  const ratio = totalPop(team) / Math.max(1, totalPop(1 - team));
  // hoarding: once the end of the world is the plan, every other purchase stops
  const fund = aggro ? POWERS.volcano.cost + POWERS.armageddon.cost + 200 : POWERS.armageddon.cost + 200;
  const hoarding = attacks && G.mana[team] < fund &&
    ((G.time > 100 && ratio > 1.35) || G.time > 380);
  if (attacks) {
    // the closer: armageddon when clearly ahead, or when the world has gone on long enough
    if (can('armageddon') && ((ratio > 1.5 && G.time > 120) || (ratio > 1.15 && G.time > 300) ||
        (G.strikeT[team] >= 0 && G.time > G.strikeT[team] + 3 && ratio > 0.9) ||
        (G.time > (aggro ? 600 : 480) && ratio >= 1.02))) { castArmageddon(team); return; }
    // the authored finisher: volcano their capital, then end the world on the ruins
    if (aggro && G.mana[team] >= POWERS.volcano.cost + POWERS.armageddon.cost) {
      const ck = biggestCluster(1 - team);
      if (ck && influence(team, ck[0], ck[1])) {
        if (castVolcano(team, ck[0], ck[1])) { G.strikeT[team] = G.time; return; }
      }
    }
    if (G.mana[team] > (aggro ? 1200 : 1800)) {   // the war chest and the apocalypse fund are separate budgets
      if (can('knight') && totalPop(team) > (aggro ? 10 : 14) && !G.walkers.some(w => w.team === team && w.knight)) { castKnight(team); return; }
      const c = biggestCluster(1 - team);
      if (can('quake') && c && G.time > (G.cool.quake[team] || 0) && influence(team, c[0], c[1])) { G.cool.quake[team] = G.time + 30; castQuake(team, c[0], c[1]); return; }
      const e = nearestEnemyFlat(team);
      if (can('swamp') && e && G.time > (G.cool.swamp[team] || 0)) { G.cool.swamp[team] = G.time + 12; castSwamp(team, e[0], e[1]); return; }
      // volcano the enemy heartland when rich — but not more than once a minute
      if (G.mana[team] > POWERS.volcano.cost + 400 && G.time > (G.cool.volcano[team] || 0)) {
        const c3 = biggestCluster(1 - team);
        if (c3 && influence(team, c3[0], c3[1])) { G.cool.volcano[team] = G.time + 60; castVolcano(team, c3[0], c3[1]); return; }
      }
      // flood when holding the high ground
      if (G.mana[team] > POWERS.flood.cost + 600 && G.water < 3) {
        const alt = t2 => {
          const xs = [...G.walkers.filter(w => w.team === t2).map(w => hAt(Math.floor(w.x), Math.floor(w.y))),
                      ...G.setts.filter(s => s.team === t2).map(s => s.h)];
          return xs.length ? xs.reduce((a2, b2) => a2 + b2, 0) / xs.length : 0;
        };
        if (alt(team) > alt(1 - team) + 1.2) { castFlood(team); return; }
      }
    }
  }
  // the magnet as a weapon: rally the horde at the enemy when strong (canon CPU god shoves its magnet constantly)
  if (attacks && (team === 1 || aggro)) {
    if (G.aiDecree === undefined) G.aiDecree = [0, 0];
    G.aiDecree[team] -= 0.5;
    if (G.aiDecree[team] <= 0) {
      G.aiDecree[team] = aggro ? 30 : 40;
      if (ratio > (aggro ? 1.2 : 1.25) || (aggro && G.mana[team] > 3000)) {
        const c2 = biggestCluster(1 - team);
        if (c2) {
          G.magnet[team] = [c2[0] + 0.5, c2[1] + 0.5];
          for (const w of G.walkers) if (w.team === team && !w.knight) w.mode = 'magnet';
        }
      } else {
        G.magnet[team] = null;
        for (const w of G.walkers) if (w.team === team && !w.knight) w.mode = 'settle';
      }
    }
  }
  // the economy: flatten land for the faithful — unless the apocalypse fund comes first
  if (style !== 'noflat' && !hoarding && can('raise')) {
    const target = findFlattenTarget(team) || findPlateauTarget(team);
    if (target) castRaise(team, target[0], target[1], target[2]);
  }
}
function flatDelta(vx2, vy2, dir2) {
  // simulate the vertex move: net change in flat tiles among the four it touches
  const tiles = [[vx2 - 1, vy2 - 1], [vx2, vy2 - 1], [vx2 - 1, vy2], [vx2, vy2]];
  const count = () => tiles.reduce((a2, [ox, oy]) => a2 + (tileFlat(ox, oy) >= 0 ? 1 : 0), 0);
  const i2 = vy2 * N + vx2;
  const before = count();
  const old = G.H[i2];
  G.H[i2] = clamp(old + dir2, 0, HMAX);
  const after = count();
  G.H[i2] = old;
  return after - before;
}
function findFlattenTarget(team) {
  // scan tiles near own walkers/settlements: a tile one-vertex-off flat is a cheap farm
  let best = null, bestGain = 0;
  const anchors = [];
  for (const s of G.setts) if (s.team === team) anchors.push([s.tx, s.ty]);
  for (const w of G.walkers) if (w.team === team && !w.knight) anchors.push([Math.floor(w.x), Math.floor(w.y)]);
  for (const [ax, ay] of anchors) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = ax + dx, ty = ay + dy;
      if (tx < 3 || ty < 3 || tx >= N - 4 || ty >= N - 4) continue;
      if (tileFlat(tx, ty) >= 0) continue;
      // corner heights
      const hs = [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]].map(([x, y]) => hAt(x, y));
      const target = Math.round((hs[0] + hs[1] + hs[2] + hs[3]) / 4) || 1;
      if (target <= G.water) continue;
      // pick the corner farthest from the plan
      let vi = -1, vd = 0;
      const corners = [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]];
      for (let k = 0; k < 4; k++) {
        const d = hs[k] - target;
        if (Math.abs(d) > Math.abs(vd)) { vd = d; vi = k; }
      }
      if (vi < 0) continue;
      // first, do no harm: never move a vertex that holds up a roof
      const [cvx2, cvy2] = corners[vi];
      let harms = false;
      for (const [ox, oy] of [[cvx2 - 1, cvy2 - 1], [cvx2, cvy2 - 1], [cvx2 - 1, cvy2], [cvx2, cvy2]]) {
        if (G.setts.some(s2 => s2.tx === ox && s2.ty === oy)) { harms = true; break; }
      }
      if (harms) continue;
      const dir3 = vd > 0 ? -1 : 1;
      if (flatDelta(cvx2, cvy2, dir3) < 0) continue;   // never trade farmland away
      const gain = 10 - Math.abs(vd) - (Math.abs(dx) + Math.abs(dy)) * 0.4;
      if (gain > bestGain && influence(team, cvx2, cvy2)) {
        bestGain = gain;
        best = [cvx2, cvy2, vd > 0 ? -1 : 1];
      }
    }
  }
  return best;
}
function findPlateauTarget(team) {
  // the engineer's strategy: extend the home plateau one vertex at a time
  const own = G.setts.filter(s => s.team === team);
  if (!own.length) return null;
  const counts = {};
  for (const s of own) counts[s.h] = (counts[s.h] || 0) + s.level;
  const ph = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
  let best = null, bestScore = -1e9;
  for (const s of own) {
    if (s.h !== ph) continue;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const vx = s.tx + dx, vy = s.ty + dy;
      if (vx < 3 || vy < 3 || vx >= N - 3 || vy >= N - 3) continue;
      const h = hAt(vx, vy);
      if (h === ph || h <= G.water - 1) continue;
      // must border the plateau: a ph-flat tile within two steps of this vertex
      let touches = false;
      for (let oy = vy - 2; oy <= vy + 1 && !touches; oy++)
        for (let ox = vx - 2; ox <= vx + 1; ox++)
          if (tileFlat(ox, oy) === ph) { touches = true; break; }
      if (!touches) continue;
      // never move a vertex under a roof
      let roof = false;
      for (const [ox, oy] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]]) {
        if (G.setts.some(s2 => s2.tx === ox && s2.ty === oy)) { roof = true; break; }
      }
      if (roof) continue;
      const dir = h < ph ? 1 : -1;
      if (flatDelta(vx, vy, dir) < 0) continue;
      if (!influence(team, vx, vy)) continue;
      const score = 20 - Math.abs(h - ph) * 2 - (Math.abs(dx) + Math.abs(dy)) * 0.5;
      if (score > bestScore) { bestScore = score; best = [vx, vy, dir]; }
    }
  }
  return best;
}
function biggestCluster(team) {
  let best = null, bn = 2;
  for (const s of G.setts) {
    if (s.team !== team) continue;
    let n = 0;
    for (const o of G.setts) if (o.team === team && Math.abs(o.tx - s.tx) + Math.abs(o.ty - s.ty) < 6) n++;
    if (n > bn) { bn = n; best = [s.tx, s.ty]; }
  }
  return best;
}
function nearestEnemyFlat(team) {
  let best = null, bd = 1e9;
  for (const s of G.setts) {
    if (s.team === team) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const tx = s.tx + dx, ty = s.ty + dy;
      if (tileFlat(tx, ty) < 0) continue;
      if (G.setts.some(o => o.tx === tx && o.ty === ty)) continue;
      if (G.swamps.some(o => o.tx === tx && o.ty === ty)) continue;
      if (!influence(team, tx, ty)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bd) { bd = d; best = [tx, ty]; }
    }
  }
  return best;
}

// ---------- fx ----------
function addBurst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rng(0, 6.28), s = rng(0.6, 2.4);
    G.parts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      z: rng(2, 10), vz: rng(40, 110), color, life: rng(0.4, 0.9), t: 0, kind: 'chip',
    });
  }
}
function addRing(x, y, color) { G.parts.push({ x, y, r: 4, color, life: 0.5, t: 0, kind: 'ring' }); }
function addPop(x, y, txt, color) { G.pops.push({ x, y, txt, color, t: 0, life: 1.0 }); }
function tickFX(dt) {
  if (G.shake > 0) G.shake = Math.max(0, G.shake - 22 * dt);
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt;
    if (p.t >= p.life) { G.parts.splice(i, 1); continue; }
    if (p.kind === 'chip') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= 260 * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.35; }
    } else if (p.kind === 'ring') p.r += 60 * dt;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) { const o = G.pops[i]; o.t += dt; if (o.t >= o.life) G.pops.splice(i, 1); }
  for (const s of G.setts) if (s.growT > 0) s.growT = Math.max(0, s.growT - dt);
  if (G.toast) G.toast.t += dt;
  G.manaFlashT = Math.max(0, (G.manaFlashT || 0) - dt);
  // camera keys
  const cs = 320 * dt;
  if (keys.a || keys.ArrowLeft) G.cam.x -= cs;
  if (keys.d || keys.ArrowRight) G.cam.x += cs;
  if (keys.w || keys.ArrowUp) G.cam.y -= cs;
  if (keys.s || keys.ArrowDown) G.cam.y += cs;
}

// ---------- rendering ----------
const VIGNETTE = (() => {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,8,0.5)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
})();
function worldToScreen(gx, gy, h) {
  return [isoX(gx, gy) - G.cam.x + VW / 2, isoY(gx, gy, h) - G.cam.y];
}
function tileTeamTint(tx, ty) {
  // nearest influence colors the land
  let bd = 81, team = -1;
  for (const s of G.setts) {
    const d = (s.tx - tx) * (s.tx - tx) + (s.ty - ty) * (s.ty - ty);
    if (d < bd) { bd = d; team = s.team; }
  }
  if (team < 0) return null;
  return [team, 1 - Math.sqrt(bd) / 9];
}
function draw() {
  if (G.showTitle) { drawTitle(); return; }
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MQ, VW, VH); ctx.clip();
  ctx.translate(0, MQ);
  // deep sky
  const bg = ctx.createLinearGradient(0, 0, 0, VH);
  bg.addColorStop(0, '#0a0c18'); bg.addColorStop(0.5, '#07080f'); bg.addColorStop(1, '#04050a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VW, VH);
  srand(999);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(200,220,255,${rng(0.04, 0.18)})`;
    ctx.fillRect(rng(0, VW) | 0, rng(0, VH) | 0, 2, 2);
  }
  if (G.shake > 0) ctx.translate(Math.sin(G.time * 43) * G.shake, Math.cos(G.time * 57) * G.shake * 0.5);

  // terrain tiles back-to-front
  for (let sum = 0; sum <= (N - 2) * 2; sum++) {
    for (let tx = Math.max(0, sum - (N - 2)); tx <= Math.min(N - 2, sum); tx++) {
      const ty = sum - tx;
      drawTile(tx, ty);
    }
  }
  // swamps
  for (const sw of G.swamps) drawSwamp(sw);
  // settlements + walkers, painter order by (tx+ty)
  const ents = [];
  for (const s of G.setts) ents.push({ z: s.tx + s.ty + 1, kind: 's', o: s });
  for (const w of G.walkers) ents.push({ z: w.x + w.y, kind: 'w', o: w });
  ents.sort((a, b) => a.z - b.z);
  for (const e of ents) e.kind === 's' ? drawSett(e.o) : drawWalker(e.o);
  // armageddon: the sky bleeds and a beacon calls everyone home
  if (G.armageddon) {
    const [bx2, by2] = worldToScreen(N / 2, N / 2, hVisAt(N >> 1, N >> 1));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(bx2, by2 - VH, bx2, by2);
    beam.addColorStop(0, 'rgba(255,60,80,0)');
    beam.addColorStop(0.7, `rgba(255,70,90,${0.16 + Math.sin(G.time * 4) * 0.06})`);
    beam.addColorStop(1, `rgba(255,120,140,${0.35 + Math.sin(G.time * 4) * 0.1})`);
    ctx.fillStyle = beam;
    const bw3 = 26 + Math.sin(G.time * 3) * 5;
    ctx.fillRect(bx2 - bw3 / 2, by2 - VH, bw3, VH);
    ctx.beginPath(); ctx.ellipse(bx2, by2, 30, 13, 0, 0, 7);
    ctx.fillStyle = `rgba(255,90,110,${0.25 + Math.sin(G.time * 5) * 0.1})`;
    ctx.fill();
    ctx.restore();
  }
  // magnets
  for (const t of [0, 1]) if (G.magnet[t]) drawMagnet(t);
  // cursor
  if (!G.attract) drawCursor();
  // particles
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    const k = 1 - p.t / p.life;
    const [sx, sy] = worldToScreen(p.x, p.y, Math.max(hVisAt(Math.floor(p.x), Math.floor(p.y)), G.waterVis));
    if (p.kind === 'chip') {
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - 1.5, sy - 1.5 - (p.z || 0), 3, 3);
    } else if (p.kind === 'sink') {
      // swallowed: the body slides under the bog
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.roundRect(sx - 2, sy - 8 * k, 4, 8 * k, 1.5); ctx.fill();
      ctx.fillStyle = hexA('#5aff9e', 0.5);
      ctx.beginPath(); ctx.ellipse(sx, sy, 6, 2.5, 0, 0, 7); ctx.fill();
    } else {
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, p.r * 2, p.r, 0, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  for (const o of G.pops) {
    const k = 1 - o.t / o.life;
    const [sx, sy] = worldToScreen(o.x, o.y, 6);
    ctx.globalAlpha = k;
    ctx.font = `800 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = o.color;
    ctx.fillText(o.txt, sx, sy - o.t * 26);
  }
  ctx.globalAlpha = 1;
  if (G.armageddon) {
    ctx.fillStyle = `rgba(255,30,50,${Math.min(0.16, 0.06 + G.argT * 0.01) + Math.sin(G.time * 2) * 0.02})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  ctx.restore();

  drawTopBar();
  drawHUD();
  if (G.mode === 'won' || G.mode === 'lost') {
    ctx.fillStyle = 'rgba(4,5,10,0.55)';
    ctx.fillRect(0, MQ, W, VH);
    const min2 = Math.floor(G.time / 60), sec2 = Math.floor(G.time % 60);
    const pc = G.stats.powers[0];
    const used = POWER_ORDER.filter(p => pc[p]).map(p => `${p.toUpperCase()} ×${pc[p]}`).join(' · ') || 'NO POWERS CAST';
    if (G.mode === 'won') {
      banner('DOMINION', TEAM[0].col, `THE OTHER GOD IS FORGOTTEN · ${min2}:${String(sec2).padStart(2, '0')} · PEAK POP ${Math.max(...G.stats.pop[0], 1)}`);
      bannerButton(TOUCH ? 'NEW WORLD  ·  TAP' : 'NEW WORLD  ·  SPACE', TEAM[0].col);
    } else {
      banner('FORGOTTEN', TEAM[1].col, `YOUR LAST WORSHIPPER FELL · ${min2}:${String(sec2).padStart(2, '0')} · PEAK POP ${Math.max(...G.stats.pop[0], 1)}`);
      bannerButton(TOUCH ? 'NEW WORLD  ·  TAP' : 'NEW WORLD  ·  SPACE', TEAM[1].col);
    }
    ctx.font = `700 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(180,205,235,0.8)';
    ctx.fillText(used, W / 2, H / 2 + 56);
  }
  ctx.drawImage(VIGNETTE, 0, 0);
}
function drawTile(tx, ty) {
  const H00 = hAt(tx, ty), H10 = hAt(tx + 1, ty), H01 = hAt(tx, ty + 1), H11 = hAt(tx + 1, ty + 1);
  const h00 = hVisAt(tx, ty), h10 = hVisAt(tx + 1, ty), h01 = hVisAt(tx, ty + 1), h11 = hVisAt(tx + 1, ty + 1);
  const water = H00 <= G.water && H10 <= G.water && H01 <= G.water && H11 <= G.water;
  const wv = G.waterVis;
  const [x0, y0] = worldToScreen(tx, ty, water ? wv : h00);
  const [x1, y1] = worldToScreen(tx + 1, ty, water ? wv : h10);
  const [x2, y2] = worldToScreen(tx + 1, ty + 1, water ? wv : h11);
  const [x3, y3] = worldToScreen(tx, ty + 1, water ? wv : h01);
  if (Math.max(x0, x1, x2, x3) < -40 || Math.min(x0, x1, x2, x3) > VW + 40) return;
  if (Math.max(y0, y1, y2, y3) < -60 || Math.min(y0, y1, y2, y3) > VH + 60) return;
  if (water) {
    // the ocean has depth: darker as it leaves the coast, with a breathing shore band
    const cd = G.coast ? G.coast[ty * N + tx] : 9;
    const k2 = Math.max(0, 1 - cd / 5);
    const wave = Math.sin(G.time * 1.4 + (tx + ty) * 0.7) * 0.5 + 0.5;
    ctx.fillStyle = `rgb(${6 + k2 * 14 | 0},${10 + k2 * (26 + wave * 8) | 0},${20 + k2 * (46 + wave * 10) | 0})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
    if (cd === 1) {
      ctx.strokeStyle = hexA('#6e86c8', 0.12 + wave * 0.12);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return;
  }
  const avg = (h00 + h10 + h01 + h11) / 4;
  const slope = Math.max(H00, H10, H01, H11) - Math.min(H00, H10, H01, H11);
  const flat = slope === 0;
  const poisoned = G.poison.has(ty * N + tx);
  // one sun, from the north-west: facets facing it brighten, away-facets fall dark
  const nx2 = (h00 + h01 - h10 - h11) * 0.5;   // slope toward +x
  const ny2 = (h00 + h10 - h01 - h11) * 0.5;   // slope toward +y
  let lum = 0.15 + avg * 0.035 + nx2 * 0.09 + ny2 * 0.055;
  lum = clamp(lum, 0.05, 0.85);
  let r = 30 + lum * 105, g = 38 + lum * 118, b = 56 + lum * 138;
  if (poisoned) {
    const ember = 0.5 + Math.sin(G.time * 3 + tx * 2 + ty) * 0.3;
    r = 40 + lum * 60 + ember * 26; g = 26 + lum * 40; b = 24 + lum * 40;
  } else {
    const tint = tileTeamTint(tx, ty);
    if (tint) {
      const [team, k] = tint;
      const tc = team === 0 ? [40, 160, 200] : [200, 40, 90];
      r += (tc[0] - r) * k * 0.35; g += (tc[1] - g) * k * 0.35; b += (tc[2] - b) * k * 0.35;
    }
  }
  ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
  if (flat && !poisoned) {
    ctx.strokeStyle = 'rgba(110,125,175,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // cliff faces: darken the drop and rim the edge
  if (slope >= 2) {
    ctx.fillStyle = `rgba(0,0,10,${Math.min(0.35, slope * 0.09)})`;
    ctx.fill();
    ctx.strokeStyle = hexA('#5a6da8', 0.14 + slope * 0.05);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x2, y2); ctx.lineTo(x1, y1); ctx.stroke();
  }
  const coast = H00 <= G.water || H10 <= G.water || H01 <= G.water || H11 <= G.water;
  if (coast) {
    ctx.strokeStyle = hexA('#5f79c2', 0.28 + Math.sin(G.time * 2 + tx + ty) * 0.08);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.stroke();
  }
}
function drawSwamp(sw) {
  const [sx, sy] = worldToScreen(sw.tx + 0.5, sw.ty + 0.5, Math.max(hVisAt(sw.tx, sw.ty), G.waterVis));
  ctx.save();
  const pulse = 0.5 + Math.sin(G.time * 3 + sw.tx) * 0.25;
  // the bog owns its whole tile
  ctx.fillStyle = hexA('#0d2418', 0.85);
  ctx.beginPath(); ctx.ellipse(sx, sy, TW * 0.52, TH * 0.55, 0, 0, 7); ctx.fill();
  ctx.fillStyle = hexA('#5aff9e', 0.1 + pulse * 0.12);
  ctx.strokeStyle = hexA('#5aff9e', 0.55 + pulse * 0.3);
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(sx, sy, TW * 0.5, TH * 0.52, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const bx = sx + Math.sin(G.time * 1.7 + i * 2.1 + sw.ty) * (4 + i * 2);
    const by = sy - ((G.time * (7 + i * 2) + i * 7) % 16);
    ctx.fillStyle = hexA('#5aff9e', 0.5 * (1 - ((G.time * (7 + i * 2) + i * 7) % 16) / 16));
    ctx.fillRect(bx, by, 2, 2);
  }
  ctx.restore();
}
function drawSett(s) {
  const [sx, sy] = worldToScreen(s.tx + 0.5, s.ty + 0.5, hVisAt(s.tx, s.ty));
  const c = TEAM[s.team].col;
  const lv = s.level;
  const wpx = 8 + lv * 1.6, hpx = 6 + lv * 3.4;
  ctx.save();
  if (s.growT > 0) { const g2 = 1 + s.growT * 0.6; ctx.translate(sx, sy); ctx.scale(g2, g2); ctx.translate(-sx, -sy); }
  // contact shadow: the building sits on its ground
  ctx.fillStyle = 'rgba(0,0,8,0.5)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 1, wpx + 4, (wpx + 4) / 2.1, 0, 0, 7); ctx.fill();
  // ground glow pool
  ctx.globalCompositeOperation = 'lighter';
  const gp = ctx.createRadialGradient(sx, sy, 0, sx, sy, 26 + lv * 3);
  gp.addColorStop(0, hexA(c, 0.14)); gp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gp;
  ctx.beginPath(); ctx.ellipse(sx, sy, 26 + lv * 3, (26 + lv * 3) / 2, 0, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // building: stacked prisms, more mass per level
  const stories = Math.ceil(lv / 3);
  for (let i = 0; i < stories; i++) {
    const wc = wpx * (1 - i * 0.22), hh = hpx / stories;
    const by = sy - i * hh;
    // left face / right face / top
    ctx.fillStyle = shade(TEAM[s.team].dim, -0.15 - i * 0.06);
    ctx.beginPath(); ctx.moveTo(sx - wc, by - hh * 0.4); ctx.lineTo(sx, by); ctx.lineTo(sx, by - hh); ctx.lineTo(sx - wc, by - hh * 1.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(TEAM[s.team].dim, 0.05 + i * 0.05);
    ctx.beginPath(); ctx.moveTo(sx + wc, by - hh * 0.4); ctx.lineTo(sx, by); ctx.lineTo(sx, by - hh); ctx.lineTo(sx + wc, by - hh * 1.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(TEAM[s.team].dim, 0.25 + i * 0.06);
    ctx.beginPath(); ctx.moveTo(sx, by - hh); ctx.lineTo(sx + wc, by - hh * 1.4); ctx.lineTo(sx, by - hh * 1.8); ctx.lineTo(sx - wc, by - hh * 1.4); ctx.closePath(); ctx.fill();
  }
  // neon roof rim + beacon for the big ones
  ctx.strokeStyle = c; ctx.lineWidth = 1.4;
  ctx.save();
  ctx.shadowColor = c; ctx.shadowBlur = 8;
  const topY = sy - hpx * 0.4 - hpx;
  ctx.beginPath(); ctx.moveTo(sx - wpx * (1 - (stories - 1) * 0.22), sy - (stories - 1) * (hpx / stories) - (hpx / stories) * 1.4);
  ctx.lineTo(sx, sy - (stories - 1) * (hpx / stories) - (hpx / stories) * 1.8);
  ctx.lineTo(sx + wpx * (1 - (stories - 1) * 0.22), sy - (stories - 1) * (hpx / stories) - (hpx / stories) * 1.4);
  ctx.stroke();
  if (lv >= 7) {
    const bk = 0.5 + Math.sin(G.time * 5 + s.id) * 0.5;
    ctx.fillStyle = hexA('#ffffff', bk);
    ctx.fillRect(sx - 1, topY - 6, 2, 4);
  }
  ctx.restore();
  // burn state
  if (s.burnT > 0) {
    ctx.fillStyle = hexA('#ffd12a', 0.5 + Math.sin(G.time * 20) * 0.3);
    ctx.beginPath(); ctx.ellipse(sx, sy - hpx, 6, 9, 0, 0, 7); ctx.fill();
  }
  // window glow: occupancy made visible — no debug digits
  const rows = Math.min(3, Math.ceil(lv / 3)), cols = Math.min(4, Math.ceil(lv / 2));
  ctx.fillStyle = hexA(c, 0.75 + (s.growT > 0 ? 0.25 : 0));
  for (let ry = 0; ry < rows; ry++) for (let cx2 = 0; cx2 < cols; cx2++) {
    if ((s.id + ry * 3 + cx2) % 5 === 0) continue;   // some windows dark
    ctx.fillRect(sx - wpx * 0.5 + 3 + cx2 * 5, sy - 5 - ry * (hpx / (rows + 1)) - hpx * 0.35, 1.6, 2.4);
  }
  // digit only under the god's cursor
  if (!G.attract && Math.abs(G.cursor.vx - s.tx) <= 1 && Math.abs(G.cursor.vy - s.ty) <= 1) {
    ctx.font = `800 10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('LVL ' + lv + (s.occ ? ' +' + s.occ : ''), sx, sy + 12);
  }
  ctx.restore();
}
function drawWalker(w) {
  const h = Math.max(hVisAt(Math.floor(w.x), Math.floor(w.y)), G.waterVis + 0.01);
  const [sx, sy] = worldToScreen(w.x, w.y, h);
  const c = w.knight ? '#ffd12a' : TEAM[w.team].col;
  const scale = w.knight ? 1.7 : 1;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,10,0.6)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 0.5, 4.5 * scale, 2 * scale, 0, 0, 7); ctx.fill();
  ctx.translate(sx, sy); ctx.scale(scale, scale); ctx.translate(-sx, -sy);
  ctx.globalCompositeOperation = 'lighter';
  const gp = ctx.createRadialGradient(sx, sy - 4, 0, sx, sy - 4, 12);
  gp.addColorStop(0, hexA(c, 0.3)); gp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gp;
  ctx.beginPath(); ctx.arc(sx, sy - 4, 12, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  const bob = Math.abs(Math.sin(w.age * 9 + w.id)) * 1.5;
  // body
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.roundRect(sx - 2, sy - 8 - bob, 4, 6, 1.5); ctx.fill();
  ctx.fillStyle = '#e8f4ff';
  ctx.beginPath(); ctx.arc(sx, sy - 10 - bob, 2.2, 0, 7); ctx.fill();
  if (w.knight) {
    // pennant, cape, and a gold ground ring: the hero reads at any zoom
    ctx.strokeStyle = '#ffd12a'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx + 3, sy - 12 - bob); ctx.lineTo(sx + 6, sy - 16 - bob); ctx.stroke();
    ctx.fillStyle = hexA('#ffd12a', 0.5);
    ctx.beginPath(); ctx.moveTo(sx - 2, sy - 8 - bob); ctx.lineTo(sx - 6, sy - 2); ctx.lineTo(sx - 2, sy - 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = hexA('#ffd12a', 0.6 + Math.sin(G.time * 5) * 0.25);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(sx, sy + 0.5, 8, 3.6, 0, 0, 7); ctx.stroke();
  }
  if (w.id === G.leaderId[w.team] && !w.knight) {
    // the ankh: the leader is sacred
    const ay = sy - 16 - bob + Math.sin(G.time * 3 + w.id) * 1.2;
    ctx.save();
    ctx.strokeStyle = TEAM[w.team].col; ctx.lineWidth = 1.4;
    ctx.shadowColor = TEAM[w.team].col; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(sx, ay - 2.5, 2, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, ay - 0.5); ctx.lineTo(sx, ay + 4); ctx.moveTo(sx - 2.5, ay + 1); ctx.lineTo(sx + 2.5, ay + 1); ctx.stroke();
    ctx.restore();
  }
  if (w.fightT > 0) {
    ctx.strokeStyle = hexA('#ffffff', 0.7);
    ctx.beginPath(); ctx.arc(sx, sy - 8, 6 + Math.sin(G.time * 30) * 2, 0, 7); ctx.stroke();
  }
  ctx.restore();
}
function drawMagnet(t) {
  const [mx, my] = G.magnet[t];
  const h = Math.max(hVisAt(Math.floor(mx), Math.floor(my)), G.waterVis);
  const [sx, sy] = worldToScreen(mx, my, h);
  const c = TEAM[t].col;
  ctx.save();
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.shadowColor = c; ctx.shadowBlur = 10;
  const bob2 = Math.sin(G.time * 3 + t) * 2;
  ctx.beginPath(); ctx.arc(sx, sy - 18 + bob2, 5, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx, sy - 13 + bob2); ctx.lineTo(sx, sy - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx - 5, sy - 8 + bob2); ctx.lineTo(sx + 5, sy - 8 + bob2); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = hexA(c, 0.12 + Math.sin(G.time * 4) * 0.05);
  ctx.beginPath(); ctx.ellipse(sx, sy, 14, 7, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawCursor() {
  const { vx, vy } = G.cursor;
  const [sx, sy] = worldToScreen(vx, vy, hVisAt(vx, vy));
  const ok = influence(0, vx, vy);
  const c = ok ? '#ffffff' : '#556677';
  ctx.save();
  ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  if (ok) { ctx.shadowColor = TEAM[0].col; ctx.shadowBlur = 8; }
  const r = 6 + Math.sin(G.time * 6) * 1.5;
  ctx.beginPath(); ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy); ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r, sy); ctx.closePath(); ctx.stroke();
  ctx.restore();
}

// ---------- chrome ----------
function label(txt, x, HY) {
  ctx.font = '700 10px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(140,175,210,0.75)';
  ctx.fillText(txt, x, HY + 30);
  ctx.letterSpacing = '0px';
}
function drawTopBar() {
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, W, MQ);
  ctx.fillStyle = 'rgba(200,220,240,0.4)';
  ctx.fillRect(0, MQ - 1.5, W, 1.5);
  ctx.font = '700 13px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'left';
  ctx.fillStyle = TEAM[0].col;
  ctx.fillText(`POP ${totalPop(0)}`, 26, 25);
  ctx.fillStyle = 'rgba(190,215,240,0.9)';
  const min = Math.floor(G.time / 60), sec = Math.floor(G.time % 60);
  ctx.textAlign = 'center';
  ctx.letterSpacing = '3px';
  ctx.fillText(G.mode === 'won' ? 'DOMINION' : G.mode === 'lost' ? 'FORGOTTEN' : G.armageddon ? 'ARMAGEDDON' : `WORLD ${String(G.seed).slice(-4)} · ${min}:${String(sec).padStart(2, '0')}`, W / 2, 25);
  ctx.textAlign = 'right';
  ctx.fillStyle = TEAM[1].col;
  ctx.fillText(`POP ${totalPop(1)}`, W - 26, 25);
  ctx.letterSpacing = '0px';
  if (G.hintT > 0 && !G.attract && G.mode === 'play') {
    const HINTS = [
      'RAISE AND LOWER LAND NEAR YOUR PEOPLE · FLAT LAND GROWS SETTLEMENTS · SETTLEMENTS GROW MANA',
      'WIPE OUT THE OTHER GOD\'S PEOPLE TO WIN · ARMAGEDDON IS THE FINAL CENSUS',
      (TOUCH ? 'HOLD THE MAP TO PLACE THE MAGNET' : 'RIGHT-CLICK PLACES THE MAGNET') + ' · YOUR LEADER WALKS TO IT · THE FLOCK FOLLOWS THE LEADER',
    ];
    ctx.globalAlpha = Math.min(1, G.hintT);
    ctx.font = '600 12px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,232,255,0.9)';
    ctx.fillText(HINTS[Math.floor(G.time / 8) % HINTS.length], W / 2, MQ + 22);
    ctx.globalAlpha = 1;
  }
}
const POWER_ORDER = ['raise', 'lower', 'swamp', 'quake', 'knight', 'volcano', 'flood', 'armageddon'];
const POWER_GLYPH = {
  raise: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 7, y + 5); ctx.lineTo(x, y - 6); ctx.lineTo(x + 7, y + 5); ctx.closePath(); ctx.stroke(); },
  lower: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 7, y - 5); ctx.lineTo(x, y + 6); ctx.lineTo(x + 7, y - 5); ctx.closePath(); ctx.stroke(); },
  swamp: (x, y) => { ctx.beginPath(); ctx.ellipse(x, y + 2, 7, 4, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x - 2, y - 3, 1.5, 0, 7); ctx.arc(x + 3, y - 1, 1.2, 0, 7); ctx.stroke(); },
  quake: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 8, y + 4); ctx.lineTo(x - 3, y - 2); ctx.lineTo(x, y + 3); ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 8, y + 2); ctx.stroke(); },
  knight: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 4, y + 6); ctx.lineTo(x - 4, y - 3); ctx.lineTo(x, y - 7); ctx.lineTo(x + 4, y - 3); ctx.lineTo(x + 4, y + 6); ctx.closePath(); ctx.stroke(); },
  volcano: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 8, y + 5); ctx.lineTo(x - 2, y - 5); ctx.moveTo(x + 2, y - 5); ctx.lineTo(x + 8, y + 5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 2, y - 5); ctx.quadraticCurveTo(x, y - 8, x + 2, y - 5); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y - 8, 1.2, 0, 7); ctx.stroke(); },
  flood: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x - 4, y - 6, x, y); ctx.quadraticCurveTo(x + 4, y + 6, x + 8, y); ctx.stroke(); },
  armageddon: (x, y) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke(); },
};
function drawHUD() {
  const HY = H - HUD_H;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, HY, W, HUD_H);
  ctx.fillStyle = 'rgba(200,220,240,0.45)';
  ctx.fillRect(0, HY, W, 1.5);
  // power chips
  let hovTip = null;
  POWER_ORDER.forEach((p, i) => {
    const bx = 18 + i * 78, by = HY + 12, bw = 70, bh = 66;
    const cost = POWERS[p].cost;
    const afford = G.mana[0] >= cost && !G.armageddon;
    const armed = G.selPower === p;
    const hov = mouse.x > bx && mouse.x < bx + bw && mouse.y > by && mouse.y < by + bh;
    if (hov) hovTip = { p, bx, by };
    if (armed && afford) {
      ctx.save();
      ctx.shadowColor = TEAM[0].col; ctx.shadowBlur = 10;
      ctx.fillStyle = hexA(TEAM[0].col, 0.26);
      ctx.strokeStyle = TEAM[0].col; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else if (armed) {
      ctx.strokeStyle = hexA(TEAM[0].col, 0.55); ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = hov && afford ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
      ctx.strokeStyle = afford ? (hov ? 'rgba(200,230,255,0.8)' : 'rgba(160,195,230,0.45)') : 'rgba(160,195,230,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = afford ? TEAM[0].col : 'rgba(160,195,230,0.35)';
    ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    POWER_GLYPH[p](bx + bw / 2, by + 18);
    ctx.font = '700 8px Verdana, sans-serif';
    ctx.letterSpacing = '0.5px';
    ctx.textAlign = 'center';
    ctx.fillStyle = afford ? 'rgba(210,232,255,0.95)' : 'rgba(160,195,230,0.4)';
    ctx.fillText(p.toUpperCase(), bx + bw / 2, by + 40);
    ctx.letterSpacing = '0px';
    if (POWERS[p].target === 'global') {
      ctx.font = '700 6.5px Verdana, sans-serif';
      ctx.fillStyle = 'rgba(160,195,230,0.55)';
      ctx.fillText('GLOBAL', bx + bw / 2, by + 63);
    }
    ctx.font = `800 12px ${MONO}`;
    ctx.fillStyle = afford ? '#ffffff' : 'rgba(200,220,245,0.45)';
    ctx.fillText(String(cost), bx + bw / 2, by + 56);
    // keycap
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(160,195,230,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx + bw - 17, by + 4, 13, 13, 3); ctx.fill(); ctx.stroke();
    ctx.font = `800 9px ${MONO}`;
    ctx.fillStyle = 'rgba(225,240,255,0.9)';
    ctx.fillText(POWERS[p].key, bx + bw - 10.5, by + 13.5);
  });
  // mana bar + behavior + magnet
  const mx0 = 652, mw0 = 180;
  label('MANA', mx0, HY);
  ctx.fillStyle = G.manaFlashT > 0 ? 'rgba(255,60,60,0.25)' : 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.roundRect(mx0, HY + 38, mw0, 12, 5); ctx.fill();
  const mk = clamp(G.mana[0] / 4000, 0, 1);
  const mg = ctx.createLinearGradient(mx0, 0, mx0 + mw0, 0);
  mg.addColorStop(0, '#1a7fa8'); mg.addColorStop(1, TEAM[0].col);
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.roundRect(mx0, HY + 38, mw0 * mk, 12, 5); ctx.fill();
  // cost ticks: every power is a notch on the bar
  for (const p of POWER_ORDER) {
    const tx3 = mx0 + mw0 * (POWERS[p].cost / 4000);
    ctx.fillStyle = G.mana[0] >= POWERS[p].cost ? 'rgba(240,250,255,0.85)' : 'rgba(160,195,230,0.35)';
    ctx.fillRect(tx3, HY + 35, 1.4, 18);
  }
  // the enemy's fund, thin and red beneath yours
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.roundRect(mx0, HY + 56, mw0, 5, 2.5); ctx.fill();
  ctx.fillStyle = G.mana[1] >= POWERS.armageddon.cost ? '#ff5c5c' : hexA(TEAM[1].col, 0.7);
  ctx.beginPath(); ctx.roundRect(mx0, HY + 56, mw0 * clamp(G.mana[1] / 4000, 0, 1), 5, 2.5); ctx.fill();
  ctx.font = `800 13px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(Math.floor(G.mana[0])), mx0, HY + 78);
  ctx.font = `700 10px ${MONO}`;
  ctx.fillStyle = G.mana[1] >= POWERS.armageddon.cost ? '#ff5c5c' : hexA(TEAM[1].col, 0.8);
  ctx.fillText(`ENEMY ${Math.floor(G.mana[1])}${G.mana[1] >= POWERS.armageddon.cost ? ' !' : ''}`, mx0 + 78, HY + 78);
  // behavior toggle
  const bhx = 876;
  label('DECREE', bhx, HY);
  ;['settle', 'magnet'].forEach((m, i) => {
    const by2 = HY + 38 + i * 26, on = G.behavior === m;
    const dead = G.armageddon || (m === 'magnet' && !G.magnet[0]);
    const hov = !dead && mouse.x > bhx && mouse.x < bhx + 128 && mouse.y > by2 && mouse.y < by2 + 22;
    ctx.fillStyle = on && !G.armageddon ? hexA(TEAM[0].col, 0.25) : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = on && !G.armageddon ? TEAM[0].col : dead ? 'rgba(160,195,230,0.18)' : 'rgba(160,195,230,0.4)';
    ctx.lineWidth = on && !G.armageddon ? 1.8 : 1;
    ctx.beginPath(); ctx.roundRect(bhx, by2, 128, 22, 5); ctx.fill(); ctx.stroke();
    ctx.font = '700 9px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'left';
    ctx.fillStyle = on && !G.armageddon ? '#ffffff' : dead ? 'rgba(160,195,230,0.4)' : 'rgba(190,215,240,0.8)';
    ctx.fillText(m === 'settle' ? 'GO SETTLE' : (G.magnet[0] ? 'TO THE MAGNET' : TOUCH ? 'HOLD MAP: PLACE MAGNET' : 'R-CLICK: PLACE MAGNET'), bhx + 10, by2 + 15);
    ctx.letterSpacing = '0px';
  });
  ctx.font = `700 8.5px ${MONO}`;
  ctx.fillStyle = 'rgba(160,195,230,0.6)';
  ctx.fillText(TOUCH ? 'TAP TO TOGGLE DECREE' : 'B TOGGLES DECREE', bhx, HY + 100);
  // minimap
  const mmx = 1070, mmy = HY + 12, mms = 92;
  ctx.fillStyle = '#080b14';
  ctx.strokeStyle = 'rgba(160,195,230,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(mmx, mmy, mms, mms, 4); ctx.fill(); ctx.stroke();
  const sc = mms / N;
  for (let y = 0; y < N - 1; y += 1) for (let x = 0; x < N - 1; x += 1) {
    const h = hAt(x, y);
    if (h <= G.water) continue;
    ctx.fillStyle = `rgba(${60 + h * 14},${75 + h * 16},${100 + h * 15},0.9)`;
    ctx.fillRect(mmx + x * sc, mmy + y * sc, sc + 0.5, sc + 0.5);
  }
  for (const s of G.setts) {
    ctx.fillStyle = TEAM[s.team].col;
    ctx.fillRect(mmx + s.tx * sc - 1, mmy + s.ty * sc - 1, 3, 3);
  }
  for (const w of G.walkers) {
    ctx.fillStyle = w.knight ? '#ffd12a' : hexA(TEAM[w.team].col, 0.8);
    ctx.fillRect(mmx + w.x * sc, mmy + w.y * sc, 1.5, 1.5);
  }
  label('WORLD', mmx + mms + 14, HY);
  ctx.font = `700 10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(190,215,240,0.75)';
  ctx.fillText(TOUCH ? 'DRAG PANS' : 'WASD PANS', mmx + mms + 14, HY + 50);
  ctx.fillText(TOUCH ? 'TAP CASTS' : 'P PAUSES', mmx + mms + 14, HY + 66);
  ctx.fillText(TOUCH ? 'HOLD: MAGNET' : 'ESC CLEARS', mmx + mms + 14, HY + 82);
  // viewport marker + magnets on the minimap
  const [cvx, cvy] = screenToVertex(VW / 2, MQ + VH / 2);
  ctx.strokeStyle = 'rgba(240,250,255,0.8)'; ctx.lineWidth = 1;
  ctx.strokeRect(mmx + (cvx - 10) * sc, mmy + (cvy - 7) * sc, 20 * sc, 14 * sc);
  for (const t of [0, 1]) if (G.magnet[t]) {
    ctx.strokeStyle = TEAM[t].col; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(mmx + G.magnet[t][0] * sc, mmy + G.magnet[t][1] * sc, 2.5, 0, 7); ctx.stroke();
  }
  // hover tooltip: every power teaches itself
  if (hovTip) {
    const P2 = POWERS[hovTip.p];
    const tw2 = 250, th2 = 46, tx2 = clamp(hovTip.bx, 10, W - tw2 - 10), ty2 = HY - th2 - 8;
    ctx.fillStyle = 'rgba(6,10,18,0.96)';
    ctx.strokeStyle = 'rgba(180,210,240,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tx2, ty2, tw2, th2, 6); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = '800 11px Verdana, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(hovTip.p.toUpperCase(), tx2 + 10, ty2 + 17);
    ctx.font = `700 10px ${MONO}`;
    ctx.fillStyle = 'rgba(160,195,230,0.9)';
    ctx.textAlign = 'right';
    ctx.fillText(`${P2.cost} MANA · ${P2.key} · ${P2.target.toUpperCase()}`, tx2 + tw2 - 10, ty2 + 17);
    ctx.textAlign = 'left';
    ctx.font = '600 10px Verdana, sans-serif';
    ctx.fillStyle = 'rgba(210,232,255,0.85)';
    ctx.fillText(P2.desc + (P2.target === 'global' ? '' : ' at the cursor'), tx2 + 10, ty2 + 34);
  }
  // denial toast at the cursor
  if (G.toast && G.toast.t < (G.toast.life || 1.2)) {
    const k3 = 1 - G.toast.t / (G.toast.life || 1.2);
    ctx.globalAlpha = Math.min(1, k3 * 2);
    ctx.font = '800 12px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5c5c';
    ctx.fillText(G.toast.txt, clamp(mouse.x, 90, W - 90), clamp(mouse.y - 24 - G.toast.t * 14, MQ + 20, H - HUD_H - 10));
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }
}
function banner(title, color, sub) {
  ctx.save();
  const by = H / 2 - 78, bh = 140;
  ctx.fillStyle = 'rgba(5,8,15,0.94)';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(0, by, W, 2);
  ctx.fillRect(0, by + bh - 2, W, 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = '900 40px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, by + 58);
  ctx.shadowBlur = 0;
  ctx.font = '600 14px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(225,240,255,0.92)';
  ctx.fillText(sub, W / 2, by + 96);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function bannerButton(label2, color) {
  const bw2 = 260, bh2 = 40, bx2 = W / 2 - bw2 / 2, by2 = H / 2 + 76;
  const hov = mouse.x > bx2 && mouse.x < bx2 + bw2 && mouse.y > by2 && mouse.y < by2 + bh2;
  ctx.save();
  ctx.fillStyle = hov ? hexA(color, 0.3) : hexA(color, 0.12);
  ctx.strokeStyle = color; ctx.lineWidth = hov ? 2.5 : 1.5;
  if (hov) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
  ctx.beginPath(); ctx.roundRect(bx2, by2, bw2, bh2, 8); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '800 15px Verdana, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label2, W / 2, by2 + 26);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function drawTitle() {
  ctx.fillStyle = '#05060c';
  ctx.fillRect(0, 0, W, H);
  // a slowly rotating god's-eye terrain below the title
  if (!G.titleTerrain) { G.titleTerrain = true; }
  ctx.save();
  ctx.translate(0, 210);
  ctx.globalAlpha = 0.9;
  for (let sum = 0; sum <= (N - 2) * 2; sum++) {
    for (let tx = Math.max(0, sum - (N - 2)); tx <= Math.min(N - 2, sum); tx++) {
      drawTile(tx, sum - tx);
    }
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(5,6,12,0.55)';
  ctx.fillRect(0, 0, W, H);
  const by = 96, bh = 320;
  ctx.fillStyle = 'rgba(5,8,15,0.9)';
  ctx.fillRect(0, by, W, bh);
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 9;
  ctx.fillStyle = 'rgba(51,214,255,0.6)';
  ctx.fillRect(0, by, W, 1.5);
  ctx.fillRect(0, by + bh - 1.5, W, 1.5);
  ctx.restore();
  ctx.textAlign = 'center';
  const ly = 230;
  ctx.font = '900 92px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#7fdcff'; ctx.fillText('NEOPOLIS', W / 2, ly);
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff'; ctx.fillText('NEOPOLIS', W / 2, ly);
  ctx.restore();
  ctx.letterSpacing = '5px';
  ctx.font = '600 17px Verdana, sans-serif';
  ctx.fillStyle = '#7fb0d0';
  ctx.fillText('A TRIBUTE TO POPULOUS', W / 2, ly + 48);
  const a = (Math.sin(G.time * 4) + 1) / 2 * 0.45 + 0.55;
  ctx.globalAlpha = a;
  ctx.font = '900 24px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 12;
  ctx.fillText(TOUCH ? 'TAP TO ASCEND' : 'PRESS SPACE TO ASCEND', W / 2, ly + 122);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(180,210,235,0.95)';
  ctx.fillText('SHAPE THE LAND. YOUR PEOPLE BUILD. THEIR FAITH IS YOUR POWER.', W / 2, 470);
  ctx.fillStyle = 'rgba(160,190,220,0.85)';
  ctx.fillText('RAISE · LOWER · SWAMP · QUAKE · KNIGHT · FLOOD · ARMAGEDDON', W / 2, 498);
  if (TOUCH && innerHeight > innerWidth) {
    ctx.fillStyle = '#ffd12a';
    ctx.fillText('ROTATE YOUR PHONE FOR THE BEST VIEW', W / 2, 530);
  }
  ctx.letterSpacing = '0px';
  ctx.drawImage(VIGNETTE, 0, 0);
}

// ---------- input ----------
const keys = {};
let mouse = { x: 0, y: 0 };
const TOUCH = 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
function screenToVertex(mxx, myy) {
  // iterate heights: pick nearest vertex whose projection is closest
  let best = [N >> 1, N >> 1], bd = 1e9;
  const wx = mxx - VW / 2 + G.cam.x, wy = myy - MQ + G.cam.y;
  // invert at h=0 then search neighborhood over heights
  const gy0 = (wy * 2 / TH - wx * 2 / TW) / 2, gx0 = (wy * 2 / TH + wx * 2 / TW) / 2;
  for (let dy = -3; dy <= 9; dy++) for (let dx = -3; dx <= 9; dx++) {
    const vx = clamp(Math.round(gx0 + dx * 0.5 - 2), 2, N - 3), vy = clamp(Math.round(gy0 + dy * 0.5 - 2), 2, N - 3);
    const px = isoX(vx, vy) - G.cam.x + VW / 2, py = isoY(vx, vy, hAt(vx, vy)) - G.cam.y + MQ;
    const d = (px - mxx) * (px - mxx) + (py - myy) * (py - myy);
    if (d < bd) { bd = d; best = [vx, vy]; }
  }
  return best;
}
window.addEventListener('keydown', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = true;
  if (e.key === ' ') e.preventDefault();
  audio();
  if (G.showTitle && (e.key === ' ' || e.key === 'Enter')) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if ((G.mode === 'won' || G.mode === 'lost') && e.key === ' ' && G.modeT > 0.6) { newGame((Math.random() * 1e9) >>> 0, false); return; }
  const pk = POWER_ORDER.find(p => POWERS[p].key.toLowerCase() === k);
  if (pk) G.selPower = pk;
  if (k === 'b' && !G.armageddon) { G.behavior = G.behavior === 'settle' ? 'magnet' : 'settle'; applyBehavior(); }
  if (k === 'p' && !e.repeat) G.paused = !G.paused;
  if (e.key === 'Escape') { G.selPower = 'raise'; G.confirm = null; }
});
window.addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
function setMouse(cx, cy) {
  const r = canvas.getBoundingClientRect();
  mouse.x = (cx - r.left) * (W / r.width);
  mouse.y = (cy - r.top) * (H / r.height);
  if (G && !G.showTitle && mouse.y > MQ && mouse.y < H - HUD_H) {
    const [vx, vy] = screenToVertex(mouse.x, mouse.y);
    G.cursor.vx = vx; G.cursor.vy = vy;
  }
}
canvas.addEventListener('mousemove', e => {
  setMouse(e.clientX, e.clientY);
  canvas.style.cursor = (G && !G.showTitle && (mouse.y > H - HUD_H || G.mode !== 'play')) ? 'pointer' : 'crosshair';
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => press(e.button));
function press(button) {   // button 0: cast/UI · button 2: papal magnet — shared by mouse and touch
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if ((G.mode === 'won' || G.mode === 'lost') && G.modeT > 0.6) {
    const bx2 = W / 2 - 130, by2 = H / 2 + 76;
    if (mouse.x > bx2 && mouse.x < bx2 + 260 && mouse.y > by2 && mouse.y < by2 + 40) { newGame((Math.random() * 1e9) >>> 0, false); return; }
  }
  const HY = H - HUD_H;
  if (mouse.y > HY) {
    POWER_ORDER.forEach((p, i) => {
      const bx = 18 + i * 78;
      if (mouse.x > bx && mouse.x < bx + 70 && mouse.y > HY + 12 && mouse.y < HY + 78) G.selPower = p;   // arming is free; casting costs
    });
    if (!G.armageddon) ['settle', 'magnet'].forEach((m, i) => {
      const by2 = HY + 38 + i * 26;
      if (mouse.x > 876 && mouse.x < 1004 && mouse.y > by2 && mouse.y < by2 + 22 && !(m === 'magnet' && !G.magnet[0])) { G.behavior = m; applyBehavior(); }
    });
    // minimap: click to pan
    const mmx = 1070, mmy = HY + 12, mms = 92;
    if (mouse.x > mmx && mouse.x < mmx + mms && mouse.y > mmy && mouse.y < mmy + mms) {
      camOn((mouse.x - mmx) / (mms / N), (mouse.y - mmy) / (mms / N));
    }
    return;
  }
  if (G.mode !== 'play' || G.paused) return;
  const { vx, vy } = G.cursor;
  if (button === 2) {   // right-click / long-press: papal magnet
    G.magnet[0] = [vx + 0.5, vy + 0.5];
    SFX.magnet();
    if (G.behavior === 'magnet') applyBehavior();
    return;
  }
  // world-enders demand a second click — but only ones you can afford
  if ((G.selPower === 'flood' || G.selPower === 'armageddon') &&
      !(G.confirm && G.confirm.p === G.selPower && G.time - G.confirm.t < 3)) {
    if (G.mana[0] < POWERS[G.selPower].cost) {
      G.toast = { txt: `NEED ${POWERS[G.selPower].cost} MANA`, t: 0 };
      G.manaFlashT = 0.5;
      return;
    }
    G.confirm = { p: G.selPower, t: G.time };
    G.toast = { txt: 'CLICK AGAIN TO UNLEASH ' + G.selPower.toUpperCase(), t: 0, life: 3 };
    return;
  }
  G.confirm = null;
  G.deny = null;
  let ok = false;
  switch (G.selPower) {
    case 'raise': ok = castRaise(0, vx, vy, +1); break;
    case 'lower': ok = castRaise(0, vx, vy, -1); break;
    case 'swamp': ok = castSwamp(0, vx, vy); break;
    case 'quake': ok = castQuake(0, vx, vy); break;
    case 'knight': ok = castKnight(0); break;
    case 'volcano': ok = castVolcano(0, vx, vy); break;
    case 'flood': ok = castFlood(0); break;
    case 'armageddon': ok = castArmageddon(0); break;
  }
  if (!ok && G.deny) {
    G.toast = { txt: G.deny, t: 0 };
    G.manaFlashT = 0.5;
    blip(160, 90, 0.12, 'square', 0.06);
  } else if (ok && (G.selPower === 'knight' || G.selPower === 'flood' || G.selPower === 'armageddon')) {
    G.selPower = 'raise';   // one-shot powers disarm themselves
  }
}
// touch: tap casts, one-finger drag pans, hold places the papal magnet
let touchS = null;
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  audio();
  if (e.touches.length !== 1) { if (touchS) { clearTimeout(touchS.lp); touchS = null; } return; }
  if (touchS) clearTimeout(touchS.lp);
  const t = e.touches[0];
  setMouse(t.clientX, t.clientY);
  touchS = { x: t.clientX, y: t.clientY, moved: false, held: false, lp: 0, map: !!G && !G.showTitle && mouse.y > MQ && mouse.y < H - HUD_H };
  if (touchS.map) touchS.lp = setTimeout(() => { if (touchS && !touchS.moved) { touchS.held = true; press(2); } }, 450);
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!touchS || e.touches.length !== 1) return;
  const t = e.touches[0];
  if (!touchS.moved && Math.hypot(t.clientX - touchS.x, t.clientY - touchS.y) < 9) return;
  touchS.moved = true;
  clearTimeout(touchS.lp);
  if (touchS.map) {   // the world follows the finger
    const r = canvas.getBoundingClientRect();
    G.cam.x -= (t.clientX - touchS.x) * (W / r.width);
    G.cam.y -= (t.clientY - touchS.y) * (H / r.height);
  }
  touchS.x = t.clientX; touchS.y = t.clientY;
  setMouse(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (!touchS) return;
  clearTimeout(touchS.lp);
  if (!touchS.moved && !touchS.held) press(0);
  touchS = null;
}, { passive: false });
canvas.addEventListener('touchcancel', () => {   // interrupted touch must not leave a live long-press timer
  if (touchS) { clearTimeout(touchS.lp); touchS = null; }
});
function applyBehavior() {
  if (G.armageddon) return;   // no decrees at the end of the world
  for (const w of G.walkers) if (w.team === 0 && !w.knight) w.mode = G.behavior === 'magnet' && G.magnet[0] ? 'magnet' : 'settle';
}

// ---------- main loop ----------
let last = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 1 / 15);
  last = t;
  if (!G.paused || G.showTitle || G.mode !== 'play') acc += dt;
  let n = 0;
  while (acc >= STEP && n < 6) { sim(STEP); acc -= STEP; n++; }
  draw();
  if (G.paused && G.mode === 'play' && !G.showTitle) {
    ctx.fillStyle = 'rgba(5,8,15,0.55)';
    ctx.fillRect(0, MQ, W, VH);
    ctx.font = '900 30px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '4px';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PAUSED', W / 2, H / 2 - 40);
    ctx.letterSpacing = '0px';
  }
}

// ---------- harnesses ----------
function stepFor(s) { const n2 = Math.round(s / STEP); for (let i = 0; i < n2; i++) sim(STEP); }
function stepUntil(cond, cap) { let n2 = 0; while (!cond() && n2 < cap) { sim(STEP); n2++; } }
function camOn(tx, ty) {
  G.cam.x = isoX(tx, ty);
  G.cam.y = isoY(tx, ty, hAt(Math.floor(tx), Math.floor(ty))) - VH / 2;
}
function runShot(name) {
  AUDIO_ON = false;
  newGame(778899, false);
  G.hintT = 0;
  if (name !== 'overview' && name !== 'raise') { G.cursor.vx = -99; G.cursor.vy = -99; }
  if (name === 'title') {
    G.showTitle = true; G.attract = true;
    stepFor(1.5);
  } else if (name === 'overview') {
    G.hintT = 6;
    stepFor(2);
    camOn(11, 11);
  } else if (name === 'sprawl') {
    G.botPlays = true; G.botStyle = 'flatonly'; G.aiStyle = 'flatonly';   // pure city-growth, no early apocalypse
    stepFor(150);
    camOn(13, 13);
  } else if (name === 'raise') {
    G.botPlays = true; G.botStyle = 'full';
    stepFor(24);
    const t2 = findFlattenTarget(0);
    if (t2) castRaise(0, t2[0], t2[1], t2[2]);
    stepFor(0.2);
    camOn(t2 ? t2[0] : 11, t2 ? t2[1] : 11);
  } else if (name === 'battle') {
    for (let i = 0; i < 7; i++) { spawnWalker(0, 20 + rng(-1, 1), 22 + rng(-1, 1), 40); spawnWalker(1, 21 + rng(-1, 1), 22 + rng(-1, 1), 40); }
    for (const w of G.walkers) w.mode = 'armageddon';
    G.armageddon = false;
    for (const w of G.walkers) w.mode = w.team === 0 ? 'magnet' : 'magnet';
    G.magnet[0] = [21, 22.5]; G.magnet[1] = [20.5, 22.5];
    for (const w of G.walkers) w.mode = 'magnet';
    stepFor(6);
    camOn(20.5, 22);
  } else if (name === 'knight') {
    G.botPlays = true; G.botStyle = 'full';
    stepFor(90);
    G.mana[0] = 700;
    castKnight(0);
    const l = G.walkers.find(w2 => w2.knight);
    stepFor(1.5);
    camOn(l ? l.x : 15, l ? l.y : 15);
  } else if (name === 'swamp') {
    G.botPlays = true; G.botStyle = 'flatonly'; G.aiStyle = 'flatonly';
    stepFor(70);
    G.mana[0] = 600;
    // stage inside our own influence: bog the frontier of the home plateau
    let placed = null;
    for (const s of G.setts) {
      if (s.team !== 0 || placed) continue;
      for (const [dx2, dy2] of [[2, 0], [0, 2], [-2, 0], [0, -2], [2, 2]]) {
        if (castSwamp(0, s.tx + dx2, s.ty + dy2)) { placed = [s.tx + dx2, s.ty + dy2]; break; }
      }
    }
    stepFor(1.2);
    camOn(placed ? placed[0] : 11, placed ? placed[1] : 11);
  } else if (name === 'quake') {
    G.botPlays = true; G.botStyle = 'full';
    stepFor(80);
    G.mana[0] = 600;
    const c2 = biggestCluster(1) || [N - 13, N - 13];
    // walk a walker close enough for influence, honestly staged: use own cluster edge
    castQuake(0, clamp(c2[0], 4, N - 5), clamp(c2[1], 4, N - 5)) || castQuake(0, 14, 14);
    stepFor(0.4);
    camOn(14, 14);
  } else if (name === 'magnet') {
    stepFor(12);
    G.magnet[0] = [17.5, 13.5];
    G.behavior = 'magnet';
    applyBehavior();
    stepFor(4);
    camOn(16, 13);
  } else if (name === 'armageddon') {
    G.botPlays = true; G.botStyle = 'flatonly'; G.aiStyle = 'flatonly';
    stepFor(150);
    G.mana[0] = 3000;
    castArmageddon(0);
    stepFor(2.6);                                   // mid-collapse: the wavefront, not the aftermath
    camOn(N / 2, N / 2);
  } else if (name === 'volcano') {
    G.botPlays = true; G.botStyle = 'flatonly'; G.aiStyle = 'flatonly';
    stepFor(70);
    G.mana[0] = 1200;
    const bc = biggestCluster(0) || [11, 11];
    const vt = [bc[0] + 4, bc[1] + 3];
    castVolcano(0, vt[0], vt[1]) || castVolcano(0, bc[0] + 3, bc[1]);
    stepFor(1.6);
    camOn(vt[0], vt[1]);
  } else if (name === 'win') {
    G.botPlays = true; G.botStyle = 'player'; G.aiStyle = 'none';
    stepUntil(() => G.mode === 'won', 30 * 900);
    stepFor(0.3);
    if (G.mode !== 'won') { document.title = 'shot-FAILED:' + JSON.stringify({ mode: G.mode, pop: [totalPop(0), totalPop(1)], mana: Math.floor(G.mana[0]), t: Math.floor(G.time), arg: G.armageddon, p0: G.stats.powers[0] }); return; }
  } else if (name === 'fail') {
    G.botPlays = true; G.botStyle = 'none'; G.aiStyle = 'full';
    stepUntil(() => G.mode === 'lost', 30 * 800);
    stepFor(0.3);
    if (G.mode !== 'lost') { document.title = 'shot-FAILED'; return; }
  } else {
    stepFor(2);
  }
  draw();
  document.title = 'shot-ready';
}
// god policies for harness styles referenced above
const _origPolicy = godPolicy;
godPolicy = function (team, style) {
  if (style === 'none') return;
  if (style === 'passive') { // flattens a little, never attacks
    if (G.tick % 4 === 0) {
      const t2 = findFlattenTarget(team);
      if (t2 && G.mana[team] >= POWERS.raise.cost) castRaise(team, t2[0], t2[1], t2[2]);
    }
    return;
  }
  _origPolicy(team, style);
};
function runVerify(mode) {
  AUDIO_ON = false;
  const seed = 778899;
  newGame(seed, false);
  let outcome = 'FAILED', extra = {};
  const matches = {
    solution: ['player', 'full'], null: ['none', 'full'],
    'ablate-flatten': ['noflat', 'full'], 'ablate-powers': ['flatonly', 'full'],
  };
  if (matches[mode]) {
    const [b0, b1] = matches[mode];
    G.botPlays = true; G.botStyle = b0; G.aiStyle = b1;
    let simTime = 0;
    const defCap = mode === 'ablate-powers' ? 1600 : 900;   // "cannot finish" must be earned, not asserted
    const cap = Number(new URLSearchParams(location.search).get('t') || defCap);
    while (simTime < cap && G.mode === 'play') { sim(STEP); simTime += STEP; }
    const p0 = totalPop(0), p1 = totalPop(1);
    outcome = G.mode === 'won' ? 'WON' : G.mode === 'lost' ? 'LOST' : (p0 > p1 * 1.5 ? 'AHEAD' : p1 > p0 * 1.5 ? 'BEHIND' : 'STALEMATE');
    extra = { pop: [p0, p1], mana: [Math.floor(G.mana[0]), Math.floor(G.mana[1])], time: Math.round(simTime), powers: G.stats.powers, deform: G.stats.deform, curve0: G.stats.pop[0].filter((_, i) => i % 4 === 0), curve1: G.stats.pop[1].filter((_, i) => i % 4 === 0) };
  } else if (mode === 'mech-flat') {
    // canon rule: more flat land -> bigger settlement
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(20);
    const s = G.setts.find(s2 => s2.team === 0);
    if (s) {
      const before = s.level;
      // flatten a big apron around it by direct divine intervention (harness hands)
      const h = s.h;
      for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 4; dx++) G.H[(s.ty + dy) * N + (s.tx + dx)] = h;
      recalcSetts();
      const after = G.setts.includes(s) ? s.level : -1;
      outcome = after > before ? 'SOLVED' : 'FAILED';
      extra = { before, after };
    }
  } else if (mode === 'mech-collapse') {
    // canon rule: deform the land under a settlement and it falls
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(20);
    const s = G.setts.find(s2 => s2.team === 0);
    if (s) {
      const nBefore = G.setts.length;
      G.H[s.ty * N + s.tx] = clamp(s.h + 2, 0, HMAX);   // divine hand, no mana: mechanism only
      recalcSetts();
      outcome = G.setts.length < nBefore ? 'SOLVED' : 'FAILED';
      extra = { before: nBefore, after: G.setts.length };
    }
  } else if (mode === 'mech-swamp') {
    // canon rule: the bog swallows whoever steps in — and persists
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(6);
    const w = G.walkers.find(w2 => w2.team === 0);
    if (w) {
      const tx = Math.floor(w.x) + 1, ty = Math.floor(w.y);
      G.swamps.push({ tx, ty, team: 1, kills: 0 });
      G.magnet[0] = [tx + 0.5, ty + 0.5];
      G.behavior = 'magnet';
      applyBehavior();
      const before = G.walkers.filter(w2 => w2.team === 0).length;
      stepFor(15);
      const after = G.walkers.filter(w2 => w2.team === 0).length;
      const sw = G.swamps[0];
      outcome = after < before && sw && sw.kills >= 1 ? 'SOLVED' : 'FAILED';
      extra = { before, after, kills: sw ? sw.kills : 0, persists: !!sw };
    }
  } else if (mode === 'mech-quake') {
    // canon rule: an earthquake breaks flat land and the towns on it
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(25);
    const s = G.setts.find(s2 => s2.team === 0);
    if (s) {
      const before = G.setts.length;
      G.mana[0] = 999; 
      const okq = castQuake(0, s.tx, s.ty);
      recalcSetts();
      outcome = okq && G.setts.length < before ? 'SOLVED' : 'FAILED';
      extra = { cast: okq, before, after: G.setts.length };
    }
  } else if (mode === 'mech-flood') {
    // canon rule: the flood drowns the lowlands
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(20);
    const low = () => G.walkers.filter(w2 => hAt(Math.floor(w2.x), Math.floor(w2.y)) <= 1).length
                    + G.setts.filter(s2 => s2.h <= 1).length;
    const beforeLow = low(), beforePop = totalPop(0) + totalPop(1);
    G.mana[0] = 2000;
    const okf = castFlood(0);
    stepFor(1);
    const afterPop = totalPop(0) + totalPop(1);
    outcome = okf && (afterPop < beforePop || beforeLow === 0) ? 'SOLVED' : 'FAILED';
    extra = { cast: okf, beforeLow, beforePop, afterPop, water: G.water };
  } else if (mode === 'mech-merge') {
    // canon rule: walkers who meet combine their strength
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(4);
    const ws = G.walkers.filter(w2 => w2.team === 0);
    if (ws.length >= 2) {
      const a2 = ws[0], b2 = ws[1];
      const strA = a2.str, strB = b2.str, before = G.walkers.filter(w2 => w2.team === 0).length;
      b2.x = a2.x; b2.y = a2.y;
      stepFor(0.2);
      const after = G.walkers.filter(w2 => w2.team === 0).length;
      outcome = after === before - 1 && a2.str > strA ? 'SOLVED' : 'FAILED';
      extra = { before, after, strA, strB, merged: Math.round(a2.str) };
    }
  } else if (mode === 'mech-leader') {
    // canon rule: only the leader walks to the magnet; the flock follows the leader
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(6);
    G.magnet[0] = [30, 30];
    G.behavior = 'magnet';
    applyBehavior();
    stepFor(6);
    const lead = G.walkers.find(w2 => w2.id === G.leaderId[0]);
    const others = G.walkers.filter(w2 => w2.team === 0 && w2 !== lead);
    if (lead && others.length) {
      const dLead = Math.hypot(lead.x - 30, lead.y - 30);
      const dFlock = others.reduce((a3, w2) => a3 + Math.hypot(w2.x - lead.x, w2.y - lead.y), 0) / others.length;
      outcome = dLead < 24 && dFlock < 8 ? 'SOLVED' : 'FAILED';
      extra = { leaderDistToMagnet: Math.round(dLead * 10) / 10, flockDistToLeader: Math.round(dFlock * 10) / 10 };
    }
  } else if (mode === 'mech-magnet') {
    // canon rule: the papal magnet commands the faithful
    G.botPlays = false; G.aiStyle = 'none';
    stepFor(10);
    G.magnet[0] = [30, 30];
    G.behavior = 'magnet';
    applyBehavior();
    const dist = () => {
      const ws = G.walkers.filter(w2 => w2.team === 0);
      return ws.length ? ws.reduce((a2, w2) => a2 + Math.hypot(w2.x - 30, w2.y - 30), 0) / ws.length : 1e9;
    };
    const d0 = dist();
    stepFor(12);
    const d1 = dist();
    outcome = d1 < d0 - 3 ? 'SOLVED' : 'FAILED';
    extra = { before: Math.round(d0 * 10) / 10, after: Math.round(d1 * 10) / 10 };
  }
  extra.dbg = {
    f0: findFlattenTarget(0), p0: findPlateauTarget(0),
    setts: [G.setts.filter(s2 => s2.team === 0).length, G.setts.filter(s2 => s2.team === 1).length],
    walkers: [G.walkers.filter(w2 => w2.team === 0).length, G.walkers.filter(w2 => w2.team === 1).length],
    swamps: G.swamps.length, poison: G.poison.size, water: G.water, armageddon: G.armageddon,
  };
  const report = { mode, outcome, seed, ...extra };
  document.title = 'VERIFY:' + JSON.stringify(report);
  const el = document.createElement('pre');
  el.id = 'verify-report';
  el.textContent = document.title;
  document.body.appendChild(el);
  draw();
}

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
const verifyMode = q.get('verify');
if (shotName) runShot(shotName);
else if (verifyMode !== null) runVerify(verifyMode || 'solution');
else { newGame(445566, true); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
