let play = false;
let ledges = [];
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const hint = document.querySelector('output');
const cell = 6;
let width, height, snow, flakes, balls = [], carried, pointer, tool;
let frameTime;
let lastDragPoint, movedSnow = 0;
const decorationModes = ['hat', 'scarf', 'face'];
const decorationNames = { hat: '帽子', scarf: '围巾', face: '表情' };
let decorationMode;
let treeArtwork;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const snowfallDensity = { light: 0.45, steady: 1, flurry: 1.65, paused: 0 };
const intensityLabels = { light: '小雪', steady: '中雪', flurry: '大雪', paused: '停雪' };
const intensityOrder = Object.keys(snowfallDensity);
let intensity = 'steady';
const intensityControl = document.getElementById('intensity');
let looseSnow = [];
let wind = 0, windTarget = 0, gustStart = 0, gustDuration = 0;
let steadyWindDirection = 0;
let nextGust = 12_000 + Math.random() * 16_000, nextWindLift = 0;
let warmingUntil = 0, weatherMessageUntil = 0;
let trees = [];
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
      x - halfWidth < 135 || Math.abs(x - width / 2) < 350 + halfWidth) return false;
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

function weatherEvent(event) {
  const now = performance.now();
  if (event === 'warm') {
    warmingUntil = now + 24_000;
    weatherMessage.textContent = '短暂回暖，积雪正在融化';
  } else if (event === 'tree') {
    if (trees.length < 8 && !trees.some(tree => tree.plantedAt === undefined)) {
      trees.push({ preferred: 0.15 + Math.random() * 0.7, size: 0.62 + Math.random() * 0.76 });
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

function melt(depth, dt) {
  for (let i = 0; i < depth.length; i++) {
    depth[i] = Math.max(0, depth[i] - dt * (0.7 + 0.45 * Math.sin(i * 0.19) ** 2));
  }
}

function buildTreeArtwork() {
  const artwork = document.createElement('canvas');
  artwork.width = 224;
  artwork.height = 292;
  const brush = artwork.getContext('2d');
  brush.scale(2, 2);
  brush.translate(56, 143);
  let seed = 1321;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  brush.fillStyle = '#665044';
  brush.fillRect(-3, -44, 6, 44);
  for (let i = 0; i < 27; i++) {
    const y = -12 - i * 4.05;
    for (const side of [-1, 1]) {
      const span = (3 + (26 - i) * 1.7) * (0.78 + random() * 0.29);
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
      if (i % 3 === 0 || random() > 0.72) {
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
  for (let row = 0; row < 4; row++) {
    const y = -29 - row * 23;
    const span = 36 - row * 7;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x = (t * 2 - 1) * span;
      const bulbY = y + Math.sin(t * Math.PI) * 7 + (random() - 0.5) * 3;
      const glow = brush.createRadialGradient(x, bulbY, 0, x, bulbY, 4);
      glow.addColorStop(0, i % 3 === 0 ? '#ffc6a8' : '#ffe6a1');
      glow.addColorStop(0.44, '#ffd990b0');
      glow.addColorStop(1, '#ffd99000');
      brush.fillStyle = glow;
      brush.fillRect(x - 4, bulbY - 4, 8, 8);
    }
  }
  brush.fillStyle = '#ffe1a1';
  brush.beginPath();
  for (let i = 0; i <= 10; i++) {
    const angle = i * Math.PI / 5 - Math.PI / 2;
    const r = i % 2 ? 2.7 : 6;
    const x = Math.cos(angle) * r;
    const y = -132 + Math.sin(angle) * r;
    if (i) brush.lineTo(x, y);
    else brush.moveTo(x, y);
  }
  brush.fill();
  return artwork;
}

function drawTree(tree, now) {
  if (tree.x === undefined || now >= tree.checkAt) {
    if (now < (tree.checkAt ?? 0)) return;
    tree.checkAt = now + 350;
    if (tree.x === undefined || !clearTreeSpot(tree, tree.x)) tree.x = treeSpot(tree);
    if (tree.x === undefined) return;
    if (tree.plantedAt === undefined) {
      tree.plantedAt = now;
      weatherMessage.textContent = '积雪里长出了一棵圣诞树';
      weatherMessageUntil = now + 5500;
      weatherMessage.hidden = false;
    }
  }
  const growth = 1 - (1 - Math.max(0, Math.min(1, (now - tree.plantedAt) / 9000))) ** 2;
  const x = tree.x;
  treeArtwork ??= buildTreeArtwork();
  ctx.save();
  ctx.translate(x, groundY() - snow[Math.floor(x / cell)] * 0.5);
  ctx.scale(growth * tree.size, growth * tree.size);
  ctx.transform(1, 0, -wind / 2200, 1, 0, 0);
  ctx.drawImage(treeArtwork, -56, -143, 112, 146);
  ctx.restore();
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

function shed(edge, vx, vy, strength, blown = false) {
  if (strength <= 0) return;
  const direction = Math.sign(vx || edge.vx);
  for (let i = 0; i < edge.depth.length; i++) {
    const depth = edge.depth[i];
    const x = edge.x + Math.min(edge.width - 0.1, i * cell + cell / 2);
    if (x < 0 || x >= width || looseSnow.length >= 420 || depth < 1.2 || isCovered(edge, x) ||
        Math.random() > strength) continue;
    const mass = Math.min(depth, (blown ? 0.7 : 1.5) + depth * strength * 0.5);
    edge.depth[i] -= mass;
    looseSnow.push({
      x, y: edgeTop(edge, x) - depth, vx: blown
        ? vx * (0.55 + Math.random() * 0.4)
        : vx * 0.35 - direction * (40 + Math.random() * 85),
      vy: Math.min(40, vy * 0.25) - 25 - Math.random() * 45, mass, source: edge.id,
    });
  }
}

function drawLooseSnow(dt) {
  looseSnow = looseSnow.filter(grain => {
    const previousY = grain.y;
    grain.vy += 470 * dt;
    grain.vx += (wind - grain.vx) * (1 - Math.exp(-dt * 0.9));
    grain.x += grain.vx * dt;
    grain.y += grain.vy * dt;
    if (grain.x < 0 || grain.x >= width) return false;
    const edge = findLanding(grain.x, previousY, grain.y, grain.source);
    if (edge) {
      edge.depth[Math.floor((grain.x - edge.x) / cell)] += grain.mass * 0.8;
      return false;
    }
    const index = Math.floor(grain.x / cell);
    if (onGround(grain.x) && grain.y >= groundTop(grain.x) - snow[index]) {
      snow[index] += grain.mass;
      return false;
    }
    if (grain.y >= height) return false;
    circle(grain.x, grain.y, 1.1 + Math.sqrt(grain.mass) * 0.65, '#f3faff');
    return true;
  });
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

function resize() {
  width = innerWidth;
  height = innerHeight;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
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
  if (document.hidden || (!play && frameTime !== undefined && now - frameTime < 30)) return;
  const dt = Math.min((now - (frameTime ?? now)) / 1000, 0.06);
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
      if (warming) melt(edge.depth, dt);
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
    for (const tree of trees) drawTree(tree, now);
    for (const ball of balls.concat(carried ?? [])) drawBall(ball);
  }
}

function drawBall(ball) {
  const { x, y, r } = ball;
  const shading = ctx.createRadialGradient(x - r * 0.34, y - r * 0.42, r * 0.06, x, y, r);
  shading.addColorStop(0, '#ffffff');
  shading.addColorStop(0.65, '#e9f5fd');
  shading.addColorStop(1, '#a8cbdc');
  circle(x, y, r, shading);
  if (!ball.stacked) return;
  const dot = Math.max(1.4, r * 0.105);
  const face = ball.face ?? 0;
  const eyeY = y - r * 0.15;
  circle(x - r * 0.25, eyeY, dot, '#293847');
  circle(x + r * 0.25, eyeY, dot, '#293847');
  ctx.fillStyle = '#ed994d';
  ctx.beginPath();
  ctx.moveTo(x - dot, y + dot);
  ctx.lineTo(x + r * 0.48, y + r * 0.17);
  ctx.lineTo(x - dot, y + dot * 3);
  ctx.fill();
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
    const color = ['','#bb4d55','#3c778e','#9b64b0'][ball.scarf];
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
  }
}

function decorationTargets() {
  return balls.filter(ball => ball.stacked).map(ball => ({
    x: ball.x, y: ball.y, radius: Math.max(20, ball.r * 1.8),
  }));
}

function syncDecorationTargets() {
  window.desktopSnow?.setDecorationTargets?.(tool === 'decorate' ? decorationTargets() : []);
}

function select(next) {
  tool = next;
  for (const name of ['shovel', 'roll', 'decorate']) {
    document.getElementById(name).setAttribute('aria-pressed', name === tool);
  }
  const decorate = document.getElementById('decorate');
  decorate.textContent = tool === 'decorate' ? decorationNames[decorationMode] : '装饰';
  syncDecorationTargets();
  hint.textContent = tool === 'shovel'
    ? '沿底部拖动，把雪推到铲子前方。'
    : tool === 'decorate'
      ? `点击雪人的头换${decorationNames[decorationMode]}。再次点击工具按钮切换装饰类别。`
      : '沿底部滚雪球，拖到更大的雪球上叠起来。';
}

{
  select('roll');
  window.desktopSnow?.onWeatherEvent(weatherEvent);
  document.getElementById('warm').onclick = () => weatherEvent('warm');
  document.getElementById('tree').onclick = () => weatherEvent('tree');
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
    document.querySelector('header').hidden = !play;
    hint.hidden = !play;
    if (!play) {
      if (carried) {
        carried.y = groundY() - carried.r - 5;
        balls.push(carried);
      }
      carried = undefined;
      pointer = undefined;
    }
  });
  window.desktopSnow?.onWindowEdges(edges => {
    dockSurface = edges.find(edge => edge.id === -1);
    dockEdgeY = dockSurface?.y;
    document.documentElement.style.setProperty('--floor-inset', `${height - groundY()}px`);
    const now = performance.now();
    const previous = new Map(ledges.map(edge => [edge.id, edge]));
    ledges = edges.map((rect, index) => {
      const old = previous.get(rect.id);
      const dt = old ? Math.max(0.08, (now - old.time) / 1000) : 1;
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
  });
  for (const name of ['shovel', 'roll']) {
    document.getElementById(name).onclick = () => select(name);
  }
  document.getElementById('decorate').onclick = () => {
    decorationMode = decorationModes[(tool === 'decorate' ? decorationModes.indexOf(decorationMode) + 1 : 0)
      % decorationModes.length];
    select('decorate');
    if (!decorationTargets().length) hint.textContent = '先把两个雪球叠起来，再给雪人换装。';
  };
  document.getElementById('close').onclick = () => window.desktopSnow?.leavePlayMode();
  document.getElementById('reset').onclick = () => {
    balls = [];
    syncDecorationTargets();
    looseSnow = [];
    warmingUntil = 0;
    weatherMessageUntil = 0;
    trees = [];
    for (const edge of ledges) edge.depth.fill(0);
    resize();
  };
  canvas.onpointerdown = event => {
    if (!play || event.button !== 0 || pointer !== undefined) return;
    if (tool === 'decorate') {
      const ball = balls.findLast(item => item.stacked &&
        Math.hypot(event.offsetX - item.x, event.offsetY - item.y) <= Math.max(20, item.r * 1.8));
      if (ball) {
        ball[decorationMode] = ((ball[decorationMode] ?? 0) + 1) % (decorationMode === 'face' ? 3 : 4);
        hint.textContent = `已更换${decorationNames[decorationMode]}。再点雪人可以试下一款。`;
      }
      return;
    }
    if (event.offsetY < groundY() - 62) return;
    pointer = event.pointerId;
    lastDragPoint = { x: event.offsetX, y: event.offsetY };
    movedSnow = 0;
    canvas.setPointerCapture(pointer);
    window.desktopSnow?.setDragging(true);
    if (tool === 'roll') {
      const existing = balls.findLastIndex(ball =>
        Math.hypot(event.offsetX - ball.x, event.offsetY - ball.y) < ball.r);
      carried = existing >= 0 ? balls.splice(existing, 1)[0]
        : { x: event.offsetX, y: event.offsetY, r: 8 };
    }
  };
  function moveSnow(x, y, direction) {
    if (!onGround(x) || y < groundY() - 64 || y >= groundY()) return;
    const index = Math.floor(x / cell);
    let collected = 0;
    for (let i = Math.max(0, index - 2); i <= Math.min(snow.length - 1, index + 2); i++) {
      const amount = Math.min(snow[i], carried ? (carried.r < 42 ? 1 : 0) : 3);
      snow[i] -= amount;
      collected += amount;
    }
    movedSnow += collected;
    if (carried) carried.r = Math.min(42, Math.sqrt(carried.r ** 2 + collected * 2));
    else {
      const ahead = Math.max(0, Math.min(snow.length - 1, index + direction * 3));
      snow[ahead] += collected;
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
    if (event.pointerId === pointer) followDrag(event);
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = event => {
    if (event.pointerId !== pointer) return;
    if (event.type === 'pointerup') followDrag(event);
    pointer = undefined;
    window.desktopSnow?.setDragging(false);
    if (!carried) {
      if (movedSnow > 0) hint.textContent = '雪已推到铲子前方。';
      return;
    }
    const base = balls.findLast(ball => ball.r >= carried.r * 1.15 &&
      Math.abs(ball.x - carried.x) < ball.r &&
      Math.abs(ball.y - ball.r - carried.y) < carried.r + 24);
    carried.stacked = Boolean(base);
    if (base) {
      carried.x = base.x;
      carried.y = base.y - base.r - carried.r + 2;
      hint.textContent = '叠好了一个雪人。';
    } else {
      carried.y = groundY() - carried.r - 5;
      if (movedSnow > 0) hint.textContent = '雪球变大了。把小雪球拖到它上方。';
    }
    balls.push(carried);
    carried = undefined;
  };
}

addEventListener('resize', resize);
intensityControl.addEventListener('click', () => {
  intensity = intensityOrder[(intensityOrder.indexOf(intensity) + 1) % intensityOrder.length];
  intensityControl.textContent = intensityLabels[intensity];
  intensityControl.setAttribute('aria-label', `降雪强度：${intensityLabels[intensity]}`);
  syncSnowfall();
});
reducedMotion.addEventListener('change', syncSnowfall);
resize();
requestAnimationFrame(draw);
