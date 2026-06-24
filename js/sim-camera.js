'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM KAMERY — ORBIT / COCKPIT
// ═══════════════════════════════════════════════════════════════════════════════

const CameraMode = { ORBIT: 'ORBIT', COCKPIT: 'COCKPIT' };
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

function _shortestYawDeg(from, to) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

function applyCamera(dt) {
  if (camMode === CameraMode.ORBIT || !activeEntity) { _applyOrbitCamera(dt); return; }
  if (camMode === CameraMode.COCKPIT)                { _applyCockpitCamera();   return; }
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
