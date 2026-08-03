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

  // Update sound system (GPWS callouts, warnings)
  if (typeof SimSound !== 'undefined') SimSound.update(frameDt);

  updateOrbitKeyboard(frameDt);
  applyJoystick(frameDt);
  applyZoomButtons(frameDt);

  applyCamera(frameDt);

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

  // Niebo (Słońce/Księżyc/gwiazdy, atmosfera, chmury wolumetryczne, deszcz)
  // aktualizowane co klatkę dla płynności animacji czasu i smug deszczu.
  updateSky(frameDt);

  // Kamera cienia (sunLight, sim-shadows.js) podąża za samolotem — MUSI iść
  // PO updateSky(), bo czyta świeżo policzony kierunek Słońca (sunWorldDir).
  if (typeof updateShadowFollow !== 'undefined') updateShadowFollow();

  // Światła lotniskowe (krawędziowe/progowe/osiowe/PAPI/REIL/latarnia) —
  // MUSI iść PO updateSky(), bo czyta świeżo policzony SkyState.nightFactor
  // w tej samej klatce (patrz sim-airport-lights.js).
  if (typeof updateAirportLights !== 'undefined') updateAirportLights();

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
const bootSelect = document.getElementById('phase-select');
const bootLoad   = document.getElementById('phase-load');
const loadbar      = document.getElementById('loadbar');
const loadingText  = document.getElementById('loading-text');
const loadbar2     = document.getElementById('loadbar2');
const loadingText2 = document.getElementById('loading-text2');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Sekwencja intro: czarny ekran → logo studia → nick autora → WYBÓR
// LOTNISKA → loading ──────────────────────────────────────────────────────
// Czas trwania fade in/fade out (900ms) MUSI zgadzać się z `transition: opacity`
// na .boot-phase w sim-style.css — zmieniaj oba razem.
// WAŻNE: zwracamy tu promise (bootIntroDone) i init() na niego czeka przed
// ukryciem #loading — inaczej, gdy realne zasoby wczytają się błyskawicznie
// (np. kafelki terenu/model samolotu już w cache przeglądarki po
// wcześniejszych testach), init() chowałby cały ekran startowy ZANIM intro
// zdążyłoby pokazać logo.
//
// Wybór lotniska (patrz sim-airport-select.js) jest teraz CZĘŚCIĄ tej samej
// sekwencji intro, między nickiem autora a paskiem ładowania — ale init()
// NIE czeka na bootIntroDone, żeby zacząć pobierać teren (patrz niżej:
// init() czeka na `airportSelectDone` OSOBNO i od razu, równolegle z resztą
// animacji intro/fade-out tej fazy — dokładnie taki jest sens tej zmiany:
// gracz wybiera lotnisko i TEREN ZACZYNA SIĘ ŁADOWAĆ NATYCHMIAST, jeszcze
// zanim ekran wyboru zdąży zniknąć).
const bootIntroDone = (async function bootIntro() {
  await sleep(200);                 // chwila czystej czerni na starcie
  if (bootStudio) bootStudio.classList.add('show');
  await sleep(1600);                // "WKR GAMES" trzyma się w pełni widoczne
  if (bootStudio) bootStudio.classList.remove('show');
  await sleep(900);                 // fade-out studia

  if (bootAuthor) bootAuthor.classList.add('show');
  await sleep(1500);                // "oOska4" trzyma się w pełni widoczne
  if (bootAuthor) bootAuthor.classList.remove('show');
  await sleep(900);                 // fade-out autora

  if (bootSelect) bootSelect.classList.add('show');
  await airportSelectDone;          // czeka na wybór gracza (sim-airport-select.js)
  if (bootSelect) bootSelect.classList.remove('show');
  await sleep(500);                 // fade-out ekranu wyboru

  if (bootLoad) bootLoad.classList.add('show');   // od teraz widoczny prawdziwy pasek postępu
})();

// ── Realny postęp ładowania (teren/model/pogoda) ──────────────────────────────
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

// ── Drugi, NIEZALEŻNY pasek: dane lotniska (WKR API + Overpass) ──────────────
// Leci RÓWNOLEGLE z paskiem terenu powyżej — nie wchodzi do LOAD_TOTAL_WEIGHT
// i NIE blokuje ukrycia ekranu ładowania (dokładnie jak wcześniej
// loadAirportLights() dla domyślnego lotniska: "może potrwać do minuty, gra
// jest grywalna zanim się doładuje", tylko teraz WIDOCZNE na pasku zamiast
// cichego "wskoczenia" świateł po fakcie). Trzy zgrubne etapy zamiast
// realnego % — fetchAirportFullData to w praktyce dwa równoległe zapytania
// sieciowe (patrz sim-airport-lights.js), trudno zmierzyć postęp w środku.
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
  // Wybór gracza z ekranu startowego (sim-airport-select.js) —
  // { icao, lat, lon, name, isPreset, searchObj }. Czekamy na TO, nie na
  // bootIntroDone, żeby teren zaczął się ładować OD RAZU po wyborze, a nie
  // dopiero po zakończeniu animacji fade-out ekranu wyboru.
  const choice = await airportSelectDone;

  // Punkt odniesienia CAŁEGO układu współrzędnych świata — ustawiany PRZED
  // czymkolwiek innym, żeby DEM/kafle/budynki/spawn liczyły się od razu
  // względem wybranego lotniska (nie zawsze-domyślnego EPWR jak wcześniej).
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
    // Zsynchronizuj podświetlenie przycisku lotniska w panelu — domyślnie w
    // HTML aktywny jest EPWR, ale start mógł paść na LOWI/EDDF (patrz ekran
    // wyboru lotniska), więc bez tego przycisk pokazywałby złe lotnisko.
    document.querySelectorAll('[data-apt]').forEach(b => {
      b.classList.toggle('active', b.dataset.apt === choice.icao);
    });
  } else {
    // Dokładny próg pasa jeszcze nieznany (czeka na fetchAirportFullData
    // poniżej, w aptDataP) — startujemy na przybliżonym punkcie odniesienia
    // lotniska; worldSpawnAtRunway() (wołane z waptLoad()) doprecyzuje
    // pozycję, gdy dane dojdą — zwykle kilka sekund, nie blokuje startu.
    plane.reset({ lat: refLat, lon: refLon });
  }
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
  const satTilesP = Promise.allSettled(updateTiles(refLat, refLon, initialGroundDist))
    .then(() => completeStage('sat'));

  const buildingsP = loadBuildings(refLat, refLon, initialGroundDist)
    .then(() => completeStage('osm'))
    .catch(e => { console.error('[init] loadBuildings failed', e); completeStage('osm'); });

  // Dane lotniska (pasy dokładne + Overpass: kołowanie/płyty/stanowiska/PAPI) —
  // RÓWNOLEGLE z terenem powyżej (patrz aptTrackProgress powyżej), NIE
  // blokują paska terenu. Dla lotniska świata to jednocześnie źródło
  // dokładnego progu pasa (worldSpawnAtRunway wywoła się automatycznie na
  // końcu waptLoad, patrz sim-airport-spawn.js).
  aptTrackProgress('start');
  const aptDataP = choice.isPreset
    ? (typeof loadAirportLights !== 'undefined'
        ? loadAirportLights(choice.icao, null, aptTrackProgress)
        : Promise.resolve())
    : waptLoad(choice.icao, choice.searchObj, aptTrackProgress);
  aptDataP.catch(e => console.error('[init] dane lotniska', e));

  // Model A321 (obj+mtl) ładuje się w tle od razu w konstruktorze encji —
  // modelReadyPromise (patrz sim-physics.js) pozwala tu na niego poczekać.
  const modelP = (plane.modelReadyPromise || Promise.resolve())
    .then(() => completeStage('model'))
    .catch(() => completeStage('model')); // błąd już zalogowany w loadA321Model()

  updateCameraHUD();

  await Promise.allSettled([satTilesP, buildingsP, modelP]);
  await bootIntroDone; // patrz komentarz przy bootIntro() — nie chowamy ekranu przed czasem

  clearInterval(statusTimer);
  if (loadbar) loadbar.style.width = '100%';
  if (loadingText) loadingText.textContent = 'Gotowe do startu.';

  setTimeout(() => {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = 'block';

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