'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-airport-select.js
//
// Ekran wyboru lotniska na starcie (między intro studia/autora a paskiem
// ładowania — patrz #phase-select w simworld.html i bootIntro() w
// sim-main.js). Pozwala wybrać DOWOLNE lotnisko świata (ta sama wyszukiwarka
// WKR API co "LOTNISKA ŚWIATA" w locie — apltApiSearchText/apltApiSearchByCode
// z sim-airport-lights.js) albo jeden z 3 wbudowanych presetów, albo pominąć
// i lecieć z domyślnego EPWR.
//
// Musi się ładować PO sim-airport-lights.js (korzysta z apltXxx helperów) i
// PO sim-constants.js (AIRPORTS{}), a PRZED sim-main.js (patrz simworld.html) —
// init() w sim-main.js czeka na `airportSelectDone` zanim ruszy jakiekolwiek
// pobieranie terenu.
//
// Eksportuje `airportSelectDone` — Promise, na który czeka init() w
// sim-main.js — rozwiązuje się DOPIERO gdy gracz coś wybierze, z obiektem:
//   { icao, lat, lon, name, isPreset, searchObj }
// `searchObj` (tylko dla wyszukanych/nie-presetowych) to surowy obiekt z WKR
// API — przekazywany dalej do waptLoad() jako `hintObj`, żeby teren zaczął
// się ładować z lat/lon które już mamy, RÓWNOLEGLE z fetchAirportFullData
// (pasy+Overpass) zamiast po nim czekać — patrz komentarz w waptLoad()
// (sim-airport-spawn.js).
// ════════════════════════════════════════════════════════════════════════════════

let _aselResolve = null;
const airportSelectDone = new Promise(resolve => { _aselResolve = resolve; });

const ASEL_RECENT_KEY = 'simworld_recent_airports';
const ASEL_RECENT_MAX = 5;
// Pula dla przycisku "Losowe" — kilka zróżnicowanych geograficznie lotnisk
// (w tym górskie, pasujące do tematyki studia). Same kody ICAO — pełne dane
// (lat/lon/nazwa) i tak trzeba pobrać z API po wybraniu, jak przy zwykłym
// wyszukiwaniu.
const ASEL_RANDOM_POOL = ['NZQN', 'VQPR', 'LSZH', 'KJFK', 'RJTT', 'OMDB', 'CYVR', 'SBGR'];

function aselChoose(choice) {
  if (!_aselResolve) return;
  const resolve = _aselResolve;
  _aselResolve = null; // pierwszy wybór wygrywa — kolejne kliknięcia (np. Enter i klik) są no-opem
  resolve(choice);
}

function aselSaveRecent(icao, name) {
  try {
    let list = JSON.parse(localStorage.getItem(ASEL_RECENT_KEY) || '[]');
    list = list.filter(r => r.icao !== icao);
    list.unshift({ icao, name });
    list = list.slice(0, ASEL_RECENT_MAX);
    localStorage.setItem(ASEL_RECENT_KEY, JSON.stringify(list));
  } catch (e) { /* localStorage niedostępny (np. tryb prywatny) — pomijamy po cichu */ }
}
function aselLoadRecent() {
  try { return JSON.parse(localStorage.getItem(ASEL_RECENT_KEY) || '[]'); }
  catch (e) { return []; }
}

// ── Wybór: preset (AIRPORTS{}) — natychmiastowy, znamy dokładny refLat/refLon
// bez żadnego zapytania sieciowego. ──────────────────────────────────────────
function aselPickPreset(icao) {
  const apt = AIRPORTS[icao];
  if (!apt) return;
  aselSaveRecent(icao, apt.name);
  aselChoose({ icao, lat: apt.refLat, lon: apt.refLon, name: apt.name, isPreset: true });
}

// ── Wybór: wynik wyszukiwania / lotnisko świata (obiekt z WKR API) — lat/lon
// już znamy z samego wyszukiwania, więc init() może ruszyć teren od razu. ───
function aselPickSearchObj(obj) {
  const icao = apltGetIdent(obj);
  const lat = apltGetLat(obj), lon = apltGetLon(obj);
  if (!icao || isNaN(lat) || isNaN(lon)) return;
  const name = apltGetName(obj);
  aselSaveRecent(icao, name);
  aselChoose({ icao, lat, lon, name, isPreset: false, searchObj: obj });
}

// ── Wybór po samym ICAO (np. z "ostatnio odwiedzone"/losowe) — trzeba
// doszukać pełny obiekt, żeby mieć lat/lon zanim cokolwiek ruszy. ───────────
async function aselPickByIcao(icao) {
  if (AIRPORTS[icao]) { aselPickPreset(icao); return; }
  aselSetStatus('Wczytywanie…', true);
  const obj = await apltApiSearchByCode(icao);
  if (obj) { aselPickSearchObj(obj); return; }
  aselSetStatus(`Nie udało się wczytać ${icao} — spróbuj wyszukać ręcznie.`);
}

function aselSetStatus(text, loading) {
  const el = document.getElementById('asel-status');
  if (el) el.innerHTML = (loading ? '<span class="spinner"></span>' : '') + text;
}

// ── Render: wyniki wyszukiwania ───────────────────────────────────────────────
function aselRenderResults(list) {
  const container = document.getElementById('asel-results');
  if (!container) return;
  container.innerHTML = '';
  for (const c of list.slice(0, 8)) {
    const div = document.createElement('div');
    div.className = 'asel-res-row';
    const icao = apltGetIdent(c) || '?';
    div.innerHTML = `<span class="asel-res-icao">${icao}</span>
      <span class="asel-res-mid"><div class="asel-res-name">${apltGetName(c)}</div><div class="asel-res-sub">${apltGetCountry(c)}</div></span>`;
    div.addEventListener('click', () => aselPickSearchObj(c));
    container.appendChild(div);
  }
}

// ── Wyszukiwanie (ta sama logika co waptSearch() w sim-airport-spawn.js, ale
// tu tylko POKAZUJEMY wyniki do wyboru — nie ładujemy od razu). ─────────────
let aselSearchEpoch = 0;
async function aselSearch(queryRaw) {
  const q = (queryRaw || '').trim();
  const myEpoch = ++aselSearchEpoch;
  if (!q) { aselRenderResults([]); aselSetStatus(''); return; }
  aselSetStatus('Szukam…', true);

  const looksLikeIcao = /^[A-Za-z]{4}$/.test(q);
  if (looksLikeIcao) {
    const obj = await apltApiSearchByCode(q.toUpperCase());
    if (myEpoch !== aselSearchEpoch) return;
    if (obj) { aselSetStatus(''); aselRenderResults([obj]); return; }
  }
  const candidates = await apltApiSearchText(q);
  if (myEpoch !== aselSearchEpoch) return;
  if (!candidates.length) { aselSetStatus('Nie znaleziono lotniska. Spróbuj kodu ICAO, np. KJFK.'); aselRenderResults([]); return; }
  aselSetStatus('');
  aselRenderResults(candidates);
}

// ── Montaż UI ──────────────────────────────────────────────────────────────
function aselMount() {
  const quickGrid = document.getElementById('asel-quick');
  if (quickGrid) {
    const quickDefs = [
      { icao: 'EPWR', city: 'Wrocław' },
      { icao: 'LOWI', city: 'Innsbruck' },
      { icao: 'EDDF', city: 'Frankfurt' },
    ];
    quickGrid.innerHTML = '';
    for (const q of quickDefs) {
      const div = document.createElement('div');
      div.className = 'asel-qcard';
      div.innerHTML = `<div class="aq-icao">${q.icao}</div><div class="aq-city">${q.city.toUpperCase()}</div>`;
      div.addEventListener('click', () => aselPickPreset(q.icao));
      quickGrid.appendChild(div);
    }
    const rnd = document.createElement('div');
    rnd.className = 'asel-qcard';
    rnd.innerHTML = `<div class="aq-icao">🎲</div><div class="aq-city">LOSOWE</div>`;
    rnd.addEventListener('click', () => {
      const pick = ASEL_RANDOM_POOL[Math.floor(Math.random() * ASEL_RANDOM_POOL.length)];
      aselPickByIcao(pick);
    });
    quickGrid.appendChild(rnd);
  }

  const recentList = aselLoadRecent();
  const recentRow = document.getElementById('asel-recent');
  const recentLbl = document.getElementById('asel-recent-lbl');
  if (recentRow && recentList.length) {
    if (recentLbl) recentLbl.style.display = '';
    for (const r of recentList) {
      const div = document.createElement('div');
      div.className = 'asel-recent-pill';
      div.innerHTML = `<b>${r.icao}</b><span>${r.name}</span>`;
      div.addEventListener('click', () => aselPickByIcao(r.icao));
      recentRow.appendChild(div);
    }
  }

  const input = document.getElementById('asel-input');
  if (input) {
    let debounceT = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceT);
      debounceT = setTimeout(() => aselSearch(input.value), 350);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        clearTimeout(debounceT);
        const first = document.querySelector('#asel-results .asel-res-row');
        if (first) first.click(); else aselSearch(input.value);
      }
    });
  }

  const skip = document.getElementById('asel-skip');
  if (skip) skip.addEventListener('click', e => { e.preventDefault(); aselPickPreset('EPWR'); });
}
aselMount();
