const play = new URLSearchParams(location.search).has('play');
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const hint = document.querySelector('output');
const cell = 6;
let width, height, snow, flakes, balls = [], carried, pointer, tool;
let frameTime;

function newFlake(scattered = false) {
  return {
    x: Math.random() * width, y: scattered ? Math.random() * height : -5,
    radius: 0.8 + Math.random() * 2.1, speed: 32 + Math.random() * 73,
    phase: Math.random() * Math.PI * 2,
  };
}

function resize() {
  width = innerWidth;
  height = innerHeight;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  snow = Array.from({ length: Math.ceil(width / cell) }, (_, i) =>
    play ? 8 + 4 * Math.sin(i / 7) : 0);
  flakes = Array.from({ length: play ? 125 : Math.min(350, Math.ceil(width / 5)) },
    () => newFlake(true));
}

function circle(x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function draw(now) {
  const dt = Math.min((now - (frameTime ?? now)) / 1000, 0.04);
  frameTime = now;
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < flakes.length; i++) {
    const flake = flakes[i];
    flake.x = (flake.x + width + dt * (12 + 20 * Math.sin(now / 3800)
      + 17 * Math.sin(now / 510 + flake.phase))) % width;
    flake.y += flake.speed * dt;
    const index = Math.floor(flake.x / cell);
    if (flake.y >= height - snow[index]) {
      if (play && snow[index] < 48) snow[index] = Math.min(48, snow[index] + 0.65);
      flakes[i] = newFlake();
    } else {
      circle(flake.x, flake.y, flake.radius, '#ecf8ffcb');
    }
  }
  if (play) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    snow.forEach((depth, i) => {
      const previous = snow[Math.max(0, i - 1)];
      const next = snow[Math.min(snow.length - 1, i + 1)];
      ctx.lineTo(i * cell, height - (previous + 2 * depth + next) / 4);
    });
    ctx.lineTo(width, height - snow.at(-1));
    ctx.lineTo(width, height);
    ctx.fillStyle = '#e8f4fc';
    ctx.fill();
    for (const ball of balls.concat(carried ?? [])) {
      circle(ball.x, ball.y, ball.r, '#d9edf9');
      circle(ball.x - ball.r * 0.15, ball.y - ball.r * 0.2, ball.r * 0.8, '#f5fbff');
      if (ball.stacked) {
        circle(ball.x - ball.r * 0.27, ball.y - 2, 2, '#182943');
        circle(ball.x + ball.r * 0.27, ball.y - 2, 2, '#182943');
        circle(ball.x, ball.y + 3, 2.5, '#f69546');
      }
    }
  }
  requestAnimationFrame(draw);
}

function select(next) {
  tool = next;
  for (const name of ['shovel', 'roll']) {
    document.getElementById(name).setAttribute('aria-pressed', name === tool);
  }
  hint.textContent = tool === 'shovel'
    ? '沿底部拖动，把雪推到铲子前方。'
    : '沿底部滚雪球，拖到更大的雪球上叠起来。';
}

if (play) {
  document.body.classList.add('play');
  document.querySelector('header').hidden = false;
  hint.hidden = false;
  select('roll');
  for (const name of ['shovel', 'roll']) {
    document.getElementById(name).onclick = () => select(name);
  }
  document.getElementById('close').onclick = () => window.close();
  document.getElementById('reset').onclick = () => {
    balls = [];
    resize();
  };
  canvas.onpointerdown = event => {
    if (event.button !== 0 || pointer !== undefined) return;
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    if (tool === 'roll') {
      const existing = balls.findLastIndex(ball =>
        Math.hypot(event.offsetX - ball.x, event.offsetY - ball.y) < ball.r);
      carried = existing >= 0 ? balls.splice(existing, 1)[0]
        : { x: event.offsetX, y: event.offsetY, r: 8 };
    }
  };
  canvas.onpointermove = event => {
    if (event.pointerId !== pointer) return;
    const x = Math.max(0, Math.min(width - 1, event.offsetX));
    const y = event.offsetY;
    if (carried) Object.assign(carried, { x, y });
    if (y < height - 64) return;
    const index = Math.floor(x / cell);
    let collected = 0;
    for (let i = Math.max(0, index - 2); i <= Math.min(snow.length - 1, index + 2); i++) {
      const amount = Math.min(snow[i], carried ? (carried.r < 42 ? 1 : 0) : 3);
      snow[i] -= amount;
      collected += amount;
    }
    if (carried) carried.r = Math.min(42, Math.sqrt(carried.r ** 2 + collected * 2));
    else {
      const ahead = Math.max(0, Math.min(snow.length - 1, index + (event.movementX < 0 ? -3 : 3)));
      snow[ahead] += collected;
    }
  };
  canvas.onpointerup = canvas.onpointercancel = event => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    if (!carried) return;
    const base = balls.findLast(ball => ball.r >= carried.r * 1.15 &&
      Math.abs(ball.x - carried.x) < ball.r &&
      Math.abs(ball.y - ball.r - carried.y) < carried.r + 24);
    carried.stacked = Boolean(base);
    if (base) {
      carried.x = base.x;
      carried.y = base.y - base.r - carried.r + 2;
    } else {
      carried.y = height - carried.r - 5;
    }
    balls.push(carried);
    carried = undefined;
  };
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(draw);
