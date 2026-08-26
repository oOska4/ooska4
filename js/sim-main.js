'use strict';

// Section: fc.

let fc = 0, lastRenderT = performance.now();
let contrails = null;

// === Instrumentacja pomiarowa (do analizy czy warto WASM) ===================
// Mierzy per-klatke czas najwazniejszych funkcji w animate() zeby miec twarde
// dane zamiast zgadywania co jest bottleneckiem. Wylacz w konsoli:
//   window.SIM_PERF_ENABLED = false
// Raport (po ~10-30s lotu, najlepiej przez obszar z duzo nowych kafli terenu):
//   window.simPerfReport()
// Reset licznikow (np. przed nowym testem):
//   window.simPerfReset()
window.SIM_PERF_ENABLED = true;
const _perfStats = {};       // name -> { count, total, max, samples: [] }
const _PERF_SAMPLE_CAP = 300; // ring buffer per-metryke, zeby pamiec nie rosla w nieskonczonosc

// Zapisuje juz-zmierzony czas trwania (np. round-trip do Web Workera, gdzie
// _perfTime nie zadziala poprawnie - fn() dla funkcji async zwraca Promise
// natychmiast, wiec zmierzylby tylko czas do pierwszego await, nie cale
// oczekiwanie). Uzywane przez sim-terrain.js dla terrainMeshBuild_* metryk.
function _perfRecord(name, dt) {
  if (!window.SIM_PERF_ENABLED) return;
  let s = _perfStats[name];
  if (!s) s = _perfStats[name] = { count: 0, total: 0, max: 0, samples: [] };
  s.count++; s.total += dt; if (dt > s.max) s.max = dt;
  s.samples.push(dt);
  if (s.samples.length > _PERF_SAMPLE_CAP) s.samples.shift();
}

function _perfTime(name, fn) {
  if (!window.SIM_PERF_ENABLED) return fn();
  const t0 = performance.now();
  const result = fn();
  _perfRecord(name, performance.now() - t0);
  return result;
}

window.simPerfReport = function () {
  const rows = Object.entries(_perfStats).map(([name, s]) => {
    const avg = s.total / s.count;
    const sorted = [...s.samples].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    return {
      fn: name,
      calls: s.count,
      avgMs: +avg.toFixed(3),
      p95Ms: +p95.toFixed(3),
      maxMs: +s.max.toFixed(3),
      totalMs: +s.total.toFixed(1),
    };
  }).sort((a, b) => b.totalMs - a.totalMs);
  console.table(rows);
  console.log('Budzet klatki przy 60fps: 16.7ms. Kolumna avgMs pokazuje ile z tego budzetu zjada kazda funkcja.');
  return rows;
};

window.simPerfReset = function () {
  for (const k in _perfStats) delete _perfStats[k];
};

function animate(t) {
  requestAnimationFrame(animate);
  const frameDt = Math.min(0.1, (t - lastRenderT) / 1000); // cap at 100ms
  lastRenderT = t; fc++;

  const inReplay = typeof ReplaySystem !== 'undefined' && ReplaySystem.active;

  if (inReplay) {
    // Odtwarzanie replay: ZAMIAST zywego inputu/fizyki, activeEntity jest
    // sterowany z nagranego bufora (patrz sim-replay.js ReplaySystem.update
    // -> A321Entity.applyReplayPose w sim-physics.js). GPWS/warnings (SimSound)
    // pomijamy - bazuja na biezacym stanie gry i mogłyby myląco zaalarmowac
    // podczas odtwarzania przeszlego ladowania.
    _perfTime('replayPlayback', () => ReplaySystem.update(frameDt));
    if (typeof updateReplayUI === 'function') updateReplayUI();
  } else {
    // Physics note.
    _perfTime('updatePlaneInput', () => updatePlaneInput());

    // Advance physics
    _perfTime('physicsTick', () => physicsTick(t));

    // Nagrywanie do bufora replay + sledzenie czy samolot realnie leci (do
    // odroznienia ladowania od kolowania) - TYLKO podczas zywego lotu,
    // nigdy podczas samego replay (nie nagrywamy odtwarzania z powrotem).
    if (typeof ReplayRecorder !== 'undefined') ReplayRecorder.update(activeEntity, frameDt);
    if (typeof LandingScore !== 'undefined') LandingScore.trackAirborne(activeEntity, frameDt);

    // Update sound system (GPWS callouts, warnings)
    if (typeof SimSound !== 'undefined') _perfTime('SimSound.update', () => SimSound.update(frameDt));
  }

  _perfTime('camera+controls', () => {
    updateOrbitKeyboard(frameDt);
    applyJoystick(frameDt);
    applyZoomButtons(frameDt);
    applyCamera(frameDt);
  });

  // Update engine sound (throttle -> idle/spool-up/cruise, dystans kamery, przeloty)
  if (typeof SimEngineSound !== 'undefined') _perfTime('SimEngineSound.update', () => SimEngineSound.update(frameDt));

  const trackLat  = activeEntity ? activeEntity.lat : orb.lat;
  const trackLon  = activeEntity ? activeEntity.lon : orb.lon;
  const trackDist = cameraGroundDistanceM(orb.dist);

  if (fc % 2  === 0) _perfTime('updateTiles', () => updateTiles(trackLat, trackLon, trackDist));
  if (fc % 10 === 0) _perfTime('loadBuildings', () => loadBuildings(trackLat, trackLon, trackDist));
  if (fc % 10 === 0 && typeof updateGroundTint !== 'undefined') _perfTime('updateGroundTint', () => updateGroundTint());

  _perfTime('entities_update', () => {
    for (const e of entities.values()) {
      // activeEntity juz zostal zaktualizowany (pozycja+wizualia) przez
      // ReplaySystem.update() powyzej - dodatkowe renderUpdate() tutaj
      // przeliczylby animacje sterow z ZYWEGO planeInput, psujac wiernosc
      // odtwarzania. Inne entities (jesli istnieja) aktualizujemy normalnie.
      if (inReplay && e === activeEntity) continue;
      e.syncMesh();
      e.renderUpdate(frameDt);
    }
  });

  if (fc % 3 === 0) _perfTime('updateHUD', () => updateHUD());
  if (fc % 2 === 0 && weather) _perfTime('weather.update', () => weather.update(frameDt, camera.position, activeEntity ? activeEntity.altM : 0));

  // Rendering note.
  _perfTime('updateSky', () => updateSky(frameDt));

  // Configure if.
  if (typeof updateShadowFollow !== 'undefined') _perfTime('updateShadowFollow', () => updateShadowFollow());

  // Configure if.
  if (typeof updateAirportLights !== 'undefined') _perfTime('updateAirportLights', () => updateAirportLights());

  // Configure if.
  if (contrails) {
    _perfTime('contrails', () => {
      const ct = t / 1000;
      contrails.emit(ct, frameDt);
      contrails.update(ct);
    });
  }

  // Rendering note.
  _perfTime('renderFrame', () => renderFrame());
}

// Start

const bootStudio = document.getElementById('phase-studio');
const bootAuthor = document.getElementById('phase-author');
const bootSelect = document.getElementById('phase-select');
const bootLoad   = document.getElementById('phase-load');
const loadbar      = document.getElementById('loadbar');
const loadingText  = document.getElementById('loading-text');
const loadbar2     = document.getElementById('loadbar2');
const loadingText2 = document.getElementById('loading-text2');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Section: function bootIntro().
const bootIntroDone = (async function bootIntro() {
  await sleep(200);                 // Brief black screen at startup.
  if (bootStudio) bootStudio.classList.add('show');
  await sleep(1600);                // Configure if.
  if (bootStudio) bootStudio.classList.remove('show');
  await sleep(900);                 // fade-out studia

  if (bootAuthor) bootAuthor.classList.add('show');
  await sleep(1500);                // Configure if.
  if (bootAuthor) bootAuthor.classList.remove('show');
  await sleep(900);                 // Fade out the author phase.

  if (bootSelect) bootSelect.classList.add('show');
  await airportSelectDone;          // Configure if.
  if (bootSelect) bootSelect.classList.remove('show');
  await sleep(500);                 // fade-out ekranu wyboru

  if (bootLoad) bootLoad.classList.add('show');   // Airport lighting note.
})();

// Section: LOAD_STAGES.
const LOAD_STAGES = [
  { key: 'dem',   label: 'Ładowanie danych wysokościowych terenu (DEM)…', weight: 25, done: false },
  { key: 'model', label: 'Wczytywanie modelu samolotu A321…',             weight: 30, done: false },
  { key: 'sat',   label: 'Ładowanie zdjęć satelitarnych terenu…',         weight: 25, done: false },
  { key: 'osm',   label: 'Wyszukiwanie budynków (OpenStreetMap)…',        weight: 12, done: false },
  { key: 'wx',    label: 'Inicjalizacja atmosfery i pogody…',             weight: 8,  done: false },
];
const LOAD_TOTAL_WEIGHT = LOAD_STAGES.reduce((s, x) => s + x.weight, 0);

function completeStage(key) {
  const stage = LOAD_STAGES.find(s => s.key === key);
  if (!stage || stage.done) return;
  stage.done = true;
  const doneWeight = LOAD_STAGES.filter(s => s.done).reduce((s, x) => s + x.weight, 0);
  if (loadbar) loadbar.style.width = Math.min(100, Math.round(doneWeight / LOAD_TOTAL_WEIGHT * 100)) + '%';
}

let statusRotIdx = 0;
if (loadingText) loadingText.textContent = LOAD_STAGES[0].label;
const statusTimer = setInterval(() => {
  const pending = LOAD_STAGES.filter(s => !s.done);
  if (!pending.length || !loadingText) return;
  loadingText.textContent = pending[statusRotIdx % pending.length].label;
  statusRotIdx++;
}, 900);

// Section: function aptTrackProgress().
function aptTrackProgress(phase) {
  if (!loadbar2) return;
  const pct = phase === 'searched' ? 45 : phase === 'done' ? 100 : 8;
  loadbar2.style.width = pct + '%';
  if (loadingText2) {
    loadingText2.textContent = phase === 'searched'
      ? 'Pasy znalezione — pobieranie dróg kołowania (Overpass)…'
      : phase === 'done'
      ? 'Dane lotniska gotowe.'
      : 'Zapytanie do WKR API…';
  }
}

(async function init() {
  // Configure choice.
  const choice = await airportSelectDone;

  // Configure currentAirport.
  currentAirport = choice.icao;
  refLat = choice.lat; refLon = choice.lon;

  try {
    await Promise.all([
      prefetchDEM(refLat, refLon, 2, 17),
      prefetchDEM(refLat, refLon, 3, 15),
      prefetchDEM(refLat, refLon, 4, 13),
      prefetchDEM(refLat, refLon, 5, 11),
      prefetchDEM(refLat, refLon, 6,  9),
    ]);
  } catch (e) { console.error('[init] DEM prefetch failed', e); }
  completeStage('dem');

  const plane = new A321Entity({ id: 'a321' });
  if (choice.isPreset) {
    const apt = AIRPORTS[choice.icao];
    plane.reset({ lat: apt.spawnLat, lon: apt.spawnLon, yawRad: apltHeadingToYawRad(apt.heading) });
    // Airport lighting note.
    document.querySelectorAll('[data-apt]').forEach(b => {
      b.classList.toggle('active', b.dataset.apt === choice.icao);
    });
  } else {
    // Handle loading and error cases.
    plane.reset({ lat: refLat, lon: refLon });
  }
  scene.add(plane.mesh);
  addEntity(plane);
  activeEntity = plane;

  // Configure contrails.
  contrails = new AircraftContrailSystem(plane);

  applyCamera(0);
  const initialGroundDist = cameraGroundDistanceM(orb.dist);

  // Configure satTilesP.
  const satTilesP = Promise.allSettled(updateTiles(refLat, refLon, initialGroundDist))
    .then(() => completeStage('sat'));

  const buildingsP = loadBuildings(refLat, refLon, initialGroundDist)
    .then(() => completeStage('osm'))
    .catch(e => { console.error('[init] loadBuildings failed', e); completeStage('osm'); });

  // Handle loading and error cases.
  aptTrackProgress('start');
  const aptDataP = choice.isPreset
    ? (typeof loadAirportLights !== 'undefined'
        ? loadAirportLights(choice.icao, null, aptTrackProgress)
        : Promise.resolve())
    : waptLoad(choice.icao, choice.searchObj, aptTrackProgress);
  aptDataP.catch(e => console.error('[init] dane lotniska', e));

  // Configure modelP.
  const modelP = (plane.modelReadyPromise || Promise.resolve())
    .then(() => completeStage('model'))
    .catch(() => completeStage('model')); // Handle loading and error cases.

  updateCameraHUD();

  await Promise.allSettled([satTilesP, buildingsP, modelP]);
  await bootIntroDone; // Implementation note.

  clearInterval(statusTimer);
  if (loadbar) loadbar.style.width = '100%';
  if (loadingText) loadingText.textContent = 'Gotowe do startu.';

  setTimeout(() => {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = 'block';

    // Configure hasFinePointer.
    const hasFinePointer = matchMedia('(pointer:fine)').matches;
    const hasTouchEvents = navigator.maxTouchPoints > 0;
    const isRealMobile   = hasTouchEvents && !hasFinePointer;
    if (isRealMobile) {
      document.body.classList.add('is-touch');
    }
    setInterval(() => {
      if (activeEntity) {
        const la = activeEntity.lat, lo = activeEntity.lon;
        prefetchDEM(la, lo, 2, 17);
        prefetchDEM(la, lo, 3, 15);
        prefetchDEM(la, lo, 4, 13);
        prefetchDEM(la, lo, 5, 11);
      }
    }, 800);
    // Configure weather.
    weather = new WeatherSystem();
    if (typeof weatherUI !== 'undefined') {
      weatherUI.init();
      weatherUI.syncUI();
    }
    if (typeof weightUI !== 'undefined') weightUI.init();
    if (typeof apUI !== 'undefined') apUI.init();
    completeStage('wx');

    lastRenderT = performance.now();
    animate(lastRenderT);
  }, 400);
})();
