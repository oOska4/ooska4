'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// STEROWANIE — KAMERA (mysz, klawiatura, touch) + SAMOLOT + MOBILE UI
// ═══════════════════════════════════════════════════════════════════════════════

const WASD_SPEED = 30, QE_SPEED = 30;
let mDown = false, rDown = false, lx = 0, ly = 0;
const keys = new Set();
const cv = document.getElementById('c');

// ── Desktop: mysz ────────────────────────────────────────────────────────────
cv.addEventListener('mousedown', e => {
  if (e.button === 0) mDown = true;
  if (e.button === 2) rDown = true;
  lx = e.clientX; ly = e.clientY;
  e.preventDefault();
});
window.addEventListener('mouseup', () => { mDown = false; rDown = false; });
window.addEventListener('mousemove', e => {
  const dx = e.clientX - lx, dy = e.clientY - ly;
  if (mDown && camMode === CameraMode.ORBIT) {
    orb.yaw   -= dx * 0.3;
    orb.pitch  = Math.max(5, Math.min(89, orb.pitch + dy * 0.25));
  } else if (mDown && camMode === CameraMode.COCKPIT) {
    cockpitLook.yaw   = Math.max(-2.6, Math.min(2.6, cockpitLook.yaw   - dx * 0.006));
    cockpitLook.pitch = Math.max(-1.3, Math.min(1.3, cockpitLook.pitch + dy * 0.004));
  }
  if (rDown && camMode === CameraMode.ORBIT) {
    const cosRef = Math.cos(Units.degToRad(refLat));
    const spd    = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
    const yr     = Units.degToRad(orb.yaw);
    orb.lon += ( Math.sin(yr) * dy - Math.cos(yr) * dx) * spd / cosRef;
    orb.lat += ( Math.cos(yr) * dy + Math.sin(yr) * dx) * spd;
  }
  lx = e.clientX; ly = e.clientY;
});
cv.addEventListener('wheel', e => {
  if (camMode === CameraMode.ORBIT)
    orb.dist = Math.max(30, Math.min(900_000, orb.dist * (1 + e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

// ── Desktop: klawiatura (orbit) ───────────────────────────────────────────────
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w','a','s','d','q','e','c','v'].includes(k)) keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

function updateOrbitKeyboard(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  const fwd = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const str = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  const clb = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
  if (!fwd && !str && !clb) return;
  const cosRef = Math.cos(Units.degToRad(refLat));
  const yr     = Units.degToRad(orb.yaw);
  const base   = Math.max(50, orb.dist * 0.0015);
  const hm     = base * WASD_SPEED * dt, vm = base * QE_SPEED * dt;
  orb.lon += ((fwd * Math.sin(yr) + str * Math.cos(yr)) * hm / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  orb.lat += ((fwd * Math.cos(yr) - str * Math.sin(yr)) * hm /  EARTH_RADIUS)            * 180 / Math.PI;
  orb.y   +=  clb * vm;
}

// ── Touch pinch/pan na canvas (orbit & cockpit) ───────────────────────────────
const activeT = new Map(), prevT = new Map();
let lastPinchDist = null, lastPanMid = null;
function touchDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function touchMid(a, b)  { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

cv.addEventListener('touchstart', e => {
  [...e.changedTouches].forEach(t => {
    const p = { x: t.clientX, y: t.clientY };
    prevT.set(t.identifier, activeT.has(t.identifier) ? { ...activeT.get(t.identifier) } : p);
    activeT.set(t.identifier, p);
  });
  if (activeT.size === 2) {
    const [a, b] = [...activeT.values()];
    lastPinchDist = touchDist(a, b); lastPanMid = touchMid(a, b);
  }
}, { passive: true });

cv.addEventListener('touchmove', e => {
  [...e.changedTouches].forEach(t => {
    prevT.set(t.identifier, activeT.has(t.identifier) ? { ...activeT.get(t.identifier) } : { x: t.clientX, y: t.clientY });
    activeT.set(t.identifier, { x: t.clientX, y: t.clientY });
  });
  if (camMode === CameraMode.ORBIT) {
    if (activeT.size === 1) {
      const t = e.changedTouches[0], pr = prevT.get(t.identifier);
      if (pr) {
        orb.yaw   -= (t.clientX - pr.x) * 0.3;
        orb.pitch  = Math.max(5, Math.min(89, orb.pitch + (t.clientY - pr.y) * 0.25));
      }
    } else if (activeT.size === 2) {
      const [a, b] = [...activeT.values()];
      const dist = touchDist(a, b), mid = touchMid(a, b);
      if (lastPinchDist !== null)
        orb.dist = Math.max(30, Math.min(900_000, orb.dist * (lastPinchDist / dist)));
      if (lastPanMid !== null) {
        const cosRef = Math.cos(Units.degToRad(refLat)), yr = Units.degToRad(orb.yaw);
        const spd = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
        const dx = mid.x - lastPanMid.x, dy = mid.y - lastPanMid.y;
        orb.lon -= (Math.sin(yr) * dy - Math.cos(yr) * dx) * spd / cosRef;
        orb.lat -= (Math.cos(yr) * dy + Math.sin(yr) * dx) * spd;
      }
      lastPinchDist = dist; lastPanMid = mid;
    }
  } else if (camMode === CameraMode.COCKPIT) {
    if (activeT.size === 1) {
      const t = e.changedTouches[0], pr = prevT.get(t.identifier);
      if (pr) {
        cockpitLook.yaw   = Math.max(-2.6, Math.min(2.6, cockpitLook.yaw   + (t.clientX - pr.x) * 0.006));
        cockpitLook.pitch = Math.max(-1.3, Math.min(1.3, cockpitLook.pitch + (t.clientY - pr.y) * 0.004));
      }
    }
  }
}, { passive: true });

cv.addEventListener('touchend',   e => {
  [...e.changedTouches].forEach(t => { activeT.delete(t.identifier); prevT.delete(t.identifier); });
  if (activeT.size < 2) { lastPinchDist = null; lastPanMid = null; }
});
cv.addEventListener('touchcancel', e => {
  [...e.changedTouches].forEach(t => { activeT.delete(t.identifier); prevT.delete(t.identifier); });
  lastPinchDist = null; lastPanMid = null;
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — JOYSTICK LOTU (lewy, pitch + roll)
// ═══════════════════════════════════════════════════════════════════════════════

const flyJoyBase = document.getElementById('fly-joy-base');
const flyJoyKnob = document.getElementById('fly-joy-knob');
const FLY_JOY_R  = 35;   // maks. przemieszczenie knoba (px)
let flyJoyActive = false, flyJoyId = null;
let flyJoyOrigin = { x: 0, y: 0 }, flyJoyDelta = { x: 0, y: 0 };

flyJoyBase.addEventListener('touchstart', e => {
  const t = e.changedTouches[0];
  flyJoyActive = true; flyJoyId = t.identifier;
  const r = flyJoyBase.getBoundingClientRect();
  flyJoyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  e.stopPropagation();
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (!flyJoyActive) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== flyJoyId) continue;
    const dx = t.clientX - flyJoyOrigin.x;
    const dy = t.clientY - flyJoyOrigin.y;
    const len = Math.hypot(dx, dy);
    const clamp = Math.min(len, FLY_JOY_R);
    const nx = len > 0 ? dx / len * clamp : 0;
    const ny = len > 0 ? dy / len * clamp : 0;
    flyJoyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    // x→roll, y→pitch (ujemny Y = nos w górę)
    flyJoyDelta = { x: nx / FLY_JOY_R, y: ny / FLY_JOY_R };
  }
}, { passive: true });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier !== flyJoyId) continue;
    flyJoyActive = false; flyJoyId = null; flyJoyDelta = { x: 0, y: 0 };
    flyJoyKnob.style.transform = 'translate(-50%, -50%)';
  }
});
window.addEventListener('touchcancel', e => {
  for (const t of e.changedTouches) {
    if (t.identifier !== flyJoyId) continue;
    flyJoyActive = false; flyJoyId = null; flyJoyDelta = { x: 0, y: 0 };
    flyJoyKnob.style.transform = 'translate(-50%, -50%)';
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — SLIDER GAZU (prawy)
// ═══════════════════════════════════════════════════════════════════════════════

const thrTrack  = document.getElementById('thr-track');
const thrFill   = document.getElementById('thr-fill');
const thrThumb  = document.getElementById('thr-thumb');
const thrPctLbl = document.getElementById('thr-pct-label');

let thrSliderActive = false, thrSliderId = null;
// Wartość 0–1 z suwaka; -1 = niekontrolowany (używamy klawiaturowych KeyW/S)
let thrSliderValue = -1;

function _thrTrackRect() { return thrTrack.getBoundingClientRect(); }

function _setThrFromY(clientY) {
  const r    = _thrTrackRect();
  const rel  = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  thrSliderValue = rel;
  _updateThrVisual(rel);
}

function _updateThrVisual(v) {
  const pct = (v * 100).toFixed(0);
  thrFill.style.height  = pct + '%';
  thrThumb.style.bottom = `calc(${pct}% - 10px)`;
  thrPctLbl.textContent = pct + '%';
}

thrTrack.addEventListener('touchstart', e => {
  const t = e.changedTouches[0];
  thrSliderActive = true; thrSliderId = t.identifier;
  _setThrFromY(t.clientY);
  e.stopPropagation();
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (!thrSliderActive) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== thrSliderId) continue;
    _setThrFromY(t.clientY);
  }
}, { passive: true });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches)
    if (t.identifier === thrSliderId) { thrSliderActive = false; thrSliderId = null; }
});
window.addEventListener('touchcancel', e => {
  for (const t of e.changedTouches)
    if (t.identifier === thrSliderId) { thrSliderActive = false; thrSliderId = null; }
});

// Zsynchronizuj wizualnie slider z aktualnym throttle (gdy wracamy z PK lub animacji)
function syncThrSlider(throttleVal) {
  if (thrSliderActive) return;   // slider jest trzymany — nie nadpisuj
  if (thrSliderValue < 0) {
    // slider jeszcze nie dotknięty — pokaż aktualny throttle silnika, ale nie blokuj
    _updateThrVisual(throttleVal);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — RUDER (lewy/prawy obok suwaka)
// ═══════════════════════════════════════════════════════════════════════════════

const rudderState = { L: false, R: false };
const rudL = document.getElementById('mob-rud-l');
const rudR = document.getElementById('mob-rud-r');

function _bindHold(el, key) {
  el.addEventListener('touchstart',  e => { rudderState[key] = true;  e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend',    () => rudderState[key] = false);
  el.addEventListener('touchcancel', () => rudderState[key] = false);
  // mousedown dla testów na PC
  el.addEventListener('mousedown', () => rudderState[key] = true);
  el.addEventListener('mouseup',   () => rudderState[key] = false);
}
_bindHold(rudL, 'L');
_bindHold(rudR, 'R');

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — GUZIKI KONFIGURACYJNE (pasek dolny)
// ═══════════════════════════════════════════════════════════════════════════════

// Guziki: FLAPS, GEAR, SPLR, RESET, APPROACH, CAM
document.getElementById('mob-btn-flaps').addEventListener('click', () => {
  if (!activeEntity) return;
  activeEntity.flaps = (activeEntity.flaps + 1) % 4;
  document.getElementById('mob-btn-flaps').querySelector('.mb-label').textContent = 'FLAP ' + activeEntity.flaps;
});
document.getElementById('mob-btn-gear').addEventListener('click', () => {
  const p = activeEntity; if (!p || p.onGround) return;
  p.gearDown = !p.gearDown; p.updateGearVisibility();
  document.getElementById('mob-btn-gear').classList.toggle('active', p.gearDown);
});
document.getElementById('mob-btn-splr').addEventListener('click', () => {
  const p = activeEntity; if (!p) return;
  p.spoilers = !p.spoilers;
  document.getElementById('mob-btn-splr').classList.toggle('active', p.spoilers);
});
document.getElementById('mob-btn-reset').addEventListener('click', resetPlane);
document.getElementById('mob-btn-appr').addEventListener('click', spawnApproach);
document.getElementById('mob-btn-cam').addEventListener('click', cycleCameraMode);

// ═══════════════════════════════════════════════════════════════════════════════
//  ORBIT JOYSTICK (mapa, ORBIT mode)
// ═══════════════════════════════════════════════════════════════════════════════

const joyBase = document.getElementById('joy-base');
const joyKnob = document.getElementById('joy-knob');
let joyActive = false, joyId = null, joyOrigin = { x: 0, y: 0 }, joyDelta = { x: 0, y: 0 };
const JOY_R = 33;
joyBase.addEventListener('touchstart', e => {
  const t = e.changedTouches[0]; joyActive = true; joyId = t.identifier;
  const r = joyBase.getBoundingClientRect();
  joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  e.stopPropagation();
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (!joyActive) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== joyId) continue;
    const dx = t.clientX - joyOrigin.x, dy = t.clientY - joyOrigin.y;
    const len = Math.hypot(dx, dy), c = Math.min(len, JOY_R);
    const nx = len > 0 ? dx / len * c : 0, ny = len > 0 ? dy / len * c : 0;
    joyKnob.style.transform = `translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
    joyDelta = { x: nx / JOY_R, y: ny / JOY_R };
  }
}, { passive: true });
window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier !== joyId) continue;
    joyActive = false; joyId = null; joyDelta = { x: 0, y: 0 };
    joyKnob.style.transform = 'translate(-50%,-50%)';
  }
});
function applyJoystick(dt) {
  if (!joyActive || (!joyDelta.x && !joyDelta.y) || camMode !== CameraMode.ORBIT) return;
  const cosRef = Math.cos(Units.degToRad(refLat)), yr = Units.degToRad(orb.yaw);
  const spd    = Math.max(50, orb.dist * 0.0015) * WASD_SPEED * dt;
  orb.lon += ((joyDelta.x * Math.cos(yr) - joyDelta.y * Math.sin(yr)) * spd / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  orb.lat += ((joyDelta.x * Math.sin(yr) + joyDelta.y * Math.cos(yr)) * spd / EARTH_RADIUS)            * 180 / Math.PI;
}

// ── Zoom buttons (orbit) ─────────────────────────────────────────────────────
let zoomInHeld = false, zoomOutHeld = false;
document.getElementById('btn-zoom-in').addEventListener('touchstart',  () => zoomInHeld  = true, { passive: true });
document.getElementById('btn-zoom-in').addEventListener('touchend',    () => zoomInHeld  = false);
document.getElementById('btn-zoom-out').addEventListener('touchstart', () => zoomOutHeld = true, { passive: true });
document.getElementById('btn-zoom-out').addEventListener('touchend',   () => zoomOutHeld = false);
function applyZoomButtons(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  if (zoomInHeld)  orb.dist = Math.max(500,     orb.dist * (1 - 1.5 * dt));
  if (zoomOutHeld) orb.dist = Math.min(900_000, orb.dist * (1 + 1.5 * dt));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEROWANIE SAMOLOTEM — klawiatura
// ═══════════════════════════════════════════════════════════════════════════════

const planeKeys = {};
const PLANE_CODES = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyQ','KeyE'];
window.addEventListener('keydown', e => {
  if (PLANE_CODES.includes(e.code)) { planeKeys[e.code] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  planeKeys[e.code] = false;
  const p = activeEntity;
  if (e.code === 'KeyF' && p) { p.flaps = (p.flaps + 1) % 4; }
  if (e.code === 'KeyG' && p && !p.onGround) { p.gearDown = !p.gearDown; p.updateGearVisibility(); }
  if (e.code === 'KeyB' && p) p.spoilers = !p.spoilers;
  if (e.code === 'KeyR') resetPlane();
  if (e.code === 'KeyC') cycleCameraMode();
});

// ── updatePlaneInput — łączy klawiaturę + joystick mobilny + slider + ruder ──
function updatePlaneInput() {
  const isMobile = matchMedia('(pointer:coarse)').matches;

  // Pitch i roll z joysticka lotniczego (mobile) LUB strzałek (PC)
  let pitch = (planeKeys['ArrowUp'] ? 1 : 0) - (planeKeys['ArrowDown']  ? 1 : 0);
  let roll  = (planeKeys['ArrowRight'] ? 1 : 0) - (planeKeys['ArrowLeft'] ? 1 : 0);

  if (isMobile && flyJoyActive) {
    pitch = -flyJoyDelta.y;   // joystick w górę = nos w górę
    roll  =  flyJoyDelta.x;
  }

  // Ruder (Q/E na PC, guziki na mobile)
  let yaw = (planeKeys['KeyQ'] ? -1 : 0) + (planeKeys['KeyE'] ? 1 : 0);
  if (isMobile) {
    if (rudderState.L) yaw = -1;
    if (rudderState.R) yaw =  1;
  }

  // Throttle: slider mobile ma pierwszeństwo, potem W/S
  let throttleUp   = !!planeKeys['KeyW'];
  let throttleDown = !!planeKeys['KeyS'];
  let brakes       = !!planeKeys['KeyS'];

  if (isMobile && thrSliderValue >= 0 && activeEntity) {
    // Zamiast inkrementować — ustawiamy throttle bezpośrednio na wartość suwaka
    activeEntity.throttle = thrSliderValue;
    throttleUp   = false;
    throttleDown = false;
  }

  planeInput.pitch        = pitch;
  planeInput.roll         = roll;
  planeInput.yaw          = yaw;
  planeInput.throttleUp   = throttleUp;
  planeInput.throttleDown = throttleDown;
  planeInput.brakes       = brakes;

  // Synchronizuj slider z faktycznym throttle jeśli nie jest dotknięty
  if (isMobile && activeEntity) syncThrSlider(activeEntity.throttle);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESET / SPAWN / AIRPORT
// ═══════════════════════════════════════════════════════════════════════════════

function resetPlane() {
  if (!activeEntity) return;
  const apt = AIRPORTS[currentAirport];
  // zresetuj slider
  thrSliderValue = -1;
  activeEntity.reset({
    lat: apt.spawnLat, lon: apt.spawnLon,
    yawRad: Units.degToRad((180 - apt.heading + 360) % 360),
  });
}

function spawnApproach() {
  const plane = activeEntity; if (!plane) return;
  const apt    = AIRPORTS[currentAirport];
  const yawRad = Units.degToRad((180 - apt.heading + 360) % 360);
  const bearingBack = (apt.heading + 180) % 360;
  const D = 6000;
  const dEast  = D * Math.sin(Units.degToRad(bearingBack));
  const dNorth = D * Math.cos(Units.degToRad(bearingBack));
  const p = offsetGeo(apt.spawnLat, apt.spawnLon, dEast, dNorth);
  const groundH = terrainHeightBest(p.lat, p.lon);
  // Ustaw slider na 55%
  thrSliderValue = 0.55;
  plane.reset({
    lat: p.lat, lon: p.lon,
    altM: groundH + 300,
    yawRad, pitchRad: 0.02,
    velX: Math.sin(yawRad) * 70, velY: -2, velZ: Math.cos(yawRad) * 70,
    throttle: 0.55, flaps: 2, gearDown: true, onGround: false,
  });
  prefetchDEM(p.lat, p.lon, 2, 17);
  prefetchDEM(p.lat, p.lon, 3, 15);
  prefetchDEM(p.lat, p.lon, 4, 13);
  prefetchDEM(p.lat, p.lon, 5, 11);
}

function selectAirport(code) {
  if (!AIRPORTS[code]) return;
  currentAirport = code;
  const apt = AIRPORTS[code];
  refLat = apt.refLat; refLon = apt.refLon;
  document.querySelectorAll('.airport-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-airport-' + code.toLowerCase()).classList.add('active');
  const lt = document.getElementById('loading-text');
  if (lt) lt.textContent = `ŁADOWANIE TERENU ${code} · ${apt.name.toUpperCase()}`;
  thrSliderValue = -1;
  if (activeEntity) {
    activeEntity.reset({ lat: apt.spawnLat, lon: apt.spawnLon, yawRad: Units.degToRad((180 - apt.heading + 360) % 360) });
    orb.lat = apt.spawnLat; orb.lon = apt.spawnLon;
    prefetchDEM(apt.spawnLat, apt.spawnLon, 2, 17);
    prefetchDEM(apt.spawnLat, apt.spawnLon, 3, 15);
    prefetchDEM(apt.spawnLat, apt.spawnLon, 4, 13);
    prefetchDEM(apt.spawnLat, apt.spawnLon, 5, 11);
  }
}

document.getElementById('btn-airport-epwr').addEventListener('click', () => selectAirport('EPWR'));
document.getElementById('btn-airport-lowi').addEventListener('click', () => selectAirport('LOWI'));
document.getElementById('btn-reset').addEventListener('click', resetPlane);
document.getElementById('btn-approach').addEventListener('click', spawnApproach);
document.getElementById('btn-camera').addEventListener('click', cycleCameraMode);
document.getElementById('btn-orbit-free').addEventListener('click', () => {
  if (activeEntity) { orb.lat = activeEntity.lat; orb.lon = activeEntity.lon; orb.y = activeEntity.worldPos.y; }
  orb.dist = 8000; orb.pitch = 40; orb.free = true;
  setCameraMode(CameraMode.ORBIT);
});

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
