(() => {
  'use strict';

  const WIDTH = 360;
  const HEIGHT = 540;
  const CELL = 30;
  const COLS = 12;
  const ROWS = 18;
  const FOV = Math.PI * 0.48;
  const SIGHT = 166;
  const PLAYER_RADIUS = 10;
  const ENEMY_RADIUS = 11;
  const PLAYER_SPEED = 139;
  const PATROL_SPEED = 57;
  const CHASE_SPEED = 186;
  const BEST_KEY = 'one-take-game-005-best-v1';
  const NORMAL_HANDS = ['👆', '👉', '👇', '👈'];
  const CHASE_HANDS = ['🫵', '🫵', '🫵', '🫵'];
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const $ = (id) => document.getElementById(id);
  const canvas = $('field');
  const ctx = canvas.getContext('2d');
  const stageNameEl = $('stageName');
  const modeTextEl = $('modeText');
  const timeTextEl = $('timeText');
  const playerEl = $('player');
  const enemyEl = $('enemy');
  const enemyFaceEl = $('enemyFace');
  const hands = Array.from(document.querySelectorAll('.enemy-hand'));
  const titleScreen = $('titleScreen');
  const resultScreen = $('resultScreen');
  const shell = $('fieldShell');
  const stickEl = $('joystick');
  const knobEl = $('joystickKnob');
  const flashEl = $('flash');
  const warningEl = $('alertMessage');
  const muteButtons = [...document.querySelectorAll('[data-mute]')];

  canvas.width = WIDTH * 2;
  canvas.height = HEIGHT * 2;
  ctx.setTransform(2, 0, 0, 2, 0, 0);

  const rand = (min, max) => min + Math.random() * (max - min);
  const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hypot = Math.hypot;
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const atCenter = (c, r) => ({x: (c + .5) * CELL, y: (r + .5) * CELL});
  const cellAt = (x, y) => ({c: clamp(Math.floor(x / CELL), 0, COLS - 1), r: clamp(Math.floor(y / CELL), 0, ROWS - 1)});
  const index = (c, r) => r * COLS + c;
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '--:--.--';
    const cs = Math.floor(Math.max(0, seconds) * 100 + 0.00001);
    return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };

  // Three authored layouts. Empty squares remain a generous 30px grid; obstacles never change per run.
  const LEVEL_DEFS = [
    {name: 'STAGE A', kind: '開けた倉庫', walls: [[2, 5, 5, 1], [8, 3, 1, 3], [5, 11, 5, 1], [3, 13, 1, 2]], boxes: [[3, 8], [9, 8], [7, 14]], pillars: [[6, 3], [2, 11], [9, 15]]},
    {name: 'STAGE B', kind: '曲がりくねった通路', walls: [[4, 2, 1, 3], [4, 6, 1, 3], [7, 9, 1, 3], [7, 13, 1, 3], [7, 6, 4, 1], [1, 13, 4, 1]], boxes: [[2, 5], [9, 4], [9, 12], [4, 15]], pillars: [[6, 2], [2, 10], [6, 16]]},
    {name: 'STAGE C', kind: '箱と柱の迷路', walls: [[4, 4, 3, 1], [2, 10, 3, 1], [7, 13, 3, 1]], boxes: [[2, 3], [8, 3], [5, 7], [9, 9], [3, 14], [6, 15]], pillars: [[7, 2], [2, 7], [7, 10], [9, 15], [5, 12]]}
  ];

  function makeLevel(def) {
    const grid = Array.from({length: ROWS}, (_, r) => Array.from({length: COLS}, (_, c) =>
      r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? '#' : '.'));
    for (const [x, y, w, h] of def.walls) for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) grid[r][c] = '#';
    for (const [c, r] of def.boxes) grid[r][c] = 'B';
    for (const [c, r] of def.pillars) grid[r][c] = 'O';
    const blocks = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== '.') blocks.push({x: c * CELL, y: r * CELL, w: CELL, h: CELL, type: grid[r][c], c, r});
    }
    const free = (c, r) => !!grid[r] && grid[r][c] === '.';
    return {name: def.name, kind: def.kind, grid, blocks, free};
  }
  const levels = LEVEL_DEFS.map(makeLevel);

  // Cardinal BFS is intentionally shared by spawn validation and enemy navigation.
  function findRoute(level, from, to) {
    if (!level.free(from.c, from.r) || !level.free(to.c, to.r)) return null;
    const start = index(from.c, from.r);
    const goal = index(to.c, to.r);
    const previous = new Int16Array(COLS * ROWS).fill(-1);
    const queue = [start];
    previous[start] = start;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (current === goal) break;
      const c = current % COLS, r = Math.floor(current / COLS);
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr, ni = index(nc, nr);
        if (level.free(nc, nr) && previous[ni] === -1) {
          previous[ni] = current;
          queue.push(ni);
        }
      }
    }
    if (previous[goal] === -1) return null;
    const route = [];
    for (let n = goal; n !== start; n = previous[n]) route.push({c: n % COLS, r: Math.floor(n / COLS)});
    route.push(from);
    route.reverse();
    return route;
  }

  function inBlock(level, x, y, radius) {
    if (x - radius < 0 || y - radius < 0 || x + radius > WIDTH || y + radius > HEIGHT) return true;
    for (const b of level.blocks) {
      const cx = clamp(x, b.x, b.x + b.w);
      const cy = clamp(y, b.y, b.y + b.h);
      if ((cx - x) ** 2 + (cy - y) ** 2 < radius * radius - 0.0001) return true;
    }
    return false;
  }

  function moveDisc(level, actor, dx, dy, radius) {
    // Substeps prevent tunnelling; independent axes make corners slide naturally.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const sx = dx / steps, sy = dy / steps;
    const x0 = actor.x, y0 = actor.y;
    for (let i = 0; i < steps; i++) {
      if (!inBlock(level, actor.x + sx, actor.y, radius)) actor.x += sx;
      if (!inBlock(level, actor.x, actor.y + sy, radius)) actor.y += sy;
    }
    return hypot(actor.x - x0, actor.y - y0);
  }

  // Analytic ray/AABB intersection. The visible polygon and recognition tests use this SAME occlusion logic.
  function castRay(level, x, y, angle, distance) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let nearest = distance;
    for (const b of level.blocks) {
      const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
      let lo = 0, hi = nearest;
      if (Math.abs(dx) < 1e-9) { if (x < x0 || x > x1) continue; }
      else {
        let t0 = (x0 - x) / dx, t1 = (x1 - x) / dx;
        if (t0 > t1) [t0, t1] = [t1, t0];
        lo = Math.max(lo, t0); hi = Math.min(hi, t1);
        if (lo > hi) continue;
      }
      if (Math.abs(dy) < 1e-9) { if (y < y0 || y > y1) continue; }
      else {
        let t0 = (y0 - y) / dy, t1 = (y1 - y) / dy;
        if (t0 > t1) [t0, t1] = [t1, t0];
        lo = Math.max(lo, t0); hi = Math.min(hi, t1);
        if (lo > hi) continue;
      }
      if (lo < nearest) nearest = lo;
    }
    return nearest;
  }

  function wrapAngle(angle) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
  function canSeePoint(level, enemy, x, y) {
    const dx = x - enemy.x, dy = y - enemy.y;
    const dist = hypot(dx, dy);
    if (dist > SIGHT || dist < 0.01) return dist < 0.01;
    const angle = Math.atan2(dy, dx);
    if (Math.abs(wrapAngle(angle - enemy.angle)) > FOV / 2 - 0.00001) return false;
    return castRay(level, enemy.x, enemy.y, angle, dist) >= dist - 0.05;
  }
  function canSeePlayer(level, enemy, player) {
    const p = PLAYER_RADIUS * .64;
    return [[0, 0], [p, 0], [-p, 0], [0, p], [0, -p]]
      .some(([ox, oy]) => canSeePoint(level, enemy, player.x + ox, player.y + oy));
  }

  let phase = 'title';
  let level = null;
  let player = {x: 0, y: 0};
  let enemy = {x: 0, y: 0, angle: 0, orbit: 0, state: 'patrol', wait: 0, target: null, path: null, repath: 0, stuck: 0, lastX: 0, lastY: 0};
  let exit = {x: 0, y: 0};
  let elapsed = 0;
  let eyeContact = 0;
  let protectedUntil = 1.15;
  let best = null;
  let muted = true; // ALWAYS begin muted, even after a previous unmuted run.
  let audioCtx = null;
  let pointerId = null;
  let thumb = {x: 0, y: 0};
  const keys = new Set();
  let previousFrame = performance.now();

  try { const stored = Number(localStorage.getItem(BEST_KEY)); if (stored > 0 && Number.isFinite(stored)) best = stored; } catch (_) { /* private browsing can disable storage */ }

  function syncMute() {
    for (const button of muteButtons) {
      if (button.classList.contains('mute-toggle')) button.innerHTML = `${muted ? '🔇' : '🔊'} <span>${muted ? 'OFF' : 'ON'}</span>`;
      else button.textContent = muted ? '🔇 音声 OFF' : '🔊 音声 ON';
      button.setAttribute('aria-label', muted ? '音声をオンにする' : '音声をミュートする');
      button.setAttribute('aria-pressed', String(!muted));
    }
  }
  function playSound(type) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const presets = {
        start: [[350, 510, .12, 'sine', .08], [510, 720, .16, 'sine', .07]],
        alarm: [[520, 180, .2, 'sawtooth', .14], [690, 285, .21, 'square', .045]],
        loss: [[260, 110, .36, 'triangle', .13]],
        win: [[510, 690, .12, 'sine', .10], [690, 890, .17, 'sine', .10], [890, 1100, .24, 'sine', .11]]
      };
      let offset = 0;
      for (const [f1, f2, duration, waveform, volume] of presets[type] || []) {
        const now = audioCtx.currentTime + offset;
        const osc = audioCtx.createOscillator(), amp = audioCtx.createGain();
        osc.type = waveform;
        osc.frequency.setValueAtTime(f1, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, f2), now + duration);
        amp.gain.setValueAtTime(.0001, now);
        amp.gain.exponentialRampToValueAtTime(volume, now + .015);
        amp.gain.exponentialRampToValueAtTime(.0001, now + duration);
        osc.connect(amp); amp.connect(audioCtx.destination);
        osc.start(now); osc.stop(now + duration + .015);
        offset += duration * .78;
      }
    } catch (_) { /* sound is optional */ }
  }
  muteButtons.forEach(button => button.addEventListener('click', () => {muted = !muted; syncMute(); if (!muted) playSound('start');}));
  syncMute();

  function pickSpawn(lvl) {
    const bottom = Math.random() < .5;
    const starts = [], exits = [], foes = [];
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      if (!lvl.free(c, r)) continue;
      if (r >= (bottom ? 12 : 1) && r <= (bottom ? 16 : 5)) starts.push({c, r});
      if (r >= (bottom ? 1 : 12) && r <= (bottom ? 5 : 16)) exits.push({c, r});
      if (r >= 6 && r <= 11) foes.push({c, r});
    }
    const possibilities = [];
    for (const s of starts) for (const e of exits) {
      const route = findRoute(lvl, s, e);
      if (route && route.length >= 11 && hypot(s.c - e.c, s.r - e.r) > 8) possibilities.push({s, e});
    }
    if (!possibilities.length) throw new Error('Stage layout has no reachable start/exit pair');
    const {s, e} = choose(possibilities);
    const start = atCenter(s.c, s.r), goal = atCenter(e.c, e.r);
    const validFoes = foes.filter(f => {
      const p = atCenter(f.c, f.r);
      return hypot(start.x - p.x, start.y - p.y) >= 155 &&
        hypot(goal.x - p.x, goal.y - p.y) >= 90 && !!findRoute(lvl, f, s);
    });
    const f = choose(validFoes.length ? validFoes : foes);
    const foe = atCenter(f.c, f.r);
    const safeFacing = DIRS.map(([dx, dy]) => Math.atan2(dy, dx))
      .filter(angle => !canSeePlayer(lvl, {x: foe.x, y: foe.y, angle}, start));
    return {start, goal, foe, angle: choose(safeFacing.length ? safeFacing : [0, Math.PI / 2, Math.PI, -Math.PI / 2])};
  }

  function resetMovement() {
    keys.clear(); thumb.x = thumb.y = 0;
    pointerId = null;
    knobEl.style.left = '50%'; knobEl.style.top = '50%';
  }

  function applyEnemyAppearance() {
    const spotted = enemy.state === 'chase';
    enemyFaceEl.textContent = spotted ? '🫪' : '😁';
    for (let i = 0; i < 4; i++) hands[i].textContent = spotted ? CHASE_HANDS[i] : NORMAL_HANDS[i];
    enemyEl.classList.toggle('chase-face', spotted);
    shell.classList.toggle('chasing', spotted);
    document.querySelector('.hud').classList.toggle('danger', spotted);
    modeTextEl.textContent = spotted ? '追跡中！ 走れ！' : '見つからずに脱出';
  }

  function begin(forcedStage) {
    const idx = Number.isInteger(forcedStage) && forcedStage >= 0 && forcedStage < levels.length ? forcedStage : Math.floor(Math.random() * levels.length);
    level = levels[idx];
    const spawns = pickSpawn(level);
    player = {...spawns.start};
    exit = {...spawns.goal};
    enemy = {...spawns.foe, lastX: spawns.foe.x, lastY: spawns.foe.y, angle: spawns.angle,
      orbit: 0, state: 'patrol', wait: rand(.4, .85), target: null, path: null, repath: 0, stuck: 0};
    elapsed = 0;
    eyeContact = 0;
    protectedUntil = 1.15;
    phase = 'playing';
    resetMovement();
    applyEnemyAppearance();
    stageNameEl.textContent = level.name;
    timeTextEl.textContent = '00:00.00';
    titleScreen.classList.add('is-hidden');
    resultScreen.classList.add('is-hidden');
    warningEl.classList.remove('active');
    flashEl.classList.remove('active');
    enemyEl.classList.remove('alarmed');
    playSound('start');
    updateGlyphPositions();
  }

  function recognize() {
    if (phase !== 'playing' || enemy.state === 'chase') return;
    enemy.state = 'chase';
    enemy.path = null;
    enemy.wait = 0;
    enemy.repath = 0;
    enemy.stuck = 0;
    eyeContact = 0;
    applyEnemyAppearance();
    for (const [el, className] of [[flashEl, 'active'], [warningEl, 'active'], [enemyEl, 'alarmed']]) {
      el.classList.remove(className); void el.offsetWidth; el.classList.add(className);
    }
    playSound('alarm');
  }

  function finish(success) {
    if (phase !== 'playing') return;
    phase = success ? 'won' : 'lost';
    resetMovement();
    let record = false;
    if (success && (best === null || elapsed < best)) {
      best = elapsed;
      record = true;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) { /* optional persistence */ }
    }
    $('resultLabel').textContent = success ? 'MISSION COMPLETE' : 'GAME OVER';
    $('resultIcon').textContent = success ? '🚪✨' : '🫵🫪';
    $('resultTitle').textContent = success ? '脱出成功！' : 'つかまった！';
    $('resultMessage').textContent = success ? '出口まで逃げ切った！' : '見つかったら、全力で逃げよう。';
    $('resultTime').textContent = formatTime(elapsed);
    $('resultBest').textContent = formatTime(best);
    $('recordBox').hidden = false;
    $('newRecord').hidden = !record;
    resultScreen.classList.remove('is-hidden');
    modeTextEl.textContent = success ? '脱出成功' : 'つかまった';
    playSound(success ? 'win' : 'loss');
  }

  function pickPatrolTarget() {
    const cell = cellAt(enemy.x, enemy.y);
    const options = [];
    const dirs = DIRS.slice().sort(() => Math.random() - .5);
    for (const [dc, dr] of dirs) {
      const limit = Math.floor(rand(2, 6));
      let last = null;
      for (let n = 1; n <= limit; n++) {
        const c = cell.c + dc * n, r = cell.r + dr * n;
        if (!level.free(c, r)) break;
        last = {c, r};
        if (n >= 2) options.push({...last, weight: n});
      }
      if (last && !options.some(o => o.c === last.c && o.r === last.r)) options.push({...last, weight: 1});
    }
    if (!options.length) {
      enemy.wait = rand(.2, .4);
      return;
    }
    const goal = choose(options);
    enemy.target = atCenter(goal.c, goal.r);
  }

  function updatePatrol(dt) {
    if (enemy.wait > 0) { enemy.wait = Math.max(0, enemy.wait - dt); return; }
    if (!enemy.target) pickPatrolTarget();
    if (!enemy.target) return;
    const dx = enemy.target.x - enemy.x, dy = enemy.target.y - enemy.y;
    const distance = hypot(dx, dy);
    if (distance < 2) {
      enemy.target = null;
      enemy.wait = rand(.28, 1.08);
      return;
    }
    enemy.angle = Math.atan2(dy, dx);
    const step = Math.min(PATROL_SPEED * dt, distance);
    const amount = moveDisc(level, enemy, dx / distance * step, dy / distance * step, ENEMY_RADIUS);
    if (amount < .01) {
      enemy.target = null;
      enemy.wait = rand(.18, .45);
    }
  }

  function updateChase(dt) {
    enemy.repath -= dt;
    if (enemy.repath <= 0 || !enemy.path) {
      enemy.repath = .23;
      const origin = cellAt(enemy.x, enemy.y), target = cellAt(player.x, player.y);
      enemy.path = findRoute(level, origin, target) || [origin];
    }
    const cell = cellAt(enemy.x, enemy.y);
    let dest = player;
    if (enemy.path && enemy.path.length > 1) {
      // The next grid square avoids obstacles; route always consists of open cardinal neighbours.
      let next = enemy.path[1];
      if (enemy.path[0].c !== cell.c || enemy.path[0].r !== cell.r) {
        const updated = findRoute(level, cell, cellAt(player.x, player.y));
        if (updated && updated.length > 1) { enemy.path = updated; next = updated[1]; }
      }
      dest = atCenter(next.c, next.r);
      // If a turn requires centering on a lane, align first to avoid catching a corner.
      const prev = atCenter(cell.c, cell.r);
      if (enemy.stuck > .12 || (Math.abs(next.c - cell.c) > 0 && Math.abs(enemy.y - prev.y) > 8) ||
          (Math.abs(next.r - cell.r) > 0 && Math.abs(enemy.x - prev.x) > 8)) dest = prev;
    }
    const dx = dest.x - enemy.x, dy = dest.y - enemy.y;
    const distance = hypot(dx, dy);
    if (distance > .01) {
      enemy.angle = Math.atan2(dy, dx);
      const step = Math.min(CHASE_SPEED * dt, distance);
      const moved = moveDisc(level, enemy, dx / distance * step, dy / distance * step, ENEMY_RADIUS);
      enemy.stuck = moved < step * .12 ? enemy.stuck + dt : Math.max(0, enemy.stuck - dt * 3);
      if (enemy.stuck > .65) { enemy.path = null; enemy.repath = 0; enemy.stuck = .2; }
    } else { enemy.path = null; enemy.repath = 0; }
  }

  function update(dt) {
    if (phase !== 'playing' || !level) return;
    elapsed += dt;
    timeTextEl.textContent = formatTime(elapsed);

    let vx = thumb.x, vy = thumb.y;
    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    if (left || right || up || down) { vx = Number(right) - Number(left); vy = Number(down) - Number(up); }
    const magnitude = hypot(vx, vy);
    if (magnitude > 1) { vx /= magnitude; vy /= magnitude; }
    moveDisc(level, player, vx * PLAYER_SPEED * dt, vy * PLAYER_SPEED * dt, PLAYER_RADIUS);

    // Reaching the exit has priority over a capture on the same simulation step.
    if (hypot(player.x - exit.x, player.y - exit.y) < 19) {finish(true); return;}
    if (enemy.state === 'patrol') {
      updatePatrol(dt);
      if (elapsed >= protectedUntil && canSeePlayer(level, enemy, player)) eyeContact += dt;
      else eyeContact = 0;
      if (eyeContact >= .12) recognize();
    } else {
      updateChase(dt);
      if (hypot(player.x - enemy.x, player.y - enemy.y) < PLAYER_RADIUS + ENEMY_RADIUS + 1) {finish(false); return;}
    }
    enemy.orbit += dt * (enemy.state === 'chase' ? 3.65 : 2.1); // screen-space clockwise orbit
  }

  function roundedRect(x, y, w, h, rad) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, rad);
  }
  function drawFloor() {
    ctx.fillStyle = '#111b30'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const grad = ctx.createRadialGradient(175, 235, 25, 175, 235, 355);
    grad.addColorStop(0, '#24334a'); grad.addColorStop(1, '#111a2c');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = '#ffffff0a'; ctx.lineWidth = .9;
    ctx.beginPath();
    for (let x = 0; x <= WIDTH; x += CELL) {ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, HEIGHT);}
    for (let y = 0; y <= HEIGHT; y += CELL) {ctx.moveTo(0, y + .5); ctx.lineTo(WIDTH, y + .5);}
    ctx.stroke();
    if (level) {
      ctx.fillStyle = '#dceaff0b';ctx.font = 'bold 10px system-ui';
      ctx.fillText(level.kind, 34, HEIGHT - 35);
    }
  }
  function drawVision() {
    if (!level) return;
    const chase = enemy.state === 'chase';
    const points = [];
    const samples = 84;
    for (let i = 0; i <= samples; i++) {
      const a = enemy.angle - FOV / 2 + i / samples * FOV;
      const d = castRay(level, enemy.x, enemy.y, a, SIGHT);
      points.push({x: enemy.x + Math.cos(a) * d, y: enemy.y + Math.sin(a) * d});
    }
    ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = chase ? '#ff42502d' : '#f6dd7b47'; ctx.fill();
    ctx.strokeStyle = chase ? '#ff84938c' : '#ffe59c8c'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 37, 0, Math.PI * 2);
    ctx.fillStyle = chase ? '#fe385b10' : '#f6d98a09'; ctx.fill();
  }
  function drawExit() {
    const pulse = .5 + .5 * Math.sin(elapsed * 4.5);
    ctx.save();
    ctx.shadowBlur = 13 + pulse * 7; ctx.shadowColor = '#5decc7';
    roundedRect(exit.x - 13, exit.y - 14, 26, 28, 5);
    ctx.fillStyle = '#42c59e'; ctx.fill();
    ctx.shadowBlur = 0;
    roundedRect(exit.x - 10, exit.y - 11, 20, 22, 3);
    ctx.fillStyle = '#0e524e'; ctx.fill();
    ctx.strokeStyle = '#c2fff0'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = '#b2ffda'; ctx.font = '900 8px system-ui';
    ctx.textAlign = 'center'; ctx.fillText('EXIT', exit.x, exit.y + 2);
    ctx.restore();
    ctx.save();ctx.strokeStyle = `rgba(100,255,193,${.25 + pulse * .24})`; ctx.lineWidth = 1.4;
    ctx.beginPath();ctx.arc(exit.x, exit.y, 17 + 2.2 * pulse, 0, Math.PI * 2);ctx.stroke();ctx.restore();
  }
  function drawBlocks() {
    for (const b of level.blocks) {
      if (b.type === '#') {
        const x = b.x, y = b.y;
        ctx.fillStyle = '#253755'; ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = '#43577a'; ctx.fillRect(x + 1, y + 1, CELL - 2, 4);
        ctx.fillStyle = '#111a30'; ctx.fillRect(x + 1, y + CELL - 4, CELL - 2, 3);
        ctx.strokeStyle = '#182840'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, CELL - 1, CELL - 1);
        ctx.fillStyle = '#65779d4f'; ctx.fillRect(x + 4, y + 8, 2, 2);
      } else if (b.type === 'B') {
        ctx.fillStyle = '#0b0c18aa'; roundedRect(b.x + 4, b.y + 6, 25, 25, 3);ctx.fill();
        ctx.fillStyle = '#98725c'; roundedRect(b.x + 2, b.y + 2, 25, 25, 3); ctx.fill();
        ctx.strokeStyle = '#dfad82';ctx.lineWidth = 2;ctx.stroke();
        ctx.strokeStyle = '#664b44';ctx.lineWidth = 2;
        ctx.beginPath();ctx.moveTo(b.x + 5, b.y + 5);ctx.lineTo(b.x + 24, b.y + 24);ctx.moveTo(b.x + 24, b.y + 5);ctx.lineTo(b.x + 5, b.y + 24);ctx.stroke();
      } else {
        ctx.beginPath();ctx.ellipse(b.x + 16, b.y + 19, 13, 10, 0, 0, Math.PI * 2);ctx.fillStyle = '#090d1a91';ctx.fill();
        ctx.beginPath();ctx.arc(b.x + 15, b.y + 14, 12.7, 0, Math.PI * 2);ctx.fillStyle = '#6d7699';ctx.fill();
        ctx.lineWidth = 3;ctx.strokeStyle = '#bac3d4';ctx.stroke();
        ctx.beginPath();ctx.arc(b.x + 11, b.y + 10, 4.2, 0, Math.PI * 2);ctx.fillStyle = '#c4cee0';ctx.fill();
      }
    }
  }
  function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawFloor();
    if (!level) return;
    drawExit();
    drawVision();
    drawBlocks();
    if (enemy.state === 'chase') {
      ctx.strokeStyle = '#ff436e6b';ctx.lineWidth = 2;
      ctx.beginPath();ctx.arc(enemy.x, enemy.y, 44 + Math.sin(elapsed * 15) * 3, 0, 2 * Math.PI);ctx.stroke();
    }
    updateGlyphPositions();
  }

  function updateGlyphPositions() {
    if (!level) return;
    const width = canvas.getBoundingClientRect().width || WIDTH;
    const s = width / WIDTH;
    shell.style.setProperty('--visual-scale', s);
    playerEl.style.left = `${player.x / WIDTH * 100}%`;
    playerEl.style.top = `${player.y / HEIGHT * 100}%`;
    playerEl.style.fontSize = `${30 * s}px`;
    enemyEl.style.left = `${enemy.x / WIDTH * 100}%`;
    enemyEl.style.top = `${enemy.y / HEIGHT * 100}%`;
    enemyFaceEl.style.fontSize = `${34 * s}px`;
    for (let i = 0; i < hands.length; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 2 + enemy.orbit;
      const orbitRadius = 30.5 * s;
      hands[i].style.left = `${Math.cos(a) * orbitRadius}px`;
      hands[i].style.top = `${Math.sin(a) * orbitRadius}px`;
      hands[i].style.fontSize = `${27 * s}px`;
    }
  }

  function tick(now) {
    const dt = Math.min(.034, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  function setThumbFromPointer(ev) {
    const rect = stickEl.getBoundingClientRect();
    const dx = ev.clientX - (rect.left + rect.width / 2);
    const dy = ev.clientY - (rect.top + rect.height / 2);
    const range = rect.width * .32;
    const len = hypot(dx, dy), normalized = Math.min(1, len / range);
    thumb.x = len > .001 ? dx / len * normalized : 0;
    thumb.y = len > .001 ? dy / len * normalized : 0;
    knobEl.style.left = `${50 + thumb.x * 25}%`;
    knobEl.style.top = `${50 + thumb.y * 25}%`;
  }
  stickEl.addEventListener('pointerdown', e => {
    if (phase !== 'playing' || pointerId !== null) return;
    e.preventDefault();pointerId = e.pointerId;
    stickEl.setPointerCapture(e.pointerId);
    setThumbFromPointer(e);
  });
  stickEl.addEventListener('pointermove', e => {
    if (pointerId !== e.pointerId || phase !== 'playing') return;
    e.preventDefault();setThumbFromPointer(e);
  });
  function releaseThumb(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;thumb.x = thumb.y = 0;
    knobEl.style.left = '50%';knobEl.style.top = '50%';
    try {if (stickEl.hasPointerCapture(e.pointerId)) stickEl.releasePointerCapture(e.pointerId);} catch (_) {}
  }
  stickEl.addEventListener('pointerup', releaseThumb);
  stickEl.addEventListener('pointercancel', releaseThumb);
  stickEl.addEventListener('lostpointercapture', releaseThumb);
  const acceptedKeys = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (acceptedKeys.has(k) && phase === 'playing') {e.preventDefault();keys.add(k);}
    if (k === 'enter' && phase === 'title' && !e.repeat) begin();
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', resetMovement);
  document.addEventListener('visibilitychange', () => {if (document.hidden) resetMovement();previousFrame = performance.now();});
  $('startButton').addEventListener('click', () => begin());
  $('retryButton').addEventListener('click', () => begin());
  window.addEventListener('resize', updateGlyphPositions);

  requestAnimationFrame(tick);
})();
