'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-controls.js  —  sterowanie kamerą (mysz/klawiatura/touch) + samolotem
// ═══════════════════════════════════════════════════════════════════════════════

const IS_TOUCH = matchMedia('(pointer:coarse)').matches;
const WASD_SPEED = 30, QE_SPEED = 30;
const cv = document.getElementById('c');

// ── Stan klawiaturowy ────────────────────────────────────────────────────────
const keys     = new Set();   // orbit/mapa
const planeKeys = {};         // samolot

// ═══════════════════════════════════════════════════════════════════════════════
//  DESKTOP — mysz (orbit + cockpit)
// ═══════════════════════════════════════════════════════════════════════════════
let mDown = false, rDown = false, lx = 0, ly = 0;

cv.addEventListener('mousedown', e => {
  if (e.button === 0) mDown = true;
  if (e.button === 2) rDown = true;
  lx = e.clientX; ly = e.clientY;
  e.preventDefault();
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
    const spd    = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
    const yr     = Units.degToRad(orb.yaw);
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
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w','a','s','d','q','e'].includes(k)) keys.add(k);
});
window.addEventListener('keyup', e => {
  keys.delete(e.key.toLowerCase());
  const p = activeEntity;
  switch (e.code) {
    case 'KeyF': if (p)            { p.flaps = (p.flaps + 1) % 4; }               break;
    case 'KeyG': if (p && !p.onGround) { p.gearDown = !p.gearDown; p.updateGearVisibility(); } break;
    case 'KeyB': if (p)            { p.spoilers = !p.spoilers; }                   break;
    case 'KeyR': resetPlane();                                                      break;
    case 'KeyC': cycleCameraMode();                                                 break;
  }
});

function updateOrbitKeyboard(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  const fwd = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const str = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  const clb = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
  if (!fwd && !str && !clb) return;
  const cosRef = Math.cos(Units.degToRad(refLat));
  const yr     = Units.degToRad(orb.yaw);
  const base   = Math.max(50, orb.dist * 0.0015);
  const hm = base * WASD_SPEED * dt, vm = base * QE_SPEED * dt;
  orb.lon += ((fwd * Math.sin(yr) + str * Math.cos(yr)) * hm / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  orb.lat += ((fwd * Math.cos(yr) - str * Math.sin(yr)) * hm / EARTH_RADIUS)            * 180 / Math.PI;
  orb.y   +=  clb * vm;
}

// ── Desktop: klawiatura samolot ──────────────────────────────────────────────
const PLANE_CODES = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyQ','KeyE'];
window.addEventListener('keydown', e => {
  if (PLANE_CODES.includes(e.code)) { planeKeys[e.code] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => { planeKeys[e.code] = false; });

// ── Canvas pinch/pan touch (orbit + cockpit camera) ──────────────────────────
const activeT = new Map(), prevT = new Map();
let lastPinchDist = null, lastPanMid = null;
const _td = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const _tm = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

cv.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    const p = { x: t.clientX, y: t.clientY };
    prevT.set(t.identifier, { ...p }); activeT.set(t.identifier, p);
  }
  if (activeT.size === 2) {
    const [a, b] = [...activeT.values()];
    lastPinchDist = _td(a, b); lastPanMid = _tm(a, b);
  }
}, { passive: true });

cv.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    prevT.set(t.identifier, { ...activeT.get(t.identifier) } ?? { x: t.clientX, y: t.clientY });
    activeT.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
  if (camMode === CameraMode.ORBIT) {
    if (activeT.size === 1) {
      const t = e.changedTouches[0], pr = prevT.get(t.identifier);
      if (pr) { orb.yaw -= (t.clientX - pr.x) * 0.3; orb.pitch = Math.max(5, Math.min(89, orb.pitch + (t.clientY - pr.y) * 0.25)); }
    } else if (activeT.size === 2) {
      const [a, b] = [...activeT.values()];
      const dist = _td(a, b), mid = _tm(a, b);
      if (lastPinchDist) orb.dist = Math.max(30, Math.min(900_000, orb.dist * (lastPinchDist / dist)));
      if (lastPanMid) {
        const cosRef = Math.cos(Units.degToRad(refLat)), yr = Units.degToRad(orb.yaw);
        const spd = orb.dist / EARTH_RADIUS * 180 / Math.PI * 0.003;
        const dx = mid.x - lastPanMid.x, dy = mid.y - lastPanMid.y;
        orb.lon -= (Math.sin(yr) * dy - Math.cos(yr) * dx) * spd / cosRef;
        orb.lat -= (Math.cos(yr) * dy + Math.sin(yr) * dx) * spd;
      }
      lastPinchDist = dist; lastPanMid = mid;
    }
  } else if (camMode === CameraMode.COCKPIT && activeT.size === 1) {
    const t = e.changedTouches[0], pr = prevT.get(t.identifier);
    if (pr) {
      cockpitLook.yaw   = Math.max(-2.6, Math.min(2.6, cockpitLook.yaw   + (t.clientX - pr.x) * 0.006));
      cockpitLook.pitch = Math.max(-1.3, Math.min(1.3, cockpitLook.pitch + (t.clientY - pr.y) * 0.004));
    }
  }
}, { passive: true });

cv.addEventListener('touchend',    e => { for (const t of e.changedTouches) { activeT.delete(t.identifier); prevT.delete(t.identifier); } if (activeT.size < 2) { lastPinchDist = null; lastPanMid = null; } });
cv.addEventListener('touchcancel', e => { for (const t of e.changedTouches) { activeT.delete(t.identifier); prevT.delete(t.identifier); } lastPinchDist = null; lastPanMid = null; });

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — JOYSTICK LOTU (pitch + roll)
// ═══════════════════════════════════════════════════════════════════════════════
const flyJoyBase = document.getElementById('fly-joy-base');
const flyJoyKnob = document.getElementById('fly-joy-knob');
const FLY_R = 38;
let flyActive = false, flyId = null;
let flyOrigin = { x: 0, y: 0 };
let flyDelta  = { x: 0, y: 0 };

function _flyStart(clientX, clientY, id) {
  flyActive = true; flyId = id;
  const r = flyJoyBase.getBoundingClientRect();
  flyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  _flyMove(clientX, clientY);
}
function _flyMove(clientX, clientY) {
  const dx = clientX - flyOrigin.x, dy = clientY - flyOrigin.y;
  const len = Math.hypot(dx, dy), c = Math.min(len, FLY_R);
  const nx = len > 0 ? dx / len * c : 0, ny = len > 0 ? dy / len * c : 0;
  flyJoyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  flyDelta = { x: nx / FLY_R, y: ny / FLY_R };
}
function _flyEnd() {
  flyActive = false; flyId = null; flyDelta = { x: 0, y: 0 };
  flyJoyKnob.style.transform = 'translate(-50%,-50%)';
}

flyJoyBase.addEventListener('touchstart', e => {
  e.stopPropagation();
  const t = e.changedTouches[0];
  _flyStart(t.clientX, t.clientY, t.identifier);
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (!flyActive) return;
  for (const t of e.changedTouches) if (t.identifier === flyId) _flyMove(t.clientX, t.clientY);
}, { passive: true });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) if (t.identifier === flyId) _flyEnd();
});
window.addEventListener('touchcancel', e => {
  for (const t of e.changedTouches) if (t.identifier === flyId) _flyEnd();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — SLIDER GAZU (pionowy)
// ═══════════════════════════════════════════════════════════════════════════════
const thrTrack = document.getElementById('thr-track');
const thrFill  = document.getElementById('thr-fill');
const thrThumb = document.getElementById('thr-thumb');
const thrPct   = document.getElementById('thr-pct');

let thrActive = false, thrId = null;
// -1 = suwak jeszcze nie dotknięty (pozwól silnikowi działać normalnie)
let thrValue = -1;

function _thrY(clientY) {
  const r = thrTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
}
function _thrSet(v) {
  thrValue = v;
  const pct = (v * 100).toFixed(0);
  thrFill.style.height  = pct + '%';
  // kciuk: bottom = fill height - pół kciuka
  thrThumb.style.bottom = `calc(${pct}% - 11px)`;
  thrPct.textContent    = pct + '%';
}
// Aktualizacja wizualna bez blokowania silnika (gdy suwak nie jest trzymany)
function _thrSync(engineVal) {
  if (thrActive) return;
  const pct = (engineVal * 100).toFixed(0);
  thrFill.style.height  = pct + '%';
  thrThumb.style.bottom = `calc(${pct}% - 11px)`;
  thrPct.textContent    = pct + '%';
}

thrTrack.addEventListener('touchstart', e => {
  e.stopPropagation(); e.preventDefault();
  const t = e.changedTouches[0];
  thrActive = true; thrId = t.identifier;
  _thrSet(_thrY(t.clientY));
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (!thrActive) return;
  for (const t of e.changedTouches) if (t.identifier === thrId) _thrSet(_thrY(t.clientY));
}, { passive: true });

window.addEventListener('touchend',    e => { for (const t of e.changedTouches) if (t.identifier === thrId) { thrActive = false; thrId = null; } });
window.addEventListener('touchcancel', e => { for (const t of e.changedTouches) if (t.identifier === thrId) { thrActive = false; thrId = null; } });

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — RUDER (Q/E)
// ═══════════════════════════════════════════════════════════════════════════════
const rudState = { L: false, R: false };
function _bindHold(id, key) {
  const el = document.getElementById(id);
  el.addEventListener('touchstart',  e => { rudState[key] = true;  e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend',    () => { rudState[key] = false; });
  el.addEventListener('touchcancel', () => { rudState[key] = false; });
}
_bindHold('mob-rud-l', 'L');
_bindHold('mob-rud-r', 'R');

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — PASEK KONFIGURACYJNY
// ═══════════════════════════════════════════════════════════════════════════════
let brakesHeld = false;

function _mb(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

_mb('mb-flaps', () => {
  if (!activeEntity) return;
  activeEntity.flaps = (activeEntity.flaps + 1) % 4;
  const lbl = document.getElementById('mb-flaps-lbl');
  if (lbl) lbl.textContent = 'FLAP ' + activeEntity.flaps;
});

_mb('mb-gear', () => {
  const p = activeEntity; if (!p || p.onGround) return;
  p.gearDown = !p.gearDown; p.updateGearVisibility();
  document.getElementById('mb-gear')?.classList.toggle('active', p.gearDown);
});

_mb('mb-splr', () => {
  const p = activeEntity; if (!p) return;
  p.spoilers = !p.spoilers;
  document.getElementById('mb-splr')?.classList.toggle('active', p.spoilers);
});

// Hamulce — trzymane
const brakesBtn = document.getElementById('mb-brakes');
if (brakesBtn) {
  brakesBtn.addEventListener('touchstart',  e => { brakesHeld = true;  brakesBtn.classList.add('pressed');    e.preventDefault(); }, { passive: false });
  brakesBtn.addEventListener('touchend',    () => { brakesHeld = false; brakesBtn.classList.remove('pressed'); });
  brakesBtn.addEventListener('touchcancel', () => { brakesHeld = false; brakesBtn.classList.remove('pressed'); });
}

_mb('mb-reset', resetPlane);
_mb('mb-appr',  spawnApproach);
_mb('mb-cam',   cycleCameraMode);

// Airport picker
let aptPickerOpen = false;
_mb('mb-apt', () => {
  aptPickerOpen = !aptPickerOpen;
  const el = document.getElementById('apt-picker');
  if (el) el.style.display = aptPickerOpen ? 'flex' : 'none';
  document.getElementById('mb-apt')?.classList.toggle('active', aptPickerOpen);
});
_mb('apt-close', () => {
  aptPickerOpen = false;
  const el = document.getElementById('apt-picker');
  if (el) el.style.display = 'none';
  document.getElementById('mb-apt')?.classList.remove('active');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MOBILE — ORBIT JOYSTICK (mapa)
// ═══════════════════════════════════════════════════════════════════════════════
const orbitJoyBase = document.getElementById('orbit-joy-base');
const orbitJoyKnob = document.getElementById('orbit-joy-knob');
const ORB_R = 30;
let orbActive = false, orbId = null, orbOrigin = { x: 0, y: 0 }, orbDelta = { x: 0, y: 0 };

orbitJoyBase.addEventListener('touchstart', e => {
  e.stopPropagation();
  const t = e.changedTouches[0]; orbActive = true; orbId = t.identifier;
  const r = orbitJoyBase.getBoundingClientRect();
  orbOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (!orbActive) return;
  for (const t of e.changedTouches) {
    if (t.identifier !== orbId) continue;
    const dx = t.clientX - orbOrigin.x, dy = t.clientY - orbOrigin.y;
    const len = Math.hypot(dx, dy), c = Math.min(len, ORB_R);
    const nx = len > 0 ? dx / len * c : 0, ny = len > 0 ? dy / len * c : 0;
    orbitJoyKnob.style.transform = `translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
    orbDelta = { x: nx / ORB_R, y: ny / ORB_R };
  }
}, { passive: true });

window.addEventListener('touchend', e => {
  for (const t of e.changedTouches) if (t.identifier === orbId) {
    orbActive = false; orbId = null; orbDelta = { x: 0, y: 0 };
    orbitJoyKnob.style.transform = 'translate(-50%,-50%)';
  }
});

function applyJoystick(dt) {
  if (!orbActive || camMode !== CameraMode.ORBIT) return;
  const cosRef = Math.cos(Units.degToRad(refLat)), yr = Units.degToRad(orb.yaw);
  const spd    = Math.max(50, orb.dist * 0.0015) * WASD_SPEED * dt;
  orb.lon += ((orbDelta.x * Math.cos(yr) - orbDelta.y * Math.sin(yr)) * spd / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  orb.lat += ((orbDelta.x * Math.sin(yr) + orbDelta.y * Math.cos(yr)) * spd / EARTH_RADIUS)            * 180 / Math.PI;
}

// ── Orbit zoom buttons ───────────────────────────────────────────────────────
let zoomInHeld = false, zoomOutHeld = false;
const zbIn  = document.getElementById('btn-zoom-in');
const zbOut = document.getElementById('btn-zoom-out');
if (zbIn)  { zbIn.addEventListener('touchstart',  () => zoomInHeld  = true, { passive: true }); zbIn.addEventListener('touchend',  () => zoomInHeld  = false); }
if (zbOut) { zbOut.addEventListener('touchstart', () => zoomOutHeld = true, { passive: true }); zbOut.addEventListener('touchend', () => zoomOutHeld = false); }

function applyZoomButtons(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  if (zoomInHeld)  orb.dist = Math.max(500,     orb.dist * (1 - 1.5 * dt));
  if (zoomOutHeld) orb.dist = Math.min(900_000, orb.dist * (1 + 1.5 * dt));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  updatePlaneInput — łączy wszystkie źródła wejścia
// ═══════════════════════════════════════════════════════════════════════════════
function updatePlaneInput() {
  // ── Pitch + Roll ──────────────────────────────────────────────────────────
  let pitch = (planeKeys['ArrowUp'] ? 1 : 0) - (planeKeys['ArrowDown']  ? 1 : 0);
  let roll  = (planeKeys['ArrowRight'] ? 1 : 0) - (planeKeys['ArrowLeft'] ? 1 : 0);
  if (IS_TOUCH && flyActive) { pitch = -flyDelta.y; roll = flyDelta.x; }

  // ── Ruder ─────────────────────────────────────────────────────────────────
  let yaw = (planeKeys['KeyQ'] ? -1 : 0) + (planeKeys['KeyE'] ? 1 : 0);
  if (IS_TOUCH) { if (rudState.L) yaw = -1; if (rudState.R) yaw = 1; }

  // ── Throttle ──────────────────────────────────────────────────────────────
  let throttleUp   = !!planeKeys['KeyW'];
  let throttleDown = !!planeKeys['KeyS'];
  let brakes       = !!planeKeys['KeyS'] || brakesHeld;

  if (IS_TOUCH && thrValue >= 0 && activeEntity) {
    activeEntity.throttle = thrValue;
    throttleUp = false; throttleDown = false;
  } else if (IS_TOUCH && activeEntity) {
    // suwak jeszcze nie tknięty — synchronizuj wizualnie
    _thrSync(activeEntity.throttle);
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
  const D = 6000;
  const bearBack = (apt.heading + 180) % 360;
  const p = offsetGeo(apt.spawnLat, apt.spawnLon,
    D * Math.sin(Units.degToRad(bearBack)),
    D * Math.cos(Units.degToRad(bearBack)));
  const groundH = terrainHeightBest(p.lat, p.lon);
  thrValue = 0.55;
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
  document.querySelectorAll(`[id="btn-airport-${code.toLowerCase()}"]`).forEach(b => b.classList.add('active'));
  const lt = document.getElementById('loading-text');
  if (lt) lt.textContent = `ŁADOWANIE TERENU ${code} · ${apt.name.toUpperCase()}`;
  thrValue = -1;
  // Zamknij picker
  aptPickerOpen = false;
  const pk = document.getElementById('apt-picker');
  if (pk) pk.style.display = 'none';
  document.getElementById('mb-apt')?.classList.remove('active');

  if (activeEntity) {
    activeEntity.reset({ lat: apt.spawnLat, lon: apt.spawnLon, yawRad: Units.degToRad((180 - apt.heading + 360) % 360) });
    orb.lat = apt.spawnLat; orb.lon = apt.spawnLon;
    for (const [r, z] of [[2,17],[3,15],[4,13],[5,11]]) prefetchDEM(apt.spawnLat, apt.spawnLon, r, z);
  }
}

// ── Guziki desktop (controls panel) ─────────────────────────────────────────
document.getElementById('btn-airport-epwr')?.addEventListener('click', () => selectAirport('EPWR'));
document.getElementById('btn-airport-lowi')?.addEventListener('click', () => selectAirport('LOWI'));
document.getElementById('btn-reset')?.addEventListener('click', resetPlane);
document.getElementById('btn-approach')?.addEventListener('click', spawnApproach);
document.getElementById('btn-camera')?.addEventListener('click', cycleCameraMode);
document.getElementById('btn-orbit-free')?.addEventListener('click', () => {
  if (activeEntity) { orb.lat = activeEntity.lat; orb.lon = activeEntity.lon; orb.y = activeEntity.worldPos.y; }
  orb.dist = 8000; orb.pitch = 40; orb.free = true;
  setCameraMode(CameraMode.ORBIT);
});

// Airport picker - duplikaty dla mobile
document.getElementById('apt-close')?.addEventListener('click', () => {
  aptPickerOpen = false;
  const el = document.getElementById('apt-picker'); if (el) el.style.display = 'none';
  document.getElementById('mb-apt')?.classList.remove('active');
});
// Listener na guzikach w apt-picker (moga byc duplikaty id - querySelectorAll)
document.querySelectorAll('#apt-picker .airport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const code = btn.id === 'btn-airport-epwr' ? 'EPWR' : 'LOWI';
    selectAirport(code);
  });
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
