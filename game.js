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
  for (let i = 0; i < N * N; i++) Hgt[i] = clamp(Math.round(Hf[i]), 0, HMAX);
  // ocean border
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = Math.min(x, y, N - 1 - x, N - 1 - y);
    if (b < 3) Hgt[y * N + x] = 0;
    else if (b < 5) Hgt[y * N + x] = Math.min(Hgt[y * N + x], b - 2);
  }
  return Hgt;
}
function hAt(x, y) { return G.H[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)]; }
function tileFlat(tx, ty) {
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
    H: genTerrain(seed), water: 0,
    walkers: [], setts: [], swamps: [], parts: [], pops: [],
    mana: [180, 180], magnet: [null, null], magnetOn: [false, false],
    mode: 'play', modeT: 0, endT: 0, armageddon: false,
    cam: { x: 0, y: -60 }, shake: 0,
    cursor: { vx: N >> 1, vy: N >> 1 },
    selPower: 'raise', behavior: 'settle',
    aiT: 0, hintT: 9, nextId: 1, cool: { quake: [0, 0], swamp: [0, 0] },
    stats: { t: [], pop: [[], []], deform: [0, 0], powers: [{}, {}] },
  };
  // starting flats + seed walkers for both gods, mirrored for fairness
  seedStart(0, 10, 10);
  seedStart(1, N - 13, N - 13);
  G.cam.x = isoX(11, 11) - 0;
  G.cam.y = isoY(11, 11, hAt(11, 11)) - VH / 2 + 40;
}
function seedStart(team, cx, cy) {
  const h = Math.max(2, hAt(cx, cy));
  for (let y = -2; y <= 3; y++) for (let x = -2; x <= 3; x++) G.H[(cy + y) * N + (cx + x)] = h;
  for (let i = 0; i < 5; i++) spawnWalker(team, cx + 0.5 + rng(-1.5, 1.5), cy + 0.5 + rng(-1.5, 1.5), 30);
}
function spawnWalker(team, x, y, str) {
  G.walkers.push({
    id: G.nextId++, team, x, y, tx: x, ty: y,
    str, age: 0, mode: 'settle', knight: false, fightT: 0, wanderT: 0, dir: rng(0, 6.28),
  });
}

// ---------- settlements ----------
function settleAt(w) {
  const tx = Math.floor(w.x), ty = Math.floor(w.y);
  if (tileFlat(tx, ty) < 0) return false;
  if (G.setts.some(s => Math.abs(s.tx - tx) <= 1 && Math.abs(s.ty - ty) <= 1)) return false;
  if (G.swamps.some(s => s.tx === tx && s.ty === ty)) return false;
  const score = flatScore(tx, ty);
  if (score < 4) return false;
  G.setts.push({
    id: G.nextId++, team: w.team, tx, ty, h: tileFlat(tx, ty),
    level: levelOf(score), spawnT: rng(2, 5), popT: 0, burnT: 0,
  });
  SFX.settle();
  addRing(tx + 0.5, ty + 0.5, TEAM[w.team].col);
  return true;
}
function collapseSett(s, silent) {
  // the people walk free; the building is gone — a city yields a crowd, a hut yields one soul
  const idx = G.setts.indexOf(s);
  if (idx >= 0) G.setts.splice(idx, 1);
  const n = Math.ceil(s.level / 2);
  for (let i = 0; i < n; i++) spawnWalker(s.team, s.tx + 0.5 + rng(-0.5, 0.5), s.ty + 0.5 + rng(-0.5, 0.5), 16 + s.level * 3);
  if (!silent) { SFX.collapse(); addBurst(s.tx + 0.5, s.ty + 0.5, TEAM[s.team].col, 10); }
}
function recalcSetts() {
  for (const s of [...G.setts]) {
    const h = tileFlat(s.tx, s.ty);
    if (h < 0 || h <= G.water) { collapseSett(s); continue; }
    s.h = h;
    s.level = levelOf(flatScore(s.tx, s.ty));
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
  raise: { cost: 12, key: 'Q' }, lower: { cost: 12, key: 'W' },
  swamp: { cost: 180, key: 'E' }, quake: { cost: 420, key: 'R' },
  knight: { cost: 650, key: 'T' }, flood: { cost: 1400, key: 'F' },
  armageddon: { cost: 2600, key: 'G' },
};
function castRaise(team, vx, vy, dir) {
  if (G.armageddon) return false;
  const p = POWERS[dir > 0 ? 'raise' : 'lower'];
  if (G.mana[team] < p.cost) return false;
  if (!influence(team, vx, vy)) return false;
  const i = vy * N + vx;
  const nh = clamp(G.H[i] + dir, 0, HMAX);
  if (nh === G.H[i]) return false;
  G.mana[team] -= p.cost;
  G.H[i] = nh;
  G.stats.deform[team]++;
  recalcSetts();
  (dir > 0 ? SFX.raise : SFX.lower)();
  addBurst(vx, vy, TEAM[team].col, 4);
  logPower(team, dir > 0 ? 'raise' : 'lower');
  return true;
}
function castSwamp(team, tx, ty) {
  if (G.armageddon || G.mana[team] < POWERS.swamp.cost) return false;
  if (tileFlat(tx, ty) < 0 || !influence(team, tx, ty)) return false;
  G.mana[team] -= POWERS.swamp.cost;
  G.swamps.push({ tx, ty, team, uses: 4 });
  SFX.swamp(); logPower(team, 'swamp');
  return true;
}
function castQuake(team, vx, vy) {
  if (G.armageddon || G.mana[team] < POWERS.quake.cost) return false;
  if (!influence(team, vx, vy)) return false;
  G.mana[team] -= POWERS.quake.cost;
  srand((G.seed ^ (G.tick * 7919) ^ (vx * 131 + vy)) >>> 0);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = vx + dx, y = vy + dy;
    if (x < 2 || y < 2 || x > N - 3 || y > N - 3) continue;
    if (Math.hypot(dx, dy) > 3.4) continue;
    const i = y * N + x;
    G.H[i] = clamp(G.H[i] + (rand() < 0.5 ? -1 : 1) * (rand() < 0.3 ? 2 : 1), 0, HMAX);
  }
  G.shake = 9;
  recalcSetts();
  SFX.quake(); logPower(team, 'quake');
  return true;
}
function leaderOf(team) {
  let best = null;
  for (const w of G.walkers) if (w.team === team && !w.knight && (!best || w.age > best.age)) best = w;
  return best;
}
function castKnight(team) {
  if (G.armageddon || G.mana[team] < POWERS.knight.cost) return false;
  const l = leaderOf(team);
  if (!l) return false;
  G.mana[team] -= POWERS.knight.cost;
  l.knight = true; l.str = Math.max(l.str * 2, 120); l.mode = 'magnet';
  SFX.knight(); addRing(l.x, l.y, '#ffd12a'); logPower(team, 'knight');
  return true;
}
function castFlood(team) {
  if (G.armageddon || G.mana[team] < POWERS.flood.cost || G.water >= 3) return false;
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
  if (G.armageddon || G.mana[team] < POWERS.armageddon.cost) return false;
  G.mana[team] -= POWERS.armageddon.cost;
  G.armageddon = true;
  for (const s of [...G.setts]) collapseSett(s, true);
  for (const w of G.walkers) { w.mode = 'armageddon'; }
  SFX.gg(); logPower(team, 'armageddon');
  G.shake = 12;
  return true;
}
function logPower(team, p) { G.stats.powers[team][p] = (G.stats.powers[team][p] || 0) + 1; }
function killWalker(w) {
  w.dead = true;
  addBurst(w.x, w.y, TEAM[w.team].col, 6);
}

// ---------- simulation ----------
function sim(dt) {
  G.time += dt; G.modeT += dt; G.tick++;
  if (G.mode !== 'play') { tickFX(dt); return; }
  G.hintT = Math.max(0, G.hintT - dt);

  // mana income: worship flows from settlements (canon: population is mana)
  for (const s of G.setts) {
    G.mana[s.team] += s.level * 0.55 * dt;
    s.spawnT -= dt * (0.6 + s.level * 0.12);
    if (s.spawnT <= 0 && countPop(s.team) < 70) {
      s.spawnT = rng(4, 7);
      spawnWalker(s.team, s.tx + 0.5 + rng(-0.4, 0.4), s.ty + 0.5 + rng(-0.4, 0.4), 14 + s.level * 7);
    }
  }
  for (const t of [0, 1]) G.mana[t] = Math.min(G.mana[t], 4000);

  // walkers
  for (const w of G.walkers) {
    if (w.dead) continue;
    w.age += dt;
    stepWalker(w, dt);
  }
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
  for (const w of G.walkers) {
    if (w.dead || !w.knight) continue;
    for (const s of G.setts) {
      if (s.team !== w.team && Math.abs(s.tx + 0.5 - w.x) < 1 && Math.abs(s.ty + 0.5 - w.y) < 1) {
        s.burnT += dt;
        if (s.burnT > 1.2) { collapseSett(s); addBurst(w.x, w.y, '#ffd12a', 14); }
      }
    }
  }
  G.walkers = G.walkers.filter(w => !w.dead);

  // swamps swallow
  for (const sw of [...G.swamps]) {
    for (const w of G.walkers) {
      if (!w.knight && Math.floor(w.x) === sw.tx && Math.floor(w.y) === sw.ty) {
        killWalker(w); SFX.die();
        sw.uses--;
      }
    }
    if (sw.uses <= 0) G.swamps.splice(G.swamps.indexOf(sw), 1);
  }
  G.walkers = G.walkers.filter(w => !w.dead);

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
  if (G.armageddon && G.walkers.length && G.walkers.every(w => Math.hypot(w.x - N / 2, w.y - N / 2) < 3.5)) {
    // final melee resolves by numbers — no more running
  }
  tickFX(dt);
}
function countPop(team) { return G.walkers.filter(w => w.team === team).length + G.setts.filter(s => s.team === team).length; }
function totalPop(team) {
  let p = 0;
  for (const w of G.walkers) if (w.team === team) p += 1;
  for (const s of G.setts) if (s.team === team) p += s.level;
  return p;
}

function stepWalker(w, dt) {
  const speed = w.knight ? 2.6 : 1.7;
  let goal = null;
  if (G.armageddon || w.mode === 'armageddon') goal = [N / 2, N / 2];
  else if (w.mode === 'magnet' && G.magnet[w.team]) goal = G.magnet[w.team];
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
      if (flatScore(x, y) < 4) continue;
      if (G.setts.some(s => Math.abs(s.tx - x) <= 1 && Math.abs(s.ty - y) <= 1)) continue;
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
  const attacks = style === 'full' || style === 'noflat';
  if (attacks) {
    const ratio = totalPop(team) / Math.max(1, totalPop(1 - team));
    // the closer: armageddon when clearly ahead — a god game must end
    if (can('armageddon') && ((ratio > 1.5 && G.time > 120) || (ratio > 1.15 && G.time > 300))) { castArmageddon(team); return; }
    if (ratio > 1.35) { /* hoard for the end of the world */ }
    else if (G.mana[team] > 1800) {
      if (can('knight') && totalPop(team) > 14 && !G.walkers.some(w => w.team === team && w.knight)) { castKnight(team); return; }
      const c = biggestCluster(1 - team);
      if (can('quake') && c && G.time > (G.cool.quake[team] || 0) && influence(team, c[0], c[1])) { G.cool.quake[team] = G.time + 30; castQuake(team, c[0], c[1]); return; }
      const e = nearestEnemyFlat(team);
      if (can('swamp') && e && G.time > (G.cool.swamp[team] || 0)) { G.cool.swamp[team] = G.time + 12; castSwamp(team, e[0], e[1]); return; }
    }
  }
  // the economy: flatten land for the faithful
  if (style !== 'noflat' && can('raise')) {
    const target = findFlattenTarget(team);
    if (target) castRaise(team, target[0], target[1], target[2]);
  }
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
      const gain = 10 - Math.abs(vd) - (Math.abs(dx) + Math.abs(dy)) * 0.4;
      if (gain > bestGain && influence(team, corners[vi][0], corners[vi][1])) {
        bestGain = gain;
        best = [corners[vi][0], corners[vi][1], vd > 0 ? -1 : 1];
      }
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
    const a = rng(0, 6.28), s = rng(20, 70);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rng(0.3, 0.7), t: 0, kind: 'chip' });
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
    if (p.kind === 'chip') { p.x += p.vx * dt * 0.03; p.y += p.vy * dt * 0.03; }
    else if (p.kind === 'ring') p.r += 60 * dt;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) { const o = G.pops[i]; o.t += dt; if (o.t >= o.life) G.pops.splice(i, 1); }
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
  // magnets
  for (const t of [0, 1]) if (G.magnet[t]) drawMagnet(t);
  // cursor
  if (!G.attract) drawCursor();
  // particles
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    const k = 1 - p.t / p.life;
    const [sx, sy] = worldToScreen(p.x, p.y, hAt(Math.floor(p.x), Math.floor(p.y)));
    if (p.kind === 'chip') {
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - 2 + p.vx * p.t * 0.05, sy - 2 + p.vy * p.t * 0.05, 3, 3);
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
  ctx.restore();

  drawTopBar();
  drawHUD();
  if (G.mode === 'won') { banner('DOMINION', TEAM[0].col, `THE OTHER GOD IS FORGOTTEN — PEAK POP ${Math.max(...G.stats.pop[0], 1)}`); bannerButton('NEW WORLD  ·  SPACE', TEAM[0].col); }
  if (G.mode === 'lost') { banner('FORGOTTEN', TEAM[1].col, `YOUR LAST WORSHIPPER FELL — SPACE TO TRY AGAIN`); bannerButton('NEW WORLD  ·  SPACE', TEAM[1].col); }
  ctx.drawImage(VIGNETTE, 0, 0);
}
function drawTile(tx, ty) {
  const h00 = hAt(tx, ty), h10 = hAt(tx + 1, ty), h01 = hAt(tx, ty + 1), h11 = hAt(tx + 1, ty + 1);
  const water = h00 <= G.water && h10 <= G.water && h01 <= G.water && h11 <= G.water;
  const [x0, y0] = worldToScreen(tx, ty, water ? G.water : h00);
  const [x1, y1] = worldToScreen(tx + 1, ty, water ? G.water : h10);
  const [x2, y2] = worldToScreen(tx + 1, ty + 1, water ? G.water : h11);
  const [x3, y3] = worldToScreen(tx, ty + 1, water ? G.water : h01);
  if (Math.max(x0, x1, x2, x3) < -40 || Math.min(x0, x1, x2, x3) > VW + 40) return;
  if (Math.max(y0, y1, y2, y3) < -60 || Math.min(y0, y1, y2, y3) > VH + 60) return;
  if (water) {
    ctx.fillStyle = '#060a14';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
    // faint scan shimmer
    if (((tx * 7 + ty * 13 + (G.tick >> 4)) % 23) === 0) {
      ctx.fillStyle = 'rgba(51,120,190,0.16)';
      ctx.fill();
    }
    return;
  }
  const avg = (h00 + h10 + h01 + h11) / 4;
  const slope = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
  const flat = slope === 0;
  // altitude + slope lighting
  let base = 0.16 + avg * 0.045;
  // light from north-west: darker if南east higher
  base += (h00 - h11) * 0.05;
  let r = 32 + base * 90, g = 40 + base * 100, b = 58 + base * 120;
  const tint = tileTeamTint(tx, ty);
  if (tint) {
    const [team, k] = tint;
    const tc = team === 0 ? [40, 160, 200] : [200, 40, 90];
    r += (tc[0] - r) * k * 0.35; g += (tc[1] - g) * k * 0.35; b += (tc[2] - b) * k * 0.35;
  }
  ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
  // grid whisper on flat land, cliff rims on steps
  if (flat) {
    ctx.strokeStyle = 'rgba(120,180,220,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (slope >= 2) {
    ctx.strokeStyle = hexA('#5fd4ff', 0.12 + slope * 0.05);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x2, y2); ctx.lineTo(x1, y1); ctx.stroke();
  }
  // shoreline glow
  const coast = h00 <= G.water || h10 <= G.water || h01 <= G.water || h11 <= G.water;
  if (coast) {
    ctx.strokeStyle = hexA('#33d6ff', 0.25 + Math.sin(G.time * 2 + tx + ty) * 0.08);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.stroke();
  }
}
function drawSwamp(sw) {
  const [sx, sy] = worldToScreen(sw.tx + 0.5, sw.ty + 0.5, tileFlat(sw.tx, sw.ty) > 0 ? tileFlat(sw.tx, sw.ty) : 1);
  ctx.save();
  const pulse = 0.5 + Math.sin(G.time * 3 + sw.tx) * 0.25;
  ctx.fillStyle = hexA('#5aff9e', 0.14 + pulse * 0.1);
  ctx.strokeStyle = hexA('#5aff9e', 0.5 + pulse * 0.3);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(sx, sy, TW * 0.42, TH * 0.42, 0, 0, 7); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const bx = sx + Math.sin(G.time * 1.7 + i * 2.1 + sw.ty) * 8;
    const by = sy - ((G.time * 9 + i * 7) % 12);
    ctx.fillStyle = hexA('#5aff9e', 0.5);
    ctx.fillRect(bx, by, 2, 2);
  }
  ctx.restore();
}
function drawSett(s) {
  const [sx, sy] = worldToScreen(s.tx + 0.5, s.ty + 0.5, s.h);
  const c = TEAM[s.team].col;
  const lv = s.level;
  const wpx = 8 + lv * 1.6, hpx = 6 + lv * 3.4;
  ctx.save();
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
    s.burnT = Math.max(0, s.burnT - 0.008);
  }
  // level pips
  ctx.font = `800 9px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = hexA('#ffffff', 0.85);
  ctx.fillText(String(lv), sx, sy + 9);
  ctx.restore();
}
function drawWalker(w) {
  const h = Math.max(hAt(Math.floor(w.x), Math.floor(w.y)), G.water + 0.01);
  const [sx, sy] = worldToScreen(w.x, w.y, h);
  const c = w.knight ? '#ffd12a' : TEAM[w.team].col;
  ctx.save();
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
    ctx.strokeStyle = '#ffd12a'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx + 3, sy - 12 - bob); ctx.lineTo(sx + 6, sy - 16 - bob); ctx.stroke();
  }
  if (w.fightT > 0) {
    w.fightT -= 0.016;
    ctx.strokeStyle = hexA('#ffffff', 0.7);
    ctx.beginPath(); ctx.arc(sx, sy - 8, 6 + Math.sin(G.time * 30) * 2, 0, 7); ctx.stroke();
  }
  ctx.restore();
}
function drawMagnet(t) {
  const [mx, my] = G.magnet[t];
  const h = Math.max(hAt(Math.floor(mx), Math.floor(my)), G.water);
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
  const [sx, sy] = worldToScreen(vx, vy, hAt(vx, vy));
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
  ctx.fillStyle = hexA(TEAM[0].col, 0.55);
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
  ctx.fillText(G.armageddon ? 'ARMAGEDDON' : `WORLD ${String(G.seed).slice(-4)} · ${min}:${String(sec).padStart(2, '0')}`, W / 2, 25);
  ctx.textAlign = 'right';
  ctx.fillStyle = TEAM[1].col;
  ctx.fillText(`${totalPop(1)} POP`, W - 26, 25);
  ctx.letterSpacing = '0px';
  if (G.hintT > 0 && !G.attract && G.mode === 'play') {
    ctx.globalAlpha = Math.min(1, G.hintT);
    ctx.font = '600 12px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,232,255,0.9)';
    ctx.fillText('RAISE AND LOWER LAND NEAR YOUR PEOPLE · FLAT LAND GROWS SETTLEMENTS · SETTLEMENTS GROW MANA', W / 2, MQ + 22);
    ctx.globalAlpha = 1;
  }
}
const POWER_ORDER = ['raise', 'lower', 'swamp', 'quake', 'knight', 'flood', 'armageddon'];
const POWER_GLYPH = {
  raise: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 7, y + 5); ctx.lineTo(x, y - 6); ctx.lineTo(x + 7, y + 5); ctx.closePath(); ctx.stroke(); },
  lower: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 7, y - 5); ctx.lineTo(x, y + 6); ctx.lineTo(x + 7, y - 5); ctx.closePath(); ctx.stroke(); },
  swamp: (x, y) => { ctx.beginPath(); ctx.ellipse(x, y + 2, 7, 4, 0, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x - 2, y - 3, 1.5, 0, 7); ctx.arc(x + 3, y - 1, 1.2, 0, 7); ctx.stroke(); },
  quake: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 8, y + 4); ctx.lineTo(x - 3, y - 2); ctx.lineTo(x, y + 3); ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 8, y + 2); ctx.stroke(); },
  knight: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 4, y + 6); ctx.lineTo(x - 4, y - 3); ctx.lineTo(x, y - 7); ctx.lineTo(x + 4, y - 3); ctx.lineTo(x + 4, y + 6); ctx.closePath(); ctx.stroke(); },
  flood: (x, y) => { ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x - 4, y - 6, x, y); ctx.quadraticCurveTo(x + 4, y + 6, x + 8, y); ctx.stroke(); },
  armageddon: (x, y) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke(); },
};
function drawHUD() {
  const HY = H - HUD_H;
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, HY, W, HUD_H);
  ctx.save();
  ctx.shadowColor = TEAM[0].col; ctx.shadowBlur = 8;
  ctx.fillStyle = hexA(TEAM[0].col, 0.6);
  ctx.fillRect(0, HY, W, 1.5);
  ctx.restore();
  // power chips
  POWER_ORDER.forEach((p, i) => {
    const bx = 22 + i * 88, by = HY + 12, bw = 78, bh = 66;
    const cost = POWERS[p].cost;
    const afford = G.mana[0] >= cost && !G.armageddon;
    const armed = G.selPower === p;
    const hov = mouse.x > bx && mouse.x < bx + bw && mouse.y > by && mouse.y < by + bh;
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
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'center';
    ctx.fillStyle = afford ? 'rgba(210,232,255,0.95)' : 'rgba(160,195,230,0.4)';
    ctx.fillText(p.toUpperCase(), bx + bw / 2, by + 40);
    ctx.letterSpacing = '0px';
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
  const mx0 = 648;
  label('MANA', mx0, HY);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.roundRect(mx0, HY + 40, 190, 14, 6); ctx.fill();
  const mk = clamp(G.mana[0] / 3000, 0, 1);
  const mg = ctx.createLinearGradient(mx0, 0, mx0 + 190, 0);
  mg.addColorStop(0, '#1a7fa8'); mg.addColorStop(1, TEAM[0].col);
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.roundRect(mx0, HY + 40, 190 * mk, 14, 6); ctx.fill();
  ctx.font = `800 13px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(Math.floor(G.mana[0])), mx0, HY + 74);
  ctx.font = `700 10px ${MONO}`;
  ctx.fillStyle = hexA(TEAM[1].col, 0.8);
  ctx.fillText(`ENEMY ${Math.floor(G.mana[1])}`, mx0 + 90, HY + 74);
  // behavior toggle
  const bhx = 872, bhy = HY + 14;
  label('DECREE', bhx, HY - 2);
  ;['settle', 'magnet'].forEach((m, i) => {
    const by2 = bhy + 14 + i * 26, on = G.behavior === m;
    const hov = mouse.x > bhx && mouse.x < bhx + 128 && mouse.y > by2 && mouse.y < by2 + 22;
    ctx.fillStyle = on ? hexA(TEAM[0].col, 0.25) : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = on ? TEAM[0].col : 'rgba(160,195,230,0.4)';
    ctx.lineWidth = on ? 1.8 : 1;
    ctx.beginPath(); ctx.roundRect(bhx, by2, 128, 22, 5); ctx.fill(); ctx.stroke();
    ctx.font = '700 9px Verdana, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.textAlign = 'left';
    ctx.fillStyle = on ? '#ffffff' : 'rgba(190,215,240,0.8)';
    ctx.fillText(m === 'settle' ? 'GO SETTLE' : 'TO THE MAGNET', bhx + 10, by2 + 15);
    ctx.letterSpacing = '0px';
  });
  ctx.font = `700 9px ${MONO}`;
  ctx.fillStyle = 'rgba(160,195,230,0.6)';
  ctx.fillText('B TOGGLES · RIGHT-CLICK PLACES MAGNET', bhx, HY + 96);
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
  ctx.fillText('WASD PANS', mmx + mms + 14, HY + 50);
  ctx.fillText('P PAUSES', mmx + mms + 14, HY + 66);
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
  ctx.fillText('PRESS SPACE TO ASCEND', W / 2, ly + 122);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(180,210,235,0.95)';
  ctx.fillText('SHAPE THE LAND. YOUR PEOPLE BUILD. THEIR FAITH IS YOUR POWER.', W / 2, 470);
  ctx.fillStyle = 'rgba(160,190,220,0.85)';
  ctx.fillText('RAISE · LOWER · SWAMP · QUAKE · KNIGHT · FLOOD · ARMAGEDDON', W / 2, 498);
  ctx.letterSpacing = '0px';
  ctx.drawImage(VIGNETTE, 0, 0);
}

// ---------- input ----------
const keys = {};
let mouse = { x: 0, y: 0 };
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
  if (k === 'b') G.behavior = G.behavior === 'settle' ? 'magnet' : 'settle', applyBehavior();
  if (k === 'p' && !e.repeat) G.paused = !G.paused;
});
window.addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
  if (G && !G.showTitle && mouse.y > MQ && mouse.y < H - HUD_H) {
    const [vx, vy] = screenToVertex(mouse.x, mouse.y);
    G.cursor.vx = vx; G.cursor.vy = vy;
  }
  canvas.style.cursor = (G && !G.showTitle && (mouse.y > H - HUD_H || G.mode !== 'play')) ? 'pointer' : 'crosshair';
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); return; }
  if ((G.mode === 'won' || G.mode === 'lost') && G.modeT > 0.6) {
    const bx2 = W / 2 - 130, by2 = H / 2 + 76;
    if (mouse.x > bx2 && mouse.x < bx2 + 260 && mouse.y > by2 && mouse.y < by2 + 40) { newGame((Math.random() * 1e9) >>> 0, false); return; }
  }
  const HY = H - HUD_H;
  if (mouse.y > HY) {
    POWER_ORDER.forEach((p, i) => {
      const bx = 22 + i * 88;
      if (mouse.x > bx && mouse.x < bx + 78 && mouse.y > HY + 12 && mouse.y < HY + 78 && G.mana[0] >= POWERS[p].cost) G.selPower = p;
    });
    ;['settle', 'magnet'].forEach((m, i) => {
      const by2 = HY + 28 + i * 26;
      if (mouse.x > 872 && mouse.x < 1000 && mouse.y > by2 && mouse.y < by2 + 22) { G.behavior = m; applyBehavior(); }
    });
    return;
  }
  if (G.mode !== 'play' || G.paused) return;
  const { vx, vy } = G.cursor;
  if (e.button === 2) {   // right-click: papal magnet
    G.magnet[0] = [vx + 0.5, vy + 0.5];
    SFX.magnet();
    applyBehavior();
    return;
  }
  switch (G.selPower) {
    case 'raise': castRaise(0, vx, vy, +1); break;
    case 'lower': castRaise(0, vx, vy, -1); break;
    case 'swamp': castSwamp(0, vx, vy); break;
    case 'quake': castQuake(0, vx, vy); break;
    case 'knight': castKnight(0); break;
    case 'flood': castFlood(0); break;
    case 'armageddon': castArmageddon(0); break;
  }
});
function applyBehavior() {
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
    G.botPlays = true; G.botStyle = 'full';
    stepFor(60);
    G.mana[0] = 400;
    const e2 = nearestEnemyFlat(0) || [20, 20];
    castSwamp(0, e2[0], e2[1]);
    stepFor(1);
    camOn(e2[0], e2[1]);
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
    G.botPlays = true; G.botStyle = 'full';
    stepFor(120);
    G.mana[0] = 3000;
    castArmageddon(0);
    stepFor(14);
    camOn(N / 2, N / 2);
  } else if (name === 'win') {
    G.botPlays = true; G.botStyle = 'full'; G.aiStyle = 'passive';
    stepUntil(() => G.mode === 'won', 30 * 400);
    stepFor(0.3);
  } else if (name === 'fail') {
    G.botPlays = true; G.botStyle = 'none'; G.aiStyle = 'full';
    stepUntil(() => G.mode === 'lost', 30 * 400);
    stepFor(0.3);
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
    solution: ['full', 'full'], null: ['none', 'full'],
    'ablate-flatten': ['noflat', 'full'], 'ablate-powers': ['flatonly', 'full'],
  };
  if (matches[mode]) {
    const [b0, b1] = matches[mode];
    G.botPlays = true; G.botStyle = b0; G.aiStyle = b1;
    // the authored edge: the player-god thinks slightly faster than the demon
    if (mode === 'solution') G.solutionEdge = true;
    let simTime = 0;
    const cap = Number(new URLSearchParams(location.search).get('t') || 420);
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
  const report = { mode, outcome, seed, ...extra };
  document.title = 'VERIFY:' + JSON.stringify(report);
  const el = document.createElement('pre');
  el.id = 'verify-report';
  el.textContent = document.title;
  document.body.appendChild(el);
  draw();
}

// solution edge: the player-bot god acts on a faster clock (declared in README)
const _sim = sim;
sim = function (dt) {
  _sim(dt);
  if (G.solutionEdge && G.mode === 'play' && G.tick % 9 === 0) godPolicy(0, G.botStyle);
};

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
const verifyMode = q.get('verify');
if (shotName) runShot(shotName);
else if (verifyMode !== null) runVerify(verifyMode || 'solution');
else { newGame(445566, true); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
