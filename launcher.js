const button = document.querySelector('button');
let pointer;
let origin;
let moved = false;

button.onpointerdown = event => {
  if (event.button !== 0 || pointer !== undefined) return;
  pointer = event.pointerId;
  origin = { x: event.screenX, y: event.screenY };
  moved = false;
  button.setPointerCapture(pointer);
  window.desktopSnow.moveLauncher('start');
};
button.onpointermove = event => {
  if (event.pointerId !== pointer) return;
  moved ||= Math.hypot(event.screenX - origin.x, event.screenY - origin.y) >= 5;
  if (moved) window.desktopSnow.moveLauncher('move');
};
function finish(event, clicked) {
  if (event.pointerId !== pointer) return;
  pointer = undefined;
  window.desktopSnow.moveLauncher(moved ? 'finish' : 'cancel');
  if (clicked && !moved) window.desktopSnow.enterPlayMode();
}
button.onpointerup = event => finish(event, true);
button.onpointercancel = button.onlostpointercapture = event => finish(event, false);
button.onclick = event => {
  if (event.detail === 0) window.desktopSnow.enterPlayMode();
};
window.desktopSnow.onPlayMode(expanded => button.setAttribute('aria-expanded', String(expanded)));
