const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor, systemPreferences } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');

let snowfall, tracker, tray, launcher, eventTimer;
let playing = false;
let visible = true;
let trackedWindows = [];
let draggingSnow = false;
let inputTimer;
let capturesMouse = false;
let decorationTargets = [];

function snowFloor(display) {
  return display.workArea.y + display.workArea.height;
}

function updateMouseCapture() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  const floor = snowFloor(display);
  const center = bounds.x + bounds.width / 2;
  const toolbar = Math.abs(cursor.x - center) <= 350 &&
    cursor.y >= floor - 135 && cursor.y <= floor - 85;
  const overWindow = trackedWindows.some(rect => cursor.x >= rect.x &&
    cursor.x < rect.x + rect.width && cursor.y >= rect.y && cursor.y < rect.y + rect.height);
  const snowbank = cursor.x >= workArea.x && cursor.x < workArea.x + workArea.width &&
    cursor.y >= floor - 62 && cursor.y < floor && !overWindow;
  const overlay = snowfall.getBounds();
  const decoration = !overWindow && decorationTargets.some(({ x, y, radius }) =>
    Math.hypot(cursor.x - overlay.x - x, cursor.y - overlay.y - y) <= radius);
  const capture = playing && (draggingSnow || toolbar || snowbank || decoration);
  if (capture !== capturesMouse) {
    capturesMouse = capture;
    snowfall.setIgnoreMouseEvents(!capture);
  }
}

function sendWindowEdges() {
  const { x, y } = snowfall.getBounds();
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  const bottom = snowFloor(display);
  const left = workArea.x - bounds.x;
  const right = bounds.x + bounds.width - workArea.x - workArea.width;
  // The floating Dock is inset from the screen edge on this layout.
  const dockInset = process.platform === 'darwin' ? Math.min(17, workArea.width / 8) : 0;
  const bars = [
    { id: -1, x: workArea.x + dockInset, y: bottom, width: workArea.width - 2 * dockInset,
      height: bounds.y + bounds.height - bottom, cornerRadius: dockInset ? 12 : 0 },
    { id: -2, x: bounds.x, y: workArea.y, width: left, height: workArea.height },
    { id: -3, x: workArea.x + workArea.width, y: workArea.y, width: right, height: workArea.height },
  ].filter((bar, index) => (index === 0 ? bar.height : bar.width) >= 10);
  snowfall.webContents.send('window-edges', [
    ...bars.map(bar => ({ ...bar, systemBar: true })),
    ...trackedWindows,
  ].map(rect => ({ ...rect, x: rect.x - x, y: rect.y - y })));
}

function setPlaying(next) {
  playing = next && visible;
  if (!playing) draggingSnow = false;
  updateMouseCapture();
  snowfall.setFocusable(playing);
  if (playing) {
    launcher?.hide();
    snowfall.focus();
  } else {
    launcher?.showInactive();
    launcher?.moveTop();
  }
  snowfall.webContents.send('play-mode', playing);
  updateMenu();
}

function toggleSnow() {
  visible = !visible;
  setPlaying(false);
  if (visible) snowfall.showInactive();
  else snowfall.hide();
}

function startPlaying() {
  if (!visible) toggleSnow();
  setPlaying(true);
}

function launcherPosition() {
  const display = screen.getPrimaryDisplay();
  return { x: display.workArea.x + 14, y: snowFloor(display) - 60 };
}

function createLauncher() {
  launcher = new BrowserWindow({
    ...launcherPosition(), width: 112, height: 38, transparent: true, frame: false,
    show: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    focusable: false, acceptFirstMouse: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  launcher.once('ready-to-show', () => { if (!playing) launcher.showInactive(); });
  launcher.loadFile('launcher.html');
}

function startWeatherEvents() {
  const nextWarmSpell = () => Date.now() + 150_000 + Math.random() * 180_000;
  let warmAt = nextWarmSpell();
  let treeGrownThisBreak = false;
  eventTimer = setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle < 10) treeGrownThisBreak = false;
    if (!visible) return;
    if (idle >= 90 && !treeGrownThisBreak) {
      treeGrownThisBreak = true;
      snowfall.webContents.send('weather-event', 'tree');
    }
    if (Date.now() >= warmAt) {
      warmAt = nextWarmSpell();
      snowfall.webContents.send('weather-event', 'warm');
    }
  }, 1000);
}

function updateMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: playing ? '退出玩雪' : '开始玩雪', click: () => {
      if (playing) setPlaying(false);
      else startPlaying();
    } },
    { label: '试试回暖', enabled: visible, click: () => snowfall.webContents.send('weather-event', 'warm') },
    { label: '种一棵圣诞树', enabled: visible, click: () => snowfall.webContents.send('weather-event', 'tree') },
    ...(process.platform === 'darwin' ? [{
      label: '允许桌面图标积雪',
      click: () => systemPreferences.isTrustedAccessibilityClient(true),
    }] : []),
    { label: visible ? '隐藏雪景' : '显示雪景', click: toggleSnow },
    { type: 'separator' },
    { label: '退出桌面雪景', click: () => app.quit() },
  ]));
}

function createTray() {
  const size = 18;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 2; y < 16; y++) {
    for (let x = 2; x < 16; x++) {
      if (x === 8 || y === 8 || x === y || x + y === 16) {
        const i = (y * size + x) * 4;
        pixels.set(process.platform === 'darwin' ? [0, 0, 0, 255] : [245, 202, 112, 255], i);
      }
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('桌面雪景');
  updateMenu();
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
}

function trackWindows() {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'win32') return;
  const macTracker = app.isPackaged ? path.join(process.resourcesPath, 'desktop-snow-tracker') : '/usr/bin/swift';
  tracker = spawn(mac ? macTracker : 'powershell.exe', mac
    ? (app.isPackaged ? [String(process.pid)] : [path.join(__dirname, 'windows.swift'), String(process.pid)])
    : ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'windows.ps1'), String(process.pid)],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  tracker.on('error', error => console.warn('Window tracking:', error.message));
  tracker.stderr.on('data', data => console.warn(String(data).trim()));
  createInterface({ input: tracker.stdout }).on('line', line => {
    try {
      trackedWindows = JSON.parse(line).map(({ id, desktopItem, finderIcon, ...rect }) => {
        const bounds = mac ? rect : screen.screenToDipRect(null, rect);
        return { ...bounds, id, desktopItem, finderIcon,
          cornerRadius: finderIcon ? 5 : mac ? (desktopItem ? 16 : 12) : 8 };
      });
      sendWindowEdges();
    } catch (error) {
      console.warn('Window tracking:', error.message);
    }
  });
}

app.whenReady().then(() => {
  snowfall = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    transparent: true, frame: false, show: false, skipTaskbar: true,
    focusable: false, resizable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  snowfall.setIgnoreMouseEvents(true);
  snowfall.on('blur', () => { if (playing) setPlaying(false); });
  snowfall.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'Escape' && playing) setPlaying(false);
  });
  ipcMain.on('leave-play-mode', event => {
    if (event.sender === snowfall.webContents) setPlaying(false);
  });
  ipcMain.on('enter-play-mode', event => {
    if (event.sender === launcher?.webContents) startPlaying();
  });
  ipcMain.on('snow-drag', (event, dragging) => {
    if (event.sender !== snowfall.webContents) return;
    draggingSnow = playing && dragging === true;
    updateMouseCapture();
  });
  ipcMain.on('decoration-targets', (event, targets) => {
    if (event.sender !== snowfall.webContents || !Array.isArray(targets)) return;
    decorationTargets = targets.slice(0, 60);
    updateMouseCapture();
  });
  snowfall.once('ready-to-show', () => {
    if (visible) snowfall.showInactive();
    sendWindowEdges();
    trackWindows();
    startWeatherEvents();
  });
  snowfall.loadFile('snow.html');
  createLauncher();
  createTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '玩雪', submenu: [
      { label: '开始玩雪', click: startPlaying },
      { label: '退出玩雪', click: () => setPlaying(false) },
      { label: '显示或隐藏雪景', click: toggleSnow },
    ] },
  ]));
  inputTimer = setInterval(() => { if (playing) updateMouseCapture(); }, 25);
  screen.on('display-metrics-changed', () => {
    snowfall.setBounds(screen.getPrimaryDisplay().bounds);
    const { x, y } = launcherPosition();
    launcher.setPosition(x, y);
    sendWindowEdges();
  });
  globalShortcut.register('CommandOrControl+Shift+S', () => setPlaying(!playing));
  globalShortcut.register('CommandOrControl+Shift+D', toggleSnow);
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tracker?.kill();
  clearInterval(eventTimer);
  clearInterval(inputTimer);
});
