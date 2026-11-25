const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopSnow', {
  onPlayMode: callback => ipcRenderer.on('play-mode', (_, enabled) => callback(enabled)),
  onWindowEdges: callback => ipcRenderer.on('window-edges', (_, edges) => callback(edges)),
  leavePlayMode: () => ipcRenderer.send('leave-play-mode'),
  enterPlayMode: () => ipcRenderer.send('enter-play-mode'),
  moveLauncher: phase => ipcRenderer.send('launcher-drag', phase),
  onLauncherAnchor: callback => ipcRenderer.on('launcher-anchor', (_, anchor) => callback(anchor)),
  setToolbarBounds: bounds => ipcRenderer.send('toolbar-bounds', bounds),
  setDragging: dragging => ipcRenderer.send('snow-drag', dragging),
  setDecorationTargets: targets => ipcRenderer.send('decoration-targets', targets),
  onWeatherEvent: callback => ipcRenderer.on('weather-event', (_, event) => callback(event)),
});
