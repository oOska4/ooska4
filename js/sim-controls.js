'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-controls.js
//
// ZASADA:
//   • Joystick lotu (lewy)  → pitch + roll samolotu  (zawsze)
//   • Slider gazu  (prawy)  → throttle samolotu       (zawsze)
//   • Guziki rudera         → yaw samolotu             (zawsze)
//   • Dotyk canvasu         → kamera (orbit: obrót/zoom | cockpit: rozglądanie)
// ═══════════════════════════════════════════════════════════════════════════════

const IS_TOUCH  = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const WASD_SPEED = 30, QE_SPEED = 30;
const cv = document.getElementById('c');

// ── Klawiatura ───────────────────────────────────────────────────────────────
const keys      = new Set();
const planeKeys = {};

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w','a','s','d','q','e'].includes(k)) keys.add(k);
  const PCODES = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyQ','KeyE'];
  if (PCODES.includes(e.code)) { planeKeys[e.code] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  keys.delete(e.key.toLowerCase());
  planeKeys[e.code] = false;
  const p = activeEntity;
  switch (e.code) {
    case 'KeyF': if (p) { p.flaps = (p.flaps + 1) % 4; } break;
    case 'KeyG': if (p && !p.onGround) { p.gearDown = !p.gearDown; p.updateGearVisibility(); } break;
    case 'KeyB': if (p) { p.spoilers = !p.spoilers; } break;
    case 'KeyR': resetPlane(); break;
    case 'KeyC': cycleCameraMode(); break;
  }
});

// ── Desktop: mysz na canvasie ────────────────────────────────────────────────
let mDown = false, rDown = false, lx = 0, ly = 0;
cv.addEventListener('mousedown', e => {
  if (e.button === 0) mDown = true;
  if (e.button === 2) rDown = true;
  lx = e.clientX; ly = e.clientY; e.preventDefault();
});
window.addEventListener('mouseup', () => { mDown = false; rDown = false; });
window.addEventListener('mousemove', e => {
  const dx = e.clientX - lx, dy = e.clientY - ly;
  lx = e.clientX; ly = e.clientY;
  if (!dx && !dy) return;
  if (mDown) {
    if (camMode === CameraMode.ORBIT) {
      orb.yaw   -= dx * 0.3;
      orb.pitch  = Math.max(5, Math.min(89, orb.pitch + dy * 0.25));
    } else if (camMode === CameraMode.COCKPIT) {
      cockpitLook.yaw   = Math.max(-2.6, Math.min(2.6, cockpitLook.yaw   - dx * 0.006));
      cockpitLook.pitch = Math.max(-1.3, Math.min(1.3, cockpitLook.pitch + dy * 0.004));
    }
  }
  if (rDown && camMode === CameraMode.ORBIT) {
    const cosRef = Math.cos(Units.degToRad(refLat));
    const spd = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
    const yr  = Units.degToRad(orb.yaw);
    orb.lon += (Math.sin(yr) * dy - Math.cos(yr) * dx) * spd / cosRef;
    orb.lat += (Math.cos(yr) * dy + Math.sin(yr) * dx) * spd;
  }
});
cv.addEventListener('wheel', e => {
  if (camMode === CameraMode.ORBIT)
    orb.dist = Math.max(30, Math.min(900_000, orb.dist * (1 + e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

// ── Desktop: klawiatura orbit ────────────────────────────────────────────────
function updateOrbitKeyboard(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  const fwd = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const str = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  const clb = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
  if (!fwd && !str && !clb) return;
  const cosRef = Math.cos(Units.degToRad(refLat));
  const yr  = Units.degToRad(orb.yaw);
  const hm  = Math.max(50, orb.dist * 0.0015) * WASD_SPEED * dt;
  const vm  = Math.max(50, orb.dist * 0.0015) * QE_SPEED   * dt;
  orb.lon += ((fwd * Math.sin(yr) + str * Math.cos(yr)) * hm / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  orb.lat += ((fwd * Math.cos(yr) - str * Math.sin(yr)) * hm /  EARTH_RADIUS)            * 180 / Math.PI;
  orb.y   +=  clb * vm;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOUCH NA CANVASIE — kamera (orbit: obrót+zoom | cockpit: rozglądanie)
//  Ignorujemy touche które startują na kontrolkach mobilnych (stopPropagation)
// ═══════════════════════════════════════════════════════════════════════════════
const cvTouches = new Map();   // id → {x,y}  — tylko touche z canvasu
let cvPinchDist = null, cvPanMid = null;

function _cvMid(m) {
  const pts = [...m.values()];
  if (pts.length < 2) return null;
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}
function _cvDist(m) {
  const pts = [...m.values()];
  if (pts.length < 2) return null;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

cv.addEventListener('touchstart', e => {
  for (const t of e.changedTouches)
    cvTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  if (cvTouches.size === 2) {
    cvPinchDist = _cvDist(cvTouches);
    cvPanMid    = _cvMid(cvTouches);
  }
}, { passive: true });

cv.addEventListener('touchmove', e => {
  const prev = new Map(cvTouches);
  for (const t of e.changedTouches) {
    if (!cvTouches.has(t.identifier)) continue;  // ten palec startował poza canvasem
    cvTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  }

  if (camMode === CameraMode.ORBIT) {
    if (cvTouches.size === 1) {
      // Jeden palec: obrót kamery
      const id  = cvTouches.keys().next().value;
      const cur = cvTouches.get(id), old = prev.get(id);
      if (cur && old) {
        orb.yaw   -= (cur.x - old.x) * 0.35;
        orb.pitch  = Math.max(5, Math.min(89, orb.pitch + (cur.y - old.y) * 0.25));
      }
    } else if (cvTouches.size === 2) {
      // Dwa palce: pinch zoom + pan
      const newDist = _cvDist(cvTouches);
      const newMid  = _cvMid(cvTouches);
      if (cvPinchDist && newDist)
        orb.dist = Math.max(30, Math.min(900_000, orb.dist * (cvPinchDist / newDist)));
      if (cvPanMid && newMid) {
        const cosRef = Math.cos(Units.degToRad(refLat));
        const spd = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
        const yr  = Units.degToRad(orb.yaw);
        const dx  = newMid.x - cvPanMid.x, dy = newMid.y - cvPanMid.y;
        orb.lon -= (Math.sin(yr) * dy - Math.cos(yr) * dx) * spd / cosRef;
        orb.lat -= (Math.cos(yr) * dy + Math.sin(yr) * dx) * spd;
      }
      cvPinchDist = newDist;
      cvPanMid    = newMid;
    }
  } else if (camMode === CameraMode.COCKPIT && cvTouches.size === 1) {
    // Kokpit: rozglądanie
    const id  = cvTouches.keys().next().value;
    const cur = cvTouches.get(id), old = prev.get(id);
    if (cur && old) {
      cockpitLook.yaw   = Math.max(-2.6, Math.min(2.6, cockpitLook.yaw   + (cur.x - old.x) * 0.006));
      cockpitLook.pitch = Math.max(-1.3, Math.min(1.3, cockpitLook.pitch + (cur.y - old.y) * 0.004));
    }
  }
}, { passive: true });

cv.addEventListener('touchend',    e => { for (const t of e.changedTouches) cvTouches.delete(t.identifier); if (cvTouches.size < 2) { cvPinchDist = null; cvPanMid = null; } });
cv.addEventListener('touchcancel', e => { for (const t of e.changedTouches) cvTouches.delete(t.identifier); cvPinchDist = null; cvPanMid = null; });

// stubs żeby sim-main.js się nie poskarżył
function applyJoystick(dt)    {}
function applyZoomButtons(dt) {}

// ═══════════════════════════════════════════════════════════════════════════════
//  JOYSTICK LOTU — pitch + roll (zawsze steruje samolotem)
// ═══════════════════════════════════════════════════════════════════════════════
const flyBase = document.getElementById('fly-joy-base');
const flyKnob = document.getElementById('fly-joy-knob');
const FLY_R   = 40;
let flyId     = -1;
let flyDelta  = { x: 0, y: 0 };

flyBase.addEventListener('touchstart', e => {
  e.stopPropagation();   // nie przekazuj do canvasu
  const t = e.changedTouches[0];
  flyId = t.identifier;
  const r = flyBase.getBoundingClientRect();
  _flyMove(t.clientX, t.clientY,
    r.left + r.width  / 2,
    r.top  + r.height / 2);
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (flyId < 0) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== flyId) continue;
    const r = flyBase.getBoundingClientRect();
    _flyMove(t.clientX, t.clientY,
      r.left + r.width  / 2,
      r.top  + r.height / 2);
  }
}, { passive: true });

window.addEventListener('touchend',    e => { for (const t of e.changedTouches) if (t.identifier === flyId) _flyReset(); });
window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) if (t.identifier === flyId) _flyReset(); });

function _flyMove(cx, cy, ox, oy) {
  const dx = cx - ox, dy = cy - oy;
  const len = Math.hypot(dx, dy);
  const clamp = Math.min(len, FLY_R);
  const nx = len > 0 ? dx / len * clamp : 0;
  const ny = len > 0 ? dy / len * clamp : 0;
  flyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  flyDelta = { x: nx / FLY_R, y: ny / FLY_R };
}
function _flyReset() {
  flyId = -1; flyDelta = { x: 0, y: 0 };
  flyKnob.style.transform = 'translate(-50%,-50%)';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SLIDER GAZU — zawsze steruje samolotem
// ═══════════════════════════════════════════════════════════════════════════════
const thrTrack = document.getElementById('thr-track');
const thrFill  = document.getElementById('thr-fill');
const thrThumb = document.getElementById('thr-thumb');
const thrPct   = document.getElementById('thr-pct');

let thrId    = -1;
let thrValue = -1;   // -1 = suwak nie dotknięty

thrTrack.addEventListener('touchstart', e => {
  e.stopPropagation(); e.preventDefault();
  const t = e.changedTouches[0];
  thrId = t.identifier;
  _thrSet(_thrY(t.clientY));
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (thrId < 0) return;
  for (const t of e.changedTouches)
    if (t.identifier === thrId) _thrSet(_thrY(t.clientY));
}, { passive: true });

window.addEventListener('touchend',    e => { for (const t of e.changedTouches) if (t.identifier === thrId) thrId = -1; });
window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) if (t.identifier === thrId) thrId = -1; });

function _thrY(clientY) {
  const r = thrTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
}
function _thrSet(v) {
  thrValue = v;
  _thrDraw(v);
}
function _thrDraw(v) {
  const pct = Math.round(v * 100);
  if (thrFill)  thrFill.style.height   = pct + '%';
  if (thrThumb) thrThumb.style.bottom  = `calc(${pct}% - 11px)`;
  if (thrPct)   thrPct.textContent     = pct + '%';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RUDER — yaw samolotu
// ═══════════════════════════════════════════════════════════════════════════════
const rudState = { L: false, R: false };
function _holdBtn(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('touchstart',  e => { rudState[key] = true;  e.stopPropagation(); e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend',    () => rudState[key] = false);
  el.addEventListener('touchcancel', () => rudState[key] = false);
}
_holdBtn('mob-rud-l', 'L');
_holdBtn('mob-rud-r', 'R');

// ═══════════════════════════════════════════════════════════════════════════════
//  PASEK GUZIKÓW
// ═══════════════════════════════════════════════════════════════════════════════
let brakesHeld = false;
let aptOpen    = false;

function _btn(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

_btn('mb-flaps', () => {
  if (!activeEntity) return;
  activeEntity.flaps = (activeEntity.flaps + 1) % 4;
  const l = document.getElementById('mb-flaps-lbl');
  if (l) l.textContent = 'FLAP ' + activeEntity.flaps;
});

_btn('mb-gear', () => {
  const p = activeEntity; if (!p || p.onGround) return;
  p.gearDown = !p.gearDown; p.updateGearVisibility();
  document.getElementById('mb-gear')?.classList.toggle('active', p.gearDown);
});

_btn('mb-splr', () => {
  const p = activeEntity; if (!p) return;
  p.spoilers = !p.spoilers;
  document.getElementById('mb-splr')?.classList.toggle('active', p.spoilers);
});

const brakeEl = document.getElementById('mb-brakes');
if (brakeEl) {
  brakeEl.addEventListener('touchstart',  e => { brakesHeld = true;  brakeEl.classList.add('pressed');    e.preventDefault(); }, { passive: false });
  brakeEl.addEventListener('touchend',    () => { brakesHeld = false; brakeEl.classList.remove('pressed'); });
  brakeEl.addEventListener('touchcancel', () => { brakesHeld = false; brakeEl.classList.remove('pressed'); });
}

_btn('mb-reset', resetPlane);
_btn('mb-appr',  spawnApproach);
_btn('mb-cam',   cycleCameraMode);

_btn('mb-apt', () => {
  aptOpen = !aptOpen;
  const pk = document.getElementById('apt-picker');
  if (pk) pk.style.display = aptOpen ? 'flex' : 'none';
  document.getElementById('mb-apt')?.classList.toggle('active', aptOpen);
});
_btn('apt-close', () => {
  aptOpen = false;
  const pk = document.getElementById('apt-picker');
  if (pk) pk.style.display = 'none';
  document.getElementById('mb-apt')?.classList.remove('active');
});

// airport buttons w pickerze
document.querySelectorAll('#apt-picker .airport-btn').forEach(btn => {
  btn.addEventListener('click', () => selectAirport(btn.id === 'btn-airport-epwr' ? 'EPWR' : 'LOWI'));
});

// Desktop airport + action buttons
_btn('btn-airport-epwr', () => selectAirport('EPWR'));
_btn('btn-airport-lowi', () => selectAirport('LOWI'));
_btn('btn-reset',        resetPlane);
_btn('btn-approach',     spawnApproach);
_btn('btn-camera',       cycleCameraMode);
_btn('btn-orbit-free', () => {
  if (activeEntity) { orb.lat = activeEntity.lat; orb.lon = activeEntity.lon; orb.y = activeEntity.worldPos.y; }
  orb.dist = 8000; orb.pitch = 40; orb.free = true;
  setCameraMode(CameraMode.ORBIT);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  updatePlaneInput — jedno miejsce, wszystkie źródła
// ═══════════════════════════════════════════════════════════════════════════════
function updatePlaneInput() {
  // Pitch + roll: klawiatura lub joystick (joystick ma pierwszeństwo na touch)
  let pitch = (planeKeys['ArrowUp']    ? 1 : 0) - (planeKeys['ArrowDown']  ? 1 : 0);
  let roll  = (planeKeys['ArrowRight'] ? 1 : 0) - (planeKeys['ArrowLeft']  ? 1 : 0);
  if (IS_TOUCH && flyId >= 0) {
    pitch = -flyDelta.y;   // joystick góra = nos w górę
    roll  =  flyDelta.x;
  }

  // Yaw: klawiatura lub guziki rudera
  let yaw = (planeKeys['KeyQ'] ? -1 : 0) + (planeKeys['KeyE'] ? 1 : 0);
  if (IS_TOUCH) {
    if (rudState.L) yaw = -1;
    if (rudState.R) yaw  =  1;
  }

  // Throttle: slider ma pierwszeństwo nad klawiszami
  let throttleUp   = !!planeKeys['KeyW'];
  let throttleDown = !!planeKeys['KeyS'];
  let brakes       = !!planeKeys['KeyS'] || brakesHeld;

  if (IS_TOUCH && activeEntity) {
    if (thrValue >= 0) {
      // Slider tknięty — ustaw bezpośrednio
      activeEntity.throttle = thrValue;
      throttleUp = false; throttleDown = false;
    } else {
      // Slider nie tknięty — synchronizuj wizualnie z silnikiem
      _thrDraw(activeEntity.throttle);
    }
  }

  planeInput.pitch        = pitch;
  planeInput.roll         = roll;
  planeInput.yaw          = yaw;
  planeInput.throttleUp   = throttleUp;
  planeInput.throttleDown = throttleDown;
  planeInput.brakes       = brakes;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESET / SPAWN / AIRPORT
// ═══════════════════════════════════════════════════════════════════════════════
function resetPlane() {
  if (!activeEntity) return;
  const apt = AIRPORTS[currentAirport];
  thrValue = -1;
  activeEntity.reset({
    lat: apt.spawnLat, lon: apt.spawnLon,
    yawRad: Units.degToRad((180 - apt.heading + 360) % 360),
  });
}

function spawnApproach() {
  const plane = activeEntity; if (!plane) return;
  const apt = AIRPORTS[currentAirport];
  const yawRad = Units.degToRad((180 - apt.heading + 360) % 360);
  const D = 6000, bear = (apt.heading + 180) % 360;
  const p = offsetGeo(apt.spawnLat, apt.spawnLon,
    D * Math.sin(Units.degToRad(bear)),
    D * Math.cos(Units.degToRad(bear)));
  const groundH = terrainHeightBest(p.lat, p.lon);
  thrValue = 0.55;
  _thrDraw(0.55);
  plane.reset({
    lat: p.lat, lon: p.lon, altM: groundH + 300,
    yawRad, pitchRad: 0.02,
    velX: Math.sin(yawRad) * 70, velY: -2, velZ: Math.cos(yawRad) * 70,
    throttle: 0.55, flaps: 2, gearDown: true, onGround: false,
  });
  for (const [r, z] of [[2,17],[3,15],[4,13],[5,11]]) prefetchDEM(p.lat, p.lon, r, z);
}

function selectAirport(code) {
  if (!AIRPORTS[code]) return;
  currentAirport = code;
  const apt = AIRPORTS[code];
  refLat = apt.refLat; refLon = apt.refLon;
  document.querySelectorAll('.airport-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`#btn-airport-${code.toLowerCase()}`).forEach(b => b.classList.add('active'));
  thrValue = -1;
  aptOpen = false;
  const pk = document.getElementById('apt-picker');
  if (pk) pk.style.display = 'none';
  document.getElementById('mb-apt')?.classList.remove('active');
  if (activeEntity) {
    activeEntity.reset({ lat: apt.spawnLat, lon: apt.spawnLon, yawRad: Units.degToRad((180 - apt.heading + 360) % 360) });
    orb.lat = apt.spawnLat; orb.lon = apt.spawnLon;
    for (const [r, z] of [[2,17],[3,15],[4,13],[5,11]]) prefetchDEM(apt.spawnLat, apt.spawnLon, r, z);
  }
}

// ── Emisja spalin ─────────────────────────────────────────────────────────────
const EXHAUST_LOCAL_POS = [new THREE.Vector3(1, -1, 5), new THREE.Vector3(1, -1, -5)];
const _exhaustBackDir  = new THREE.Vector3();
const _exhaustWorldPos = new THREE.Vector3();
function emitExhaust(plane, exhaust) {
  plane.mesh.updateMatrixWorld(true);
  _exhaustBackDir.set(-Math.sin(plane.yawRad), 0, -Math.cos(plane.yawRad));
  for (const lp of EXHAUST_LOCAL_POS) {
    _exhaustWorldPos.copy(lp).applyMatrix4(plane.mesh.matrixWorld);
    exhaust.emit(_exhaustWorldPos, plane.throttle, _exhaustBackDir);
  }
}
