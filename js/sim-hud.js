'use strict';

// ── Funkcje rysujące HUD ──────────────────────────────────────────────────────

const MPS_KT = 1.94384, MPS_FPM = 196.85, M_FT = 3.28084;

function drawSpeedTape(canvas, speed_kt) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const range = 60;
  ctx.strokeStyle = '#c8e8ff'; ctx.fillStyle = '#c8e8ff';
  ctx.font = 'bold 9px Courier New'; ctx.textAlign = 'right';
  for (let v = Math.max(0, speed_kt - range); v <= speed_kt + range; v += 10) {
    const y = h / 2 - (v - speed_kt) * (h / (range * 2));
    ctx.lineWidth = v % 20 === 0 ? 1.5 : 0.7;
    ctx.beginPath(); ctx.moveTo(w - 8, y); ctx.lineTo(w, y); ctx.stroke();
    if (v % 20 === 0) ctx.fillText(v.toFixed(0), w - 10, y + 4);
  }
  const vs_y = h / 2 - (A321_PARAMS.Vstall * MPS_KT - speed_kt) * (h / (range * 2));
  ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w - 20, vs_y); ctx.lineTo(w, vs_y); ctx.stroke();
  [[A321_PARAMS.VR * MPS_KT, '#ffaa00', 'VR'], [A321_PARAMS.V2 * MPS_KT, '#44ff88', 'V2']].forEach(([v, c, l]) => {
    const vy = h / 2 - (v - speed_kt) * (h / (range * 2));
    ctx.fillStyle = c; ctx.font = 'bold 8px Courier New'; ctx.textAlign = 'left';
    ctx.fillText(l, 2, vy + 3);
  });
  ctx.fillStyle = '#000c1a'; ctx.fillRect(0, h / 2 - 14, w, 28);
  ctx.strokeStyle = '#1a6aaa'; ctx.lineWidth = 1.5; ctx.strokeRect(0, h / 2 - 14, w, 28);
  ctx.fillStyle = '#c8e8ff'; ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'right';
  ctx.fillText(speed_kt.toFixed(0), w - 2, h / 2 + 5);
  ctx.fillStyle = '#4a8fbf'; ctx.font = '8px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('IAS', w / 2, 10);
}

function drawAltTape(canvas, alt_ft) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const range = 500;
  ctx.strokeStyle = '#c8e8ff'; ctx.fillStyle = '#c8e8ff';
  ctx.font = 'bold 9px Courier New'; ctx.textAlign = 'left';
  for (let v = Math.max(0, alt_ft - range); v <= alt_ft + range; v += 100) {
    const y = h / 2 - (v - alt_ft) * (h / (range * 2));
    ctx.lineWidth = v % 500 === 0 ? 1.5 : 0.7;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(10, y); ctx.stroke();
    if (v % 200 === 0) ctx.fillText(v.toFixed(0), 12, y + 4);
  }
  ctx.fillStyle = '#000c1a'; ctx.fillRect(0, h / 2 - 14, w, 28);
  ctx.strokeStyle = '#1a6aaa'; ctx.lineWidth = 1.5; ctx.strokeRect(0, h / 2 - 14, w, 28);
  ctx.fillStyle = '#c8e8ff'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'left';
  ctx.fillText(alt_ft.toFixed(0), 4, h / 2 + 5);
  ctx.fillStyle = '#4a8fbf'; ctx.font = '8px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('ALT', w / 2, 10);
}

function drawAttitude(canvas, pitchRad, rollRad) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = w / 2 - 2;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  const pixPerDeg = 3.5;
  const pitchOff  = pitchRad * (180 / Math.PI) * pixPerDeg;
  ctx.rotate(-rollRad);
  ctx.fillStyle = '#1a4a8a'; ctx.fillRect(-w * 2, -h * 2, w * 4, h * 4);
  ctx.fillStyle = '#5a4020'; ctx.fillRect(-w * 2, pitchOff, w * 4, h * 4);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-w * 2, pitchOff); ctx.lineTo(w * 2, pitchOff); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.8;
  ctx.font = '8px Courier New'; ctx.fillStyle = '#ffffff';
  for (let deg = -30; deg <= 30; deg += 5) {
    if (deg === 0) continue;
    const py = pitchOff - deg * pixPerDeg;
    const lw = deg % 10 === 0 ? 16 : 10;
    ctx.beginPath(); ctx.moveTo(-lw, py); ctx.lineTo(lw, py); ctx.stroke();
    if (deg % 10 === 0) {
      ctx.textAlign = 'right'; ctx.fillText(Math.abs(deg), -lw - 2, py + 3);
      ctx.textAlign = 'left';  ctx.fillText(Math.abs(deg),  lw + 2, py + 3);
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 28, cy); ctx.lineTo(cx - 10, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 28, cy); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffff00'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy - 10); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r - 4, -Math.PI * 0.75, -Math.PI * 0.25); ctx.stroke();
  const ra  = -Math.PI / 2 + rollRad;
  const tx2 = cx + (r - 4) * Math.cos(ra), ty2 = cy + (r - 4) * Math.sin(ra);
  ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx2, ty2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a4a7a'; ctx.lineWidth = 2; ctx.stroke();
}

function drawCompass(canvas, headingDeg) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2 + 4, r = w / 2 - 8;
  const heading = Units.degToRad(headingDeg);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(5,15,30,0.9)'; ctx.fillRect(0, 0, w, h);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-heading);
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180, isMaj = deg % 30 === 0;
    const len = isMaj ? 12 : 6;
    ctx.strokeStyle = isMaj ? '#c8e8ff' : '#3a6a9a'; ctx.lineWidth = isMaj ? 1.5 : 0.7;
    ctx.beginPath(); ctx.moveTo(Math.sin(a) * (r - len), -Math.cos(a) * (r - len)); ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r); ctx.stroke();
    if (deg % 45 === 0) {
      const lbl = dirs[deg / 45], x = Math.sin(a) * (r - 20), y = -Math.cos(a) * (r - 20);
      ctx.fillStyle = deg === 0 ? '#ff4444' : '#c8e8ff';
      ctx.font = `bold ${deg === 0 ? 12 : 10}px Courier New`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lbl, x, y);
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx - 6, cy + 6); ctx.lineTo(cx, cy + 2); ctx.lineTo(cx + 6, cy + 6); ctx.closePath(); ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a4a7a'; ctx.lineWidth = 2; ctx.stroke();
}

// ── Aktualizacja HUD ───────────────────────────────────────────────────────────

let lastLoggedCamDrot = null;
let lastLoggedCamDpos = null;

// Cache wszystkich elementów DOM HUD-a RAZ — wcześniej updateHUD() wołało
// document.getElementById() ~30 razy na każde wywołanie. Same elementy się
// nie zmieniają (statyczny HTML), więc wyszukujemy je tylko raz przy starcie.
const hudEl = {
  speedCanvas:    document.getElementById('speed-canvas'),
  altCanvas:      document.getElementById('alt-canvas'),
  attitudeCanvas: document.getElementById('attitude-canvas'),
  compassCanvas:  document.getElementById('compass-canvas'),
  ias:        document.getElementById('ias-val'),
  vs:         document.getElementById('vs-val'),
  pitch:      document.getElementById('pitch-val'),
  bank:       document.getElementById('bank-val'),
  gs:         document.getElementById('gs-val'),
  alt:        document.getElementById('alt-val'),
  altM:       document.getElementById('alt-m-val'),
  agl:        document.getElementById('agl-val'),
  terr:       document.getElementById('terr-val'),
  hdg:        document.getElementById('hdg-val'),
  lat:        document.getElementById('lat-val'),
  lon:        document.getElementById('lon-val'),
  aoa:        document.getElementById('aoa-val'),
  camPos:     document.getElementById('cam-pos-val'),
  camRot:     document.getElementById('cam-rot-val'),
  planeRot:   document.getElementById('plane-rot-val'),
  camDrot:    document.getElementById('cam-drot-val'),
  camDpos:    document.getElementById('cam-dpos-val'),
  flaps:      document.getElementById('flaps-val'),
  gear:       document.getElementById('gear-val'),
  spoilers:   document.getElementById('spoilers-val'),
  tiles:      document.getElementById('h-tiles'),
  satZ:       document.getElementById('sat-z-val'),
  throttleBar:document.getElementById('throttle-bar'),
  throttlePct:document.getElementById('throttle-pct'),
  phase:      document.getElementById('phase-disp'),
  stall:      document.getElementById('stall-disp'),
  overspeed:  document.getElementById('overspeed-disp'),
  windshear:  document.getElementById('windshear-disp'),
  wind:       document.getElementById('wind-val'),
  fmaHdg:     document.getElementById('fma-hdg'),
  fmaAlt:     document.getElementById('fma-alt'),
  fmaVs:      document.getElementById('fma-vs'),
  fmaSpd:     document.getElementById('fma-spd'),
  brakes:     document.getElementById('brakes-val'),
  park:       document.getElementById('park-val'),
  autobrake:  document.getElementById('autobrake-val'),
};

function updateHUD() {
  const plane = activeEntity;
  if (!plane) return;
  const ias_kt = plane.airspeed * MPS_KT;
  const gs_kt  = Math.sqrt(plane.vel.x ** 2 + plane.vel.z ** 2) * MPS_KT;
  const vs_fpm = plane.vs * MPS_FPM;
  const alt_ft = plane.altM * M_FT;
  const agl_ft = plane.agl  * M_FT;
  const hdg    = plane.headingDeg;

  drawSpeedTape(hudEl.speedCanvas, ias_kt);
  drawAltTape(hudEl.altCanvas, alt_ft);
  drawAttitude(hudEl.attitudeCanvas, plane.pitchRad, plane.rollRad);
  drawCompass(hudEl.compassCanvas, hdg);

  hudEl.ias.textContent   = ias_kt.toFixed(0) + ' kt';
  hudEl.vs.textContent    = (vs_fpm > 0 ? '+' : '') + vs_fpm.toFixed(0) + ' fpm';
  hudEl.pitch.textContent = (plane.pitch > 0 ? '+' : '') + plane.pitch.toFixed(1) + '°';
  hudEl.bank.textContent  = plane.roll.toFixed(1) + '°';
  hudEl.gs.textContent    = gs_kt.toFixed(0) + ' kt';
  hudEl.alt.textContent   = alt_ft.toFixed(0) + ' ft';
  hudEl.altM.textContent  = Math.round(plane.altM) + ' m MSL';
  hudEl.agl.textContent   = agl_ft.toFixed(0) + ' ft';
  hudEl.terr.textContent  = Math.round(plane.terrainM) + ' m';
  hudEl.hdg.textContent   = hdg.toFixed(0) + '°';
  hudEl.lat.textContent   = plane.lat.toFixed(5) + '°';
  hudEl.lon.textContent   = plane.lon.toFixed(5) + '°';
  hudEl.aoa.textContent   = (plane._alpha * 180 / Math.PI).toFixed(1) + '°';

  const camEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const camPitch = Units.radToDeg(camEuler.x);
  const camYaw   = Units.radToDeg(camEuler.y);
  const camRoll  = Units.radToDeg(camEuler.z);
  const camPos   = camera.position;
  const planePos = plane.worldPos;
  const dx = camPos.x - planePos.x, dy = camPos.y - planePos.y, dz = camPos.z - planePos.z;
  const dpos = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const yawDiff   = (((camYaw - hdg + 180) % 360) + 360) % 360 - 180;
  const pitchDiff = camPitch - plane.pitch;
  const rollDiff  = camRoll  - plane.roll;
  hudEl.camPos.textContent   = `${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)}`;
  hudEl.camRot.textContent   = `${camPitch.toFixed(1)}° / ${camYaw.toFixed(1)}° / ${camRoll.toFixed(1)}°`;
  hudEl.planeRot.textContent = `${plane.pitch.toFixed(1)}° / ${hdg.toFixed(1)}° / ${plane.roll.toFixed(1)}°`;
  hudEl.camDrot.textContent  = `${pitchDiff.toFixed(1)}° / ${yawDiff.toFixed(1)}° / ${rollDiff.toFixed(1)}°`;
  hudEl.camDpos.textContent  = dpos.toFixed(1);

  hudEl.flaps.textContent    = plane.flaps.toString();
  hudEl.gear.textContent     = plane.gearDown ? 'DOWN' : 'UP';
  hudEl.spoilers.textContent = plane.spoilers ? 'ON' : 'OFF';
  hudEl.tiles.textContent    = `${tileMeshes.size} załad., ${loadingTiles.size} ład.`;
  // Pokaż zakres aktywnych zoomów w HUD
  const activeZooms = [...new Set([...tileMeshes.keys()].map(k => k.split('_')[0]))].sort((a, b) => b - a).join('/');
  hudEl.satZ.textContent     = activeZooms ? `Z=${activeZooms}` : '–';

  // N1/throttle: throttle<0 = reverse thrust (patrz reverserDeployFrac w
  // sim-physics.js) — pasek pokazuje wartość bezwzględną, ale w kolorze
  // ostrzegawczym i z etykietą "REV", żeby było jasne że silniki ciągną do tyłu.
  const revActive = plane.throttle < 0;
  const tPctAbs = Math.round(Math.abs(plane.throttle) * 100);
  hudEl.throttleBar.style.width   = tPctAbs + '%';
  hudEl.throttlePct.textContent   = (revActive ? 'REV ' : '') + tPctAbs + '%';
  hudEl.throttleBar.style.background = revActive
    ? 'linear-gradient(90deg,#5a1a0a,#ff5a30)'
    : 'linear-gradient(90deg,#0a5a22,#44ff88)';
  hudEl.throttlePct.style.color = revActive ? '#ff5a30' : (plane.throttle > 0.85 ? '#ff8800' : '#44ff88');

  // Hamulce / parking brake / autobrake — patrz sim-physics.js (input.brakes
  // odczytany co klatkę w physicsUpdate, tu tylko pokazujemy stan z encji;
  // brakesActiveDisplay ustawiane co klatkę w physicsUpdate, patrz tam).
  if (hudEl.brakes) {
    hudEl.brakes.textContent = plane.brakesActiveDisplay ? 'ON' : 'OFF';
    hudEl.brakes.style.color = plane.brakesActiveDisplay ? '#ff8800' : '#c8e8ff';
  }
  if (hudEl.park) {
    hudEl.park.textContent = plane.parkingBrake ? 'ON' : 'OFF';
    hudEl.park.style.color = plane.parkingBrake ? '#ff5a30' : '#c8e8ff';
  }
  if (hudEl.autobrake) {
    hudEl.autobrake.textContent = plane.autobrakeLevel;
    hudEl.autobrake.style.color = plane.autobrakeLevel !== 'OFF' ? '#44ccff' : '#c8e8ff';
  }

  // Wiatr — odczyt "po ludzku" (kierunek OD którego wieje / prędkość), patrz
  // getWindVector3D w sim-weather.js. Nie zawiera windsheara testowego celowo
  // (patrz komentarz przy getWindshearDelta) — to osobne ostrzeżenie niżej.
  if (hudEl.wind) {
    hudEl.wind.textContent = Math.round(plane.windDirDeg || 0) + '°/' + Math.round(plane.windSpeedKt || 0) + 'kt';
  }

  // FMA (Flight Mode Annunciator) — pokazuje cel gdy tryb aktywny, samą
  // etykietę (przygaszoną przez CSS .fma-item bez .active) gdy nieaktywny.
  if (hudEl.fmaHdg) {
    hudEl.fmaHdg.textContent = plane.ap.hdgHold ? ('HDG ' + Math.round(plane.ap.targetHdgDeg) + '°') : 'HDG';
    hudEl.fmaHdg.classList.toggle('active', plane.ap.hdgHold);
  }
  if (hudEl.fmaAlt) {
    hudEl.fmaAlt.textContent = plane.ap.altHold ? ('ALT ' + Math.round(plane.ap.targetAltFt)) : 'ALT';
    hudEl.fmaAlt.classList.toggle('active', plane.ap.altHold);
  }
  if (hudEl.fmaVs) {
    hudEl.fmaVs.textContent = plane.ap.vsHold ? ('V/S ' + (plane.ap.targetVsFpm >= 0 ? '+' : '') + Math.round(plane.ap.targetVsFpm)) : 'V/S';
    hudEl.fmaVs.classList.toggle('active', plane.ap.vsHold);
  }
  if (hudEl.fmaSpd) {
    hudEl.fmaSpd.textContent = plane.ap.spdHold ? ('A/THR ' + Math.round(plane.ap.targetSpdKt)) : 'A/THR';
    hudEl.fmaSpd.classList.toggle('active', plane.ap.spdHold);
  }
  if (typeof apUI !== 'undefined') apUI.syncFromEntity(plane); // złap autonomiczne rozłączenia (ręczny ster) w panelu

  // Windshear — ostrzeżenie widoczne DOKŁADNIE podczas scenariusza testowego
  // (patrz weather.triggerWindshearTest / getWindshearDelta).
  if (hudEl.windshear) {
    hudEl.windshear.style.display = (typeof weather !== 'undefined' && weather && weather.windshearActive) ? 'block' : 'none';
  }

  let phase = 'ON GROUND';
  if (!plane.onGround) {
    if (agl_ft < 400 && plane.vs > 0.5) phase = 'TAKEOFF';
    else if (vs_fpm > 200) phase = 'CLIMB';
    else if (vs_fpm < -200) phase = 'DESCENT';
    else phase = 'CRUISE';
  }
  hudEl.phase.textContent     = phase;
  hudEl.stall.style.display     = plane._isStalling ? 'block' : 'none';
  hudEl.overspeed.style.display = (ias_kt > A321_PARAMS.VMO * MPS_KT) ? 'block' : 'none';

  hudEl.vs.classList.remove('warn', 'danger', 'green');
  if (vs_fpm < -1500) hudEl.vs.classList.add('danger');
  else if (vs_fpm < -800) hudEl.vs.classList.add('warn');
  else if (vs_fpm > 100) hudEl.vs.classList.add('green');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA BUTTONS — Obsługa przycisków przełączania kamer (1-7)
// ═══════════════════════════════════════════════════════════════════════════════

function _updateCameraButtonStates() {
  const btnMap = {
    'cam-orbit': CameraMode.ORBIT,
    'cam-cockpit': CameraMode.COCKPIT,
    'cam-free': CameraMode.FREE,
    'cam-cinematic': CameraMode.CINEMATIC,
    'cam-flyby': CameraMode.FLYBY,
    'cam-dolly': CameraMode.DOLLY,
    'cam-tower': CameraMode.TOWER,
  };
  
  Object.entries(btnMap).forEach(([btnId, mode]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active', camMode === mode);
  });
}

// Inicjalizacja przycisków kamer
(function initCameraButtons() {
  const btnMap = {
    'cam-orbit': CameraMode.ORBIT,
    'cam-cockpit': CameraMode.COCKPIT,
    'cam-free': CameraMode.FREE,
    'cam-cinematic': CameraMode.CINEMATIC,
    'cam-flyby': CameraMode.FLYBY,
    'cam-dolly': CameraMode.DOLLY,
    'cam-tower': CameraMode.TOWER,
  };
  
  Object.entries(btnMap).forEach(([btnId, mode]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => setCameraMode(mode));
    }
  });
})();

// Uaktualnij stany przycisków po każdej zmianie kamery
const _originalSetCameraMode = setCameraMode;
window.setCameraMode = function(mode) {
  _originalSetCameraMode(mode);
  _updateCameraButtonStates();
};
