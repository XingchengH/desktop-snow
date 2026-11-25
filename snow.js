let play = false;
let ledges = [];
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const hint = document.querySelector('output');
const toolbar = document.querySelector('header');
let launcherAnchor;
let toolbarBounds;
let hoverPoint;
let movingProp;
let treeDrag;

function placeToolbar() {
  if (!play || !launcherAnchor) return;
  const { x, y, size, left, right, top, bottom } = launcherAnchor;
  const gap = 8;
  toolbar.style.maxWidth = `${Math.max(1, right - left - gap * 2)}px`;
  const w = toolbar.offsetWidth, h = toolbar.offsetHeight;
  const panelX = Math.max(left + gap, Math.min(right - w - gap, x + (size - w) / 2));
  const above = y - h - gap >= top + gap &&
    (y + size + h + gap > bottom - gap || y - top > bottom - y);
  const panelY = Math.max(top + gap, Math.min(bottom - h - gap, above ? y - h - gap : y + size + gap));
  toolbar.style.left = `${panelX}px`;
  toolbar.style.top = `${panelY}px`;
  hint.style.left = `${panelX}px`;
  hint.style.top = `${above ? Math.max(top, panelY - 23) : panelY + h + 4}px`;
  toolbarBounds = { x: panelX, y: panelY, width: w, height: h };
  window.desktopSnow?.setToolbarBounds(toolbarBounds);
}
const cell = 6;
let width, height, snow, flakes, balls = [], carried, pointer, tool;
let frameTime;
let lastDragPoint, movedSnow = 0;
const outfits = {
  hat: ['帽子', '无', '礼帽', '红绒帽', '蓝绒帽', '圣诞帽', '耳罩'],
  scarf: ['围巾', '无', '莓红', '湖蓝', '浅紫', '松绿', '金色'],
  arms: ['手臂', '无', '树枝', '连指手套'],
  face: ['表情', '微笑', '开心', '惊讶', '眨眼'], nose: ['鼻子', '胡萝卜', '煤球', '红鼻子'],
  buttons: ['纽扣', '无', '煤扣', '金扣', '彩扣'],
};
const treeDecorations = {
  lighting: ['灯光', ['twinkle', '闪烁'], ['steady', '常亮'], ['off', '关灯']],
  ornaments: ['挂饰', ['none', '无'], ['classic', '红金彩球'], ['frost', '冰晶'], ['candy', '糖果']],
  garland: ['彩带', ['none', '无'], ['gold', '金色'], ['silver', '银色'], ['red', '红色']],
  topper: ['树顶', ['star', '金星'], ['snowflake', '雪花'], ['bow', '蝴蝶结'], ['none', '无']],
};
const wardrobe = document.getElementById('wardrobe');
let dressedSnowman;
let snowTexture;

function seededRandom(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const snowfallDensity = { light: 0.45, steady: 1, flurry: 1.65, paused: 0 };
const intensityLabels = { light: '小雪', steady: '中雪', flurry: '大雪', paused: '停雪' };
const intensityOrder = Object.keys(snowfallDensity);
let intensity = 'steady';
const intensityControl = document.getElementById('intensity');
let looseSnow = [];
const meltwater = [];
const puddles = [];
let wind = 0, windTarget = 0, gustStart = 0, gustDuration = 0;
let steadyWindDirection = 0;
let nextGust = 12_000 + Math.random() * 16_000, nextWindLift = 0;
let warmingUntil = 0, weatherMessageUntil = 0;
let trees = [];
const displayId = new URLSearchParams(location.search).get('display');
const sceneKey = displayId === null ? null : `desktop-snow:scene:${displayId}`;

function saveScene() {
  if (!sceneKey) return;
  const figures = balls.filter(ball => ball.stacked && ball.base && !ball.base.anchor)
    .map(ball => ({
      x: ball.base.x / width, baseRadius: ball.base.r, radius: ball.r,
      ...Object.fromEntries(Object.keys(outfits).map(part => [part, ball[part] ?? 0])),
    }));
  const planted = trees.filter(tree => !tree.anchor && tree.plantedAt !== undefined)
    .map(({ x, preferred, size, seed, lighting, ornaments, garland, topper }) => ({
      preferred: Number.isFinite(x) ? x / width : preferred, size, seed, lighting, ornaments, garland, topper,
    }));
  try { localStorage.setItem(sceneKey, JSON.stringify({ figures, planted })); }
  catch (error) { console.warn('Snow scene could not be saved:', error.message); }
}

function restoreScene() {
  if (!sceneKey) return;
  try {
    const { figures = [], planted = [] } = JSON.parse(localStorage.getItem(sceneKey) ?? '{}');
    for (const figure of figures.slice(0, 30)) {
      const { x, baseRadius, radius } = figure;
      if (![x, baseRadius, radius].every(Number.isFinite) ||
          x < 0 || x > 1 || radius < 8 || baseRadius < radius || baseRadius > 42) continue;
      const base = { x: x * width, y: groundY() - baseRadius - 5, r: baseRadius, restored: true };
      const head = { x: base.x, y: base.y - baseRadius - radius + 2, r: radius, stacked: true, base };
      for (const [part, choices] of Object.entries(outfits)) {
        if (Number.isInteger(figure[part]) && figure[part] >= 0 && figure[part] < choices.length - 1) {
          head[part] = figure[part];
        }
      }
      balls.push(base, head);
    }
    for (const tree of planted.slice(0, 8)) {
      if (![tree.preferred, tree.size, tree.seed].every(Number.isFinite) || tree.size < 0.36 || tree.size > 1.38) continue;
      trees.push({ ...tree, x: tree.preferred * width, checkAt: 0, plantedAt: performance.now() - 9000 });
    }
    syncDecorationTargets();
  } catch (error) { console.warn('Snow scene could not be restored:', error.message); }
}
const weatherMessage = document.getElementById('weather');

function startGust(now, strong = false) {
  gustStart = now;
  gustDuration = 8000 + Math.random() * 10000;
  const speed = strong || Math.random() < 0.55
    ? 145 + Math.random() * 105 : 45 + Math.random() * 55;
  windTarget = (steadyWindDirection || (Math.random() < 0.5 ? -1 : 1)) * speed;
  nextGust = now + gustDuration + 12_000 + Math.random() * 23_000;
}

function updateWind(now, dt) {
  if (!steadyWindDirection && now >= nextGust && intensity !== 'paused') startGust(now);
  const progress = gustDuration ? (now - gustStart) / gustDuration : 1;
  const envelope = progress < 1 ? Math.sin(Math.PI * Math.max(0, progress)) : 0;
  const breeze = steadyWindDirection
    ? steadyWindDirection * (112 + 32 * Math.sin(now / 2900) + 18 * Math.sin(now / 6300))
    : 12 * Math.sin(now / 4400);
  const target = Math.max(-255, Math.min(255, envelope * windTarget + breeze));
  wind += (target - wind) * (1 - Math.exp(-dt * 4));
  if (Math.abs(wind) < 120 || now < nextWindLift) return;
  nextWindLift = now + 400;
  const strength = Math.min(0.17, (Math.abs(wind) - 120) / 800);
  for (const edge of ledges) {
    if (!edge.systemBar && edge.y >= 0 && edge.y < groundY()) {
      shed(edge, wind, 0, strength, true);
    }
  }
}
let dockEdgeY;
let dockSurface;

function groundY() {
  return Math.min(height, dockEdgeY ?? height);
}

function groundTop(x) {
  return dockSurface ? edgeTop(dockSurface, x) : groundY();
}

function onGround(x) {
  return !dockSurface || (x >= dockSurface.x && x < dockSurface.x + dockSurface.width);
}

function clearTreeSpot(tree, x) {
  const floor = groundY();
  const halfWidth = 55 * tree.size;
  const top = floor - 146 * tree.size;
  if (!onGround(x - halfWidth) || !onGround(x + halfWidth) ||
      x - halfWidth < 6 || x + halfWidth > width - 6) return false;
  const blocks = [launcherAnchor && { ...launcherAnchor, width: launcherAnchor.size,
    height: launcherAnchor.size }, play && toolbarBounds];
  if (blocks.some(rect => rect && x + halfWidth > rect.x && x - halfWidth < rect.x + rect.width &&
      floor > rect.y && top < rect.y + rect.height)) return false;
  if (ledges.some(rect => !rect.systemBar && x + halfWidth > rect.x &&
      x - halfWidth < rect.x + rect.width && floor > rect.y &&
      top < rect.y + rect.height)) return false;
  if (balls.some(ball => Math.abs(ball.x - x) < halfWidth + ball.r + 8 &&
      ball.y + ball.r >= top)) return false;
  return !trees.some(other => other !== tree && other.x !== undefined &&
    Math.abs(other.x - x) < halfWidth + 55 * other.size + 12);
}

function treeSpot(tree) {
  let best;
  for (let x = 64; x < width - 64; x += 18) {
    if (!clearTreeSpot(tree, x)) continue;
    const depth = snow[Math.floor(x / cell)];
    if (depth < 1) continue;
    const score = depth - Math.abs(x - width * tree.preferred) * 0.012;
    if (!best || score > best.score) best = { x, score };
  }
  return best?.x;
}

function placeTree(tree) {
  const originalSize = tree.size;
  for (const scale of [1, 0.8, 0.65, 0.5]) {
    tree.size = Math.max(0.36, originalSize * scale);
    const x = treeSpot(tree);
    if (x !== undefined) return x;
  }
  tree.size = originalSize;
  return undefined;
}

function weatherEvent(event) {
  const now = performance.now();
  if (event === 'warm') {
    warmingUntil = now + 24_000;
    weatherMessage.textContent = '短暂回暖，积雪正在融化';
  } else if (event === 'tree') {
    if (trees.length < 8 && !trees.some(tree => tree.plantedAt === undefined)) {
      trees.push({ preferred: 0.15 + Math.random() * 0.7, size: 0.62 + Math.random() * 0.76,
        seed: Math.floor(Math.random() * 2 ** 32) });
      weatherMessage.textContent = '正在积雪中寻找空地';
    } else {
      weatherMessage.textContent = trees.length >= 8 ? '桌面最多可以种八棵树' : '等雪地腾出空位，下一棵树就会长出来';
    }
  } else {
    return;
  }
  weatherMessageUntil = now + 5500;
  weatherMessage.hidden = false;
}

function addPuddle(x, y, radius, edge) {
  if (puddles.length >= 100) return;
  const existing = puddles.find(pool => pool.edge === edge?.id && Math.abs(pool.x - (x - (edge?.x ?? 0))) < 9);
  if (existing) {
    existing.radius = Math.min(12, Math.hypot(existing.radius, radius));
    existing.age *= 0.55;
  } else {
    puddles.push({ x: x - (edge?.x ?? 0), y, edge: edge?.id, radius, age: 0 });
  }
}

function melt(depth, dt, edge) {
  for (let i = 0; i < depth.length; i++) {
    const melted = Math.min(depth[i], dt * (0.7 + 0.45 * Math.sin(i * 0.19) ** 2));
    depth[i] -= melted;
    if (Math.random() >= melted * (edge ? 0.32 : 0.075)) continue;
    const offset = (i + 0.2 + Math.random() * 0.6) * cell;
    const x = (edge?.x ?? 0) + offset;
    if (x < 0 || x >= width) continue;
    if (edge) {
      if (offset >= edge.width || isCovered(edge, x) || meltwater.length >= 180) continue;
      meltwater.push({ x, y: ledgeSurface(edge, x), vy: 12 + Math.random() * 22,
        radius: 0.9 + Math.random() * 1.3, source: edge.id, offset,
        attached: !edge.desktopItem && !edge.systemBar, age: 0 });
    } else if (onGround(x)) {
      addPuddle(x, groundTop(x) - depth[i], 2 + Math.random() * 3);
    }
  }
}

function drawMeltwater(dt) {
  const byId = new Map(ledges.map(edge => [edge.id, edge]));
  for (let i = meltwater.length - 1; i >= 0; i--) {
    const drop = meltwater[i];
    const source = byId.get(drop.source);
    const previousY = drop.y;
    drop.age += dt;
    // Run down the glass before releasing from the bottom edge.
    if (drop.attached && source && drop.offset < source.width) {
      drop.x = source.x + drop.offset;
      drop.slide = (drop.slide ?? -4) + drop.vy * dt;
      drop.y = edgeTop(source, drop.x) + drop.slide;
      drop.vy = Math.min(320, drop.vy + 300 * dt);
      if (drop.y >= source.y + source.height) drop.attached = false;
    } else {
      drop.attached = false;
      drop.vy += 590 * dt;
      drop.x += wind * dt * 0.055;
      drop.y += drop.vy * dt;
    }
    const landing = drop.attached ? undefined : findLanding(drop.x, previousY, drop.y, drop.source);
    const ground = !drop.attached && onGround(drop.x) && drop.y >= groundTop(drop.x);
    if (landing || ground) {
      addPuddle(drop.x, landing ? ledgeSurface(landing, drop.x) : groundTop(drop.x),
        drop.radius * 3, landing);
    }
    if (landing || ground || drop.y > height + 20 || drop.x < 0 || drop.x >= width || drop.age > 5) {
      meltwater.splice(i, 1);
      continue;
    }
    const trail = Math.min(17, 2 + drop.vy * 0.031);
    ctx.save();
    if (drop.attached) {
      clipBehindWindows(source.covers, {
        x: drop.x - 3, y: drop.y - trail, width: 6, height: trail + 3,
      });
    }
    ctx.strokeStyle = '#92d6f0a8';
    ctx.lineCap = 'round';
    ctx.lineWidth = drop.radius;
    ctx.beginPath();
    ctx.moveTo(drop.x - (drop.attached ? 0 : wind * 0.003), drop.y - trail);
    ctx.lineTo(drop.x, drop.y);
    ctx.stroke();
    circle(drop.x, drop.y, drop.radius, '#c4edffd9');
    ctx.restore();
  }
  for (let i = puddles.length - 1; i >= 0; i--) {
    const pool = puddles[i];
    const edge = byId.get(pool.edge);
    pool.age += dt;
    if (pool.age >= 3.2 || (pool.edge !== undefined && !edge)) {
      puddles.splice(i, 1);
      continue;
    }
    const x = pool.x + (edge?.x ?? 0);
    if (edge && (pool.x >= edge.width || isCovered(edge, x))) continue;
    const y = edge ? ledgeSurface(edge, x) : pool.y;
    const spread = pool.radius * (1 + Math.min(pool.age, 1) * 0.55);
    ctx.save();
    ctx.globalAlpha = (1 - pool.age / 3.2) * 0.72;
    ctx.translate(x, y - 1);
    ctx.scale(1, 0.19);
    circle(0, 0, spread, '#5daecf');
    circle(-spread * 0.19, -spread * 0.19, spread * 0.65, '#b9e7f4');
    ctx.restore();
  }
}

function buildTreeArtwork(seed) {
  const artwork = document.createElement('canvas');
  artwork.width = 224;
  artwork.height = 292;
  const brush = artwork.getContext('2d');
  brush.scale(2, 2);
  brush.translate(56, 143);
  const random = seededRandom(seed);
  const breadth = 0.88 + random() * 0.17;
  const snowCover = 0.28 + random() * 0.42;
  const palettes = [['#ffd68a', '#fff1c2'], ['#ffc68b', '#f59b99', '#ffe9bf'], ['#b5ddff', '#ffd191', '#9ae4ca']];
  const palette = palettes[Math.floor(random() * palettes.length)];
  const lights = [];
  brush.fillStyle = '#665044';
  brush.fillRect(-3, -44, 6, 44);
  for (let i = 0; i < 27; i++) {
    const y = -12 - i * 4.05;
    for (const side of [-1, 1]) {
      const span = (3 + (26 - i) * 1.7) * breadth * (0.72 + random() * 0.36);
      const tipY = y + 3 + random() * 8;
      const foliage = brush.createLinearGradient(0, y - 12, side * span, tipY);
      foliage.addColorStop(0, '#527d65');
      foliage.addColorStop(0.45, '#2e574a');
      foliage.addColorStop(1, '#163c35');
      brush.fillStyle = foliage;
      brush.beginPath();
      brush.moveTo(side * 2, y - 14);
      brush.quadraticCurveTo(side * span * 0.5, y - 2, side * span, tipY);
      for (let n = 0; n < 4; n++) {
        const t = 1 - (n + 1) / 5;
        brush.lineTo(side * span * (t + 0.07), y + 6 + t * 9);
        brush.lineTo(side * span * t, y + 4 + t * 5);
      }
      brush.quadraticCurveTo(0, y + 7, side * 2, y - 14);
      brush.fill();
      if (random() < snowCover) {
        brush.strokeStyle = random() > 0.45 ? '#d4e9eb' : '#a6c8cc';
        brush.lineWidth = 1.3 + random() * 1.8;
        brush.lineCap = 'round';
        brush.beginPath();
        brush.moveTo(side * span * 0.45, y - 2);
        brush.quadraticCurveTo(side * span * 0.74, y + 0.5, side * span * 0.94, tipY - 1);
        brush.stroke();
      }
    }
  }
  const rows = 3 + Math.floor(random() * 3);
  for (let row = 0; row < rows; row++) {
    const y = -25 - row * (76 / (rows - 1));
    const span = (34 + (y + 25) * 0.29) * breadth;
    const bulbs = 4 + Math.floor(random() * 4);
    for (let i = 0; i < bulbs; i++) {
      const t = (i + 0.25 + random() * 0.5) / bulbs;
      lights.push({ x: (2 * t - 1) * span, y: y + Math.sin(t * Math.PI) * 7,
        color: palette[Math.floor(random() * palette.length)], phase: random() * 7,
        speed: 0.6 + random() * 1.4, radius: 3.4 + random() * 2.2 });
    }
  }
  const ornaments = lights.filter((_, index) => index % 2 === 0)
    .map(({ x, y }) => ({ x, y: y + 5 + random() * 3 }));
  const glow = document.createElement('canvas');
  glow.width = glow.height = 24;
  const lightBrush = glow.getContext('2d');
  const halo = lightBrush.createRadialGradient(12, 12, 0, 12, 12, 12);
  halo.addColorStop(0, '#fff0bdde');
  halo.addColorStop(0.35, '#ffd1825c');
  halo.addColorStop(1, '#ffd18200');
  lightBrush.fillStyle = halo;
  lightBrush.fillRect(0, 0, 24, 24);
  return { artwork, lights, glow, ornaments };
}

function clipBehindWindows(covers, bounds) {
  for (const rect of covers) {
    if (rect.systemBar || rect.x >= bounds.x + bounds.width || rect.x + rect.width <= bounds.x ||
        rect.y >= bounds.y + bounds.height || rect.y + rect.height <= bounds.y) continue;
    // Intersect one exclusion at a time so overlapping windows stay opaque.
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip('evenodd');
  }
}

function drawTree(tree, now) {
  tree.hit = undefined;
  const edge = tree.anchor && anchoredEdge(tree.anchor);
  if (tree.anchor) {
    if (!edge) return;
    tree.x = edge.x + tree.anchor.offset;
    if (!fitsLedge(edge, tree.x, 55 * tree.size, 146 * tree.size, true)) return;
  } else if (tree.x === undefined) {
    if (now < (tree.checkAt ?? 0)) return;
    tree.checkAt = now + 350;
    tree.x = placeTree(tree);
    if (tree.x === undefined) return;
    if (tree.plantedAt === undefined) {
      tree.plantedAt = now;
      saveScene();
      weatherMessage.textContent = '积雪里长出了一棵圣诞树';
      weatherMessageUntil = now + 5500;
      weatherMessage.hidden = false;
    }
  }
  const growth = 1 - (1 - Math.max(0, Math.min(1, (now - tree.plantedAt) / 9000))) ** 2;
  const x = tree.x;
  const y = edge ? ledgeSurface(edge, x) : groundY() - snow[Math.floor(x / cell)] * 0.5;
  tree.hit = { x: x - 43 * tree.size, y: y - 138 * tree.size * growth,
    width: 86 * tree.size, height: 138 * tree.size * growth };
  ctx.save();
  clipBehindWindows(edge?.covers ?? ledges, {
    x: x - 72 * tree.size, y: y - 143 * tree.size,
    width: 144 * tree.size, height: 146 * tree.size,
  });
  ctx.translate(x, y);
  ctx.scale(growth * tree.size, growth * tree.size);
  ctx.transform(1, 0, -wind / 2200, 1, 0, 0);
  paintTree(tree.artwork ??= buildTreeArtwork(tree.seed), now, tree);
  ctx.restore();
}

function treeDrop(tree, x, y) {
  const edge = playableLedge(x, y, true);
  if (edge && fitsLedge(edge, x, 55 * tree.size, 146 * tree.size) &&
      !trees.some(other => other !== tree && other.anchor?.id === edge.id &&
        Math.abs(edge.x + other.anchor.offset - x) < 55 * (tree.size + other.size) + 12)) {
    return { x, y: ledgeSurface(edge, x), anchor: { id: edge.id, offset: x - edge.x } };
  }
  if (y >= groundY() - 62 && y <= groundY() + 5) {
    const originalSize = tree.size;
    const size = [1, 0.85, 0.7, 0.55].map(scale => Math.max(0.36, originalSize * scale))
      .find(candidate => {
        tree.size = candidate;
        return clearTreeSpot(tree, x);
      });
    tree.size = originalSize;
    if (size) return { x, y: groundTop(x), size };
  }
}

function updateTreeDrag(event) {
  const { tree, startX, startY, offsetX, offsetY } = treeDrag;
  treeDrag.moved ||= Math.hypot(event.offsetX - startX, event.offsetY - startY) >= 5;
  if (!treeDrag.moved) return;
  treeDrag.x = event.offsetX + offsetX;
  treeDrag.y = event.offsetY + offsetY;
  treeDrag.drop = treeDrop(tree, treeDrag.x, treeDrag.y);
}

function drawTreeDrag(now) {
  if (!treeDrag?.moved) return;
  const { tree, drop, x, y } = treeDrag;
  ctx.save();
  ctx.translate(drop?.x ?? x, drop?.y ?? y);
  ctx.scale(drop?.size ?? tree.size, drop?.size ?? tree.size);
  ctx.globalAlpha = drop ? 0.8 : 0.38;
  paintTree(tree.artwork ??= buildTreeArtwork(tree.seed), now, tree);
  ctx.restore();
}

function paintTree({ artwork, lights, glow, ornaments }, now, style = {}) {
  const { lighting, ornaments: theme, garland, topper = 'star' } = style;
  ctx.drawImage(artwork, -56, -143, 112, 146);
  if (garland && garland !== 'none') {
    ctx.strokeStyle = { gold: '#e9bd60', silver: '#ddeffa', red: '#df6372' }[garland];
    ctx.lineWidth = 1.8;
    for (const [y, span] of [[-96, 12], [-72, 20], [-48, 28], [-25, 34]]) {
      ctx.beginPath();
      ctx.moveTo(-span, y - 3);
      ctx.quadraticCurveTo(-span * 0.15, y + 10, span, y - 5);
      ctx.stroke();
    }
  }
  if (theme && theme !== 'none') {
    ornaments.forEach(({ x, y }, index) => {
      if (theme === 'frost') {
        drawCrystal(x, y, 3.1);
      } else {
        const colors = theme === 'candy' ? ['#f087a6', '#8bdec2', '#f4bfdd'] : ['#c94e60', '#edc065', '#f5e0aa'];
        ctx.fillStyle = '#f1d599';
        ctx.fillRect(x - 0.8, y - 4, 1.6, 2);
        circle(x, y, 2.9, colors[index % colors.length]);
        circle(x - 0.9, y - 0.9, 0.85, '#ffffffb3');
      }
    });
  }
  if (topper === 'snowflake') drawCrystal(0, -132, 6.5);
  if (topper === 'bow') {
    ctx.fillStyle = '#e85a70';
    ctx.beginPath();
    ctx.moveTo(0, -132);
    ctx.quadraticCurveTo(-9, -143, -8, -131);
    ctx.quadraticCurveTo(-7, -126, 0, -132);
    ctx.quadraticCurveTo(9, -143, 8, -131);
    ctx.quadraticCurveTo(7, -126, 0, -132);
    ctx.fill();
    circle(0, -132, 1.9, '#ffacaa');
  }
  if (topper === 'star') {
    ctx.fillStyle = '#ffe1a1';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5 - Math.PI / 2;
      const r = i % 2 ? 2.7 : 6;
      if (i) ctx.lineTo(Math.cos(angle) * r, -132 + Math.sin(angle) * r);
      else ctx.moveTo(0, -138);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (lighting === 'off') return;
  const opacity = ctx.globalAlpha;
  for (const light of lights) {
    const brightness = reducedMotion.matches || lighting === 'steady' ? 0.78
      : 0.68 + 0.26 * Math.sin(now / 1000 * light.speed + light.phase);
    ctx.globalAlpha = opacity * brightness;
    const { x, y, radius } = light;
    ctx.drawImage(glow, x - radius, y - radius, radius * 2, radius * 2);
    circle(x, y, 1.1, light.color);
  }
  ctx.globalAlpha = opacity;
}

function drawCrystal(x, y, radius) {
  ctx.strokeStyle = '#d2f3ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const dx = Math.cos(i * Math.PI / 3) * radius;
    const dy = Math.sin(i * Math.PI / 3) * radius;
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
  }
  ctx.stroke();
}

function deposit(depth, index, mass, offset, limit) {
  const texture = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(index * 0.27 + offset)) ** 2;
  depth[index] += Math.min(Math.max(0, limit - depth[index]), mass * texture);
}

function settle(depth, dt) {
  for (let i = 1; i < depth.length; i++) {
    const difference = depth[i - 1] - depth[i];
    const excess = Math.max(0, Math.abs(difference) - 4.5);
    const transfer = Math.sign(difference) * excess * Math.min(0.4, dt * 7);
    depth[i - 1] -= transfer;
    depth[i] += transfer;
  }
}

function edgeTop(edge, x) {
  const radius = Math.min(edge.cornerRadius ?? 0, edge.width / 2, edge.height / 2);
  const distance = Math.min(x - edge.x, edge.x + edge.width - x);
  const offset = Math.max(0, radius - Math.max(0, distance));
  return edge.y + radius - Math.sqrt(Math.max(0, radius ** 2 - offset ** 2));
}

function isCovered(edge, x) {
  const top = edgeTop(edge, x);
  return edge.covers.some(rect => x >= rect.x && x < rect.x + rect.width &&
    top >= edgeTop(rect, x) && top <= rect.y + rect.height);
}

function drawEdgeSnow(edge) {
  if (edge.y > height + 30 || edge.y < -32 || edge.x >= width ||
      edge.x + edge.width <= 0 || !edge.depth.some(depth => depth > 0.03)) return;
  const start = Math.max(0, -edge.x);
  const end = Math.min(edge.width, width - edge.x);
  const getDepth = i => edge.depth[Math.max(0, Math.min(edge.depth.length - 1, i))] ?? 0;
  let strip = [];
  function finishStrip() {
    if (strip.length < 2) {
      strip = [];
      return;
    }
    ctx.beginPath();
    ctx.moveTo(strip[0].x, strip[0].surface);
    for (let i = 1; i < strip.length; i++) ctx.lineTo(strip[i].x, strip[i].surface);
    for (let i = strip.length - 1; i >= 0; i--) {
      ctx.lineTo(strip[i].x, strip[i].base);
    }
    ctx.closePath();
    ctx.fill();
    strip = [];
  }

  ctx.fillStyle = '#e8f4fc';
  for (let offset = start; offset <= end; offset = Math.min(end, offset + 2)) {
    const x = edge.x + offset;
    if (isCovered(edge, x)) {
      finishStrip();
      if (offset === end) break;
      continue;
    }
    const index = offset / cell - 0.5;
    const left = Math.floor(index);
    const weight = index - left;
    const depth = getDepth(left) * (1 - weight) + getDepth(left + 1) * weight;
    const radius = edge.cornerRadius || 6;
    const taper = Math.min(1, Math.min(offset, edge.width - offset) / radius);
    const base = edgeTop(edge, x);
    strip.push({ x, base, surface: base - depth * taper });
    if (offset === end) break;
  }
  finishStrip();
}

function findLanding(x, previousY, y, source) {
  return ledges.find(edge => {
    if (edge.id === -1 || edge.id === source || x < edge.x || x >= edge.x + edge.width || isCovered(edge, x)) return false;
    const surface = edgeTop(edge, x) - edge.depth[Math.floor((x - edge.x) / cell)];
    return previousY < surface && y >= surface;
  });
}

function ledgeSurface(edge, x) {
  const slot = Math.max(0, Math.min(edge.depth.length - 1, Math.floor((x - edge.x) / cell)));
  return edgeTop(edge, x) - edge.depth[slot];
}

function playableLedge(x, y, dropping = false) {
  return ledges.find(edge => !edge.systemBar && !edge.desktopItem &&
    x >= edge.x + 6 && x < edge.x + edge.width - 6 &&
    y >= edge.y - (dropping ? 58 : 36) && y < edge.y + (dropping ? 10 : 0) &&
    !isCovered(edge, x));
}

function anchoredEdge(anchor) {
  return ledges.find(edge => edge.id === anchor.id);
}

function fitsLedge(edge, x, radius, objectHeight, ignoreOcclusion = false) {
  const y = ledgeSurface(edge, x);
  return x - radius >= Math.max(0, edge.x + 6) &&
    x + radius <= Math.min(width, edge.x + edge.width - 6) && y - objectHeight >= 0 &&
    (ignoreOcclusion || !edge.covers.some(rect => rect.x < x + radius && rect.x + rect.width > x - radius &&
      rect.y < edge.y && rect.y + rect.height > y - objectHeight));
}

function ledgeTreeSize(edge, x, preferred = 0.62) {
  if (trees.length >= 8 || edgeTop(edge, x) - ledgeSurface(edge, x) < 1) return undefined;
  return [preferred, 0.42, 0.36].find(scale =>
    fitsLedge(edge, x, 55 * scale, 146 * scale) &&
    !trees.some(tree => tree.anchor?.id === edge.id &&
      Math.abs(tree.anchor.offset - (x - edge.x)) < 55 * (tree.size + scale) + 12));
}

function plantOnLedge(edge, x) {
  if (trees.length >= 8) return '这块屏幕最多可以种八棵树。';
  if (edgeTop(edge, x) - ledgeSurface(edge, x) < 1) return '等窗沿积一点雪再种树。';
  const size = ledgeTreeSize(edge, x);
  if (!size) return '这段窗沿空间不够，试试另一个位置。';
  trees.push({ x, size, anchor: { id: edge.id, offset: x - edge.x },
    seed: Math.floor(Math.random() * 2 ** 32), plantedAt: performance.now() });
  return '树正在窗沿长出来。';
}

function drawPlacementPreview() {
  if (!play || !hoverPoint || (tool !== 'tree' && !carried)) return;
  const { x, y } = hoverPoint;
  const edge = playableLedge(x, y, Boolean(carried));
  if (!edge) return;
  const surface = ledgeSurface(edge, x);
  if (carried) {
    if (!fitsLedge(edge, x, carried.r, carried.r * 2)) return;
    circle(x, surface - carried.r, carried.r, '#daf0ff65');
    return;
  }
  const size = ledgeTreeSize(edge, x);
  ctx.fillStyle = size ? '#abdcc58f' : '#ffa9a99c';
  ctx.beginPath();
  ctx.moveTo(x, surface - 130 * (size ?? 0.2));
  ctx.lineTo(x - 42 * (size ?? 0.2), surface);
  ctx.lineTo(x + 42 * (size ?? 0.2), surface);
  ctx.fill();
}

function updateAnchoredBalls() {
  for (const ball of balls) {
    if (!ball.anchor) continue;
    const edge = anchoredEdge(ball.anchor);
    ball.x = edge ? edge.x + ball.anchor.offset : ball.x;
    ball.hidden = !edge || !fitsLedge(edge, ball.x, ball.r, ball.r * 2, true);
    if (!ball.hidden) ball.y = ledgeSurface(edge, ball.x) - ball.r;
  }
  for (const ball of balls) {
    if (!ball.base?.anchor) continue;
    const edge = anchoredEdge(ball.base.anchor);
    ball.hidden = ball.base.hidden || !edge ||
      !fitsLedge(edge, ball.base.x, ball.r, 2 * (ball.r + ball.base.r), true);
    if (!ball.hidden) {
      ball.x = ball.base.x;
      ball.y = ball.base.y - ball.base.r - ball.r + 2;
    }
  }
}

function shed(edge, vx, vy, strength, blown = false) {
  if (strength <= 0) return;
  const direction = Math.sign(vx || edge.vx);
  for (let i = 0; i < edge.depth.length; i++) {
    const depth = edge.depth[i];
    const x = edge.x + Math.min(edge.width - 0.1, i * cell + cell / 2);
    if (x < 0 || x >= width || looseSnow.length >= 420 || depth < 1.2 || isCovered(edge, x) ||
        Math.random() > strength) continue;
    let mass = Math.min(depth, (blown ? 0.9 : 1.5) + depth * strength * 0.5);
    edge.depth[i] -= mass;
    const clump = blown && depth >= 3 && Math.random() < 0.65;
    if (clump) {
      for (let j = 1; j <= 2 && i + j < edge.depth.length; j++) {
        const neighbor = i + j;
        const neighborX = edge.x + neighbor * cell + cell / 2;
        if (neighborX >= edge.x + edge.width || isCovered(edge, neighborX)) break;
        const piece = Math.min(edge.depth[neighbor], depth * 0.28);
        edge.depth[neighbor] -= piece;
        mass += piece;
      }
    }
    looseSnow.push({
      x, y: edgeTop(edge, x) - depth, vx: blown
        ? vx * (0.55 + Math.random() * 0.4)
        : vx * 0.35 - direction * (40 + Math.random() * 85),
      vy: Math.min(40, vy * 0.25) - 25 - Math.random() * 45, mass, source: edge.id,
      clump, angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 14,
      age: 0, splitAt: clump && mass >= 4 ? 0.2 + Math.random() * 0.5 : Infinity,
    });
  }
}

function drawClump(grain) {
  const radius = 1.4 + Math.sqrt(grain.mass) * 1.15;
  ctx.save();
  ctx.translate(grain.x, grain.y);
  ctx.rotate(grain.angle);
  ctx.scale(radius, radius);
  ctx.fillStyle = '#b3cedf';
  ctx.beginPath();
  ctx.moveTo(-1.25, 0.16);
  ctx.lineTo(-0.83, -0.67);
  ctx.lineTo(-0.2, -0.52);
  ctx.lineTo(0.4, -0.78);
  ctx.lineTo(1.18, -0.28);
  ctx.lineTo(1.02, 0.44);
  ctx.lineTo(0.28, 0.71);
  ctx.lineTo(-0.65, 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f1f9ff';
  ctx.beginPath();
  ctx.moveTo(-1.25, 0.16);
  ctx.lineTo(-0.83, -0.67);
  ctx.lineTo(-0.2, -0.52);
  ctx.lineTo(0.4, -0.78);
  ctx.lineTo(1.18, -0.28);
  ctx.lineTo(0.24, 0.16);
  ctx.lineTo(-0.43, 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLooseSnow(dt) {
  const fragments = [];
  looseSnow = looseSnow.filter(grain => {
    const previousY = grain.y;
    grain.vy += 470 * dt;
    grain.vx += (wind - grain.vx) * (1 - Math.exp(-dt * (grain.clump ? 0.42 : 0.95)));
    grain.x += grain.vx * dt;
    grain.y += grain.vy * dt;
    if (grain.x < 0 || grain.x >= width) return false;
    const edge = findLanding(grain.x, previousY, grain.y, grain.source);
    if (edge) {
      edge.depth[Math.floor((grain.x - edge.x) / cell)] += grain.mass;
      return false;
    }
    const index = Math.floor(grain.x / cell);
    if (onGround(grain.x) && grain.y >= groundTop(grain.x) - snow[index]) {
      snow[index] += grain.mass;
      return false;
    }
    if (grain.y >= height) return false;
    grain.age += dt;
    grain.angle += grain.spin * dt;
    if (grain.age >= grain.splitAt && looseSnow.length + fragments.length < 408) {
      for (const [offset, share] of [[-1, 0.24], [0, 0.46], [1, 0.3]]) {
        fragments.push({
          ...grain, x: grain.x + offset * 2, vx: grain.vx + offset * 32,
          vy: grain.vy - Math.abs(offset) * 16, mass: grain.mass * share,
          splitAt: Infinity, clump: offset === 0,
        });
      }
      return false;
    }
    if (grain.clump) drawClump(grain);
    else circle(grain.x, grain.y, 0.65 + Math.sqrt(grain.mass) * 0.62, '#f3faff');
    return true;
  });
  looseSnow.push(...fragments);
}

function newFlake(scattered = false) {
  return {
    x: Math.random() * width, y: scattered ? Math.random() * height : -5,
    radius: 0.8 + Math.random() * 2.1, speed: 32 + Math.random() * 73,
    phase: Math.random() * Math.PI * 2,
  };
}

function syncSnowfall() {
  const base = Math.min(325, Math.ceil(width / 5));
  const count = Math.round(base * snowfallDensity[intensity] * (reducedMotion.matches ? 0.4 : 1));
  flakes.length = Math.min(flakes.length, count);
  while (flakes.length < count) flakes.push(newFlake(true));
}

function resizeBackingCanvas() {
  const preview = new URLSearchParams(location.search).has('demo');
  const density = play || preview ? devicePixelRatio : Math.min(1.25, devicePixelRatio);
  const pixelsWide = Math.max(1, Math.round(width * density));
  const pixelsHigh = Math.max(1, Math.round(height * density));
  if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
  if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
  ctx.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
}

function resize() {
  width = innerWidth;
  height = innerHeight;
  resizeBackingCanvas();
  snow = Array.from({ length: Math.ceil(width / cell) }, (_, i) =>
    Math.max(0, 2 + 3 * Math.sin(i / 12) + 2 * Math.sin(i / 4)));
  flakes = [];
  syncSnowfall();
}

function circle(x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function draw(now) {
  requestAnimationFrame(draw);
  if (document.hidden) return;
  // A little tolerance avoids dropping every third 60 Hz frame near the limit.
  const quiet = !play && intensity === 'paused' && !looseSnow.length && !meltwater.length && !puddles.length && now >= warmingUntil;
  if (!play && frameTime !== undefined && now - frameTime < (quiet ? 120 : 46)) return;
  const dt = Math.min((now - (frameTime ?? now)) / 1000, quiet ? 0.13 : 0.075);
  frameTime = now;
  updateWind(now, dt);
  const warming = now < warmingUntil;
  if (now >= weatherMessageUntil) weatherMessage.hidden = true;
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < flakes.length; i++) {
    const flake = flakes[i];
    const drift = wind * (0.55 + flake.radius * 0.24);
    const nextX = flake.x + dt * (drift + 17 * Math.sin(now / 510 + flake.phase));
    flake.x = ((nextX % width) + width) % width;
    flake.y += flake.speed * dt;
    const index = Math.floor(flake.x / cell);
    const edge = findLanding(flake.x, flake.y - flake.speed * dt, flake.y);
    if (edge) {
      const slot = Math.floor((flake.x - edge.x) / cell);
      const cornerDrop = edgeTop(edge, flake.x) - edge.y;
      if (!warming) deposit(edge.depth, slot, flake.radius ** 2 * 0.55 / (1 + cornerDrop / 4), edge.id % 37,
        edge.desktopItem ? 3 + 3 * Math.sin(slot * 0.22) ** 2
          : edge.systemBar ? 5 + 4 * Math.sin(slot * 0.14) ** 2
          : 12 + 9 * Math.sin(slot * 0.14 + edge.id % 23) ** 2);
      flakes[i] = newFlake();
    } else if (onGround(flake.x) && flake.y >= groundTop(flake.x) - snow[index]) {
      if (!warming) deposit(snow, index, flake.radius ** 2 * 0.45, 0, 20 + 12 * Math.sin(index * 0.09) ** 2);
      flakes[i] = newFlake();
    } else if (flake.y >= height) {
      flakes[i] = newFlake();
    } else {
      circle(flake.x, flake.y, flake.radius, '#ecf8ffcb');
    }
  }
  drawLooseSnow(dt);
  if (warming) melt(snow, dt);
  settle(snow, dt);
  {
    for (const edge of ledges) {
      if (warming && edge.id !== -1) melt(edge.depth, dt, edge);
      settle(edge.depth, dt);
      if (edge.id !== -1) drawEdgeSnow(edge);
    }
    ctx.beginPath();
    const start = dockSurface?.x ?? 0;
    const end = dockSurface ? dockSurface.x + dockSurface.width : width;
    function surface(x) {
      const i = Math.min(snow.length - 1, Math.floor(x / cell));
      const depth = (snow[Math.max(0, i - 1)] + 2 * snow[i] + snow[Math.min(snow.length - 1, i + 1)]) / 4;
      const taper = dockSurface?.cornerRadius
        ? Math.min(1, Math.min(x - start, end - x) / dockSurface.cornerRadius) : 1;
      return groundTop(x) - depth * taper;
    }
    ctx.moveTo(start, surface(start));
    for (let x = start + 2; x < end; x += 2) ctx.lineTo(x, surface(x));
    ctx.lineTo(end, surface(end));
    for (let x = end; x > start; x -= 2) ctx.lineTo(x, groundTop(x));
    ctx.lineTo(start, groundTop(start));
    ctx.closePath();
    ctx.fillStyle = '#e8f4fc';
    ctx.fill();
    if (meltwater.length || puddles.length) drawMeltwater(dt);
    for (const tree of trees) drawTree(tree, now);
    drawTreeDrag(now);
    if (play) syncDecorationTargets();
    updateAnchoredBalls();
    for (const ball of balls) {
      if (ball.hidden) continue;
      const anchor = ball.anchor ?? ball.base?.anchor;
      const edge = anchor && anchoredEdge(anchor);
      const r = ball.r * 2.5;
      ctx.save();
      clipBehindWindows(edge?.covers ?? ledges, {
        x: ball.x - r, y: ball.y - r, width: r * 2, height: r * 2,
      });
      drawBall(ball);
      ctx.restore();
    }
    if (carried) drawBall(carried);
    drawPlacementPreview();
  }
}

function buildSnowTexture() {
  const texture = document.createElement('canvas');
  texture.width = texture.height = 144;
  const brush = texture.getContext('2d');
  const random = seededRandom(84291);
  const radius = 68;
  const shading = brush.createRadialGradient(48, 43, 3, 72, 72, radius);
  shading.addColorStop(0, '#ffffff');
  shading.addColorStop(0.52, '#eaf3f9');
  shading.addColorStop(0.82, '#c5dce9');
  shading.addColorStop(1, '#94b3c9');
  brush.beginPath();
  for (let i = 0; i < 96; i++) {
    const angle = i * Math.PI / 48;
    const edge = radius + 1.3 * Math.sin(angle * 9) + 0.8 * Math.sin(angle * 17 + 1.1);
    const x = 72 + Math.cos(angle) * edge;
    const y = 72 + Math.sin(angle) * edge;
    if (i) brush.lineTo(x, y);
    else brush.moveTo(x, y);
  }
  brush.closePath();
  brush.clip();
  brush.fillStyle = shading;
  brush.fillRect(0, 0, 144, 144);
  for (let i = 0; i < 2000; i++) {
    const x = random() * 144;
    const y = random() * 144;
    const darker = random() < 0.47;
    brush.fillStyle = darker ? '#49758f' : '#fff';
    brush.globalAlpha = darker ? 0.04 + random() * 0.13 : 0.16 + random() * 0.52;
    const grain = 0.45 + random() ** 3 * 2.3;
    brush.fillRect(x, y, grain, grain * 0.8);
  }
  return texture;
}

function drawBall(ball) {
  const { x, y, r } = ball;
  snowTexture ??= buildSnowTexture();
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  shadow.addColorStop(0, '#2a4b6575');
  shadow.addColorStop(1, '#2a4b6500');
  ctx.save();
  ctx.translate(x + r * 0.12, y + r * 0.89);
  ctx.scale(1, ball.stacked ? 0.25 : 0.4);
  circle(0, 0, r, shadow);
  ctx.restore();
  const half = r * 72 / 68;
  ctx.drawImage(snowTexture, x - half, y - half, half * 2, half * 2);
  const head = balls.find(item => item.stacked && item.base === ball);
  if (head) drawOutfit(ball, head);
  if (!ball.stacked) return;
  const dot = Math.max(1.4, r * 0.105);
  const face = ball.face ?? 0;
  const eyeY = y - r * 0.15;
  if (face === 3) {
    ctx.fillStyle = '#293847';
    ctx.fillRect(x - r * 0.4, eyeY, r * 0.29, dot * 0.8);
  } else {
    circle(x - r * 0.25, eyeY, dot, '#293847');
  }
  circle(x + r * 0.25, eyeY, dot, '#293847');
  if (ball.nose) {
    circle(x, y + r * 0.17, dot * 1.55, ball.nose === 1 ? '#324354' : '#d75b6b');
    circle(x - dot * 0.45, y + r * 0.17 - dot * 0.55, dot * 0.42, '#ffffff9c');
  } else {
    ctx.fillStyle = '#ed994d';
    ctx.beginPath();
    ctx.moveTo(x - dot, y + dot);
    ctx.lineTo(x + r * 0.48, y + r * 0.17);
    ctx.lineTo(x - dot, y + dot * 3);
    ctx.fill();
  }
  if (face !== 2) {
    ctx.strokeStyle = '#40556a';
    ctx.lineWidth = dot * 0.75;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.22, y + r * 0.43);
    ctx.quadraticCurveTo(x, y + r * (face ? 0.8 : 0.48), x + r * 0.22, y + r * 0.43);
    ctx.stroke();
  } else {
    circle(x, y + r * 0.48, dot * 1.3, '#40556a');
  }
  if (ball.scarf) {
    const color = ['','#bb4d55','#3c778e','#9b64b0','#408269','#ba872b'][ball.scarf];
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, r * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.78, y + r * 0.68);
    ctx.quadraticCurveTo(x, y + r * 1.12, x + r * 0.78, y + r * 0.68);
    ctx.lineTo(x + r * 0.91, y + r * 1.65);
    ctx.stroke();
  }
  const hatY = y - r * 0.78;
  if (ball.hat === 1) {
    ctx.fillStyle = '#263647';
    ctx.fillRect(x - r * 0.62, hatY - r * 0.65, r * 1.24, r * 0.67);
    ctx.fillStyle = '#ae5861';
    ctx.fillRect(x - r * 0.62, hatY - r * 0.2, r * 1.24, r * 0.15);
    ctx.fillStyle = '#263647';
    ctx.fillRect(x - r * 0.91, hatY, r * 1.82, r * 0.14);
  } else if (ball.hat === 2 || ball.hat === 3) {
    ctx.fillStyle = ball.hat === 2 ? '#bc515d' : '#537395';
    ctx.beginPath();
    ctx.ellipse(x, hatY, r * 0.8, r * 0.68, 0, Math.PI, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#e6edf4';
    ctx.fillRect(x - r * 0.85, hatY - r * 0.12, r * 1.7, r * 0.21);
    circle(x, hatY - r * 0.7, r * 0.17, '#f6fafc');
  } else if (ball.hat === 4) {
    ctx.fillStyle = '#c34459';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.78, hatY);
    ctx.quadraticCurveTo(x - r * 0.22, hatY - r * 1.65, x + r * 0.89, hatY - r * 0.85);
    ctx.lineTo(x + r * 0.53, hatY);
    ctx.fill();
    ctx.fillStyle = '#f6fafc';
    ctx.fillRect(x - r * 0.84, hatY - r * 0.13, r * 1.47, r * 0.24);
    circle(x + r * 0.89, hatY - r * 0.85, r * 0.2, '#f6fafc');
  } else if (ball.hat === 5) {
    ctx.strokeStyle = '#744c83';
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.25, r * 0.89, r * 0.77, 0, Math.PI, 2 * Math.PI);
    ctx.stroke();
    for (const side of [-1, 1]) {
      circle(x + side * r * 0.84, y - r * 0.25, r * 0.25, '#9964a7');
      circle(x + side * r * 0.84, y - r * 0.29, r * 0.13, '#dbaddf');
    }
  }
}

function drawOutfit({ x, y, r }, head) {
  ctx.save();
  if (head.arms) {
    ctx.strokeStyle = '#795747';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const tip = x + side * r * 1.62;
      ctx.beginPath();
      ctx.moveTo(x + side * r * 0.8, y);
      ctx.lineTo(tip, y - r * 0.7);
      ctx.moveTo(x + side * r * 1.4, y - r * 0.52);
      ctx.lineTo(x + side * r * 1.36, y - r * 0.81);
      ctx.stroke();
      if (head.arms === 2) {
        circle(tip, y - r * 0.7, r * 0.18, '#ad5367');
        circle(tip - side * r * 0.12, y - r * 0.79, r * 0.09, '#ad5367');
      }
    }
  }
  if (head.buttons) {
    const colors = [
      ['#354556', '#354556', '#354556'],
      ['#bc842b', '#bc842b', '#bc842b'],
      ['#c95364', '#39927f', '#6979b6'],
    ][head.buttons - 1];
    for (const [index, offset] of [-0.37, 0.04, 0.45].entries()) {
      const buttonY = y + r * offset;
      circle(x, buttonY, r * 0.115, colors[index]);
      circle(x - r * 0.026, buttonY - r * 0.034, r * 0.035, '#ffffff96');
    }
  }
  ctx.restore();
}

function decorationTargets() {
  return balls.filter(ball => ball.stacked && !ball.hidden).flatMap(ball => [ball, ball.base].filter(Boolean)
    .map(item => ({ x: item.x, y: item.y, radius: Math.max(20, item.r * 1.25) })));
}

function syncDecorationTargets() {
  const targets = [...trees.flatMap(tree => tree.hit ? [{
    x: tree.hit.x + tree.hit.width / 2, y: tree.hit.y + tree.hit.height / 2,
    radius: Math.max(10, tree.hit.height * 0.36),
  }] : []), ...decorationTargets()].slice(0, 59);
  if (!wardrobe.hidden) {
    const { x, y, width, height } = wardrobe.getBoundingClientRect();
    targets.unshift({ x, y, width, height });
  }
  const key = JSON.stringify(targets);
  if (key === syncDecorationTargets.lastKey) return;
  syncDecorationTargets.lastKey = key;
  window.desktopSnow?.setDecorationTargets?.(targets);
}

function closeWardrobe() {
  dressedSnowman = undefined;
  wardrobe.hidden = true;
  syncDecorationTargets();
}

function decorationRow(item, part, label, choices) {
  const row = document.createElement('div');
  row.className = 'outfit-row';
  const title = document.createElement('span');
  title.textContent = label;
  row.append(title);
  for (const [value, choice] of choices) {
    const button = document.createElement('button');
    button.textContent = choice;
    button.setAttribute('aria-label', `${label}：${choice}`);
    button.setAttribute('aria-pressed', String((item[part] ?? choices[0][0]) === value));
    button.onclick = () => {
      item[part] = value;
      saveScene();
      for (const peer of row.querySelectorAll('button')) {
        peer.setAttribute('aria-pressed', String(peer === button));
      }
    };
    row.append(button);
  }
  return row;
}

function openWardrobe(ball) {
  dressedSnowman = ball;
  document.querySelector('#wardrobe-title strong').textContent = '雪人换装';
  wardrobe.setAttribute('aria-label', '雪人换装');
  const options = document.getElementById('outfits');
  options.replaceChildren();
  for (const [part, [label, ...choices]] of Object.entries(outfits)) {
    options.append(decorationRow(ball, part, label, choices.map((choice, index) => [index, choice])));
  }
  const actions = document.createElement('div');
  actions.className = 'outfit-row';
  if (!ball.base?.anchor) addMoveButton(actions, '雪人', { ball });
  const remove = document.createElement('button');
  remove.textContent = '移除雪人';
  remove.onclick = () => {
    balls = balls.filter(item => item !== ball && item !== ball.base);
    saveScene();
    closeWardrobe();
  };
  actions.append(remove);
  options.append(actions);
  wardrobe.hidden = false;
  wardrobe.style.left = `${Math.max(8, Math.min(ball.x - wardrobe.offsetWidth / 2, width - wardrobe.offsetWidth - 8))}px`;
  wardrobe.style.top = `${Math.max(8, Math.min(ball.y - ball.r - wardrobe.offsetHeight - 18, groundY() - 142 - wardrobe.offsetHeight))}px`;
  syncDecorationTargets();
}

function openTreeDecorations(tree) {
  dressedSnowman = undefined;
  document.querySelector('#wardrobe-title strong').textContent = '装饰圣诞树';
  wardrobe.setAttribute('aria-label', '装饰圣诞树');
  const options = document.getElementById('outfits');
  options.replaceChildren();
  for (const [part, [title, ...choices]] of Object.entries(treeDecorations)) {
    options.append(decorationRow(tree, part, title, choices));
  }
  const row = document.createElement('div');
  row.className = 'outfit-row';
  const remove = document.createElement('button');
  const moveHint = document.createElement('span');
  moveHint.textContent = '拖动树可移动';
  moveHint.style.width = 'auto';
  row.append(moveHint);
  remove.textContent = '移除树';
  remove.onclick = () => { trees = trees.filter(item => item !== tree); saveScene(); closeWardrobe(); };
  row.append(remove);
  options.append(row);
  wardrobe.hidden = false;
  wardrobe.style.left = `${Math.max(8, Math.min(tree.x - wardrobe.offsetWidth / 2, width - wardrobe.offsetWidth - 8))}px`;
  wardrobe.style.top = `${Math.max(8, tree.hit.y - wardrobe.offsetHeight - 12)}px`;
  syncDecorationTargets();
}

function addMoveButton(row, label, prop) {
  const button = document.createElement('button');
  button.textContent = `移动${label}`;
  button.onclick = () => {
    closeWardrobe();
    movingProp = prop;
    hint.textContent = '点击底部雪带上的新位置。';
  };
  row.append(button);
}

function moveGroundProp(x) {
  const { ball } = movingProp;
  const { base } = ball;
  if (!base || !onGround(x - base.r) || !onGround(x + base.r)) return false;
  const y = groundY() - base.r - 5;
  const top = y - base.r - 2 * ball.r;
  if (ledges.some(rect => !rect.systemBar && rect.x < x + base.r &&
    rect.x + rect.width > x - base.r && rect.y < groundY() && rect.y + rect.height > top)) return false;
  base.x = ball.x = x;
  base.y = y;
  ball.y = y - base.r - ball.r + 2;
  movingProp = undefined;
  hint.textContent = '已移动。';
  saveScene();
  syncDecorationTargets();
  return true;
}

function select(next) {
  tool = next;
  movingProp = undefined;
  closeWardrobe();
  for (const name of ['shovel', 'roll', 'decorate', 'tree']) {
    document.getElementById(name).setAttribute('aria-pressed', name === tool);
  }
  hint.textContent = tool === 'shovel'
    ? '沿底部或窗沿上方拖动，把雪推到铲子前方。'
    : tool === 'tree' ? '点击有积雪的窗沿种树，或点击底部雪地自动选址。'
    : tool === 'decorate'
      ? '点击雪人打开换装面板。'
      : '沿雪带或窗沿滚雪球，也可以把雪球拖到窗沿放下。';
}

{
  select('roll');
  window.desktopSnow?.onWeatherEvent(weatherEvent);
  document.getElementById('warm').onclick = () => weatherEvent('warm');
  document.getElementById('tree').onclick = () => select('tree');
  document.getElementById('gust').onclick = () => startGust(performance.now(), true);
  const steadyWind = document.getElementById('steady-wind');
  steadyWind.onclick = () => {
    const now = performance.now();
    steadyWindDirection = steadyWindDirection ? 0 : Math.sign(windTarget || wind) || 1;
    steadyWind.setAttribute('aria-pressed', String(Boolean(steadyWindDirection)));
    gustDuration = 0;
    nextGust = now + 12_000 + Math.random() * 23_000;
  };
  window.desktopSnow?.onPlayMode(enabled => {
    play = enabled;
    resizeBackingCanvas();
    toolbar.hidden = !play;
    hint.hidden = !play;
    placeToolbar();
    if (!play) {
      movingProp = undefined;
      treeDrag = undefined;
      closeWardrobe();
      if (carried) {
        carried.anchor = undefined;
        carried.y = groundY() - carried.r - 5;
        balls.push(carried);
      }
      carried = undefined;
      pointer = undefined;
    }
  });
  window.desktopSnow?.onLauncherAnchor(anchor => {
    launcherAnchor = anchor;
    placeToolbar();
  });
  window.desktopSnow?.onWindowEdges(edges => {
    dockSurface = edges.find(edge => edge.id === -1);
    dockEdgeY = dockSurface?.y;
    for (const ball of balls) {
      if (ball.restored) ball.y = groundY() - ball.r - 5;
      if (ball.base?.restored) ball.y = ball.base.y - ball.base.r - ball.r + 2;
    }
    document.documentElement.style.setProperty('--floor-inset', `${height - groundY()}px`);
    const now = performance.now();
    const previous = new Map(ledges.map(edge => [edge.id, edge]));
    ledges = edges.map((rect, index) => {
      const old = previous.get(rect.id);
      const dt = old ? Math.min(0.2, Math.max(0.08, (now - old.time) / 1000)) : 1;
      const vx = old ? (rect.x - old.x) / dt : 0;
      const vy = old ? (rect.y - old.y) / dt : 0;
      const edge = {
        ...rect, vx, vy, time: now, covers: edges.slice(0, index),
        depth: Array.from({ length: Math.ceil(rect.width / cell) },
          (_, i) => old?.depth[i] ?? 0),
      };
      if (old && !edge.systemBar) {
        const speed = Math.hypot(vx, vy);
        const jolt = Math.hypot(vx - old.vx, vy - old.vy);
        const strength = Math.min(0.75, Math.max(0, (speed - 340) / 1600, (jolt - 260) / 1100));
        shed(edge, vx - old.vx * 0.45, vy - old.vy * 0.45, strength);
      }
      return edge;
    }).sort((a, b) => a.y - b.y);
    updateAnchoredBalls();
    if (balls.some(ball => ball.anchor)) {
      if (dressedSnowman?.hidden) closeWardrobe();
      else syncDecorationTargets();
    }
  });
  for (const name of ['shovel', 'roll']) {
    document.getElementById(name).onclick = () => select(name);
  }
  document.getElementById('decorate').onclick = () => {
    select('decorate');
    if (!decorationTargets().length) hint.textContent = '先把两个雪球叠起来，再给雪人换装。';
  };
  document.getElementById('wardrobe-close').onclick = closeWardrobe;
  document.getElementById('close').onclick = () => window.desktopSnow?.leavePlayMode();
  document.getElementById('reset').onclick = () => {
    movingProp = undefined;
    balls = [];
    closeWardrobe();
    looseSnow = [];
    meltwater.length = puddles.length = 0;
    warmingUntil = 0;
    weatherMessageUntil = 0;
    trees = [];
    saveScene();
    for (const edge of ledges) edge.depth.fill(0);
    resize();
  };
  canvas.onpointerdown = event => {
    if (!play || event.button !== 0 || pointer !== undefined) return;
    const x = event.offsetX, y = event.offsetY;
    const onSnowbank = onGround(x) && y >= groundY() - 62 && y < groundY();
    if (movingProp) {
      if (!onSnowbank || !moveGroundProp(x)) hint.textContent = '这里放不下，请点另一段底部雪带。';
      return;
    }
    const clickedTree = trees.findLast(({ hit }) => hit && x >= hit.x && x <= hit.x + hit.width &&
      y >= hit.y && y <= hit.y + hit.height);
    if (clickedTree) {
      closeWardrobe();
      pointer = event.pointerId;
      treeDrag = { tree: clickedTree, startX: x, startY: y,
        offsetX: clickedTree.x - x, offsetY: clickedTree.hit.y + clickedTree.hit.height - y };
      canvas.setPointerCapture(pointer);
      window.desktopSnow?.setDragging(true);
      return;
    }
    const edge = playableLedge(x, y);
    if (tool === 'tree') {
      if (edge) hint.textContent = plantOnLedge(edge, x);
      else if (onSnowbank) weatherEvent('tree');
      return;
    }
    const hit = item => item && Math.hypot(event.offsetX - item.x, event.offsetY - item.y) <= Math.max(20, item.r * 1.25);
    const snowman = balls.findLast(item => item.stacked && !item.hidden && (hit(item) || hit(item.base)));
    if (snowman) {
      if (dressedSnowman === snowman) closeWardrobe();
      else openWardrobe(snowman);
      return;
    }
    if (dressedSnowman) closeWardrobe();
    if (tool === 'decorate') return;
    if (!onSnowbank && !edge) return;
    pointer = event.pointerId;
    lastDragPoint = { x: event.offsetX, y: event.offsetY };
    movedSnow = 0;
    canvas.setPointerCapture(pointer);
    window.desktopSnow?.setDragging(true);
    if (tool === 'roll') {
      const existing = balls.findLastIndex(ball => !ball.hidden &&
        Math.hypot(event.offsetX - ball.x, event.offsetY - ball.y) < ball.r);
      carried = existing >= 0 ? balls.splice(existing, 1)[0]
        : { x: event.offsetX, y: event.offsetY, r: 8 };
      carried.anchor = undefined;
    }
  };
  function moveSnow(x, y, direction) {
    const edge = playableLedge(x, y);
    if (!edge && (!onGround(x) || y < groundY() - 62 || y >= groundY())) return;
    const depth = edge?.depth ?? snow;
    const index = Math.floor((x - (edge?.x ?? 0)) / cell);
    let collected = 0;
    for (let i = Math.max(0, index - 2); i <= Math.min(depth.length - 1, index + 2); i++) {
      const amount = Math.min(depth[i], carried ? (carried.r < 42 ? 1 : 0) : 3);
      depth[i] -= amount;
      collected += amount;
    }
    movedSnow += collected;
    if (carried) carried.r = Math.min(42, Math.sqrt(carried.r ** 2 + collected * 2));
    else {
      const ahead = Math.max(0, Math.min(depth.length - 1, index + direction * 3));
      depth[ahead] += collected;
    }
  }
  function followDrag(event) {
    const x = Math.max(0, Math.min(width - 1, event.offsetX));
    const y = event.offsetY;
    const dx = x - lastDragPoint.x;
    const dy = y - lastDragPoint.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / cell);
    for (let i = 1; i <= steps; i++) {
      moveSnow(lastDragPoint.x + dx * i / steps, lastDragPoint.y + dy * i / steps, dx < 0 ? -1 : 1);
    }
    lastDragPoint = { x, y };
    if (carried) Object.assign(carried, { x, y });
  }
  canvas.onpointermove = event => {
    hoverPoint = { x: event.offsetX, y: event.offsetY };
    if (event.pointerId !== pointer) return;
    if (treeDrag) updateTreeDrag(event);
    else followDrag(event);
  };
  canvas.onpointerleave = () => { hoverPoint = undefined; };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = event => {
    if (event.pointerId !== pointer) return;
    if (treeDrag) {
      const released = event.type === 'pointerup';
      if (released) updateTreeDrag(event);
      const { tree, moved, drop } = treeDrag;
      treeDrag = undefined;
      pointer = undefined;
      window.desktopSnow?.setDragging(false);
      if (!released) return;
      if (!moved && tree.hit) openTreeDecorations(tree);
      if (moved && drop) {
        tree.x = drop.x;
        tree.preferred = drop.x / width;
        tree.anchor = drop.anchor;
        tree.size = drop.size ?? tree.size;
        tree.checkAt = 0;
        hint.textContent = '树已移动。';
        saveScene();
      } else if (moved) hint.textContent = '这个位置放不下，树留在原处。';
      return;
    }
    if (event.type === 'pointerup') followDrag(event);
    pointer = undefined;
    window.desktopSnow?.setDragging(false);
    if (!carried) {
      if (movedSnow > 0) hint.textContent = '雪已推到铲子前方。';
      return;
    }
    const base = balls.findLast(ball => !ball.hidden && !ball.stacked && ball.r >= carried.r * 1.15 &&
      !balls.some(other => other.base === ball) &&
      Math.abs(ball.x - carried.x) < ball.r &&
      Math.abs(ball.y - ball.r - carried.y) < carried.r + 24);
    carried.stacked = Boolean(base);
    carried.base = base;
    if (base) {
      carried.x = base.x;
      carried.y = base.y - base.r - carried.r + 2;
      hint.textContent = '叠好了一个雪人。点击它换装。';
    } else {
      const edge = playableLedge(carried.x, carried.y, true);
      if (edge && fitsLedge(edge, carried.x, carried.r, carried.r * 2)) {
        carried.anchor = { id: edge.id, offset: carried.x - edge.x };
        hint.textContent = '雪球已放到窗沿。拖个小雪球过来叠雪人。';
      } else {
        carried.y = groundY() - carried.r - 5;
        if (movedSnow > 0) hint.textContent = '雪球变大了。把小雪球拖到它上方。';
      }
    }
    balls.push(carried);
    carried = undefined;
    updateAnchoredBalls();
    syncDecorationTargets();
    saveScene();
  };
}

addEventListener('resize', () => {
  resize();
  placeToolbar();
  closeWardrobe();
});
intensityControl.addEventListener('click', () => {
  intensity = intensityOrder[(intensityOrder.indexOf(intensity) + 1) % intensityOrder.length];
  intensityControl.textContent = intensityLabels[intensity];
  intensityControl.setAttribute('aria-label', `降雪强度：${intensityLabels[intensity]}`);
  syncSnowfall();
});
reducedMotion.addEventListener('change', syncSnowfall);
resize();
restoreScene();
if (new URLSearchParams(location.search).has('demo')) {
  document.body.style.background = 'linear-gradient(#101e32, #25465b)';
  function preview(now) {
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / 640, height / 320);
    ctx.save();
    ctx.translate((width - 640 * scale) / 2, (height - 320 * scale) / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#eef6ff';
    ctx.font = '24px system-ui';
    ctx.fillText('雪人和圣诞树装饰', 48, 48);
    ctx.fillStyle = '#b8d2e2';
    ctx.font = '13px system-ui';
    ctx.fillText('彩球、冰晶与彩带 · 点击桌面上的装饰可更换', 49, 73);
    ctx.fillStyle = '#b6d3e3';
    ctx.beginPath();
    ctx.ellipse(320, 254, 275, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    drawBall({ x: 137, y: 215, r: 39 });
    drawOutfit({ x: 137, y: 215, r: 39 }, { arms: 2, buttons: 3 });
    drawBall({ x: 137, y: 155, r: 24, stacked: true, hat: 4, scarf: 4, face: 3, nose: 2 });
    for (const [index, size] of [0.83, 1.18, 0.96].entries()) {
      const x = 285 + index * 126;
      ctx.save();
      ctx.translate(x, 253);
      ctx.scale(size, size);
      paintTree(previewTrees[index], now, previewStyles[index]);
      ctx.restore();
    }
    ctx.restore();
    requestAnimationFrame(preview);
  }
  const previewStyles = [
    { ornaments: 'classic', garland: 'gold' },
    { ornaments: 'frost', garland: 'silver', topper: 'snowflake' },
    { ornaments: 'candy', garland: 'red', topper: 'bow' },
  ];
  const previewTrees = [42, 6821, 247251].map(buildTreeArtwork);
  requestAnimationFrame(preview);
} else requestAnimationFrame(draw);
