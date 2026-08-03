'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-airport-spawn.js
//
// Spawn na DOWOLNYM lotnisku świata (nie tylko EPWR/LOWI/EDDF z AIRPORTS{}):
// wyszukiwarka po ICAO/nazwie (ten sam WKR API co airport.html), wybór
// KONKRETNEJ końcówki pasa (np. "11" albo "29" — każdy pas ma dwie), spawn
// NA PASIE (gotowy do startu), spawn NA STANOWISKU (numer z realnych danych
// OSM parking_position) oraz spawn w PODEJŚCIU (na wybraną końcówkę, ten sam
// profil co istniejące spawnApproach() dla lotnisk wbudowanych).
//
// Korzysta z warstwy danych sim-airport-lights.js (fetchAirportFullData,
// apltXxx helpery) — MUSI się więc ładować PO tym pliku (patrz simworld.html).
// Ładowanie lotniska świata jednocześnie odświeża światła nocne (reużywając
// TYCH SAMYCH pobranych danych — jedno zapytanie sieciowe, nie dwa).
//
// Integracja z istniejącym "R"/Reset i "Approach": resetPlane()/spawnApproach()
// w sim-controls.js sprawdzają worldAirportActive() i, gdy aktywne, delegują
// tutaj (worldRespawnLast()/worldSpawnApproachLast()) zamiast czytać
// AIRPORTS[currentAirport] (które dla dowolnego lotniska świata nie istnieje).
// Wybór jednego z 3 szybkich przycisków EPWR/LOWI/EDDF wychodzi z trybu
// świata (worldDeactivate(), wołane z selectAirport()).
// ════════════════════════════════════════════════════════════════════════════════

let WorldAirport = null; // patrz waptLoad() — pełny stan załadowanego lotniska świata
let waptLoadEpoch = 0;

// ── Zgadywanie identyfikatora końca pasa z namiaru, gdy ani API, ani OSM go
// nie podają (np. surowa geometria bez tagu ref) — najbliższe 10°, 1-36.
function waptGuessIdent(bearingDeg) {
  let n = Math.round(bearingDeg / 10);
  if (n <= 0) n += 36;
  if (n > 36) n -= 36;
  return String(n).padStart(2, '0');
}

// ── Szablon panelu (wstrzykiwany do #wapt-panel (desktop) i .wapt-mount
// (popup mobile) — patrz waptMountUI()). Ta sama treść w obu miejscach,
// zsynchronizowana przez selektory klas (document.querySelectorAll). ───────
const WAPT_TEMPLATE = `
  <div class="w-row">
    <input type="text" class="wapt-q" placeholder="ICAO/nazwa, np. KJFK">
    <button class="wapt-search-btn" style="flex:0 0 26px">🔎</button>
  </div>
  <div class="wapt-status hint-row dim"></div>
  <div class="wapt-results"></div>
  <div class="wapt-picker" style="display:none">
    <div class="wapt-name hint-row"></div>
    <div class="w-row"><label>Pas</label><select class="wapt-rwy-select"></select></div>
    <div class="w-row"><label>Stanowisko</label><select class="wapt-stand-select"></select></div>
    <div class="btn-row">
      <button class="wapt-spawn-rwy">🛫 Na pasie</button>
      <button class="wapt-spawn-appr">⬇ Podejście</button>
    </div>
    <div class="btn-row">
      <button class="wapt-spawn-stand">🅿 Na stanowisku</button>
    </div>
  </div>
`;

function waptMountUI() {
  document.querySelectorAll('.wapt-mount').forEach(el => { el.innerHTML = WAPT_TEMPLATE; });

  document.querySelectorAll('.wapt-search-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('.wapt-q');
      waptSearch(input ? input.value : '');
    });
  });
  document.querySelectorAll('.wapt-q').forEach(input => {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') waptSearch(input.value); });
  });
  document.querySelectorAll('.wapt-rwy-select').forEach(sel => {
    sel.addEventListener('change', () => { if (WorldAirport) WorldAirport.selectedRunwayEndIdx = parseInt(sel.value, 10) || 0; });
  });
  document.querySelectorAll('.wapt-stand-select').forEach(sel => {
    sel.addEventListener('change', () => { if (WorldAirport) WorldAirport.selectedStandIdx = parseInt(sel.value, 10) || 0; });
  });
  document.querySelectorAll('.wapt-spawn-rwy').forEach(btn => {
    btn.addEventListener('click', () => { if (WorldAirport) worldSpawnAtRunway(WorldAirport.selectedRunwayEndIdx); });
  });
  document.querySelectorAll('.wapt-spawn-appr').forEach(btn => {
    btn.addEventListener('click', () => { if (WorldAirport) worldSpawnApproach(WorldAirport.selectedRunwayEndIdx); });
  });
  document.querySelectorAll('.wapt-spawn-stand').forEach(btn => {
    btn.addEventListener('click', () => { if (WorldAirport) worldSpawnAtStand(WorldAirport.selectedStandIdx); });
  });

  // Zwijany panel na desktopie (dokładnie ten sam wzorzec co #weather-panel
  // w sim-weather-ui.js) — na mobile popup jest zawsze w pełni widoczny,
  // bo sam popup już wymaga jawnego otwarcia.
  let waptOpen = false;
  document.getElementById('btn-wapt-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('wapt-panel');
    waptOpen = !waptOpen;
    panel.style.display = waptOpen ? 'block' : 'none';
    document.getElementById('btn-wapt-toggle').textContent = waptOpen ? '▲' : '▼';
  });
}
waptMountUI();

function waptSetStatus(text, loading) {
  document.querySelectorAll('.wapt-status').forEach(el => {
    el.innerHTML = (loading ? '<span class="spinner"></span>' : '') + text;
  });
}
function waptSetResults(list) {
  document.querySelectorAll('.wapt-results').forEach(container => {
    container.innerHTML = '';
    for (const c of list) {
      const div = document.createElement('div');
      div.className = 'wapt-result-item';
      div.textContent = `${apltGetIdent(c) || '?'} — ${apltGetName(c)} (${apltGetCountry(c)})`;
      div.addEventListener('click', () => waptLoad(apltGetIdent(c), c));
      container.appendChild(div);
    }
  });
}
function waptSetPickerVisible(visible) {
  document.querySelectorAll('.wapt-picker').forEach(el => { el.style.display = visible ? 'block' : 'none'; });
}
function waptPopulateSelects() {
  if (!WorldAirport) return;
  document.querySelectorAll('.wapt-name').forEach(el => {
    el.textContent = `${WorldAirport.icao} — ${WorldAirport.name}`;
  });
  document.querySelectorAll('.wapt-rwy-select').forEach(sel => {
    sel.innerHTML = WorldAirport.runwayEnds.map((e, i) =>
      `<option value="${i}">${e.ident} (${Math.round(e.lenM)} m)</option>`).join('');
  });
  document.querySelectorAll('.wapt-stand-select').forEach(sel => {
    sel.innerHTML = WorldAirport.stands.length
      ? WorldAirport.stands.map((s, i) => `<option value="${i}">${s.ref}</option>`).join('')
      : '<option value="0">(brak danych OSM)</option>';
  });
  waptSyncSelectValues();
}
function waptSyncSelectValues() {
  if (!WorldAirport) return;
  document.querySelectorAll('.wapt-rwy-select').forEach(sel => { sel.value = String(WorldAirport.selectedRunwayEndIdx); });
  document.querySelectorAll('.wapt-stand-select').forEach(sel => { sel.value = String(WorldAirport.selectedStandIdx); });
}

// ── Wyszukiwanie ──────────────────────────────────────────────────────────────
async function waptSearch(queryRaw) {
  const q = (queryRaw || '').trim();
  if (!q) { waptSetStatus('Wpisz kod ICAO lub nazwę lotniska.'); return; }
  waptSetStatus('Szukam lotniska (API bywa wolne, do minuty)...', true);
  waptSetResults([]);
  waptSetPickerVisible(false);

  const looksLikeIcao = /^[A-Za-z]{4}$/.test(q);
  if (looksLikeIcao) {
    const obj = await apltApiSearchByCode(q.toUpperCase());
    if (obj) { await waptLoad(apltGetIdent(obj) || q.toUpperCase(), obj); return; }
  }

  const candidates = await apltApiSearchText(q);
  if (!candidates.length) {
    if (looksLikeIcao) {
      // API nic nie ma dla tego kodu, ale spróbujmy Overpass — może dane
      // istnieją tylko w OSM (patrz fallback w fetchAirportFullData()).
      await waptLoad(q.toUpperCase());
      return;
    }
    waptSetStatus('Nie znaleziono lotniska. Spróbuj kodu ICAO, np. KJFK.');
    return;
  }
  if (candidates.length === 1) { await waptLoad(apltGetIdent(candidates[0]), candidates[0]); return; }
  waptSetStatus(`Znaleziono ${candidates.length} lotnisk — wybierz:`);
  waptSetResults(candidates);
}

// ── Ładowanie lotniska (dane + światła + listy pas/stanowisko + auto-spawn) ──
async function waptLoad(icao, hintObj, onProgress) {
  if (!icao) return;
  const myEpoch = ++waptLoadEpoch;
  waptSetStatus(`Ładowanie ${icao} (API+OSM, może potrwać do minuty)...`, true);
  waptSetResults([]);

  // NATYCHMIASTOWY START TERENU: jeśli mamy już przybliżone lat/lon tego
  // lotniska (np. z wyniku wyszukiwania — apltApiSearchText/apltApiSearchByCode
  // już je zwróciły, albo z ekranu wyboru przy starcie — sim-airport-select.js),
  // nie ma powodu czekać na fetchAirportFullData (pasy+Overpass, do ~60s)
  // zanim zacznie się ciągnąć teren/satelitę/budynki — ten sam punkt i tak
  // zostanie za chwilę doprecyzowany (patrz niżej). Pomijamy to, gdy punkt
  // jest identyczny z bieżącym refLat/refLon (np. przy wyborze na starcie,
  // gdzie init() w sim-main.js już to samo ustawił przed wywołaniem) —
  // inaczej clearAllTiles() wyzerowałoby kafle, które właśnie zaczęły się
  // ładować dla tego samego miejsca.
  const hintLat = hintObj ? apltGetLat(hintObj) : NaN;
  const hintLon = hintObj ? apltGetLon(hintObj) : NaN;
  if (!isNaN(hintLat) && !isNaN(hintLon) && (hintLat !== refLat || hintLon !== refLon)) {
    currentAirport = icao;
    refLat = hintLat; refLon = hintLon;
    if (typeof clearAllTiles === 'function') clearAllTiles();
    if (typeof clearAllBldg  === 'function') clearAllBldg();
    orb.lat = hintLat; orb.lon = hintLon;
    for (const [r, z] of [[2, 17], [3, 15], [4, 13], [5, 11]]) prefetchDEM(hintLat, hintLon, r, z);
  }

  try {
    const data = await fetchAirportFullData(icao, onProgress);
    if (myEpoch !== waptLoadEpoch) return; // w międzyczasie wybrano coś innego

    const validRunways = data.validRunways.filter(r =>
      !isNaN(r.leLat) && !isNaN(r.leLon) && !isNaN(r.heLat) && !isNaN(r.heLon));
    if (!validRunways.length) {
      waptSetStatus(`Brak danych o pasach dla ${icao} (ani API, ani OSM) — spróbuj innego kodu.`);
      return;
    }

    // Punkt odniesienia (recentruje CAŁY układ współrzędnych świata — jak w
    // selectAirport()): metadane z API, w innym razie średnia progów pasów.
    let refPointLat = data.airportObj ? apltGetLat(data.airportObj) : NaN;
    let refPointLon = data.airportObj ? apltGetLon(data.airportObj) : NaN;
    if (isNaN(refPointLat) || isNaN(refPointLon)) {
      let sLat = 0, sLon = 0, n = 0;
      for (const r of validRunways) { sLat += r.leLat + r.heLat; sLon += r.leLon + r.heLon; n += 2; }
      refPointLat = sLat / n; refPointLon = sLon / n;
    }

    // Lista "końców pasów" do wyboru — po 2 na każdy pas fizyczny (LE i HE),
    // każdy ze swoim namiarem/kursem startu-lądowania w TĄ stronę.
    const runwayEnds = [];
    validRunways.forEach((r, ri) => {
      const bearingDeg = geoBearing(r.leLat, r.leLon, r.heLat, r.heLon);
      const lenM = (!isNaN(r.lenFt) && r.lenFt > 0) ? r.lenFt * 0.3048 : geoDistM(r.leLat, r.leLon, r.heLat, r.heLon);
      const widthM = !isNaN(r.widthFt) ? r.widthFt * 0.3048 : 45;
      runwayEnds.push({
        ident: r.leIdent || waptGuessIdent(bearingDeg),
        lat: r.leLat, lon: r.leLon, bearingDeg, lenM, widthM, runwayIdx: ri,
      });
      runwayEnds.push({
        ident: r.heIdent || waptGuessIdent((bearingDeg + 180) % 360),
        lat: r.heLat, lon: r.heLon, bearingDeg: (bearingDeg + 180) % 360, lenM, widthM, runwayIdx: ri,
      });
    });

    // Stanowiska — realne numery z OSM (aeroway=parking_position, ref=...),
    // posortowane naturalnie (1, 2, 10 zamiast 1, 10, 2).
    const stands = (data.classified.parkingPositions || [])
      .map(pp => ({ ref: pp.ref, lat: pp.lat, lon: pp.lon, headingDeg: pp.headingDeg }))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));

    WorldAirport = {
      icao,
      name: data.airportObj ? apltGetName(data.airportObj) : icao,
      runwayEnds, stands,
      selectedRunwayEndIdx: 0, selectedStandIdx: 0,
      lastGroundSpawn: { type: 'runway', idx: 0 },
      active: true,
    };

    // Przełącz aktywne lotnisko na ten (dowolny, spoza AIRPORTS{}) kod — jak
    // selectAirport() dla lotnisk wbudowanych: recentruje CAŁY układ
    // współrzędnych świata (refLat/refLon) na nowy punkt odniesienia, żeby
    // teren/budynki/satelita zaczęły się ładować wokół nowego miejsca.
    currentAirport = icao;
    refLat = refPointLat; refLon = refPointLon;
    // Stare kafelki terenu/budynki zbudowane względem POPRZEDNIEGO refLat/refLon
    // mają teraz błędną pozycję ("zawieszone w powietrzu") — czyść od razu,
    // zamiast czekać aż dogoni je naturalne czyszczenie oparte na odległości
    // (przy skoku na drugi kraniec świata bywa zauważalnie opóźnione).
    if (typeof clearAllTiles === 'function') clearAllTiles();
    if (typeof clearAllBldg  === 'function') clearAllBldg();
    orb.lat = refPointLat; orb.lon = refPointLon;
    for (const [r, z] of [[2, 17], [3, 15], [4, 13], [5, 11]]) prefetchDEM(refPointLat, refPointLon, r, z);
    document.querySelectorAll('[data-apt]').forEach(b => b.classList.remove('active'));

    // Fotorealistyczne światła — reużywają danych, które WŁAŚNIE pobraliśmy
    // (data), więc to NIE jest drugie zapytanie sieciowe do API/Overpass.
    if (typeof loadAirportLights !== 'undefined') loadAirportLights(icao, data);

    waptPopulateSelects();
    waptSetPickerVisible(true);
    waptSetStatus(`Wczytano: ${WorldAirport.name} (${icao}) — ${validRunways.length} pas(ów), ${stands.length} stanowisk (OSM).`);

    // Od razu spawnuj na pierwszej końcówce pierwszego pasa — jak
    // selectAirport() od razu przestawia samolot na nowe lotnisko.
    worldSpawnAtRunway(0);
  } catch (e) {
    console.error('[airport-spawn]', e);
    waptSetStatus('Błąd podczas ładowania lotniska (sieć/API/Overpass).');
  }
}

// ── Funkcje spawnu ────────────────────────────────────────────────────────────
function worldSpawnAtRunway(idx) {
  if (!WorldAirport || !activeEntity) return;
  const end = WorldAirport.runwayEnds[idx]; if (!end) return;
  WorldAirport.selectedRunwayEndIdx = idx;
  WorldAirport.lastGroundSpawn = { type: 'runway', idx };
  thrValue = null;
  activeEntity.reset({ lat: end.lat, lon: end.lon, yawRad: apltHeadingToYawRad(end.bearingDeg) });
  if (typeof SimSound !== 'undefined') SimSound.resetCallouts();
  orb.lat = end.lat; orb.lon = end.lon;
  prefetchDEM(end.lat, end.lon, 2, 16);
  waptSyncSelectValues();
}

function worldSpawnAtStand(idx) {
  if (!WorldAirport || !activeEntity) return;
  const st = WorldAirport.stands[idx]; if (!st) return;
  WorldAirport.selectedStandIdx = idx;
  WorldAirport.lastGroundSpawn = { type: 'stand', idx };
  thrValue = null;
  // Kierunek nieznany dla węzłów-punktów (headingDeg=null) — domyślnie 0°;
  // dla stanowisk zmapowanych jako linia dojazdu (patrz apltClassifyElements
  // w sim-airport-lights.js) mamy realny kierunek "dziobem po dojechaniu".
  const headingDeg = st.headingDeg != null ? st.headingDeg : 0;
  activeEntity.reset({ lat: st.lat, lon: st.lon, yawRad: apltHeadingToYawRad(headingDeg) });
  if (typeof SimSound !== 'undefined') SimSound.resetCallouts();
  orb.lat = st.lat; orb.lon = st.lon;
  prefetchDEM(st.lat, st.lon, 2, 16);
  waptSyncSelectValues();
}

function worldSpawnApproach(idx) {
  if (!WorldAirport || !activeEntity) return;
  const end = WorldAirport.runwayEnds[idx]; if (!end) return;
  WorldAirport.selectedRunwayEndIdx = idx;
  const plane = activeEntity;
  const yawRad = apltHeadingToYawRad(end.bearingDeg);
  // Ten sam profil co spawnApproach() w sim-controls.js dla lotnisk
  // wbudowanych: 6 km przed progiem, 300 m nad terenem, lekkie zniżanie.
  const D = 6000, bear = (end.bearingDeg + 180) % 360;
  const p = apltMoveGeo(end.lat, end.lon, bear, D);
  const groundH = terrainHeightBest(p.lat, p.lon);
  thrValue = 0.55;
  if (typeof _thrDraw === 'function') _thrDraw(0.55);
  plane.reset({
    lat: p.lat, lon: p.lon, altM: groundH + 300, yawRad, pitchRad: 0.02,
    velX: Math.sin(yawRad) * 70, velY: -2, velZ: Math.cos(yawRad) * 70,
    throttle: 0.55, flaps: 2, gearDown: true, onGround: false,
  });
  if (typeof SimSound !== 'undefined') SimSound.resetCallouts();
  for (const [r, z] of [[2, 17], [3, 15], [4, 13], [5, 11]]) prefetchDEM(p.lat, p.lon, r, z);
  orb.lat = p.lat; orb.lon = p.lon;
  waptSyncSelectValues();
}

// ── Integracja z resetPlane()/spawnApproach() (sim-controls.js) ─────────────
function worldAirportActive() { return !!(WorldAirport && WorldAirport.active); }
function worldRespawnLast() {
  if (!WorldAirport) return;
  const g = WorldAirport.lastGroundSpawn || { type: 'runway', idx: 0 };
  if (g.type === 'stand') worldSpawnAtStand(g.idx); else worldSpawnAtRunway(g.idx);
}
function worldSpawnApproachLast() {
  if (!WorldAirport) return;
  worldSpawnApproach(WorldAirport.selectedRunwayEndIdx);
}
// Wołane z selectAirport() (sim-controls.js) przy wyborze jednego z 3
// szybkich przycisków EPWR/LOWI/EDDF — wychodzi z trybu "lotnisko świata".
function worldDeactivate() {
  if (WorldAirport) WorldAirport.active = false;
  waptSetPickerVisible(false);
  waptSetStatus('');
}
