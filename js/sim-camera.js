'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM KAMERY — ORBIT / COCKPIT / FREE / CINEMATIC / FLYBY / DOLLY / TOWER
// ═══════════════════════════════════════════════════════════════════════════════

const CameraMode = { 
  ORBIT: 'ORBIT', 
  COCKPIT: 'COCKPIT',
  FREE: 'FREE',
  CINEMATIC: 'CINEMATIC',
  FLYBY: 'FLYBY',
  DOLLY: 'DOLLY',
  TOWER: 'TOWER'
};
let camMode = CameraMode.ORBIT;

// Cel kamery orbit — modyfikowany bezpośrednio przez mysz/touch/klawiaturę
const orb = {
  lat:   SPAWN_LAT,
  lon:   SPAWN_LON,
  dist:  100,
  pitch: 25,
  yaw:   0,            // stopnie azymutu (dowolny)
  y:     0,            // dodatkowy offset Y centrum
  free:  false,        // false = orbit śledzący, true = wolna mapa
};

// Wewnętrzny wygładzony stan (oddzielony od celu żeby nie było feedback-loopa)
const _orb = {
  lat:   SPAWN_LAT,
  lon:   SPAWN_LON,
  dist:  100,
  pitch: 25,
  yaw:   0,
  y:     0,
};
let _orbitReady = false;  // false = snap do celu przy następnej klatce

// Chase / cockpit
const cockpitConfig = { offsetM: new THREE.Vector3(0.47, 0.97, 17.5) };
const cockpitLook   = { yaw: 0, pitch: 0 };

// ── FREE — kamera wolna ──────────────────────────────────────────────────────
const freeCamera = {
  pos: new THREE.Vector3(0, 50, 0),
  look: { yaw: 0, pitch: 0 },  // kierunek patrzenia w stopniach
  speed: 50  // m/s ruchu
};

// ── CINEMATIC — patrzy na samolot z autozooma ────────────────────────────────
const cinematicCamera = {
  lat: SPAWN_LAT,
  lon: SPAWN_LON,
  heightAbove: 150,  // wysokość nad samolotem (m)
  zoom: 1.0,  // 1.0 = auto, <1 = bliżej, >1 = dalej
  autoZoomEnabled: true,
  targetDistance: 80  // idealna odległość do samolotu (m)
};

// ── FLYBY — szybka projekcja wokół samolotu ─────────────────────────────────
const flybyCamera = {
  orbitRadius: 200,  // odległość od samolotu
  orbitSpeed: 45,    // stopnie/s (prędkość obrotu)
  pitch: 15,         // kąt patrzenia
  angle: 0,          // obecny kąt obrotu (radiany)
  heightOffset: 40,  // offset Y nad samolotem
};

// ── DOLLY — kamera na torze wokół samolotu ──────────────────────────────────
const dollyCamera = {
  orbitRadius: 150,
  orbitSpeed: 25,    // stopnie/s
  pitch: 25,
  angle: 0,
  heightOffset: 30,
  autoZoom: false,
  zoomTarget: 150    // target distance dla zoom
};

// ── TOWER — punkt obserwacyjny z góry ────────────────────────────────────────
const towerCamera = {
  lat: SPAWN_LAT,
  lon: SPAWN_LON,
  height: 500,  // wysokość nad całą sceną
  radius: 100,  // "szerokość" widoku
  trackPlane: true  // czy śledzić samolot w poziomie
};

let _cinematicZoomSmoothness = 0;  // wygładzenie zoomu cinematic

function _shortestYawDeg(from, to) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

function applyCamera(dt) {
  if (camMode === CameraMode.ORBIT || !activeEntity) { _applyOrbitCamera(dt); return; }
  if (camMode === CameraMode.COCKPIT)                { _applyCockpitCamera();   return; }
  if (camMode === CameraMode.FREE)                   { _applyFreeCamera(dt);    return; }
  if (camMode === CameraMode.CINEMATIC)              { _applyCinematicCamera(dt); return; }
  if (camMode === CameraMode.FLYBY)                  { _applyFlybyCamera(dt);   return; }
  if (camMode === CameraMode.DOLLY)                  { _applyDollyCamera(dt);   return; }
  if (camMode === CameraMode.TOWER)                  { _applyTowerCamera(dt);   return; }
}

// ── ORBIT — jedyne miejsce gdzie kamera jest pozycjonowana w tym trybie ──────
function _applyOrbitCamera(dt) {
  camera.up.set(0, 1, 0);

  if (!_orbitReady) { _orb.dist = orb.dist; _orbitReady = true; }
  _orb.dist += (orb.dist - _orb.dist) * Math.min(1, dt * 10);

  // free=true → centrum z orb.lat/lon/y (wolna mapa)
  // free=false → centrum = worldPos samolotu (orbit śledzący)
  let cx, cy, cz;
  if (!orb.free && activeEntity) {
    const p = activeEntity.worldPos;
    cx = p.x; cy = p.y; cz = p.z;
  } else {
    const cosRef = Math.cos(Units.degToRad(refLat));
    cx = (orb.lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
    cy = orb.y;
    cz = -(orb.lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  }

  const pRad = Units.degToRad(orb.pitch);
  const yRad = Units.degToRad(orb.yaw);
  camera.position.set(
    cx + _orb.dist * Math.cos(pRad) * Math.sin(yRad),
    cy + _orb.dist * Math.sin(pRad),
    cz + _orb.dist * Math.cos(pRad) * Math.cos(yRad)
  );
  camera.lookAt(cx, cy, cz);
}

// ── COCKPIT ──────────────────────────────────────────────────────────────────
function _applyCockpitCamera() {
  const e   = activeEntity;
  const pos = e.worldPos;
  const planeQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-e.pitchRad, e.yawRad, e.rollRad, 'YXZ')
  );
  const localOff = new THREE.Vector3(
    cockpitConfig.offsetM.x,
    cockpitConfig.offsetM.y * DEM_EXAG * Y_SCALE,
    cockpitConfig.offsetM.z
  ).applyQuaternion(planeQ);
  camera.position.set(pos.x + localOff.x, pos.y + localOff.y, pos.z + localOff.z);
  const lookQ   = planeQ.clone().multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(cockpitLook.pitch, cockpitLook.yaw, 0, 'YXZ'))
  );
  const camUp   = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQ);
  const lookFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(lookQ);
  camera.up.copy(camUp);
  camera.lookAt(
    camera.position.x + lookFwd.x * 500,
    camera.position.y + lookFwd.y * 500,
    camera.position.z + lookFwd.z * 500
  );
}

// ── FREE — kamera wolna ──────────────────────────────────────────────────────
function _applyFreeCamera(dt) {
  camera.up.set(0, 1, 0);
  
  const yRad = Units.degToRad(freeCamera.look.yaw);
  const pRad = Units.degToRad(freeCamera.look.pitch);
  
  camera.position.copy(freeCamera.pos);
  camera.lookAt(
    freeCamera.pos.x + Math.cos(pRad) * Math.sin(yRad) * 100,
    freeCamera.pos.y + Math.sin(pRad) * 100,
    freeCamera.pos.z + Math.cos(pRad) * Math.cos(yRad) * 100
  );
}

// Funkcje sterowania free camera
function moveFreeCameraForward(dt) {
  const yRad = Units.degToRad(freeCamera.look.yaw);
  const pRad = Units.degToRad(freeCamera.look.pitch);
  const dist = freeCamera.speed * dt;
  freeCamera.pos.x += Math.cos(pRad) * Math.sin(yRad) * dist;
  freeCamera.pos.y += Math.sin(pRad) * dist;
  freeCamera.pos.z += Math.cos(pRad) * Math.cos(yRad) * dist;
}

function moveFreeCameraBackward(dt) {
  moveFreeCameraForward(-dt);
}

function moveFreeCameraLeft(dt) {
  const yRad = Units.degToRad(freeCamera.look.yaw + 90);
  const dist = freeCamera.speed * dt;
  freeCamera.pos.x += Math.sin(yRad) * dist;
  freeCamera.pos.z += Math.cos(yRad) * dist;
}

function moveFreeCameraRight(dt) {
  moveFreeCameraLeft(-dt);
}

function moveFreeCameraUp(dt) {
  freeCamera.pos.y += freeCamera.speed * dt;
}

function moveFreeCameraDown(dt) {
  freeCamera.pos.y -= freeCamera.speed * dt;
}

function rotateFreeCameraYaw(deltaDeg) {
  freeCamera.look.yaw = (freeCamera.look.yaw + deltaDeg) % 360;
}

function rotateFreeCameraPitch(deltaDeg) {
  freeCamera.look.pitch = Math.max(-90, Math.min(90, freeCamera.look.pitch + deltaDeg));
}

// ── CINEMATIC — patrzy na samolot z autozooma ────────────────────────────────
function _applyCinematicCamera(dt) {
  camera.up.set(0, 1, 0);
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const planePos = e.worldPos;
  
  // Śledź pozycję samolotu (lat/lon)
  cinematicCamera.lat = e.lat;
  cinematicCamera.lon = e.lon;
  
  // Pozycja kamery: stała pozycja z odsetkiem wysokości
  const cosRef = Math.cos(Units.degToRad(refLat));
  const cx = (cinematicCamera.lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const cy = cinematicCamera.heightAbove;
  const cz = -(cinematicCamera.lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  
  // Auto-zoom: oblicz odległość do samolotu
  let distToPlane = Math.sqrt(
    (planePos.x - cx) ** 2 + 
    (planePos.y - cy) ** 2 + 
    (planePos.z - cz) ** 2
  );
  
  // Wygładź zoom
  let targetZoom = 1.0;
  if (cinematicCamera.autoZoomEnabled) {
    const idealDist = cinematicCamera.targetDistance;
    // Jeśli samolot jest za blisko, oddal kamerę
    if (distToPlane < idealDist) {
      targetZoom = distToPlane / idealDist;
    }
  }
  
  _cinematicZoomSmoothness += (cinematicCamera.zoom * targetZoom - _cinematicZoomSmoothness) * Math.min(1, dt * 3);
  
  // Popchnij kamerę dalej od samolotu jeśli zoom wymaga
  let camX = cx, camY = cy, camZ = cz;
  if (_cinematicZoomSmoothness < 1) {
    const dir = new THREE.Vector3(
      planePos.x - cx,
      planePos.y - cy,
      planePos.z - cz
    ).normalize();
    const pushDist = cinematicCamera.targetDistance * (1 - _cinematicZoomSmoothness) * 0.5;
    camX -= dir.x * pushDist;
    camY -= dir.y * pushDist;
    camZ -= dir.z * pushDist;
  }
  
  camera.position.set(camX, camY, camZ);
  camera.lookAt(planePos.x, planePos.y, planePos.z);
}

// Sterowanie kamerą cinematic
function setCinematicTargetDistance(dist) {
  cinematicCamera.targetDistance = Math.max(30, dist);
}

function setCinematicHeightAbove(height) {
  cinematicCamera.heightAbove = Math.max(10, height);
}

function toggleCinematicAutoZoom() {
  cinematicCamera.autoZoomEnabled = !cinematicCamera.autoZoomEnabled;
}

// ── FLYBY — szybka projekcja wokół samolotu ──────────────────────────────────
function _applyFlybyCamera(dt) {
  camera.up.set(0, 1, 0);
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const center = e.worldPos;
  
  // Aktualizuj kąt (obrót wokół samolotu)
  flybyCamera.angle += Units.degToRad(flybyCamera.orbitSpeed * dt);
  
  // Pozycja na orbicie
  const px = center.x + flybyCamera.orbitRadius * Math.cos(flybyCamera.angle);
  const py = center.y + flybyCamera.heightOffset;
  const pz = center.z + flybyCamera.orbitRadius * Math.sin(flybyCamera.angle);
  
  camera.position.set(px, py, pz);
  
  // Patrz na samolot z wymaganym kątem
  const lookTarget = new THREE.Vector3(center.x, center.y, center.z);
  const dirToPlane = lookTarget.sub(camera.position);
  const lookDist = dirToPlane.length();
  
  camera.lookAt(
    center.x,
    center.y + lookDist * Math.tan(Units.degToRad(flybyCamera.pitch)),
    center.z
  );
}

function setFlybySpeed(degreesPerSecond) {
  flybyCamera.orbitSpeed = Math.max(5, degreesPerSecond);
}

function setFlybyRadius(meters) {
  flybyCamera.orbitRadius = Math.max(50, meters);
}

// ── DOLLY — kamera na torze wokół samolotu ──────────────────────────────────
function _applyDollyCamera(dt) {
  camera.up.set(0, 1, 0);
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const center = e.worldPos;
  
  // Obrót (mniejsza prędkość niż flyby dla efektu kinowego)
  dollyCamera.angle += Units.degToRad(dollyCamera.orbitSpeed * dt);
  
  // Pozycja na łuku z gradualnym przybliżaniem/oddalaniem
  let currentRadius = dollyCamera.orbitRadius;
  
  if (dollyCamera.autoZoom) {
    // Efekt dolly zoom: kamera się porusza, ale odległość zmienia się
    const zoomPhase = (dollyCamera.angle % (Math.PI * 2)) / (Math.PI * 2);
    currentRadius = dollyCamera.orbitRadius * (0.7 + zoomPhase * 0.6);
  }
  
  const px = center.x + currentRadius * Math.cos(dollyCamera.angle);
  const py = center.y + dollyCamera.heightOffset;
  const pz = center.z + currentRadius * Math.sin(dollyCamera.angle);
  
  camera.position.set(px, py, pz);
  
  // Łagodny kąt patrzenia
  camera.lookAt(
    center.x,
    center.y + currentRadius * Math.tan(Units.degToRad(dollyCamera.pitch)) * 0.3,
    center.z
  );
}

function setDollySpeed(degreesPerSecond) {
  dollyCamera.orbitSpeed = Math.max(3, Math.min(60, degreesPerSecond));
}

function setDollyRadius(meters) {
  dollyCamera.orbitRadius = Math.max(50, meters);
}

function toggleDollyAutoZoom() {
  dollyCamera.autoZoom = !dollyCamera.autoZoom;
}

// ── TOWER — punkt obserwacyjny z góry ────────────────────────────────────────
function _applyTowerCamera(dt) {
  camera.up.set(0, 1, 0);
  
  let cx, cy, cz;
  
  if (towerCamera.trackPlane && activeEntity) {
    // Śledź samolot w poziomie, ale zostań wysoko
    const e = activeEntity;
    cx = e.worldPos.x;
    cy = towerCamera.height;
    cz = e.worldPos.z;
  } else {
    // Stała pozycja wieży obserwacyjnej
    const cosRef = Math.cos(Units.degToRad(refLat));
    cx = (towerCamera.lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
    cy = towerCamera.height;
    cz = -(towerCamera.lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  }
  
  camera.position.set(cx, cy, cz);
  
  // Patrz na szerszą obszar
  camera.lookAt(cx, 0, cz + towerCamera.radius * 0.3);
}

function setTowerHeight(meters) {
  towerCamera.height = Math.max(100, meters);
}

function toggleTowerTracking() {
  towerCamera.trackPlane = !towerCamera.trackPlane;
}

// ── Przełączanie trybów ───────────────────────────────────────────────────────
function cycleCameraMode() {
  const modes = Object.values(CameraMode);
  camMode     = modes[(modes.indexOf(camMode) + 1) % modes.length];
  _onCamModeChange();
}
function setCameraMode(mode) {
  camMode = mode;
  _onCamModeChange();
}
function _onCamModeChange() {
  if (camMode === CameraMode.ORBIT) {
    if (activeEntity) {
      orb.lat   = activeEntity.lat;
      orb.lon   = activeEntity.lon;
      orb.yaw   = (360 - activeEntity.headingDeg) % 360;
      orb.pitch = 25;
      orb.dist  = 100;
      orb.y     = 0;
    }
    orb.free = false;  // domyślnie orbit śledzący samolot
    _orbitReady = false;
  }
  
  if (camMode === CameraMode.FREE) {
    if (activeEntity) {
      freeCamera.pos.copy(activeEntity.worldPos);
      freeCamera.pos.y += 30;
      freeCamera.look.yaw = (360 - activeEntity.headingDeg) % 360;
      freeCamera.look.pitch = 0;
    }
  }
  
  if (camMode === CameraMode.CINEMATIC) {
    if (activeEntity) {
      cinematicCamera.lat = activeEntity.lat;
      cinematicCamera.lon = activeEntity.lon;
      cinematicCamera.heightAbove = 150;
      cinematicCamera.zoom = 1.0;
      cinematicCamera.autoZoomEnabled = true;
      _cinematicZoomSmoothness = 0;
    }
  }
  
  if (camMode === CameraMode.FLYBY) {
    flybyCamera.angle = 0;
    flybyCamera.orbitSpeed = 45;
    flybyCamera.orbitRadius = 200;
    flybyCamera.pitch = 15;
    flybyCamera.heightOffset = 40;
  }
  
  if (camMode === CameraMode.DOLLY) {
    dollyCamera.angle = 0;
    dollyCamera.orbitSpeed = 25;
    dollyCamera.orbitRadius = 150;
    dollyCamera.pitch = 25;
    dollyCamera.heightOffset = 30;
    dollyCamera.autoZoom = false;
  }
  
  if (camMode === CameraMode.TOWER) {
    if (activeEntity) {
      towerCamera.lat = activeEntity.lat;
      towerCamera.lon = activeEntity.lon;
    }
    towerCamera.height = 500;
    towerCamera.trackPlane = true;
  }
  
  updateCameraHUD();
}

function updateCameraHUD() {
  const badge = document.getElementById('hud-cam-badge');
  if (badge) badge.textContent = camMode;

  if (!document.body.classList.contains('is-touch')) return;

  // Na mobile: joystick lotu, slider i pasek guzikow ZAWSZE widoczne
  const fj  = document.getElementById('fly-joy-wrap');
  const thr = document.getElementById('thr-wrap');
  const bar = document.getElementById('mob-bar');
  if (fj)  fj.style.display  = 'flex';
  if (thr) thr.style.display = 'flex';
  if (bar) bar.style.display = 'flex';

  // Orbit-joy i zoom — ukryte (zbedne)
  const oj = document.getElementById('orbit-joy-wrap');
  const oz = document.getElementById('orbit-zoom');
  if (oj) oj.style.display = 'none';
  if (oz) oz.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// WSZYSTKIE DOSTĘPNE KAMERY — PODSUMOWANIE
// ═══════════════════════════════════════════════════════════════════════════════
// ORBIT       — tradycyjna kamera orbitalna (śledzenie samolotu)
// COCKPIT     — widok z kabiny samolotu
// FREE        — całkowicie wolna kamera, sterowana klawiszami
// CINEMATIC   — patrzy na samolot z ustalonym punktu, z auto-zoom
// FLYBY       — szybka projekcja wokół samolotu
// DOLLY       — kinowe zbliżenie/oddalenie na łuku
// TOWER       — punkt obserwacyjny z góry (jak wieża kontrolna)
//
// FUNKCJE STEROWANIA:
// moveFreeCameraForward/Backward/Left/Right/Up/Down(dt)
// rotateFreeCameraYaw/Pitch(deltaDeg)
// setCinematicTargetDistance(dist)
// setCinematicHeightAbove(height)
// toggleCinematicAutoZoom()
// setFlybySpeed(degreesPerSecond)
// setFlybyRadius(meters)
// setDollySpeed(degreesPerSecond)
// setDollyRadius(meters)
// toggleDollyAutoZoom()
// setTowerHeight(meters)
// toggleTowerTracking()
// ═══════════════════════════════════════════════════════════════════════════════
