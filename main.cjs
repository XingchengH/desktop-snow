const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor, systemPreferences, dialog, net, shell } = require('electron');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const { createUpdateChecker } = require('./updates.cjs');
const checkForUpdates = createUpdateChecker({ app, dialog, net, shell });

let tracker, tray, eventTimer;
const scenes = new Map();
let displayChoice = 'primary';
let activeScene;
let playing = false;
let visible = true;
let trackedWindows = [];
let finderIcons = [];
let finderTimer;
let draggingSnow = false;
let inputTimer;
let capturesMouse = false;

function selectedDisplays() {
  const displays = screen.getAllDisplays();
  if (displayChoice === 'all') return displays;
  return [displays.find(display => String(display.id) === displayChoice) ?? screen.getPrimaryDisplay()];
}

function preferencePath() {
  return path.join(app.getPath('userData'), 'display.json');
}

function chooseDisplay(value) {
  displayChoice = value;
  try {
    fs.writeFileSync(preferencePath(), JSON.stringify({ display: value }));
  } catch (error) {
    console.warn('Display preference:', error.message);
  }
  reconcileDisplays();
}

function snowFloor(display) {
  return display.workArea.y + display.workArea.height;
}

function updateMouseCapture() {
  if (!activeScene) return;
  const { display, snowfall, decorationTargets } = activeScene;
  const cursor = screen.getCursorScreenPoint();
  const { bounds, workArea } = display;
  const floor = snowFloor(display);
  const center = bounds.x + bounds.width / 2;
  const toolbar = Math.abs(cursor.x - center) <= 350 &&
    cursor.y >= floor - 135 && cursor.y <= floor - 85;
  const overWindow = [...trackedWindows, ...finderIcons].some(rect => cursor.x >= rect.x &&
    cursor.x < rect.x + rect.width && cursor.y >= rect.y && cursor.y < rect.y + rect.height);
  const snowbank = cursor.x >= workArea.x && cursor.x < workArea.x + workArea.width &&
    cursor.y >= floor - 62 && cursor.y < floor && !overWindow;
  const windowLedge = !overWindow && trackedWindows.some(rect => !rect.desktopItem &&
    cursor.x >= rect.x + 6 && cursor.x < rect.x + rect.width - 6 &&
    cursor.y >= rect.y - 36 && cursor.y < rect.y);
  const overlay = snowfall.getBounds();
  const decoration = decorationTargets.some(({ x, y, radius, width, height }) => {
    const dx = cursor.x - overlay.x - x;
    const dy = cursor.y - overlay.y - y;
    return radius ? !overWindow && Math.hypot(dx, dy) <= radius
      : dx >= 0 && dy >= 0 && dx < width && dy < height;
  });
  const onDisplay = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height;
  const capture = playing && (draggingSnow || (onDisplay && (toolbar || snowbank || decoration || windowLedge)));
  if (capture !== capturesMouse) {
    capturesMouse = capture;
    snowfall.setIgnoreMouseEvents(!capture);
  }
}

function sendSceneEdges(scene) {
  const { snowfall, display, ready } = scene;
  if (!ready) return;
  const overlay = snowfall.getBounds();
  const { x, y } = overlay;
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
  const edges = [
    ...bars.map(bar => ({ ...bar, systemBar: true })),
    ...trackedWindows,
    ...finderIcons,
  ].filter(rect => rect.x < x + overlay.width && rect.x + rect.width > x &&
    rect.y < y + overlay.height && rect.y + rect.height > y)
    .map(rect => ({ ...rect, x: rect.x - x, y: rect.y - y }));
  const signature = JSON.stringify(edges);
  // Send one unchanged sample after movement so the renderer can detect a stop.
  if (signature === scene.edgeSignature && scene.sentStationarySample) return;
  scene.sentStationarySample = signature === scene.edgeSignature;
  scene.edgeSignature = signature;
  snowfall.webContents.send('window-edges', edges);
}

function sendWindowEdges() {
  for (const scene of scenes.values()) sendSceneEdges(scene);
}

function sendWeather(event) {
  for (const { snowfall, ready } of scenes.values()) {
    if (ready) snowfall.webContents.send('weather-event', event);
  }
}

function setPlaying(next, scene = activeScene) {
  if (!scene || !scene.ready) return;
  if (activeScene && activeScene !== scene) setPlaying(false, activeScene);
  activeScene = scene;
  const { snowfall, launcher } = scene;
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
  if (!playing) activeScene = undefined;
  updateMenu();
}

function toggleSnow() {
  visible = !visible;
  setPlaying(false);
  for (const { snowfall, ready } of scenes.values()) {
    if (visible && ready) snowfall.showInactive();
    else snowfall.hide();
  }
}

function startPlaying(scene) {
  if (!visible) toggleSnow();
  const nearest = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  setPlaying(true, scene ?? scenes.get(nearest.id) ?? scenes.values().next().value);
}

function launcherPosition(display) {
  return { x: display.workArea.x + 14, y: snowFloor(display) - 60 };
}

function createLauncher(scene) {
  const launcher = new BrowserWindow({
    ...launcherPosition(scene.display), width: 112, height: 38, transparent: true, frame: false,
    show: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    focusable: false, acceptFirstMouse: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  launcher.once('ready-to-show', () => { if (activeScene !== scene) launcher.showInactive(); });
  launcher.loadFile('launcher.html');
  return launcher;
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
      sendWeather('tree');
    }
    if (Date.now() >= warmAt) {
      warmAt = nextWarmSpell();
      sendWeather('warm');
    }
  }, 1000);
}

function displayMenu() {
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    label: '显示器',
    submenu: [
      { label: '所有显示器', type: 'radio', checked: displayChoice === 'all', click: () => chooseDisplay('all') },
      { label: '跟随主显示器', type: 'radio', checked: displayChoice === 'primary', click: () => chooseDisplay('primary') },
      ...screen.getAllDisplays().map((display, index) => ({
        label: `${index + 1}. ${display.label || '显示器'}${display.id === primaryId ? '（主）' : ''}`,
        type: 'radio', checked: displayChoice === String(display.id),
        click: () => chooseDisplay(String(display.id)),
      })),
    ],
  };
}

function updateMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: playing ? '退出玩雪' : '开始玩雪', click: () => {
      if (playing) setPlaying(false);
      else startPlaying();
    } },
    displayMenu(),
    { label: '试试回暖', enabled: visible, click: () => sendWeather('warm') },
    { label: '种一棵圣诞树', enabled: visible, click: () => sendWeather('tree') },
    ...(process.platform === 'darwin' ? [{
      label: '允许桌面图标积雪',
      click: () => systemPreferences.isTrustedAccessibilityClient(true),
    }] : []),
    { label: visible ? '隐藏雪景' : '显示雪景', click: toggleSnow },
    { label: '检查更新…', click: checkForUpdates },
    { type: 'separator' },
    { label: '退出桌面雪景', click: () => app.quit() },
  ]));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '玩雪', submenu: [
      { label: '开始玩雪', click: () => startPlaying() },
      { label: '退出玩雪', click: () => setPlaying(false) },
      { label: '显示或隐藏雪景', click: toggleSnow },
      { label: '检查更新…', click: checkForUpdates },
      displayMenu(),
    ] },
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
  const finderPath = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build'), 'finder-icons.node');
  let finderReader;
  if (mac && (app.isPackaged || fs.existsSync(finderPath))) {
    try {
      finderReader = require(finderPath);
      finderTimer = setInterval(() => {
        if (!visible) return;
        finderIcons = finderReader.read().map(rect => ({
          ...rect, desktopItem: true, finderIcon: true, cornerRadius: 5,
        }));
        if (process.env.DESKTOP_SNOW_DEBUG === '1' && !trackWindows.loggedFinder) {
          console.warn(`Finder (app process): trusted=${systemPreferences.isTrustedAccessibilityClient(false)}; icons=${finderIcons.length}`);
          trackWindows.loggedFinder = true;
        }
      }, 750);
    } catch (error) {
      console.warn('Finder icon tracking:', error.message);
    }
  }
  const trackerArgs = app.isPackaged
    ? [String(process.pid)] : [path.join(__dirname, 'windows.swift'), String(process.pid)];
  if (finderReader) trackerArgs.push('--windows-only');
  tracker = spawn(mac ? macTracker : 'powershell.exe', mac
    ? trackerArgs
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

function createScene(display) {
  const snowfall = new BrowserWindow({
    ...display.bounds,
    transparent: true, frame: false, show: false, skipTaskbar: true,
    focusable: false, resizable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  const scene = { display, snowfall, ready: false, decorationTargets: [] };
  scenes.set(display.id, scene);
  snowfall.setIgnoreMouseEvents(true);
  snowfall.on('blur', () => { if (activeScene === scene && playing) setPlaying(false); });
  snowfall.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'Escape' && activeScene === scene && playing) setPlaying(false);
  });
  snowfall.once('ready-to-show', () => {
    scene.ready = true;
    if (visible) snowfall.showInactive();
    sendSceneEdges(scene);
  });
  snowfall.loadFile('snow.html');
  scene.launcher = createLauncher(scene);
  return scene;
}

function reconcileDisplays() {
  const selected = selectedDisplays();
  const ids = new Set(selected.map(display => display.id));
  for (const display of selected) {
    const scene = scenes.get(display.id);
    if (!scene) {
      createScene(display);
      continue;
    }
    scene.display = display;
    scene.snowfall.setBounds(display.bounds);
    const { x, y } = launcherPosition(display);
    scene.launcher.setPosition(x, y);
  }
  for (const [id, scene] of scenes) {
    if (ids.has(id)) continue;
    if (activeScene === scene) setPlaying(false);
    scenes.delete(id);
    scene.snowfall.destroy();
    scene.launcher.destroy();
  }
  sendWindowEdges();
  updateMenu();
}

app.whenReady().then(() => {
  try {
    const { display } = JSON.parse(fs.readFileSync(preferencePath(), 'utf8'));
    if (typeof display === 'string' && /^(primary|all|-?\d+)$/.test(display)) displayChoice = display;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Display preference:', error.message);
  }
  ipcMain.on('leave-play-mode', event => {
    if (event.sender === activeScene?.snowfall.webContents) setPlaying(false);
  });
  ipcMain.on('enter-play-mode', event => {
    const scene = Array.from(scenes.values()).find(entry => event.sender === entry.launcher.webContents);
    if (scene) startPlaying(scene);
  });
  ipcMain.on('snow-drag', (event, dragging) => {
    if (event.sender !== activeScene?.snowfall.webContents) return;
    draggingSnow = playing && dragging === true;
    updateMouseCapture();
  });
  ipcMain.on('decoration-targets', (event, targets) => {
    const scene = Array.from(scenes.values()).find(entry => event.sender === entry.snowfall.webContents);
    if (!scene || !Array.isArray(targets)) return;
    scene.decorationTargets = targets.slice(0, 60);
    if (activeScene === scene) updateMouseCapture();
  });
  reconcileDisplays();
  createTray();
  trackWindows();
  startWeatherEvents();
  inputTimer = setInterval(() => { if (playing) updateMouseCapture(); }, 25);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, reconcileDisplays);
  }
  globalShortcut.register('CommandOrControl+Shift+S', () => playing ? setPlaying(false) : startPlaying());
  globalShortcut.register('CommandOrControl+Shift+D', toggleSnow);
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tracker?.kill();
  clearInterval(eventTimer);
  clearInterval(inputTimer);
  clearInterval(finderTimer);
});
