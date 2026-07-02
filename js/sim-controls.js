'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-controls.js
// Joystick + slider + guziki działają na WSZYSTKICH urządzeniach.
// Kamera: dotyk canvasu = orbit obrót/zoom lub cockpit rozglądanie.
// ═══════════════════════════════════════════════════════════════════════════════

function _isMobile() { return document.body.classList.contains('is-touch'); }

const WASD_SPEED = 30, QE_SPEED = 30;
const cv = document.getElementById('c');

// ── Klawiatura ────────────────────────────────────────────────────────────────
const keys      = new Set();
const planeKeys = {};

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['w','a','s','d','q','e'].includes(k)) keys.add(k);
  const PC = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyQ','KeyE'];
  if (PC.includes(e.code)) { planeKeys[e.code] = true; e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  keys.delete(e.key.toLowerCase());
  planeKeys[e.code] = false;
  const p = activeEntity;
  switch (e.code) {
    case 'KeyF': if (p) { p.flaps = (p.flaps + 1) % 4; _syncFlapsLabel(); } break;
    case 'KeyG': if (p && !p.onGround) { p.gearDown = !p.gearDown; p.updateGearVisibility(); _syncGearBtn(); } break;
    case 'KeyB': if (p) { p.spoilers = !p.spoilers; _syncSplrBtn(); } break;
    case 'KeyR': resetPlane(); break;
    case 'KeyC': cycleCameraMode(); break;
  }
});

// ── Desktop: mysz ─────────────────────────────────────────────────────────────
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

// ── Desktop: klawiatura orbit ─────────────────────────────────────────────────
function updateOrbitKeyboard(dt) {
  if (camMode !== CameraMode.ORBIT) return;
  const fwd = (keys.has('s')?1:0) - (keys.has('w')?1:0);
  const str = (keys.has('a')?1:0) - (keys.has('d')?1:0);
  const clb = (keys.has('e')?1:0) - (keys.has('q')?1:0);
  if (!fwd && !str && !clb) return;
  const cosRef = Math.cos(Units.degToRad(refLat));
  const yr  = Units.degToRad(orb.yaw);
  const hm  = Math.max(50, orb.dist * 0.0015) * WASD_SPEED * dt;
  const vm  = Math.max(50, orb.dist * 0.0015) * QE_SPEED   * dt;
  orb.lon += ((fwd*Math.sin(yr)+str*Math.cos(yr))*hm/(EARTH_RADIUS*cosRef))*180/Math.PI;
  orb.lat += ((fwd*Math.cos(yr)-str*Math.sin(yr))*hm/EARTH_RADIUS)         *180/Math.PI;
  orb.y   +=  clb * vm;
}

// stubs żeby sim-main.js się nie poskarżył
function applyJoystick(dt)    {}
function applyZoomButtons(dt) {}

// ── Touch na canvasie (kamera) ────────────────────────────────────────────────
const cvT = new Map();
let cvPinch = null, cvMid = null;
const _td = (m) => { const [a,b]=[...m.values()]; return Math.hypot(a.x-b.x,a.y-b.y); };
const _tm = (m) => { const [a,b]=[...m.values()]; return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; };

cv.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) cvT.set(t.identifier,{x:t.clientX,y:t.clientY});
  if (cvT.size===2){cvPinch=_td(cvT);cvMid=_tm(cvT);}
}, { passive: true });

cv.addEventListener('touchmove', e => {
  const prev = new Map(cvT);
  for (const t of e.changedTouches) {
    if (!cvT.has(t.identifier)) continue;
    cvT.set(t.identifier,{x:t.clientX,y:t.clientY});
  }
  if (camMode === CameraMode.ORBIT) {
    if (cvT.size===1) {
      const id=cvT.keys().next().value, cur=cvT.get(id), old=prev.get(id);
      if (cur&&old){orb.yaw-=(cur.x-old.x)*0.35;orb.pitch=Math.max(5,Math.min(89,orb.pitch+(cur.y-old.y)*0.25));}
    } else if (cvT.size===2) {
      const nd=_td(cvT), nm=_tm(cvT);
      if (cvPinch&&nd) orb.dist=Math.max(30,Math.min(900_000,orb.dist*(cvPinch/nd)));
      if (cvMid&&nm) {
        const cosRef=Math.cos(Units.degToRad(refLat)),yr=Units.degToRad(orb.yaw);
        const spd=orb.dist/EARTH_RADIUS*180/Math.PI*0.003;
        const dx=nm.x-cvMid.x,dy=nm.y-cvMid.y;
        orb.lon-=(Math.sin(yr)*dy-Math.cos(yr)*dx)*spd/cosRef;
        orb.lat-=(Math.cos(yr)*dy+Math.sin(yr)*dx)*spd;
      }
      cvPinch=nd; cvMid=nm;
    }
  } else if (camMode===CameraMode.COCKPIT&&cvT.size===1) {
    const id=cvT.keys().next().value,cur=cvT.get(id),old=prev.get(id);
    if (cur&&old){
      cockpitLook.yaw  =Math.max(-2.6,Math.min(2.6,cockpitLook.yaw  -(cur.x-old.x)*0.006));
      cockpitLook.pitch=Math.max(-1.3,Math.min(1.3,cockpitLook.pitch+(cur.y-old.y)*0.004));
    }
  }
}, { passive: true });

cv.addEventListener('touchend',    e => { for(const t of e.changedTouches) cvT.delete(t.identifier); if(cvT.size<2){cvPinch=null;cvMid=null;} });
cv.addEventListener('touchcancel', e => { for(const t of e.changedTouches) cvT.delete(t.identifier); cvPinch=null;cvMid=null; });

// ═══════════════════════════════════════════════════════════════════════════════
//  JOYSTICK LOTU
// ═══════════════════════════════════════════════════════════════════════════════
const flyBase = document.getElementById('fly-joy-base');
const flyKnob = document.getElementById('fly-joy-knob');
const FLY_R   = 38;
let flyId = -1, flyOx = 0, flyOy = 0;
let flyDelta = { x: 0, y: 0 };

flyBase.addEventListener('touchstart', e => {
  e.stopPropagation();
  const t = e.changedTouches[0], r = flyBase.getBoundingClientRect();
  flyId = t.identifier;
  flyOx = r.left + r.width/2; flyOy = r.top + r.height/2;
  _flyMove(t.clientX, t.clientY);
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (flyId < 0) return;
  for (const t of e.changedTouches)
    if (t.identifier === flyId) _flyMove(t.clientX, t.clientY);
}, { passive: true });
window.addEventListener('touchend',    e => { for(const t of e.changedTouches) if(t.identifier===flyId) _flyReset(); });
window.addEventListener('touchcancel', e => { for(const t of e.changedTouches) if(t.identifier===flyId) _flyReset(); });

function _flyMove(cx, cy) {
  const dx=cx-flyOx, dy=cy-flyOy, len=Math.hypot(dx,dy), c=Math.min(len,FLY_R);
  const nx=len>0?dx/len*c:0, ny=len>0?dy/len*c:0;
  flyKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  flyDelta = { x: nx/FLY_R, y: ny/FLY_R };
}
function _flyReset() {
  flyId=-1; flyDelta={x:0,y:0};
  flyKnob.style.transform='translate(-50%,-50%)';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SLIDER GAZU
// ═══════════════════════════════════════════════════════════════════════════════
const thrTrack = document.getElementById('thr-track');
const thrFill  = document.getElementById('thr-fill');
const thrThumb = document.getElementById('thr-thumb');
const thrPct   = document.getElementById('thr-pct');
let thrId = -1, thrValue = -1;

thrTrack.addEventListener('touchstart', e => {
  e.stopPropagation(); e.preventDefault();
  const t = e.changedTouches[0];
  thrId = t.identifier; _thrSet(_thrY(t.clientY));
}, { passive: false });
window.addEventListener('touchmove', e => {
  if (thrId<0) return;
  for (const t of e.changedTouches) if(t.identifier===thrId) _thrSet(_thrY(t.clientY));
}, { passive: true });
window.addEventListener('touchend',    e => { for(const t of e.changedTouches) if(t.identifier===thrId) thrId=-1; });
window.addEventListener('touchcancel', e => { for(const t of e.changedTouches) if(t.identifier===thrId) thrId=-1; });

function _thrY(cy) {
  const r = thrTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, 1-(cy-r.top)/r.height));
}
function _thrSet(v) { thrValue=v; _thrDraw(v); }
function _thrDraw(v) {
  const p = Math.round(v*100);
  if (thrFill)  thrFill.style.height  = p+'%';
  if (thrThumb) thrThumb.style.bottom = `calc(${p}% - 11px)`;
  if (thrPct)   thrPct.textContent    = p+'%';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RUDER
// ═══════════════════════════════════════════════════════════════════════════════
const rudState = { L:false, R:false };
function _holdBtn(id, key) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('touchstart',  e => { rudState[key]=true;  e.stopPropagation(); e.preventDefault(); }, { passive:false });
  el.addEventListener('touchend',    () => rudState[key]=false);
  el.addEventListener('touchcancel', () => rudState[key]=false);
}
_holdBtn('mob-rud-l','L');
_holdBtn('mob-rud-r','R');

// ═══════════════════════════════════════════════════════════════════════════════
//  GUZIKI — helper
// ═══════════════════════════════════════════════════════════════════════════════
let brakesHeld = false;

function _btn(id, fn) {
  const el = document.getElementById(id); if (el) el.addEventListener('click', fn);
}
function _syncFlapsLabel() {
  const p = activeEntity; if (!p) return;
  const l = document.getElementById('mb-flaps-lbl');
  if (l) l.textContent = 'FLAP ' + p.flaps;
}
function _syncGearBtn() {
  const p = activeEntity; if (!p) return;
  document.getElementById('mb-gear')?.classList.toggle('active', p.gearDown);
}
function _syncSplrBtn() {
  const p = activeEntity; if (!p) return;
  document.getElementById('mb-splr')?.classList.toggle('active', p.spoilers);
}

// ── Guziki lotnisk — działają przez data-apt, bez duplikatów ID ────────────────
document.querySelectorAll('[data-apt]').forEach(btn => {
  btn.addEventListener('click', () => selectAirport(btn.dataset.apt));
});

// ── Guziki desktop ─────────────────────────────────────────────────────────────
_btn('btn-reset',      resetPlane);
_btn('btn-approach',   spawnApproach);
_btn('btn-camera',     cycleCameraMode);
_btn('btn-orbit-free', () => {
  if (activeEntity) { orb.lat=activeEntity.lat; orb.lon=activeEntity.lon; orb.y=activeEntity.worldPos.y; }
  orb.dist=8000; orb.pitch=40; orb.free=true;
  setCameraMode(CameraMode.ORBIT);
});

// ── Guziki mobilne (pasek) ─────────────────────────────────────────────────────
_btn('mb-flaps', () => {
  if (!activeEntity) return;
  activeEntity.flaps = (activeEntity.flaps+1)%4;
  _syncFlapsLabel();
});
_btn('mb-gear', () => {
  const p=activeEntity; if(!p||p.onGround) return;
  p.gearDown=!p.gearDown; p.updateGearVisibility(); _syncGearBtn();
});
_btn('mb-splr', () => {
  const p=activeEntity; if(!p) return;
  p.spoilers=!p.spoilers; _syncSplrBtn();
});
_btn('mb-reset',  resetPlane);
_btn('mb-appr',   spawnApproach);
_btn('mb-cam',    cycleCameraMode);

// Hamulce — trzymane
const brakeEl = document.getElementById('mb-brakes');
if (brakeEl) {
  brakeEl.addEventListener('touchstart',  e=>{ brakesHeld=true;  brakeEl.classList.add('pressed');    e.preventDefault(); },{passive:false});
  brakeEl.addEventListener('touchend',    ()=>{ brakesHeld=false; brakeEl.classList.remove('pressed'); });
  brakeEl.addEventListener('touchcancel', ()=>{ brakesHeld=false; brakeEl.classList.remove('pressed'); });
}

// Menu popup
let menuOpen = false;
function _setMenu(open) {
  menuOpen = open;
  const popup = document.getElementById('mob-menu-popup');
  if (popup) popup.classList.toggle('open', open);
  document.getElementById('mb-menu')?.classList.toggle('active', open);
}
_btn('mb-menu',   () => _setMenu(!menuOpen));
_btn('mpop-close',() => _setMenu(false));
_btn('mpop-reset',() => { resetPlane();     _setMenu(false); });
_btn('mpop-appr', () => { spawnApproach();  _setMenu(false); });
_btn('mpop-cam',  () => { cycleCameraMode(); _setMenu(false); });
_btn('mpop-map',  () => {
  if (activeEntity) { orb.lat=activeEntity.lat; orb.lon=activeEntity.lon; orb.y=activeEntity.worldPos.y; }
  orb.dist=8000; orb.pitch=40; orb.free=true;
  setCameraMode(CameraMode.ORBIT);
  _setMenu(false);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  updatePlaneInput
// ═══════════════════════════════════════════════════════════════════════════════
function updatePlaneInput() {
  let pitch = (planeKeys['ArrowUp']?1:0)    - (planeKeys['ArrowDown']?1:0);
  let roll  = (planeKeys['ArrowRight']?1:0) - (planeKeys['ArrowLeft']?1:0);
  if (_isMobile() && flyId>=0) { pitch=-flyDelta.y; roll=flyDelta.x; }

  let yaw = (planeKeys['KeyQ']?-1:0) + (planeKeys['KeyE']?1:0);
  if (_isMobile()) { if(rudState.L) yaw=-1; if(rudState.R) yaw=1; }

  let throttleUp=!!planeKeys['KeyW'], throttleDown=!!planeKeys['KeyS'];
  let brakes=!!planeKeys['KeyS']||brakesHeld;

  if (_isMobile() && activeEntity) {
    if (thrValue>=0) { activeEntity.throttle=thrValue; throttleUp=false; throttleDown=false; }
    else _thrDraw(activeEntity.throttle);
  }

  planeInput.pitch=pitch; planeInput.roll=roll; planeInput.yaw=yaw;
  planeInput.throttleUp=throttleUp; planeInput.throttleDown=throttleDown;
  planeInput.brakes=brakes;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESET / SPAWN / AIRPORT
// ═══════════════════════════════════════════════════════════════════════════════
function resetPlane() {
  if (!activeEntity) return;
  const apt=AIRPORTS[currentAirport]; thrValue=-1;
  activeEntity.reset({ lat:apt.spawnLat, lon:apt.spawnLon, yawRad:Units.degToRad((180-apt.heading+360)%360) });
}

function spawnApproach() {
  const plane=activeEntity; if(!plane) return;
  const apt=AIRPORTS[currentAirport];
  const yawRad=Units.degToRad((180-apt.heading+360)%360);
  const D=6000, bear=(apt.heading+180)%360;
  const p=offsetGeo(apt.spawnLat,apt.spawnLon,D*Math.sin(Units.degToRad(bear)),D*Math.cos(Units.degToRad(bear)));
  const groundH=terrainHeightBest(p.lat,p.lon);
  thrValue=0.55; _thrDraw(0.55);
  plane.reset({ lat:p.lat,lon:p.lon,altM:groundH+300,yawRad,pitchRad:0.02,
    velX:Math.sin(yawRad)*70,velY:-2,velZ:Math.cos(yawRad)*70,
    throttle:0.55,flaps:2,gearDown:true,onGround:false });
  for (const[r,z] of [[2,17],[3,15],[4,13],[5,11]]) prefetchDEM(p.lat,p.lon,r,z);
}

function selectAirport(code) {
  if (!AIRPORTS[code]) return;
  currentAirport=code;
  const apt=AIRPORTS[code];
  refLat=apt.refLat; refLon=apt.refLon;
  // Zaktualizuj wszystkie guziki lotnisk (przez data-apt, bez duplikatów ID)
  document.querySelectorAll('[data-apt]').forEach(b => {
    b.classList.toggle('active', b.dataset.apt===code);
  });
  thrValue=-1; _setMenu(false);
  if (activeEntity) {
    activeEntity.reset({ lat:apt.spawnLat,lon:apt.spawnLon,yawRad:Units.degToRad((180-apt.heading+360)%360) });
    orb.lat=apt.spawnLat; orb.lon=apt.spawnLon;
    for (const[r,z] of [[2,17],[3,15],[4,13],[5,11]]) prefetchDEM(apt.spawnLat,apt.spawnLon,r,z);
  }
}

// ── Emisja spalin ─────────────────────────────────────────────────────────────
//
// Offsets w lokalnym układzie współrzędnych plane.mesh (THREE.Group):
//   +Z = nos samolotu (przód)
//   +X = prawe skrzydło
//   +Y = góra
//
// Podaj wartości w metrach (jednostki world space ≈ metry poziomo).
// Silniki A321 są ~7m od kadłuba, ~2m poniżej skrzydła, wylot ~5m za centrem.

const ENG_RIGHT  =  7;    // odległość od osi kadłuba (na zewnątrz)
const ENG_DOWN   = -2;    // poniżej skrzydła (ujemne = w dół)
const ENG_BACK   = -5;    // do tyłu od centrum mesha (ujemne = za skrzydłem)

// Pre-alokowane vektory (bez alokacji co klatkę)
const _eq = new THREE.Quaternion();
const _eR = new THREE.Vector3();
const _eL = new THREE.Vector3();
const _eBk = new THREE.Vector3();
let _exhaustDebugFrames = 0;

function emitExhaust(plane, exhaust) {
  if (!plane.mesh) return;

  // Pobierz kwaternion mesha — zawiera całą rotację (yaw+pitch+roll)
  // bez konieczności ręcznego liczenia wektorów z kątów Eulera.
  _eq.copy(plane.mesh.quaternion);

  // ----- PRAWY silnik -----
  // Zacznij od offsetu w przestrzeni lokalnej mesha
  _eR.set(ENG_RIGHT, ENG_DOWN, ENG_BACK);
  // Obróć offset do world space używając kwaternionu
  _eR.applyQuaternion(_eq);
  // Dodaj pozycję mesha (world space)
  _eR.add(plane.mesh.position);

  // ----- LEWY silnik -----
  _eL.set(-ENG_RIGHT, ENG_DOWN, ENG_BACK);
  _eL.applyQuaternion(_eq);
  _eL.add(plane.mesh.position);

  // Kierunek wylotu: lokalne -Z (tył samolotu) obrócone do world space
  _eBk.set(0, 0, -1).applyQuaternion(_eq);

  // Log co 120 klatek żeby móc kalibrować bez zaśmiecania konsoli
  if (++_exhaustDebugFrames % 120 === 1) {
    console.log(
      '[exhaust] mesh.pos:', plane.mesh.position.x.toFixed(1), plane.mesh.position.y.toFixed(1), plane.mesh.position.z.toFixed(1),
      '| R:', _eR.x.toFixed(1), _eR.y.toFixed(1), _eR.z.toFixed(1),
      '| L:', _eL.x.toFixed(1), _eL.y.toFixed(1), _eL.z.toFixed(1),
      '| ENG_RIGHT:', ENG_RIGHT, 'ENG_DOWN:', ENG_DOWN, 'ENG_BACK:', ENG_BACK
    );
  }

  exhaust.emit(_eR, plane.throttle, _eBk, 'R', plane.altM);
  exhaust.emit(_eL, plane.throttle, _eBk, 'L', plane.altM);
}
