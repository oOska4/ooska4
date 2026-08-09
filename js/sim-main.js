'use strict';

// Section: fc.

let fc = 0, lastRenderT = performance.now();
let contrails = null;

function animate(t) {
  requestAnimationFrame(animate);
  const frameDt = Math.min(0.1, (t - lastRenderT) / 1000); // cap at 100ms
  lastRenderT = t; fc++;

  // Physics note.
  updatePlaneInput();

  // Advance physics
  physicsTick(t);

  // Update sound system (GPWS callouts, warnings)
  if (typeof SimSound !== 'undefined') SimSound.update(frameDt);

  updateOrbitKeyboard(frameDt);
  applyJoystick(frameDt);
  applyZoomButtons(frameDt);

  applyCamera(frameDt);

  // Update engine sound (throttle -> idle/spool-up/cruise, dystans kamery, przeloty)
  if (typeof SimEngineSound !== 'undefined') SimEngineSound.update(frameDt);

  const trackLat  = activeEntity ? activeEntity.lat : orb.lat;
  const trackLon  = activeEntity ? activeEntity.lon : orb.lon;
  const trackDist = cameraGroundDistanceM(orb.dist);

  if (fc % 2  === 0) updateTiles(trackLat, trackLon, trackDist);
  if (fc % 10 === 0) loadBuildings(trackLat, trackLon, trackDist);
  if (fc % 10 === 0 && typeof updateGroundTint !== 'undefined') updateGroundTint();

  for (const e of entities.values()) {
    e.syncMesh();
    e.renderUpdate(frameDt);
  }

  if (fc % 3 === 0) updateHUD();
  if (fc % 2 === 0 && weather) weather.update(frameDt, camera.position, activeEntity ? activeEntity.altM : 0);

  // Rendering note.
  updateSky(frameDt);

  // Configure if.
  if (typeof updateShadowFollow !== 'undefined') updateShadowFollow();

  // Configure if.
  if (typeof updateAirportLights !== 'undefined') updateAirportLights();

  // Configure if.
  if (contrails) {
    const ct = t / 1000;
    contrails.emit(ct, frameDt);
    contrails.update(ct);
  }

  // Rendering note.
  renderFrame();
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
  // Fetch the airport's Overpass/API data ONCE here and hand the same result
  // to both loadAirportLights() (preFetched param) and terrain smoothing, for
  // both preset and searched airports - Overpass is slow/flaky enough that a
  // successful response should never be fetched twice for the same load.
  const aptDataP = (async () => {
    const data = await fetchAirportFullData(choice.icao, aptTrackProgress);
    if (typeof loadAirportTerrainSmoothing === 'function') {
      const sampleRaw = (typeof _terrainRawHeightAtWorldXZ === 'function')
        ? (sx, sz) => _terrainRawHeightAtWorldXZ(sx, sz, 15) : null;
      loadAirportTerrainSmoothing(choice.icao, data.classified, sampleRaw).then(() => {
        if (currentAirport === choice.icao && typeof clearAllTiles === 'function') clearAllTiles();
      });
    }
    if (choice.isPreset) {
      if (typeof loadAirportLights !== 'undefined') await loadAirportLights(choice.icao, data, aptTrackProgress);
    } else {
      await waptLoad(choice.icao, choice.searchObj, aptTrackProgress, data);
    }
  })();
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
