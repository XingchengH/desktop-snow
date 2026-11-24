const { app, BrowserWindow, globalShortcut, screen } = require('electron');

let snowfall;
let playground;
let visible = true;

function createSnowfall() {
  snowfall = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    transparent: true, frame: false, show: false, skipTaskbar: true,
    focusable: false, resizable: false, hasShadow: false,
  });
  snowfall.setIgnoreMouseEvents(true);
  snowfall.once('ready-to-show', () => { if (visible) snowfall.showInactive(); });
  snowfall.loadFile('snow.html');
}

function togglePlayground() {
  if (playground) {
    playground.close();
    return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(520, area.width);
  const height = Math.min(350, area.height);
  playground = new BrowserWindow({
    width, height, x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    transparent: true, frame: false, resizable: false, show: false,
  });
  playground.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'Escape') playground?.close();
  });
  playground.on('closed', () => { playground = undefined; });
  playground.once('ready-to-show', () => playground?.show());
  playground.loadFile('snow.html', { query: { play: '1' } });
}

app.whenReady().then(() => {
  createSnowfall();
  screen.on('display-metrics-changed', () => {
    snowfall.setBounds(screen.getPrimaryDisplay().bounds);
  });
  globalShortcut.register('CommandOrControl+Shift+S', togglePlayground);
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    visible = !visible;
    if (visible) snowfall.showInactive();
    else snowfall.hide();
  });
  togglePlayground();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
