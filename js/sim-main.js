'use strict';

// ── Pętla renderowania ─────────────────────────────────────────────────────────

let fc = 0, lastRenderT = performance.now();
let contrails = null;

function animate(t) {
  requestAnimationFrame(animate);
  const frameDt = Math.min(0.1, (t - lastRenderT) / 1000); // cap at 100ms
  lastRenderT = t; fc++;

  // NAPRAWA: updatePlaneInput() musi iść PRZED physicsTick() — inaczej fizyka
  // w tej klatce liczyła się na podstawie sterowania SPRZED klatki (input
  // odczytany dopiero PO physicsTick trałał dopiero do NASTĘPNEGO kroku
  // fizyki), co dawało stałe opóźnienie ~1 klatki między ruchem
  // drążka/pedałów a rzeczywistą reakcją samolotu.
  updatePlaneInput();

  // Advance physics
  physicsTick(t);

  updateOrbitKeyboard(frameDt);
  applyJoystick(frameDt);
  applyZoomButtons(frameDt);

  applyCamera(frameDt);

  const trackLat  = activeEntity ? activeEntity.lat : orb.lat;
  const trackLon  = activeEntity ? activeEntity.lon : orb.lon;
  const trackDist = cameraGroundDistanceM(orb.dist);

  if (fc % 2  === 0) updateTiles(trackLat, trackLon, trackDist);
  if (fc % 10 === 0) loadBuildings(trackLat, trackLon, trackDist);

  for (const e of entities.values()) {
    e.syncMesh();
    e.renderUpdate(frameDt);
  }

  if (fc % 3 === 0) updateHUD();
  if (fc % 2 === 0 && weather) weather.update(frameDt, camera.position, activeEntity ? activeEntity.altM : 0);

  // Niebo (Słońce/Księżyc/gwiazdy, atmosfera, chmury wolumetryczne, deszcz)
  // aktualizowane co klatkę dla płynności animacji czasu i smug deszczu.
  updateSky(frameDt);

  // Smugi kondensacyjne silników A321 — emisja + aktualizacja czasu życia
  // cząsteczek, co klatkę dla płynności (patrz sim-contrails.js).
  if (contrails) {
    const ct = t / 1000;
    contrails.emit(ct, frameDt);
    contrails.update(ct);
  }

  // Cały potok renderowania (scena → mainRT z głębią → chmury z okluzją →
  // złożenie na ekranie) — patrz sim-sky.js/renderFrame().
  renderFrame();
}

// ── Start ────────────────────────────────────────────────────────────────────

const bootStudio = document.getElementById('phase-studio');
const bootAuthor = document.getElementById('phase-author');
const bootLoad   = document.getElementById('phase-load');
const loadbar     = document.getElementById('loadbar');
const loadingText = document.getElementById('loading-text');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Sekwencja intro: czarny ekran → logo studia → nick autora → loading ──────
// Czas trwania fade in/fade out (900ms) MUSI zgadzać się z `transition: opacity`
// na .boot-phase w sim-style.css — zmieniaj oba razem.
(async function bootIntro() {
  await sleep(200);                 // chwila czystej czerni na starcie
  bootStudio.classList.add('show');
  await sleep(1600);                // "WKR GAMES" trzyma się w pełni widoczne
  bootStudio.classList.remove('show');
  await sleep(900);                 // fade-out studia

  bootAuthor.classList.add('show');
  await sleep(1500);                // "oOska4" trzyma się w pełni widoczne
  bootAuthor.classList.remove('show');
  await sleep(900);                 // fade-out autora

  bootLoad.classList.add('show');   // od teraz widoczny prawdziwy pasek postępu
})();

// ── Realny postęp ładowania ───────────────────────────────────────────────────
// Zamiast losowego paska "na oko" — każdy etap ma wagę i zapala się dopiero
// gdy odpowiadająca mu prawdziwa operacja (sieć/parsowanie/inicjalizacja)
// faktycznie się zakończy. Tekst statusu przewija etykiety etapów wciąż
// trwających, więc widać co realnie się dzieje, nawet gdy kilka rzeczy
// ładuje się jednocześnie.
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
  loadbar.style.width = Math.min(100, Math.round(doneWeight / LOAD_TOTAL_WEIGHT * 100)) + '%';
}

let statusRotIdx = 0;
loadingText.textContent = LOAD_STAGES[0].label;
const statusTimer = setInterval(() => {
  const pending = LOAD_STAGES.filter(s => !s.done);
  if (!pending.length) return;
  loadingText.textContent = pending[statusRotIdx % pending.length].label;
  statusRotIdx++;
}, 900);

(async function init() {
  try {
    await Promise.all([
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 2, 17),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 3, 15),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 4, 13),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 5, 11),
      prefetchDEM(SPAWN_LAT, SPAWN_LON, 6,  9),
    ]);
  } catch (e) { console.error('[init] DEM prefetch failed', e); }
  completeStage('dem');

  const plane = new A321Entity({ id: 'a321' });
  plane.reset({});
  scene.add(plane.mesh);
  addEntity(plane);
  activeEntity = plane;

  // Smugi kondensacyjne silników — podpięte pod encję samolotu (patrz sim-contrails.js).
  contrails = new AircraftContrailSystem(plane);

  applyCamera(0);
  const initialGroundDist = cameraGroundDistanceM(orb.dist);

  // updateTiles() zwraca teraz obietnice kafelków satelitarnych właśnie
  // uruchomionych (patrz sim-terrain.js) — czekamy na pierwszy komplet, żeby
  // pasek odzwierciedlał realne wczytanie terenu wokół miejsca startu.
  const satTilesP = Promise.allSettled(updateTiles(SPAWN_LAT, SPAWN_LON, initialGroundDist))
    .then(() => completeStage('sat'));

  const buildingsP = loadBuildings(SPAWN_LAT, SPAWN_LON, initialGroundDist)
    .then(() => completeStage('osm'))
    .catch(e => { console.error('[init] loadBuildings failed', e); completeStage('osm'); });

  // Model A321 (obj+mtl) ładuje się w tle od razu w konstruktorze encji —
  // modelReadyPromise (patrz sim-physics.js) pozwala tu na niego poczekać.
  const modelP = (plane.modelReadyPromise || Promise.resolve())
    .then(() => completeStage('model'))
    .catch(() => completeStage('model')); // błąd już zalogowany w loadA321Model()

  updateCameraHUD();

  await Promise.allSettled([satTilesP, buildingsP, modelP]);

  clearInterval(statusTimer);
  loadbar.style.width = '100%';
  loadingText.textContent = 'Gotowe do startu.';

  setTimeout(() => {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('hud').style.display = 'block';

    // Wykryj prawdziwy ekran dotykowy (wyklucz PC z touchscreen przez sprawdzenie
    // czy urządzenie ma mysz — pointer:fine = mysz, pointer:coarse = palec)
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
    // Inicjalizacja pogody — proceduralna (bez sieci), ale liczona jako osobny
    // etap dla czytelności UI; zamykamy go od razu po synchronicznej inicjalizacji.
    weather = new WeatherSystem();
    weatherUI.init();
    weatherUI.syncUI();
    completeStage('wx');

    lastRenderT = performance.now();
    animate(lastRenderT);
  }, 400);
})();