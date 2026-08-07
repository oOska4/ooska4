'use strict';

// Camera modes: orbit, cockpit, free, cinematic, flyby, dolly, tower.

const CameraMode = { 
  ORBIT: 'ORBIT', 
  COCKPIT: 'COCKPIT',
  HUD: 'HUD',
  FREE: 'FREE',
  CINEMATIC: 'CINEMATIC',
  FLYBY: 'FLYBY',
  DOLLY: 'DOLLY',
  TOWER: 'TOWER'
};
let camMode = CameraMode.ORBIT;

// Configure orb.
const orb = {
  lat:   SPAWN_LAT,
  lon:   SPAWN_LON,
  dist:  100,
  pitch: 25,
  yaw:   0,            // Azimuth in degrees.
  y:     0,            // Additional center Y offset.
  free:  false,        // Implementation note.
};

// Configure _orb.
const _orb = {
  lat:   SPAWN_LAT,
  lon:   SPAWN_LON,
  dist:  100,
  pitch: 25,
  yaw:   0,
  y:     0,
};
let _orbitReady = false;  // Configure cockpitConfig.

// Chase / cockpit
const cockpitConfig = { offsetM: new THREE.Vector3(0.47, 0.35, 17.7), fov: 60 };
const cockpitLook   = { yaw: 0, pitch: 0 };

// Free camera.
const freeCamera = {
  pos: new THREE.Vector3(0, 50, 0),
  look: { yaw: 0, pitch: 0 },  // View direction in degrees.
  speed: 50,  // Movement speed in m/s.
  fov: 60,    // Field of view in degrees.
  speedMult: 1.0  // Implementation note.
};

// Section: cinematicCamera.
const cinematicCamera = {
  offsetLat: 0,    // Latitude offset from aircraft in degrees.
  offsetLon: 0,    // Longitude offset from aircraft in degrees.
  heightAbove: 150,  // Implementation note.
  zoom: 1.0,  // Implementation note.
  autoZoomEnabled: true,
  targetDistance: 80,  // Implementation note.
  fov: 25,  // Implementation note.
  autoFov: true  // Implementation note.
};

// Section: flybyCamera.
const flybyCamera = {
  orbitRadius: 200,  // Implementation note.
  orbitSpeed: 45,    // Implementation note.
  pitch: 15,         // Implementation note.
  angle: 0,          // Implementation note.
  heightOffset: 40,  // Implementation note.
};

// Section: dollyCamera.
const dollyCamera = {
  orbitRadius: 150,
  orbitSpeed: 25,    // Degrees per second.
  pitch: 25,
  angle: 0,
  heightOffset: 30,
  autoZoom: false,
  zoomTarget: 150    // Implementation note.
};

// Section: towerCamera.
const towerCamera = {
  offsetLat: 0,    // Latitude offset from aircraft (m / EARTH_RADIUS).
  offsetLon: 0,    // Longitude offset from aircraft (m / EARTH_RADIUS).
  height: 500,  // Implementation note.
  lookHeading: 0,  // Implementation note.
  trackPlane: true,  // Implementation note.
  lookDownPitch: -45  // Implementation note.
};

let _cinematicZoomSmoothness = 0;  // Configure _freeCameraSpeedMult.
let _freeCameraSpeedMult = 1.0;    // Handle function _shortestYawDeg().

function _shortestYawDeg(from, to) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

function applyCamera(dt) {
  if (camMode === CameraMode.ORBIT || !activeEntity) { _applyOrbitCamera(dt); return; }
  if (camMode === CameraMode.COCKPIT)                { _applyCockpitCamera();   return; }
  if (camMode === CameraMode.HUD)                    { _applyCockpitCamera();   return; }
  if (camMode === CameraMode.FREE)                   { _applyFreeCamera(dt);    return; }
  if (camMode === CameraMode.CINEMATIC)              { _applyCinematicCamera(dt); return; }
  if (camMode === CameraMode.FLYBY)                  { _applyFlybyCamera(dt);   return; }
  if (camMode === CameraMode.DOLLY)                  { _applyDollyCamera(dt);   return; }
  if (camMode === CameraMode.TOWER)                  { _applyTowerCamera(dt);   return; }
}

// Section: function _applyOrbitCamera().
function _applyOrbitCamera(dt) {
  camera.up.set(0, 1, 0);
  camera.fov = 60;  // Implementation note.
  camera.updateProjectionMatrix();

  if (!_orbitReady) { _orb.dist = orb.dist; _orbitReady = true; }
  _orb.dist += (orb.dist - _orb.dist) * Math.min(1, dt * 10);

  // Configure cx.
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

// COCKPIT
function _applyCockpitCamera() {
  camera.fov = cockpitConfig.fov;
  camera.updateProjectionMatrix();
  
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

// Cockpit zoom (scroll wheel / pinch) - narrows FOV to zoom in. Upper bound is
// the normal unzoomed FOV (60), lower bound gives a tight "binoculars" zoom.
function setCockpitFOV(fovDegrees) {
  cockpitConfig.fov = Math.max(20, Math.min(60, fovDegrees));
}

// Free camera.
function _applyFreeCamera(dt) {
  camera.up.set(0, 1, 0);
  
  // Configure _freeCameraSpeedMult.
  _freeCameraSpeedMult += (freeCamera.speedMult - _freeCameraSpeedMult) * Math.min(1, dt * 5);
  
  const yRad = Units.degToRad(freeCamera.look.yaw);
  const pRad = Units.degToRad(freeCamera.look.pitch);
  
  camera.position.copy(freeCamera.pos);
  camera.fov = freeCamera.fov;
  camera.updateProjectionMatrix();
  
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
  const dist = freeCamera.speed * _freeCameraSpeedMult * dt;
  freeCamera.pos.x += Math.cos(pRad) * Math.sin(yRad) * dist;
  freeCamera.pos.y += Math.sin(pRad) * dist;
  freeCamera.pos.z += Math.cos(pRad) * Math.cos(yRad) * dist;
}

function moveFreeCameraBackward(dt) {
  moveFreeCameraForward(-dt);
}

function moveFreeCameraLeft(dt) {
  const yRad = Units.degToRad(freeCamera.look.yaw + 90);
  const dist = freeCamera.speed * _freeCameraSpeedMult * dt;
  freeCamera.pos.x += Math.sin(yRad) * dist;
  freeCamera.pos.z += Math.cos(yRad) * dist;
}

function moveFreeCameraRight(dt) {
  moveFreeCameraLeft(-dt);
}

function moveFreeCameraUp(dt) {
  freeCamera.pos.y += freeCamera.speed * _freeCameraSpeedMult * dt;
}

function moveFreeCameraDown(dt) {
  freeCamera.pos.y -= freeCamera.speed * _freeCameraSpeedMult * dt;
}

function rotateFreeCameraYaw(deltaDeg) {
  freeCamera.look.yaw = (freeCamera.look.yaw + deltaDeg) % 360;
}

function rotateFreeCameraPitch(deltaDeg) {
  freeCamera.look.pitch = Math.max(-90, Math.min(90, freeCamera.look.pitch + deltaDeg));
}

function setFreeCameraSpeed(metersPerSecond) {
  freeCamera.speed = Math.max(1, metersPerSecond);
}

function setFreeCameraFOV(fovDegrees) {
  freeCamera.fov = Math.max(15, Math.min(120, fovDegrees));
}

function setFreeCameraSpeedMultiplier(mult) {
  freeCamera.speedMult = Math.max(0.25, Math.min(4, mult));  // Range: 0.25x to 4x.
}

// Section: function _applyCinematicCamera().
function _applyCinematicCamera(dt) {
  camera.up.set(0, 1, 0);
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const planePos = e.worldPos;
  
  // Camera position relative to the aircraft.
  const cosRef = Math.cos(Units.degToRad(refLat));
  const cameraPlaneLat = e.lat + cinematicCamera.offsetLat;
  const cameraPlaneLon = e.lon + cinematicCamera.offsetLon;
  
  const cx = (cameraPlaneLon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const cy = cinematicCamera.heightAbove;
  const cz = -(cameraPlaneLat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  
  // Configure distToPlane.
  let distToPlane = Math.sqrt(
    (planePos.x - cx) ** 2 + 
    (planePos.y - cy) ** 2 + 
    (planePos.z - cz) ** 2
  );
  
  // Configure targetZoom.
  let targetZoom = 1.0;
  if (cinematicCamera.autoZoomEnabled) {
    const idealDist = cinematicCamera.targetDistance;
    // Configure if.
    if (distToPlane < idealDist) {
      targetZoom = distToPlane / idealDist;
    }
  }
  
  _cinematicZoomSmoothness += (cinematicCamera.zoom * targetZoom - _cinematicZoomSmoothness) * Math.min(1, dt * 3);
  
  // Configure camX.
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
  
  // Configure if.
  if (cinematicCamera.autoFov) {
    const fovRange = 25;  // min FOV
    const fovMax = 60;    // max FOV
    camera.fov = fovRange + (fovMax - fovRange) * _cinematicZoomSmoothness;
  } else {
    camera.fov = cinematicCamera.fov;
  }
  camera.updateProjectionMatrix();
  
  camera.lookAt(planePos.x, planePos.y, planePos.z);
}

// Handle function setCinematicTargetDistance().
function setCinematicTargetDistance(dist) {
  cinematicCamera.targetDistance = Math.max(30, dist);
}

function setCinematicHeightAbove(height) {
  cinematicCamera.heightAbove = Math.max(10, height);
}

function setCinematicOffset(offsetLat, offsetLon) {
  cinematicCamera.offsetLat = offsetLat;
  cinematicCamera.offsetLon = offsetLon;
}

function setCinematicFOV(fov) {
  cinematicCamera.fov = Math.max(15, Math.min(90, fov));
}

function toggleCinematicAutoZoom() {
  cinematicCamera.autoZoomEnabled = !cinematicCamera.autoZoomEnabled;
}

function toggleCinematicAutoFOV() {
  cinematicCamera.autoFov = !cinematicCamera.autoFov;
}

// Section: function _applyFlybyCamera().
function _applyFlybyCamera(dt) {
  camera.up.set(0, 1, 0);
  camera.fov = 60;  // Implementation note.
  camera.updateProjectionMatrix();
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const center = e.worldPos;
  
  // Configure flybyCamera.angle.
  flybyCamera.angle += Units.degToRad(flybyCamera.orbitSpeed * dt);
  
  // Orbit position.
  const px = center.x + flybyCamera.orbitRadius * Math.cos(flybyCamera.angle);
  const py = center.y + flybyCamera.heightOffset;
  const pz = center.z + flybyCamera.orbitRadius * Math.sin(flybyCamera.angle);
  
  camera.position.set(px, py, pz);
  
  // Configure lookTarget.
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

// Section: function _applyDollyCamera().
function _applyDollyCamera(dt) {
  camera.up.set(0, 1, 0);
  camera.fov = 60;  // Implementation note.
  camera.updateProjectionMatrix();
  
  if (!activeEntity) {
    _applyOrbitCamera(dt);
    return;
  }
  
  const e = activeEntity;
  const center = e.worldPos;
  
  // Configure dollyCamera.angle.
  dollyCamera.angle += Units.degToRad(dollyCamera.orbitSpeed * dt);
  
  // Configure currentRadius.
  let currentRadius = dollyCamera.orbitRadius;
  
  if (dollyCamera.autoZoom) {
    // Configure zoomPhase.
    const zoomPhase = (dollyCamera.angle % (Math.PI * 2)) / (Math.PI * 2);
    currentRadius = dollyCamera.orbitRadius * (0.7 + zoomPhase * 0.6);
  }
  
  const px = center.x + currentRadius * Math.cos(dollyCamera.angle);
  const py = center.y + dollyCamera.heightOffset;
  const pz = center.z + currentRadius * Math.sin(dollyCamera.angle);
  
  camera.position.set(px, py, pz);
  
  // Implementation note.
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

// Section: function _applyTowerCamera().
function _applyTowerCamera(dt) {
  camera.up.set(0, 1, 0);
  camera.fov = 60;  // Implementation note.
  camera.updateProjectionMatrix();
  
  let cx, cy, cz;
  let lookX, lookY, lookZ;
  
  if (towerCamera.trackPlane && activeEntity) {
    // Configure e.
    const e = activeEntity;
    const cosRef = Math.cos(Units.degToRad(refLat));
    
    // Camera position with aircraft offset.
    const offsetLatRad = Units.degToRad(towerCamera.offsetLat / 111320); // Configure offsetLonRad.
    const offsetLonRad = Units.degToRad(towerCamera.offsetLon / (111320 * cosRef));
    
    const camLat = e.lat + (offsetLatRad * 180 / Math.PI);
    const camLon = e.lon + (offsetLonRad * 180 / Math.PI);
    
    cx = (camLon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
    cy = towerCamera.height;
    cz = -(camLat - refLat) * Math.PI / 180 * EARTH_RADIUS;
    
    // Configure lookX.
    lookX = e.worldPos.x;
    lookY = e.worldPos.y;
    lookZ = e.worldPos.z;
  } else {
    // Configure cosRef.
    const cosRef = Math.cos(Units.degToRad(refLat));
    const offsetLatRad = Units.degToRad(towerCamera.offsetLat / 111320);
    const offsetLonRad = Units.degToRad(towerCamera.offsetLon / (111320 * cosRef));
    
    const towerLat = SPAWN_LAT + (offsetLatRad * 180 / Math.PI);
    const towerLon = SPAWN_LON + (offsetLonRad * 180 / Math.PI);
    
    cx = (towerLon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
    cy = towerCamera.height;
    cz = -(towerLat - refLat) * Math.PI / 180 * EARTH_RADIUS;
    
    // Configure headingRad.
    const headingRad = Units.degToRad(towerCamera.lookHeading);
    const pitchRad = Units.degToRad(towerCamera.lookDownPitch);
    lookX = cx + Math.sin(headingRad) * 500;
    lookY = cy + Math.tan(pitchRad) * 500;
    lookZ = cz + Math.cos(headingRad) * 500;
  }
  
  camera.position.set(cx, cy, cz);
  camera.lookAt(lookX, lookY, lookZ);
}

function setTowerHeight(meters) {
  towerCamera.height = Math.max(100, meters);
}

function setTowerOffset(offsetLat, offsetLon) {
  towerCamera.offsetLat = offsetLat;
  towerCamera.offsetLon = offsetLon;
}

function setTowerLookDirection(headingDeg) {
  towerCamera.lookHeading = headingDeg % 360;
}

function setTowerLookPitch(pitchDeg) {
  towerCamera.lookDownPitch = Math.max(-90, Math.min(0, pitchDeg));
}

function toggleTowerTracking() {
  towerCamera.trackPlane = !towerCamera.trackPlane;
}

// Section: function cycleCameraMode().
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
    orb.free = false;  // Configure _orbitReady.
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
    cinematicCamera.offsetLat = 0;
    cinematicCamera.offsetLon = 0;
    cinematicCamera.heightAbove = 150;
    cinematicCamera.zoom = 1.0;
    cinematicCamera.fov = 25;
    cinematicCamera.autoZoomEnabled = true;
    cinematicCamera.autoFov = true;
    _cinematicZoomSmoothness = 0;
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
    towerCamera.offsetLat = 0;
    towerCamera.offsetLon = 0;
    towerCamera.height = 500;
    towerCamera.lookHeading = 0;
    towerCamera.lookDownPitch = -45;
    towerCamera.trackPlane = true;
  }
  
  updateCameraHUD();
}

function updateCameraHUD() {
  const badge = document.getElementById('hud-cam-badge');
  if (badge) badge.textContent = camMode;

  // Configure fighterHud. Novy fighter-jet-style HUD overlay replaces the
  // boxed speed/alt tapes visually (same info, different presentation) -
  // avoid showing both at once.
  const isHudMode = camMode === CameraMode.HUD;
  const fighterHud = document.getElementById('fighter-hud-canvas');
  if (fighterHud) fighterHud.style.display = isHudMode ? 'block' : 'none';
  const speedTape = document.getElementById('speedtape');
  const altTape = document.getElementById('alt-tape');
  if (speedTape) speedTape.style.display = isHudMode ? 'none' : '';
  if (altTape) altTape.style.display = isHudMode ? 'none' : '';

  if (!document.body.classList.contains('is-touch')) return;

  // Configure fj.
  const fj  = document.getElementById('fly-joy-wrap');
  const thr = document.getElementById('thr-wrap');
  const bar = document.getElementById('mob-bar');
  if (fj)  fj.style.display  = 'flex';
  if (thr) thr.style.display = 'flex';
  if (bar) bar.style.display = 'flex';

  // Hide orbit joystick and zoom.
  const oj = document.getElementById('orbit-joy-wrap');
  const oz = document.getElementById('orbit-zoom');
  if (oj) oj.style.display = 'none';
  if (oz) oz.style.display = 'none';
}

// Implementation note.