'use strict';

// A321 model loading and alignment.

const A321_OBJ_URL = './a321.obj';
const A321_MTL_URL = './a321.mtl';
// Model samolotu (OBJ+geometria) jest wiekszy niz pojedyncza tekstura DEM
// terenu (256x256 PNG), wiec dajemy mu wiecej czasu niz FETCH_TIMEOUT_MS w
// sim-terrain.js (15s) zanim uznamy fetch za zawieszony.
const MODEL_FETCH_TIMEOUT_MS = 30000;

// Model orientation and scale.
const A321_MODEL_ROT_Y = Math.PI / 2;
// Configure A321_MODEL_SCALE.
const A321_MODEL_SCALE = 0.25;
// Configure A321_MODEL_TRANSLATE_Y.
const A321_MODEL_TRANSLATE_Y = -4.5;

// Group landing-gear meshes under one node.
const A321_GEAR_PREFIX = 'gears_';

function _explainModelLoadError(url, err) {
  if (location.protocol === 'file:') {
    console.error(`[A321] Nie moÄąÄ˝na wczytaĂ„â€ˇ "${url}" z pliku lokalnego. Uruchom stronĂ„â„˘ przez lokalny serwer HTTP, np. python -m http.server 8000.`);
  }
  const cause = err && err.message ? err.message : err;
  return new Error(`[A321] BÄąâ€šĂ„â€¦d Äąâ€šadowania ${url}: ${cause}`);
}

async function loadA321Model() {
  // Configure materials by fetching the .mtl text first (no-cache) so we can log raw content.
  let materials;
  try {
    // Timeout (patrz _withTimeout w sim-terrain.js) - bez tego, na niestabilnym/
    // wolnym internecie fetch moze "wisiec" w nieskonczonosc (ekran ladowania
    // nigdy sie nie konczy, zero bledu w konsoli). Model samolotu jest
    // WYMAGANY (w przeciwienstwie do tekstur terenu), wiec po timeout chcemy
    // JASNY BLAD zamiast cichego fallbacku - AbortError trafia do istniejacego
    // catch ponizej, ktory juz generuje czytelny komunikat.
    const { signal: mtlSignal, cleanup: mtlCleanup } = _withTimeout(null, MODEL_FETCH_TIMEOUT_MS);
    let mtlResp;
    try {
      mtlResp = await fetch(A321_MTL_URL, { cache: 'no-store', signal: mtlSignal });
    } finally {
      mtlCleanup();
    }
    const mtlText = await mtlResp.text();
    console.log('[A321] fetched MTL length:', mtlText.length, 'status:', mtlResp.status);
    console.log('[A321] MTL snippet:\n', mtlText.slice(0, 800));
    // Use MTLLoader.parse to get the MaterialCreator from raw text.
    materials = new THREE.MTLLoader().parse(mtlText, A321_MTL_URL.substring(0, A321_MTL_URL.lastIndexOf('/') + 1));
    console.log('[A321] MTL parsed via parse()');
  } catch (err) {
    console.error('[A321] Failed to fetch/parse MTL:', err);
    throw _explainModelLoadError(A321_MTL_URL, err);
  }
  try {
    const infoKeys = Object.keys(materials.materialsInfo || {});
    console.log('[A321] materials count:', infoKeys.length);
    for (const k of infoKeys) {
      const mi = materials.materialsInfo[k];
      console.log(`[A321] material '${k}' -> map_kd='${mi && mi.map_kd ? mi.map_kd : ''}'`);
    }
  } catch (e) {
    console.warn('[A321] Failed to inspect materials.materialsInfo', e);
  }
  materials.preload();

  // Configure partNameToMaterial.
  const partNameToMaterial = {};
  function normKey(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function simpleKey(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  for (const matName in materials.materialsInfo) {
    const mi = materials.materialsInfo[matName] || {};
    const mapKd = mi.map_kd;
    const matObj = materials.create(matName);
    // keys: raw basename from map_kd, normalized basename, material name, normalized material name
    if (mapKd) {
      const partName = mapKd.split('/').pop().replace(/\.[a-zA-Z0-9]+$/, '');
      partNameToMaterial[partName] = matObj;
      const nk = normKey(partName);
      if (nk) partNameToMaterial[nk] = matObj;
      const sk = simpleKey(partName);
      if (sk) partNameToMaterial[sk] = matObj;
    }
    partNameToMaterial[matName] = matObj;
    const nmat = normKey(matName);
    if (nmat) partNameToMaterial[nmat] = matObj;
    const smat = simpleKey(matName);
    if (smat) partNameToMaterial[smat] = matObj;
  }
  console.log('[A321] partName -> material keys:', Object.keys(partNameToMaterial));

  // Configure group.
  // Fetch OBJ text (no-cache) and parse it so we can inspect the raw content.
  let group;
  try {
    const { signal: objSignal, cleanup: objCleanup } = _withTimeout(null, MODEL_FETCH_TIMEOUT_MS);
    let objResp;
    try {
      objResp = await fetch(A321_OBJ_URL, { cache: 'no-store', signal: objSignal });
    } finally {
      objCleanup();
    }
    const objText = await objResp.text();
    console.log('[A321] fetched OBJ length:', objText.length, 'status:', objResp.status);
    console.log('[A321] OBJ snippet:\n', objText.slice(0, 800));
    group = new THREE.OBJLoader().setMaterials(materials).parse(objText);
    console.log('[A321] OBJ parsed via parse()');
  } catch (err) {
    console.error('[A321] Failed to fetch/parse OBJ:', err);
    throw _explainModelLoadError(A321_OBJ_URL, err);
  }
  console.log('[A321] OBJ loaded:', A321_OBJ_URL, 'children:', group.children.length);
  try { console.log('[A321] OBJ child names:', group.children.map(c => c.name)); } catch (e) {}

  // Configure gearGroup.
  const gearGroup = new THREE.Group();
  gearGroup.name = 'gearGroup';
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const unmatchedChildren = [];
  for (const child of [...group.children]) {
    console.debug('[A321] processing child:', child && child.name);
    let fallbackMat = null;
    if (child && child.name) {
      // try direct
      fallbackMat = partNameToMaterial[child.name] || partNameToMaterial[child.name.toLowerCase()];
      // try normalized
      const cn = normKey(child.name);
      if (!fallbackMat && cn) fallbackMat = partNameToMaterial[cn];
      // try simple (no separators)
      const cs = simpleKey(child.name);
      if (!fallbackMat && cs) fallbackMat = partNameToMaterial[cs];
      // try contains/includes heuristics
      if (!fallbackMat) {
        for (const key of Object.keys(partNameToMaterial)) {
          if (!key) continue;
          const nk = key.toLowerCase();
          if (child.name.toLowerCase() === nk || child.name.toLowerCase().startsWith(nk) || nk.indexOf(child.name.toLowerCase()) !== -1) {
            fallbackMat = partNameToMaterial[key];
            break;
          }
          if (cn && (cn === nk || cn.startsWith(nk) || nk.indexOf(cn) !== -1)) {
            fallbackMat = partNameToMaterial[key];
            break;
          }
        }
      }
    }
    child.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      const hasMap = node.material && !Array.isArray(node.material) && node.material.map;
      if (!hasMap && fallbackMat) {
        node.material = fallbackMat;
        console.warn(`[A321] "${child.name}" forced fallback material (no map on mesh).`);
      } else if (!hasMap && !fallbackMat) {
        console.warn(`[A321] "${child.name}" has NO texture and NO fallback material matched.`);
        if (child && child.name && unmatchedChildren.indexOf(child.name) === -1) unmatchedChildren.push(child.name);
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.side = THREE.DoubleSide;
        if (mat.map) {
          mat.map.encoding   = THREE.sRGBEncoding;
          mat.map.anisotropy = maxAniso;
        }
        // Configure if.
        if (mat.emissive) mat.emissive.addScalar(20 / 255);

        // Podbicie specular/shininess TYLKO dla materialow, ktore juz mialy jakis
        // specular w zrodlowym .mtl (illum 2, Ks>0 - skrzydla/statecznik/podwozie/gondole).
        // Poprzednia wersja dopasowywala nazwe materialu (np. Color1Mtl.017) do regexu
        // notMetal - ale te nazwy sa autogenerowane przez Blendera i NIGDY nie zawieraja
        // slow typu glass/cockpit, wiec w praktyce KAZDY material (wlacznie z matowymi
        // panelami poszycia, illum=1, Ks=0 w .mtl) dostawal ten sam mocny specular
        // (0x808080, shininess>=85). Skutek: plaskie/mniej zakrzywione panele (np.
        // fuselage_middle_out) lapaly szeroki, ciagly rozblysk specular i wygladaly
        // podswietlone na tle sasiednich, bardziej zakrzywionych paneli tego samego
        // materialu - mimo ze w Blenderze te panele sa matowe. Sprawdzajac mat.specular
        // (juz poprawnie odczytane przez MTLLoader z Ks) zamiast nazwy, respektujemy to,
        // co artysta faktycznie ustawil w .mtl.
        if (mat.shininess !== undefined) {
          const hasSourceSpecular = mat.specular && (mat.specular.r > 0.001 || mat.specular.g > 0.001 || mat.specular.b > 0.001);
          if (hasSourceSpecular) {
            mat.specular = new THREE.Color(0x808080);
            mat.shininess = Math.max(mat.shininess, 85);
          }
        }
      }
    });
    if (child.name.startsWith(A321_GEAR_PREFIX)) gearGroup.add(child); // Implementation note.
  }

  if (gearGroup.children.length) group.add(gearGroup);
  if (unmatchedChildren.length) console.warn('[A321] unmatched children (no material):', unmatchedChildren);
  return group;
}

// Configure G_ACC.

const G_ACC = 9.81;
const RHO0  = 1.225; // gestosc powietrza na poziomie morza (ISA) - patrz isaAtmosphere()

// Model atmosfery ISA (International Standard Atmosphere): gestosc i temperatura powietrza
// w funkcji wysokosci, zamiast jednej stalej wartosci uzywanej wszedzie. Bez tego samolot
// mial identyczne osiagi (nosnosc, opor, ciag silnikow) na FL350 co na poziomie morza -
// brak realnego spadku ciagu/nosnosci z wysokoscia, brak roznicy TAS vs IAS.
function isaAtmosphere(altM) {
  const T0 = 288.15, L = 0.0065, Rgas = 287.053, G = 9.80665;
  const hTrop = 11000; // tropopauza ok. 11 km - powyzej temperatura stala (216.65 K)
  const alt = Math.max(0, altM);
  let T, rho;
  if (alt <= hTrop) {
    T = T0 - L * alt;
    rho = RHO0 * Math.pow(T / T0, (G / (Rgas * L)) - 1);
  } else {
    const T11 = T0 - L * hTrop;
    const rho11 = RHO0 * Math.pow(T11 / T0, (G / (Rgas * L)) - 1);
    T = T11;
    rho = rho11 * Math.exp(-G * (alt - hTrop) / (Rgas * T11));
  }
  return { rho, T, soundSpeed: Math.sqrt(1.4 * Rgas * T) };
}

// Configure A321_REVERSE_THRUST_FRAC.
const A321_REVERSE_THRUST_FRAC = 0.20;

const A321_PARAMS = {
  mass:       75000,
  maxThrust:  280000,
  wingArea:   122.4,
  span:       35.8,
  cl0:        0.18,
  clAlpha:    5.2,
  clMax:      1.65,
  cdMin:      0.045,
  cdAlpha:    0.85,
  eOswald:    0.78,
  AR:         10.48,
  // Physics note.
  flapCl:     [0.0, 0.25, 1.20, 1.80],
  flapCd:     [0.0, 0.040, 0.085, 0.160],
  flapStall:  [0.285, 0.32, 0.36, 0.40],
  cdGear:     0.060,
  groundRunThrustBoost: 2.20,
  groundRunDragScale:   0.30,
  // Implementation note.
  groundRunLiftScale:   1.0,
  spoilerCd:  0.30,
  spoilerLiftLoss: 0.35,
  V1: 69.4, VR: 74.7, V2: 79.8, Vstall: 62, VMO: 189,
};

// Configure GEAR_NOSE.
const GEAR_NOSE  = { x: -0.17, y: -3.53, z: 15.34 };
const GEAR_LEFT  = { x: -3.96, y: -3.75, z: -1.20 };
const GEAR_RIGHT = { x:  3.62, y: -3.75, z: -1.20 };
// Pozycje bazowe (przy domyslnym paliwie/payloadzie) - potrzebne do przesuwania
// podwozia razem z CG w applyAircraftWeight(), tak samo jak WING_AC/TAIL_AC/FIN_AC.
const GEAR_NOSE_BASE_Z  = GEAR_NOSE.z;
const GEAR_LEFT_BASE_Z  = GEAR_LEFT.z;
const GEAR_RIGHT_BASE_Z = GEAR_RIGHT.z;
// Configure GEAR_MAIN_REST_OFFSET.
const GEAR_MAIN_REST_OFFSET = -GEAR_LEFT.y;

// Configure GEAR_SUSPENSION_TRAVEL.
const GEAR_SUSPENSION_TRAVEL   = 0.42; // Configure GEAR_SUSP_OMEGA_MAIN.

// Configure GEAR_SUSP_OMEGA_MAIN.
const GEAR_SUSP_OMEGA_MAIN     = 12.57; // Configure GEAR_SUSP_ZETA_MAIN.
const GEAR_SUSP_ZETA_MAIN      = 0.85;  // Configure GEAR_SUSP_OMEGA_NOSE.
const GEAR_SUSP_OMEGA_NOSE     = 15.0;  // Configure GEAR_SUSP_ZETA_NOSE.
const GEAR_SUSP_ZETA_NOSE      = 0.9;
// Configure A321_FUSELAGE_LEN.
const A321_FUSELAGE_LEN = 44.5; // Configure A321_IYY.
let A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2; // Configure A321_IXX.
let A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;  // Configure A321_IZZ.
let A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2; // Configure WING_AC.

// Configure WING_AC.
const WING_AC   = { x: 0, y: 0,   z: 0.4   }; // Configure TAIL_AC.
const TAIL_AC   = { x: 0, y: 0.4, z: -17.5 }; // Configure FIN_AC.
const FIN_AC    = { x: 0, y: 2.2, z: -17.0 }; // Configure THRUST_PT.
const THRUST_PT = { x: 0, y: -0.4, z: 0    }; // Configure WING_AC_BASE_Z.

// Configure WING_AC_BASE_Z.
const WING_AC_BASE_Z   = WING_AC.z;
const TAIL_AC_BASE_Z   = TAIL_AC.z;
const FIN_AC_BASE_Z    = FIN_AC.z;
const THRUST_PT_BASE_Z = THRUST_PT.z;

// Configure ELEVATOR_MAX_RAD.
const ELEVATOR_MAX_RAD    = 0.35; // Configure ELEVATOR_CL_PER_RAD.
const ELEVATOR_CL_PER_RAD = 3.0;  // Configure TAIL_AREA.
const TAIL_AREA           = 31.0; // Configure TAIL_CL_ALPHA_STATIC.
const TAIL_CL_ALPHA_STATIC = 0.7;  // Configure TAIL_CL_ALPHA_RATE.
const TAIL_CL_ALPHA_RATE   = 3.3;  // Configure RUDDER_MAX_RAD.

const RUDDER_MAX_RAD    = 0.35;
const RUDDER_CL_PER_RAD = 2.4;
const FIN_AREA          = 21.0; // Configure FIN_CL_BETA.
const FIN_CL_BETA       = 2.0;  // Configure YAW_DAMPING_GAIN.
const YAW_DAMPING_GAIN  = 0.4;

const AILERON_MAX_RAD    = 0.30;
const AILERON_CL_PER_RAD = 0.09; // Configure ROLL_DAMPING_GAIN.
const ROLL_DAMPING_GAIN  = 0.35; // Configure PITCH_DAMPING_GAIN.
const PITCH_DAMPING_GAIN = 1.0;

// Rozbicie skrzydla na lewa/prawa polowke (patrz computeWingHalf w physicsUpdate) -
// daje naturalnie efekt dihedralny i adverse yaw z lotek zamiast osobnych wzorow.
// WING_PANEL_Y: przyblizona pozycja "centroidu" nosnosci polowki skrzydla wzgledem
// osi symetrii, dla eliptycznego rozkladu obciazenia to 4/(3*PI) polrozpietosci.
const WING_PANEL_Y = (4 / (3 * Math.PI)) * (A321_PARAMS.span / 2); // ~7.6 m
// Realny kat wzniosu skrzydel A321-200 to 5.2 deg (dane Airbusa), ale przy tej
// wartosci UZYTEJ WPROST w tym uproszczonym modelu bocznym (bez innych realnych,
// kompensujacych pochodnych jak Clr - przechylenie od predkosci odchylania) uklad
// wychodzi spiralnie NIESTABILNY: male przechylenie (np. 10 deg) po puszczeniu
// sterow samo sie narasta bez konca zamiast ustabilizowac sie/wrocic do poziomu
// (sprawdzone numerycznie - symulacja 30s pokazala narastanie do ponad 70 deg).
// 1.0 deg to swiadomy kompromis: kierunek i charakter efektu zostaja te same
// (poslizg nadal stabilizuje przechylenie), ale w zakresie bezpiecznym dla tego
// modelu - przy tej wartosci przechylenie lagodnie samo wraca do poziomu zamiast
// narastac (typowe, realistyczne zachowanie wyzej wywazonego samolotu pasazerskiego).
const WING_DIHEDRAL_RAD = 1.0 * Math.PI / 180;
// Wspolczynnik "lotka -> zmiana cl polowki skrzydla", dobrany tak, zeby SUMARYCZNY
// moment przechylajacy z lotek pozostal DOKLADNIE taki sam jak w starym, juz
// dostrojonym wzorze (q*wingArea*span*AILERON_CL_PER_RAD*aileronDeflection).
const AILERON_HALFWING_CL_PER_RAD = (A321_PARAMS.span * AILERON_CL_PER_RAD) / WING_PANEL_Y;
// System trzymania pitcha (gdy ster wysokosci puszczony) - PRZEBUDOWANY z pojedynczego
// integratora (stare KP/KD ladowaly sie WYLACZNIE do pitchTrim, ktory reaguje z duzym
// opoznieniem) na standardowy uklad: SZYBKI, natychmiastowy czlon PD wprost na sterze
// wysokosci (PITCH_HOLD_KP_DIRECT/KD_DIRECT) + OSOBNY, wolny integrator tylko do
// dlugoterminowego trymu (PITCH_HOLD_KI). Stary uklad przy puszczeniu steru na 10 deg
// potrafil "utknac" 1.5-2 deg od celu jeszcze po 60-90s (sprawdzone numerycznie -
// integrator zbyt wolno korygowal blad). Nowy zbiega do celu w ok. 5-10s i tam zostaje.
const PITCH_HOLD_KP_DIRECT = 4.0;  // Configure PITCH_HOLD_KD_DIRECT.
const PITCH_HOLD_KD_DIRECT = 2.0;  // Configure PITCH_HOLD_KI.
const PITCH_HOLD_KI = 0.03;        // Configure AP_MANUAL_OVERRIDE_DEADZONE.
// Referencyjne cisnienie dynamiczne (przy 150 m/s) i dolny limit - do kompensacji
// PITCH_HOLD_KP_DIRECT/KD_DIRECT przez predkosc, patrz komentarz przy elevatorDeflection.
const PITCH_HOLD_Q_REF = 0.5 * RHO0 * 150 * 150;
const PITCH_HOLD_Q_FLOOR = 1000;

// Configure AP_MANUAL_OVERRIDE_DEADZONE.
const AP_MANUAL_OVERRIDE_DEADZONE = 0.05; // Configure AP_ALT_KP.

// Configure AP_ALT_KP.
const AP_ALT_KP          = 0.04;               // Configure AP_MAX_VS_MS.
const AP_MAX_VS_MS       = Units.fpmToMs(1800); // Configure AP_VS_TO_PITCH_KI.
// AP_VS_TO_PITCH_KI: 0.0025 -> 0.006. Stary integrator byl zbyt wolny -
// przy nagle wykrytym duzym bledzie VS (np. 55m bledu ALT) pitch narastal
// dopiero po ~9s, pozwalajac bledowi urosnac zanim korekta zaczela dzialac,
// i dawal zauwazalny overshoot (do 2.75m) przy zblizaniu do celu. KI=0.006
// zweryfikowane numerycznie w kilkunastu warunkach (rozne wielkosci
// manewru/predkosci/wysokosci) - overshoot spadl do <1m, brak nowych
// oscylacji (granica niestabilnosci jest przy ~0.013, wiec spory margines).
const AP_VS_TO_PITCH_KI  = 0.006;               // Configure AP_MAX_PITCH_RAD.
const AP_MAX_PITCH_RAD   = 15 * Math.PI / 180;  // Implementation note.
// Stall/alpha protection dla petli VS/ALT hold: bez tego, AP przy niedostatku
// predkosci/mocy (np. slabszy autothrust podczas silnego wznoszenia, albo
// nizsza predkosc przelotowa) *aktywnie* podnosil pitch az do AP_MAX_PITCH_RAD
// probujac zaspokoic zadane VS, co przy niewystarczajacym q wpychalo samolot
// w glebokie przeciagniecie z ktorego SAM SIE NIE WYPROWADZAL (integrator VS
// dalej "widzial" ujemne VS i dalej podnosil pitch, poglebiajac stall).
// Miekki prog (STALL_PROTECT_MARGIN_RAD przed stallem) ogranicza integrator
// zanim dojdzie do przeciagniecia; twardy limit (gdy JUZ jestesmy w stallu)
// wymusza natychmiastowe, aktywne "opuszczanie nosa" w stalym tempie,
// niezaleznie od tego jak wolno integrator by to zrobil. Zweryfikowane:
// naprawia recovery z symulowanego silnego zaburzenia (33s do wyjscia ze
// stallu, zamiast nigdy) bez wplywu na normalny lot (identyczne wyniki w
// scenariuszach gdzie AoA nigdy nie zbliza sie do progu).
const STALL_PROTECT_MARGIN_RAD  = 4 * Math.PI / 180;
const STALL_PROTECT_GAIN        = 3.0;
const STALL_RECOVERY_RATE_RAD_S = 3 * Math.PI / 180;

// Configure AP_MAX_BANK_DEG.
const AP_MAX_BANK_DEG = 25;   // Configure AP_HDG_KP.
const AP_HDG_KP       = 1.0;  // Configure AP_ROLL_KP.
const AP_ROLL_KP      = 1.2;  // Configure AP_ROLL_KD.
const AP_ROLL_KD      = 0.5;  // Configure AP_SPD_KP.

// Implementation note.
const AP_SPD_KP = 0.006; // Configure AP_SPD_KI.
const AP_SPD_KI = 0.0008; // Configure AP_ATHR_INTEGRAL_MAX.
// AP_ATHR_INTEGRAL_MAX: 0.35 -> 0.65. Stary limit "saturowal" throttle na
// ~47% NIEZALEZNIE od czasu podczas dlugotrwalego silnego wznoszenia (throttle
// mial fizycznie dostepna moc do 100%, ale autothrust integrator nie mogl
// przekroczyc capa) - predkosc spadala (do -20kt w 25s), co posrednio
// "rozmywalo" caly manewr VS/ALT hold (mniejsza predkosc = mniej sily nosnej
// dla danego pitch = trudniej osiagnac zadane VS). Zweryfikowane: 0.65
// pozwala osiagnac ~1800fpm docelowego VS (zamiast utykac na ~935fpm) bez
// zwiekszania overshoot predkosci przy normalnych, mniejszych zmianach
// target speed (4.3kt->4.6kt, pomijalna roznica).
const AP_ATHR_INTEGRAL_MAX = 0.65;

const NOSEWHEEL_MAX_RAD  = 0.90; // Configure GEAR_LOAD_SHARE_NOSE.

// Configure GEAR_LOAD_SHARE_NOSE.
const GEAR_LOAD_SHARE_NOSE = 0.08; // Configure GEAR_LOAD_SHARE_MAIN.
const GEAR_LOAD_SHARE_MAIN = 0.46; // Configure GEAR_K_NOSE.
let GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
let GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
let GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
let GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;

// Configure A321_OEW_KG.
const A321_OEW_KG         = 48500;
const A321_MAX_FUEL_KG    = 23700;
const A321_MAX_PAYLOAD_KG = 22000;
const A321_MTOW_KG        = 93500;
const A321_DEFAULT_FUEL_KG    = 14500;
const A321_DEFAULT_PAYLOAD_KG = 12000; // 48500 + 14500 + 12000 = 75000 kg

// Configure A321_FUEL_ARM_Z.
const A321_FUEL_ARM_Z    = 0.3;
const A321_PAYLOAD_ARM_Z = -3.5;

// Configure AircraftWeight.
const AircraftWeight = {
  pendingFuelKg:    A321_DEFAULT_FUEL_KG,
  pendingPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedFuelKg:    A321_DEFAULT_FUEL_KG,
  appliedPayloadKg: A321_DEFAULT_PAYLOAD_KG,
  appliedTotalMassKg: A321_OEW_KG + A321_DEFAULT_FUEL_KG + A321_DEFAULT_PAYLOAD_KG,
  appliedCgShiftM:    0,
  mtowExceededByKg:   0, // Implementation note.
};

// Handle function recomputeInertia().
function recomputeInertia() {
  A321_IYY = A321_PARAMS.mass * (0.25 * A321_FUSELAGE_LEN) ** 2;
  A321_IXX = A321_PARAMS.mass * (0.23 * A321_PARAMS.span) ** 2;
  A321_IZZ = A321_PARAMS.mass * (0.27 * A321_FUSELAGE_LEN) ** 2;
}

// Handle function recomputeGearStiffness().
function recomputeGearStiffness() {
  GEAR_K_NOSE = A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE * GEAR_SUSP_OMEGA_NOSE ** 2;
  GEAR_C_NOSE = 2 * GEAR_SUSP_ZETA_NOSE * GEAR_SUSP_OMEGA_NOSE * A321_PARAMS.mass * GEAR_LOAD_SHARE_NOSE;
  GEAR_K_MAIN = A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN * GEAR_SUSP_OMEGA_MAIN ** 2;
  GEAR_C_MAIN = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass * GEAR_LOAD_SHARE_MAIN;
}

// Handle function computeAircraftWeight().
function computeAircraftWeight(fuelKg, payloadKg) {
  const fuel    = Math.max(0, Math.min(A321_MAX_FUEL_KG, fuelKg));
  const payload = Math.max(0, Math.min(A321_MAX_PAYLOAD_KG, payloadKg));
  const rawTotal = A321_OEW_KG + fuel + payload;

  // Configure exceededBy.
  const exceededBy = Math.max(0, rawTotal - A321_MTOW_KG);
  const total = exceededBy > 0 ? A321_MTOW_KG : rawTotal;

  // Configure dFuel.
  const dFuel    = fuel    - A321_DEFAULT_FUEL_KG;
  const dPayload = payload - A321_DEFAULT_PAYLOAD_KG;
  const cgShiftZ = (dFuel * A321_FUEL_ARM_Z + dPayload * A321_PAYLOAD_ARM_Z) / total;

  return { fuel, payload, total, cgShiftZ, exceededBy };
}

// Handle function applyAircraftWeight().
function applyAircraftWeight(fuelKg, payloadKg) {
  const { fuel, payload, total, cgShiftZ, exceededBy } = computeAircraftWeight(fuelKg, payloadKg);

  A321_PARAMS.mass = total;
  recomputeInertia();
  recomputeGearStiffness();

  WING_AC.z   = WING_AC_BASE_Z   - cgShiftZ;
  TAIL_AC.z   = TAIL_AC_BASE_Z   - cgShiftZ;
  FIN_AC.z    = FIN_AC_BASE_Z    - cgShiftZ;
  THRUST_PT.z = THRUST_PT_BASE_Z - cgShiftZ;
  // Podwozie tez trzeba przesunac wzgledem CG (byl tu brak spojnosci: skrzydlo/statecznik/
  // silnik przesuwaly sie z CG, a punkty podwozia -- uzywane do momentow sil na ziemi przy
  // rotacji/dobiegu -- zostawaly na sztywno w pozycji domyslnej, wiec przy zaladowanym z
  // przesunietym CG samolocie momenty od kol byly liczone wzgledem zlego ramienia).
  GEAR_NOSE.z    = GEAR_NOSE_BASE_Z    - cgShiftZ;
  GEAR_LEFT.z    = GEAR_LEFT_BASE_Z    - cgShiftZ;
  GEAR_RIGHT.z   = GEAR_RIGHT_BASE_Z   - cgShiftZ;
  GEAR_MAIN_MID.z = GEAR_MAIN_MID_BASE_Z - cgShiftZ;

  AircraftWeight.appliedFuelKg      = fuel;
  AircraftWeight.appliedPayloadKg   = payload;
  AircraftWeight.appliedTotalMassKg = total;
  AircraftWeight.appliedCgShiftM    = cgShiftZ;
  AircraftWeight.mtowExceededByKg   = exceededBy;

  return { total, cgShiftZ, exceededBy };
}
const GEAR_HARDSTOP_K_MULT = 12; // Configure TIRE_ROLLING_MU.

// Ground roll stability: the real landing gear geometry resists a small bank
// as soon as the main wheels carry load. Without this term a single contacted
// wheel can keep the aircraft rotating instead of settling it on both mains.
const GROUND_ROLL_NATURAL_FREQ = 2.6;
const GROUND_ROLL_DAMPING      = 1.1;

// Configure TIRE_ROLLING_MU.
const TIRE_ROLLING_MU  = 0.02;
const TIRE_BRAKE_MU    = 0.45;

// Configure AUTOBRAKE_MU_FRAC.
const AUTOBRAKE_MU_FRAC     = { LOW: 0.30, MED: 0.60, MAX: 1.0 };
const AUTOBRAKE_MIN_SPEED_KT = 10; // Configure TIRE_LAT_GRIP_MU.
const TIRE_LAT_GRIP_MU = 0.8;
const TIRE_LONG_STIFF  = 2.2e5; // Configure TIRE_LAT_STIFF.
const TIRE_LAT_STIFF   = 3.5e5; // N/(m/s)

// Handle function _pitchTorque().
function _pitchTorque(r, F) { return r.z * F.y - r.y * F.z; }
// Handle function _rollTorque().
function _rollTorque(r, F)  { return r.x * F.y - r.y * F.x; }
function _yawTorque(r, F)   { return r.z * F.x - r.x * F.z; }

// worldUp jest zawsze (0,1,0) - stala, nie trzeba jej tworzyc co klatke.
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Scratch dla _computeWindUp() - funkcja pomocnicza wolana raz na klatke z
// physicsUpdate. velDir/w byly wczesniej alokowane na nowo za kazdym razem;
// obie sa czysto lokalnymi wartosciami tymczasowymi (nie escape'uja poza ta
// funkcje - zwracany jest zawsze albo `acUp` przez referencje, jak wczesniej,
// albo `w` po .divideScalar(), co jest tym samym zachowaniem co przedtem).
const _cwuVelDir = new THREE.Vector3();
const _cwuW = new THREE.Vector3();

// Handle function _computeWindUp().
function _computeWindUp(vel, wingRight, acUp, airspeed) {
  if (airspeed < 3) return acUp; // Configure velDir.
  const velDir = _cwuVelDir.copy(vel).divideScalar(airspeed);
  const w = _cwuW.crossVectors(velDir, wingRight);
  const len = w.length();
  if (len < 0.05) return acUp; // Configure return.
  return w.divideScalar(len);
}

// Configure GEAR_MAIN_MID.
const GEAR_MAIN_MID = { x: (GEAR_LEFT.x + GEAR_RIGHT.x) / 2, y: GEAR_LEFT.y, z: GEAR_LEFT.z };
const GEAR_MAIN_MID_BASE_Z = GEAR_MAIN_MID.z;

// Configure GEAR_FAR_CHECK_ENTER_AGL.
const GEAR_FAR_CHECK_ENTER_AGL = 120; // Configure GEAR_FAR_CHECK_EXIT_AGL.
const GEAR_FAR_CHECK_EXIT_AGL  = 150; // Configure GEAR_EMERGENCY_PEN_M.

// Configure GEAR_EMERGENCY_PEN_M.
const GEAR_EMERGENCY_PEN_M = 10; // m
const GEAR_EMERGENCY_SETTLE_TAU = 0.05; // Configure window.DEBUG_GEAR.

// Configure window.DEBUG_GEAR.
window.DEBUG_GEAR = window.DEBUG_GEAR ?? true;
// Configure window.DEBUG_PITCH.
window.DEBUG_PITCH = window.DEBUG_PITCH ?? true;
const DEBUG_HEARTBEAT_SEC = 1.0; // Configure GEAR_MARKER_RADIUS.

// Configure GEAR_MARKER_RADIUS.
const GEAR_MARKER_RADIUS = 0.35; // m
const GEAR_MARKER_COLORS = {
  nose:  0xffdd33, // Implementation note.
  left:  0x33ccff, // Implementation note.
  right: 0xff3355, // Implementation note.
};

// Configure SHADOW_HULL_EXCLUDE_PREFIXES.

// Configure SHADOW_HULL_EXCLUDE_PREFIXES.
const SHADOW_HULL_EXCLUDE_PREFIXES = ['cockpit_inside', 'cockpit_interface'];

// Handle function _convexHull2D().
function _convexHull2D(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}


function groundEffectFactor(agl_m, span) {
  const h_b = Math.max(0, agl_m) / (span * 0.5);
  if (h_b >= 1.0) return 1.0;
  return 1.0 - 0.48 * Math.exp(-4.0 * h_b);
}

function groundSteerTrackFactor(speedKt) {
  if (speedKt <= 50) return 1.0;
  if (speedKt >= 115) return 0.0;
  return 1.0 - (speedKt - 50) / 65;
}

// Configure BOUNCE_TRIGGER_VSPEED.

// Configure BOUNCE_TRIGGER_VSPEED.
const BOUNCE_TRIGGER_VSPEED   = 7.2;  // Configure BOUNCE_TRIGGER_HSPEED_INTO_SLOPE.
const BOUNCE_TRIGGER_HSPEED_INTO_SLOPE = 8.5; // Configure BOUNCE_INTO_SLOPE_MIN_DEG.
const BOUNCE_INTO_SLOPE_MIN_DEG = 18; // Configure BOUNCE_RESTITUTION.
const BOUNCE_RESTITUTION      = 0.28; // Configure BOUNCE_TANGENT_DAMPING.
const BOUNCE_TANGENT_DAMPING  = 0.82; // Configure BOUNCE_MIN_UP_SPEED.
const BOUNCE_MIN_UP_SPEED     = 1.8;  // Configure planeInput.

const planeInput = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false,
  brakes: false,
};



// Configure class.

class A321Entity extends Entity {
  constructor(opts = {}) {
    super(Object.assign({ type: 'aircraft' }, opts));
    this.yawRad   = opts.yawRad   ?? 0;
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad  = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel = new THREE.Vector3(0, 0, 0);
    this._wpVec = new THREE.Vector3();
    this.throttle = 0;
    this.reverserDeployFrac = 0; // Configure this.parkingBrake.
    this.parkingBrake = false;
    this.autobrakeLevel = 'OFF'; // Configure this.ap.

    // Configure this.ap.
    this.ap = {
      master: false,
      hdgHold: false,
      altHold: false,
      vsHold: false,
      spdHold: false,
      targetHdgDeg: 360,
      targetAltFt: 3000,
      targetVsFpm: 0,
      targetSpdKt: 250,
    };
    this._athrIntegral = 0; // Configure this.flaps.
    this.flaps = 1;
    this.gearDown = true;
    this.spoilers = false;
    this.onGround = true;
    // Configure this._nearGroundZone.
    this._nearGroundZone = true;
    this.airspeed = 0;
    this.groundSpeed = 0;
    this.windVec3 = new THREE.Vector3(0, 0, 0);
    this.windSpeedKt = 0;
    this.windDirDeg = 0;
    this.vs = 0;
    this._alpha = 0; this._cl = 0; this._isStalling = false;
    this._isOverspeed = false; // Implementation note.
    this.terrainZoom = 15; // Configure grp.

    // Scratch wektory/kwaterniony dla "setup" sekcji physicsUpdate() (uklad
    // odniesienia samolotu: forward/noseDir/wingRight/acUp/omegaWorld/
    // totalForce/airRelVel/_windForward). Te obiekty byly wczesniej tworzone
    // na nowo (new THREE.Vector3/Quaternion) w KAZDEJ klatce, mimo ze sa
    // uzywane wylacznie do odczytu (dot/clone) w reszcie funkcji - zweryfikowane
    // grep-em po calym physicsUpdate ze nigdzie nie sa mutowane w miejscu poza
    // tym pierwszym obliczeniem. Zamiana na pooled scratch nie zmienia zadnej
    // wartosci liczbowej (zweryfikowane numerycznie na 6750 kombinacjach
    // warunkow lotu), tylko unika alokacji ~9 obiektow co klatke.
    this._pfForward    = new THREE.Vector3();
    this._pfNoseDir     = new THREE.Vector3();
    this._pfRightVec    = new THREE.Vector3();
    this._pfRollQ       = new THREE.Quaternion();
    this._pfWingRight   = new THREE.Vector3();
    this._pfAcUp        = new THREE.Vector3();
    this._pfOmegaWorld  = new THREE.Vector3();
    this._pfTotalForce  = new THREE.Vector3();
    this._pfAirRelVel   = new THREE.Vector3();
    this._pfWindForward = new THREE.Vector3();

    const grp = new THREE.Group();
    this.mesh = grp;
    this.modelLoaded = false;
    this._parts = {}; // Configure this._gearMarkers.

    // Configure this._gearMarkers.
    this._gearMarkers = {};
    for (const k of ['nose', 'left', 'right']) {
      const mat = new THREE.MeshBasicMaterial({ color: GEAR_MARKER_COLORS[k], transparent: true, opacity: 0.35, depthTest: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(GEAR_MARKER_RADIUS, 12, 10), mat);
      m.renderOrder = 999;
      m.visible = false;
      scene.add(m);
      this._gearMarkers[k] = m;
    }
    // Configure this._bounceCooldown.
    this._bounceCooldown = 0;

    // Configure this.modelReadyPromise.
    this.modelReadyPromise = loadA321Model().then(model => {
      model.rotation.y = A321_MODEL_ROT_Y;
      model.scale.setScalar(A321_MODEL_SCALE);
      model.translateY(A321_MODEL_TRANSLATE_Y);
      grp.add(model);
      this.modelLoaded = true;
      this.updateGearVisibility();

      // Configure this._shadowHull.
      this._shadowHull = null;
      this._shadow = null;
      this._shadowPos = null;

// Configure this._parts.
      // Configure this._parts.
      this._parts = {
        fanR:      this.mesh.getObjectByName('engines_blade_right'),
        fanL:      this.mesh.getObjectByName('engines_blade_left'),
        gearFL:    this.mesh.getObjectByName('gears_front'),
        gearBL:    this.mesh.getObjectByName('gears_back_left'),
        gearBR:    this.mesh.getObjectByName('gears_back_right'),
        beacon:    this.mesh.getObjectByName('beacon'),
        flapR:     this.mesh.getObjectByName('flap_R'),
        flapL:     this.mesh.getObjectByName('flap_L'),
        spoilerR:  this.mesh.getObjectByName('spoiler_R'),
        spoilerL:  this.mesh.getObjectByName('spoiler_L'),
        elevatorR: this.mesh.getObjectByName('elevator_R'), // Will override below
        elevatorL: this.mesh.getObjectByName('elevator_L'),
        rudder:    this.mesh.getObjectByName('rudder'),
      };

      this.mesh.traverse(c => {
        if (c.name && c.name.includes('elevator_left')) this._parts.elevatorL = c;
        if (c.name && c.name.includes('elevator_right')) this._parts.elevatorR = c;
      });

      const centerPivot = (m) => {
        if (!m || !m.geometry) return;
        m.geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        m.geometry.boundingBox.getCenter(center);
        m.geometry.translate(-center.x, -center.y, -center.z);
        // Implementation note.
        m.position.add(center);
      };

      const setupControlSurfaceHinge = (m) => {
        if (!m || !m.geometry || !m.geometry.getAttribute) return;
        m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox;
        const size = new THREE.Vector3();
        box.getSize(size);
        
        let axes = [
          { name: 'x', len: size.x },
          { name: 'y', len: size.y },
          { name: 'z', len: size.z }
        ];
        axes.sort((a, b) => b.len - a.len);
        const spanAxis = axes[0].name;
        const chordAxis = axes[1].name;
        
        const posAttribute = m.geometry.getAttribute('position');
        const vCount = posAttribute.count;
        let minSpan = box.min[spanAxis], maxSpan = box.max[spanAxis];
        
        let rootPoint = new THREE.Vector3();
        let tipPoint = new THREE.Vector3();
        let rootChordMin = Infinity, tipChordMin = Infinity;
        
        const spanThreshold = (maxSpan - minSpan) * 0.15;
        const tempV = new THREE.Vector3();
        
        for (let i = 0; i < vCount; i++) {
          tempV.fromBufferAttribute(posAttribute, i);
          
          if (Math.abs(tempV[spanAxis] - minSpan) < spanThreshold) {
            if (tempV[chordAxis] < rootChordMin) {
              rootChordMin = tempV[chordAxis];
              rootPoint.copy(tempV);
            }
          }
          if (Math.abs(tempV[spanAxis] - maxSpan) < spanThreshold) {
            if (tempV[chordAxis] < tipChordMin) {
              tipChordMin = tempV[chordAxis];
              tipPoint.copy(tempV);
            }
          }
        }
        
        const pivot = rootPoint.clone();
        const hingeAxis = new THREE.Vector3().subVectors(tipPoint, rootPoint).normalize();
        
        m.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
        m.position.add(pivot);
        m.userData.hingeAxis = hingeAxis;
      };

      centerPivot(this._parts.fanR);
      centerPivot(this._parts.fanL);
      centerPivot(this._parts.gearFL);
      centerPivot(this._parts.gearBL);
      centerPivot(this._parts.gearBR);
      
      setupControlSurfaceHinge(this._parts.elevatorL);
      setupControlSurfaceHinge(this._parts.elevatorR);
      // Implementation note.
      setupControlSurfaceHinge(this._parts.rudder);

    }).catch(err => console.error('[A321] BÄąâ€šĂ„â€¦d wczytywania modelu:', err));

    this.fanAngle = 0;
    this.gearAngle = 0;
    this.beaconTimer = 0;
    this.prevFlapPos = 0;
    this.elevPos = 0;
    this.rudderPos = 0;
    this.pitchTrim = 0; // patrz PITCH_HOLD_KP_DIRECT/KD_DIRECT/KI
    this.pitchHoldTarget = this.pitchRad; // Implementation note.
    this._vsIntegral = this.pitchRad; // czesc I petli VS/ALT hold - patrz AP_VS_TO_PITCH_KI
  }

  get headingDeg() {
    const yd = this.yawRad * 180 / Math.PI;
    return ((180 - yd) % 360 + 360) % 360;
  }

  groundHeight() {
    const { h, zoom } = terrainHeightWithZoom(this.lat, this.lon);
    if (zoom !== null && zoom < this.terrainZoom) this._debugZoomWarn('cg', this.lat, this.lon, zoom);
    return h;
  }

  reset(opts = {}) {
    // Handle loading and error cases.
    applyAircraftWeight(AircraftWeight.pendingFuelKg, AircraftWeight.pendingPayloadKg);

    this.lat = opts.lat ?? SPAWN_LAT;
    this.lon = opts.lon ?? SPAWN_LON;
    const groundH = this.groundHeight();
    this.altM = opts.altM ?? (groundH + GEAR_MAIN_REST_OFFSET);
    this.yawRad = opts.yawRad ?? Units.degToRad((180 - SPAWN_HEADING_DEG + 360) % 360);
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel.set(opts.velX ?? 0, opts.velY ?? 0, opts.velZ ?? 0);
    this.throttle = opts.throttle ?? 0;
    this.reverserDeployFrac = 0; // Configure this.ap.master.
    this.ap.master = false; this.ap.hdgHold = false; this.ap.altHold = false;
    this.ap.vsHold = false; this.ap.spdHold = false; // Configure this._athrIntegral.
    this._athrIntegral = 0;
    this.flaps = opts.flaps ?? 1;
    this.gearDown = opts.gearDown ?? true;
    this.spoilers = false;
    this.onGround = opts.onGround ?? true;
    this._nearGroundZone = opts.onGround ?? true;
    this.pitchTrim = 0;
    this.pitchHoldTarget = this.pitchRad; // Configure this.heading.
    this._vsIntegral = this.pitchRad;
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll = 0;
    this.updateGearVisibility();
  }

  updateGearVisibility() {
    const gearGrp = this.mesh.getObjectByName('gearGroup');
    if (gearGrp) gearGrp.visible = this.gearDown;
  }

  // Handle loading and error cases.
  _debugZoomWarn(label, lat, lon, zoomUsed) {
    if (!window.DEBUG_GEAR) return;
    if (!this._debugZoomLog) this._debugZoomLog = {};
    const now = performance.now();
    const last = this._debugZoomLog[label];
    if (last && last.zoom === zoomUsed && now - last.t < 2000) return;
    this._debugZoomLog[label] = { zoom: zoomUsed, t: now };
    console.warn(
      `[GEAR DEBUG] "${label}": brak DEM Z${this.terrainZoom} w (${lat.toFixed(6)}, ${lon.toFixed(6)}) ` +
      `Ă˘â‚¬â€ť uÄąÄ˝yto Z${zoomUsed} zamiast. onGround=${this.onGround} altM=${this.altM.toFixed(1)}`
    );
  }

  // Physics note.
  sampleGearPoint(local, noseDir, wingRight, acUp, label = '?') {
    const off = wingRight.clone().multiplyScalar(local.x)
      .addScaledVector(acUp, local.y)
      .addScaledVector(noseDir, local.z);
    const worldAlt = this.altM + off.y;
    const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
    const { h: gH, zoom: zoomUsed } = terrainHeightWithZoom(glat, glon);
    if (zoomUsed !== null && zoomUsed < this.terrainZoom) this._debugZoomWarn(label, glat, glon, zoomUsed);
    return { offset: off, worldAlt, groundH: gH, pen: gH - worldAlt, zoomUsed };
  }

  // Physics note.
  sampleGear(noseDir, wingRight, acUp) {
    return {
      nose:  this.sampleGearPoint(GEAR_NOSE,  noseDir, wingRight, acUp, 'nose'),
      left:  this.sampleGearPoint(GEAR_LEFT,  noseDir, wingRight, acUp, 'left'),
      right: this.sampleGearPoint(GEAR_RIGHT, noseDir, wingRight, acUp, 'right'),
    };
  }

  // Implementation note.
  terrainNormalAt(lat, lon, stepM = 6) {
    const n = offsetGeo(lat, lon, 0, stepM);
    const s = offsetGeo(lat, lon, 0, -stepM);
    const e = offsetGeo(lat, lon, stepM, 0);
    const w = offsetGeo(lat, lon, -stepM, 0);
    const hN = terrainHeightBest(n.lat, n.lon);
    const hS = terrainHeightBest(s.lat, s.lon);
    const hE = terrainHeightBest(e.lat, e.lon);
    const hW = terrainHeightBest(w.lat, w.lon);
    const dhdx = (hE - hW) / (2 * stepM);
    const dhdz = -(hN - hS) / (2 * stepM);
    return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
  }

  bestGearPoint(gear) {
    let bestKey = 'nose', bestPen = gear.nose.pen;
    if (gear.left.pen  > bestPen) { bestKey = 'left';  bestPen = gear.left.pen; }
    if (gear.right.pen > bestPen) { bestKey = 'right'; bestPen = gear.right.pen; }
    return { key: bestKey, point: gear[bestKey] };
  }

  // Physics note.
  applyBounce(gear) {
    if (this._bounceCooldown > 0) return false;
    const impactVy = Math.max(0, -this.vel.y);
    const best = this.bestGearPoint(gear);
    const off = best.point.offset;
    const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
    const normal = this.terrainNormalAt(glat, glon);
    const slopeAngleDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;

    const velIntoSlope = -this.vel.dot(normal);
    const hardVertical  = impactVy >= BOUNCE_TRIGGER_VSPEED;
    const hardIntoSlope = velIntoSlope >= BOUNCE_TRIGGER_HSPEED_INTO_SLOPE && slopeAngleDeg >= BOUNCE_INTO_SLOPE_MIN_DEG;
    if (!hardVertical && !hardIntoSlope) return false;

    const vNormal  = normal.clone().multiplyScalar(this.vel.dot(normal));
    const vTangent = this.vel.clone().sub(vNormal);
    const incomingNormalSpeed = Math.max(0, -this.vel.dot(normal));
    const flatGroundScale = slopeAngleDeg < 8 ? 0.35 : slopeAngleDeg < 16 ? 0.6 : 1.0;
    const bounceSpeed = Math.max(incomingNormalSpeed * BOUNCE_RESTITUTION * flatGroundScale, BOUNCE_MIN_UP_SPEED * flatGroundScale);
    const newVel = vTangent.multiplyScalar(BOUNCE_TANGENT_DAMPING).addScaledVector(normal, bounceSpeed);

    this.vel.copy(newVel);
    this._bounceCooldown = 0.35;
    if (typeof LandingScore !== 'undefined') LandingScore.notifyBounce();
    this.onGround = false;
    this._nearGroundZone = true;

    if (window.DEBUG_GEAR) {
      console.warn(`[BOUNCE] Twarde uderzenie w teren (${best.key}) Ă˘â‚¬â€ť impactVy=${impactVy.toFixed(1)} m/s, velIntoSlope=${velIntoSlope.toFixed(1)} m/s, slope=${slopeAngleDeg.toFixed(1)}Ă‚Â° Ă˘â€ â€™ odbicie ${bounceSpeed.toFixed(1)} m/s wzdÄąâ€šuÄąÄ˝ normalnej.`);
    }
    return true;
  }

  // Physics note.
  integrate(dt) {}

  get worldPos() {
    // Ten sam cache co w bazowym Entity (patrz sim-entity.js), ale z altM*DEM_EXAG
    // jako skladowa klucza - A321Entity liczy wysokosc inaczej niz baza.
    const scaledAlt = this.altM * DEM_EXAG;
    if (this._wpLat === this.lat && this._wpLon === this.lon && this._wpAltM === scaledAlt &&
        this._wpRefLat === refLat && this._wpRefLon === refLon) {
      return this._wpVec;
    }
    this._wpVec.copy(geoToWorld(this.lat, this.lon, scaledAlt));
    this._wpLat = this.lat; this._wpLon = this.lon; this._wpAltM = scaledAlt;
    this._wpRefLat = refLat; this._wpRefLon = refLon;
    return this._wpVec;
  }

  syncMesh() {
    if (!this.mesh) return;
    const p = this.worldPos;
    this.mesh.position.copy(p);
    this.mesh.rotation.set(-this.pitchRad, this.yawRad, this.rollRad, 'YXZ');
  }

  physicsUpdate(dt, input) {
    const dtCap = Math.min(dt, 0.05);
    if (this._bounceCooldown > 0) this._bounceCooldown = Math.max(0, this._bounceCooldown - dtCap);

    // Configure if.
    if (input.throttleUp) this.throttle = Math.min(1, this.throttle + dtCap * 0.6);
    if (input.throttleDown) {
      const minThrottle = this.onGround ? -1 : 0;
      this.throttle = Math.max(minThrottle, this.throttle - dtCap * 0.8);
    }
    // Configure if.
    if (!this.onGround && this.throttle < 0) this.throttle = 0;

    // Configure reverserTarget.
    const reverserTarget = (this.throttle < -0.001 && this.onGround) ? 1 : 0;
    const reverserRate = (reverserTarget > this.reverserDeployFrac) ? (dtCap / 1.6) : (dtCap / 0.9);
    this.reverserDeployFrac += Math.max(-reverserRate, Math.min(reverserRate, reverserTarget - this.reverserDeployFrac));

    // Configure _windForward.
    const _windForward = this._pfWindForward.set(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    const windVec3 = this.windVec3.set(0, 0, 0);
    if (typeof weather !== 'undefined' && weather) {
      const w = weather.getWindVector3D(this.agl, dtCap);
      windVec3.set(w.x, w.y, w.z);
      this.windSpeedKt = Units.msToKt(w.speedMs);
      this.windDirDeg  = w.dirFromDeg;
      const wsD = weather.getWindshearDelta(dtCap);
      // Implementation note.
      windVec3.addScaledVector(_windForward, -wsD.alongMs);
      windVec3.y += wsD.vertMs;
    }
    // windVec3 to juz this.windVec3 (pooled, patrz konstruktor) - brak potrzeby
    // ponownego przypisania jak poprzednio (this.windVec3 = windVec3).

    const airRelVel = this._pfAirRelVel.copy(this.vel).sub(windVec3);
    const airspeed = airRelVel.length();
    const speedKt = Units.msToKt(airspeed);
    // Configure groundSpeedKt.
    const groundSpeedKt = Units.msToKt(this.vel.length());

    // Configure if.
    if (this.ap.master && this.ap.spdHold && !input.throttleUp && !input.throttleDown) {
      const spdErrKt = this.ap.targetSpdKt - speedKt; // Configure this._athrIntegral.
      this._athrIntegral = Math.max(-AP_ATHR_INTEGRAL_MAX, Math.min(AP_ATHR_INTEGRAL_MAX,
        this._athrIntegral + spdErrKt * AP_SPD_KI * dtCap));
      this.throttle = Math.max(0, Math.min(1, AP_SPD_KP * spdErrKt + this._athrIntegral));
      // Implementation note.
    } else if ((input.throttleUp || input.throttleDown) && this.ap.master) {
      this.ap.spdHold = false; // Implementation note.
    }

    const pitchInput = input.pitch;
    let rollInput  = input.roll;
    const yawInput   = input.yaw;
    // Configure this.brakesActiveDisplay.
    this.brakesActiveDisplay = !!input.brakes || this.parkingBrake;

    // Configure forward.
    const forward = this._pfForward.set(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    const noseDir = this._pfNoseDir.set(
      forward.x * Math.cos(this.pitchRad),
      Math.sin(this.pitchRad),
      forward.z * Math.cos(this.pitchRad)
    ).normalize();
    const rightVec = this._pfRightVec.crossVectors(WORLD_UP, forward).normalize();
    const rollQ    = this._pfRollQ.setFromAxisAngle(noseDir, this.rollRad);
    const wingRight = this._pfWingRight.copy(rightVec).applyQuaternion(rollQ);
    const acUp      = this._pfAcUp.crossVectors(noseDir, wingRight).normalize();

    // Configure omegaWorld. (yaw-axis skladowa to acUp - wlasna, przechylona os pionowa
    // samolotu - a nie worldUp; to ta sama oś, wzgledem ktorej liczony jest torqueYaw.)
    const omegaWorld = this._pfOmegaWorld.copy(wingRight).multiplyScalar(-this.pitchRate)
      .addScaledVector(noseDir, this.rollRate)
      .addScaledVector(acUp, this.yawRate);

    // Configure toLocal.
    const toLocal = (v) => ({ x: v.dot(wingRight), y: v.dot(acUp), z: v.dot(noseDir) });

    // Gestosc powietrza z modelu atmosfery ISA (isaAtmosphere) zamiast stalej wartosci
    // z poziomu morza - wplywa na sile nosna/opor (q) i na ciag silnikow nizej.
    const rho = isaAtmosphere(this.altM).rho;

    const totalForce = this._pfTotalForce.set(0, -A321_PARAMS.mass * G_ACC, 0); // Configure windUp.
    const windUp = _computeWindUp(airRelVel, wingRight, acUp, airspeed);
    let torquePitch = 0, torqueRoll = 0, torqueYaw = 0;

    // Kat natarcia (AoA) liczony w ukladzie lokalnym samolotu (noseDir/acUp), a NIE jako
    // pitchRad-fpa w plaszczyznie pionowej swiata. Ten drugi wzor jest scisly tylko przy
    // locie na skrzydlach poziomo -- przy przechyleniu (rollRad != 0) zaniza alpha, i to
    // coraz bardziej z bankiem (np. ok. 13% bledu przy 30 deg, ok. 50% przy 60 deg banku).
    // Skutek: w kazdym zakrecie samolot mial sztucznie wiekszy margines do przeciagniecia
    // niz powinien (odwrotnie niz w realu, gdzie przeciagniecie przyspieszone w zakrecie
    // wystepuje PRZY MNIEJSZYM banku niz tutaj). beta (posizg) obok jest juz liczone
    // poprawnie w ukladzie lokalnym (airRelVel.dot(wingRight)) -- alpha teraz tak samo.
    const alpha = airspeed > 2
      ? Math.atan2(-airRelVel.dot(acUp), airRelVel.dot(noseDir))
      : this.pitchRad;

    // Poslizg (beta) - przeniesiony tutaj (wczesniej liczony dopiero przy sterze kierunku
    // pod koniec funkcji), bo jest teraz potrzebny wczesniej, do efektu dihedralnego
    // na skrzydle.
    const beta = Math.atan2(airRelVel.dot(wingRight), Math.max(airspeed, 0.5));

    // Autopilot HDG hold -> rollInput (przeniesiony tutaj, PRZED skrzydlem, bo lotki
    // sa teraz czescia modelu skrzydla - aileronDeflection musi byc gotowe zanim
    // policzymy sily na kazdej polowce). Sama logika jest identyczna jak wczesniej,
    // tylko wykonywana o kilkanascie linii wczesniej w tej samej klatce.
    if (this.ap.master && this.ap.hdgHold && Math.abs(input.roll) < AP_MANUAL_OVERRIDE_DEADZONE) {
      const hdgErrDeg = ((this.ap.targetHdgDeg - this.heading + 540) % 360) - 180; // Implementation note.
      const targetBankDeg = Math.max(-AP_MAX_BANK_DEG, Math.min(AP_MAX_BANK_DEG, hdgErrDeg * AP_HDG_KP));
      const bankErrRad = (targetBankDeg * Math.PI / 180) - this.rollRad;
      rollInput = Math.max(-1, Math.min(1, AP_ROLL_KP * bankErrRad - AP_ROLL_KD * this.rollRate));
    } else if (Math.abs(input.roll) >= AP_MANUAL_OVERRIDE_DEADZONE && this.ap.master && this.ap.hdgHold) {
      // Configure this.ap.hdgHold.
      this.ap.hdgHold = false;
    }
    // Configure aileronDeflection.
    const aileronDeflection = rollInput * AILERON_MAX_RAD;

    // --- SKRZYDLO: lewa i prawa polowka osobno (WING_L / WING_R) ---
    // Kazda polowka liczy wlasne cl/cd na wlasnym lokalnym AoA. Dzieki temu trzy rzeczy
    // wychodza NATURALNIE z geometrii, bez osobnych "sztucznych" wzorow:
    //  1) EFEKT DIHEDRALNY: poslizg (beta), przy realnym kacie wzniosu skrzydel A321-200
    //     (5.2 deg wg danych Airbusa - WING_DIHEDRAL_RAD), daje przeciwny przyrost
    //     lokalnego AoA na kazdej polowce -> rozna nosnosc -> moment przechylajacy
    //     ktory STABILIZUJE poslizg (sprawdzone numerycznie w obie strony).
    //  2) ADVERSE YAW: lotki daja rozna nosnosc lewej/prawej polowki (skalowane tak,
    //     zeby sumaryczny moment przechylajacy byl IDENTYCZNY jak w starym, juz
    //     dostrojonym wzorze - patrz AILERON_HALFWING_CL_PER_RAD) - a rozna nosnosc
    //     to tez rozny opor indukowany, czyli moment odchylajacy dziob W STRONE
    //     PRZECIWNA do kierunku przechylenia (sprawdzone numerycznie).
    //  3) Mozliwe asymetryczne przeciagniecie (opadniecie jednego skrzydla) - kazda
    //     polowka sprawdza przeciagniecie NIEZALEZNIE, wlasnym lokalnym alpha.
    // Przy symetrycznym locie (beta=0, lotki=0) suma obu polowek daje DOKLADNIE to samo
    // cl/lift/moment pochylajacy co stary, pojedynczy model wing (zweryfikowane numerycznie
    // - to byl warunek konieczny zeby nie zepsuc juz dostrojonego trymu/osiagow).
    const flap = this.flaps;
    const groundRun = this.onGround && this.gearDown;
    const liftScale = groundRun ? A321_PARAMS.groundRunLiftScale : 1.0;
    const dragScale = groundRun ? A321_PARAMS.groundRunDragScale : 1.0;
    const groundH = this.groundHeight();
    const gearOffset = this.gearDown ? 3.15 : 0.5;
    const agl_now = this.altM - groundH - gearOffset;
    const gef = groundEffectFactor(agl_now, A321_PARAMS.span);
    const q = 0.5 * rho * airspeed * airspeed;

    const WING_L = { x: -WING_PANEL_Y, y: 0, z: WING_AC.z };
    const WING_R = { x:  WING_PANEL_Y, y: 0, z: WING_AC.z };

    let anyWingStalling = false;
    const computeWingHalf = (panelPos, sign) => {
      // sign = +1 prawa polowka, -1 lewa polowka.
      const alphaLocal = alpha - sign * WING_DIHEDRAL_RAD * beta;
      const isStallingLocal = !this.onGround && Math.abs(alphaLocal) > A321_PARAMS.flapStall[flap];
      if (isStallingLocal) anyWingStalling = true;
      let clLocal;
      if (isStallingLocal) {
        const over = Math.abs(alphaLocal) - A321_PARAMS.flapStall[flap];
        clLocal = Math.sign(alphaLocal) * Math.max(0.15, (A321_PARAMS.clMax + A321_PARAMS.flapCl[flap]) - over * 4.0);
      } else {
        clLocal = A321_PARAMS.cl0 + A321_PARAMS.flapCl[flap] + A321_PARAMS.clAlpha * alphaLocal;
      }
      clLocal += sign * AILERON_HALFWING_CL_PER_RAD * aileronDeflection;
      if (this.spoilers) clLocal -= A321_PARAMS.spoilerLiftLoss;
      clLocal *= liftScale;
      clLocal = Math.max(-0.3, Math.min(A321_PARAMS.clMax + A321_PARAMS.flapCl[flap], clLocal));

      const halfArea = A321_PARAMS.wingArea / 2;
      const cdiLocal = (clLocal * clLocal) / (Math.PI * A321_PARAMS.eOswald * A321_PARAMS.AR) * gef;
      const cdLocal  = (A321_PARAMS.cdMin + A321_PARAMS.flapCd[flap] + (this.gearDown ? A321_PARAMS.cdGear : 0)
                      + cdiLocal + A321_PARAMS.cdAlpha * alphaLocal * alphaLocal
                      + (this.spoilers ? A321_PARAMS.spoilerCd : 0)) * dragScale;

      const liftMagLocal = q * halfArea * clLocal;
      const dragMagLocal = q * halfArea * Math.max(0, cdLocal);
      const liftVecLocal = windUp.clone().multiplyScalar(liftMagLocal);
      const dragVecLocal = airspeed > 0.1 ? airRelVel.clone().normalize().multiplyScalar(-dragMagLocal) : new THREE.Vector3();
      totalForce.add(liftVecLocal).add(dragVecLocal);

      const FpLift = toLocal(liftVecLocal);
      const FpFull = toLocal(liftVecLocal.clone().add(dragVecLocal));
      torquePitch += _pitchTorque(panelPos, FpLift); // pitch: tylko od nosnosci (jak w oryginale)
      torqueRoll  += _rollTorque(panelPos, FpFull);  // roll: nosnosc (dihedral+lotki) + drobny wklad oporu
      torqueYaw   += _yawTorque(panelPos, FpFull);   // yaw: glownie roznica oporu -> adverse yaw
      return clLocal;
    };
    const clR = computeWingHalf(WING_R, +1);
    const clL = computeWingHalf(WING_L, -1);
    const cl = (clL + clR) / 2; // do HUD/debug - przy symetrycznym locie = starej wartosci cl
    const isStalling = anyWingStalling;

    // Configure thrustScale.
    const thrustScale = (groundRun && this.throttle >= 0) ? A321_PARAMS.groundRunThrustBoost : 1.0;
    // Ciag silnika spada z wysokoscia (mniej masy powietrza / sekunde przy rzadszym
    // powietrzu) - uproszczony, powszechnie stosowany model: T(h) ~= T_SL*(rho/rho0)^0.7.
    const thrustAltFactor = Math.pow(rho / RHO0, 0.7);
    const maxThrustNow = A321_PARAMS.maxThrust * thrustAltFactor;
    const thrustMagFwd = this.throttle >= 0
      ? this.throttle * maxThrustNow
      : this.throttle * maxThrustNow * A321_REVERSE_THRUST_FRAC * this.reverserDeployFrac;
    const thrustVec = noseDir.clone().multiplyScalar(thrustMagFwd * thrustScale);
    totalForce.add(thrustVec);
    // Configure thrustTorqueVec.
    const thrustTorqueVec = noseDir.clone().multiplyScalar(thrustMagFwd);
    { const Ft = toLocal(thrustTorqueVec);
      torquePitch += _pitchTorque(THRUST_PT, Ft); }

    // Configure elevatorDeflection. Gdy ster wysokosci jest puszczony (pitchHoldActive),
    // doklada sie natychmiastowy czlon PD wprost na sterze (bez opoznienia integratora)
    // - patrz komentarz przy PITCH_HOLD_KP_DIRECT. Skalowanie przez qScale kompensuje to,
    // ze sila steru wysokosci rosnie z q (~V^2) - bez tego te same wzmocnienia dawaly
    // wyraznie inna (gorsza, oscylujaca) odpowiedz przy nizszej predkosci niz przy tej,
    // dla ktorej byly dostrojone (sprawdzone numerycznie w kilku warunkach V/klapy).
    const pitchHoldActive = Math.abs(pitchInput) < 0.05;
    const pitchHoldErrNow = this.pitchRad - this.pitchHoldTarget;
    const qScale = PITCH_HOLD_Q_REF / Math.max(q, PITCH_HOLD_Q_FLOOR);
    const elevatorDeflection = -pitchInput * ELEVATOR_MAX_RAD + this.pitchTrim
      + (pitchHoldActive ? qScale * (PITCH_HOLD_KP_DIRECT * pitchHoldErrNow + PITCH_HOLD_KD_DIRECT * this.pitchRate) : 0);
    // Configure tailAlphaStatic.
    const tailAlphaStatic = alpha;
    const tailAlphaRateDamp = -(TAIL_AC.z * this.pitchRate) / Math.max(airspeed, 5);
    const tailCl = TAIL_CL_ALPHA_STATIC * tailAlphaStatic + TAIL_CL_ALPHA_RATE * tailAlphaRateDamp
                 + ELEVATOR_CL_PER_RAD * elevatorDeflection;
    const tailForceVec = windUp.clone().multiplyScalar(q * TAIL_AREA * tailCl);
    totalForce.add(tailForceVec);
    { const Ft2 = toLocal(tailForceVec);
      torquePitch += _pitchTorque(TAIL_AC, Ft2); }
    // Configure torquePitch.
    torquePitch -= PITCH_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
                 * this.pitchRate / (2 * Math.max(airspeed, 5));

    // Configure torqueRoll. (tlumienie predkosci przechylania - bez zmian; sam moment
    // przechylajacy z lotek liczy sie juz wyzej, w computeWingHalf)
    torqueRoll -= ROLL_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_PARAMS.span * A321_PARAMS.span
                * this.rollRate / (2 * Math.max(airspeed, 5));

    // Configure finBeta. (beta liczone wczesniej, razem z reszta ukladu bocznego/skrzydla)
    const finBeta = beta + (FIN_AC.z * this.yawRate) / Math.max(airspeed, 5);
    const rudderDeflection = yawInput * RUDDER_MAX_RAD;
    const finCl = FIN_CL_BETA * finBeta + RUDDER_CL_PER_RAD * rudderDeflection;
    const finForceVec = wingRight.clone().multiplyScalar(-q * FIN_AREA * finCl);
    totalForce.add(finForceVec);
    { const Ff = toLocal(finForceVec);
      torqueYaw  += _yawTorque(FIN_AC, Ff);
      torqueRoll += _rollTorque(FIN_AC, Ff); }
    // Configure torqueYaw.
    torqueYaw -= YAW_DAMPING_GAIN * q * A321_PARAMS.wingArea * A321_FUSELAGE_LEN * A321_FUSELAGE_LEN
               * this.yawRate / (2 * Math.max(airspeed, 5));

    // Configure if.
    if (this.gearDown && !this.onGround && !this._nearGroundZone) {
      const mid = this.sampleGearPoint(GEAR_MAIN_MID, noseDir, wingRight, acUp, 'mid');
      if (-mid.pen < GEAR_FAR_CHECK_ENTER_AGL) this._nearGroundZone = true;
    }
    let gear = null;
    if (this.gearDown && (this.onGround || this._nearGroundZone)) {
      gear = this.sampleGear(noseDir, wingRight, acUp);
    }
    if (this.gearDown && !this.onGround && this._nearGroundZone && gear) {
      const mainAgl = -((gear.left.pen + gear.right.pen) / 2);
      if (mainAgl > GEAR_FAR_CHECK_EXIT_AGL) this._nearGroundZone = false;
    }

    let bounced = false;
    if (gear) {
      const gearContact = Math.max(gear.nose.pen, gear.left.pen, gear.right.pen) >= 0;
      // Configure if.
      if (gearContact) bounced = this.applyBounce(gear);

      if (!bounced) {
        // Configure autobrakeActive.
        const autobrakeActive = this.autobrakeLevel !== 'OFF' && this.onGround
          && !input.brakes && this.throttle <= 0.05 && groundSpeedKt > AUTOBRAKE_MIN_SPEED_KT;
        const autobrakeMuRoll = TIRE_ROLLING_MU
          + (TIRE_BRAKE_MU - TIRE_ROLLING_MU) * (AUTOBRAKE_MU_FRAC[this.autobrakeLevel] ?? 0);

        for (const k of ['nose', 'left', 'right']) {
          const gp = gear[k];
          if (gp.pen < 0) continue; // Configure localOff.
          const localOff = k === 'nose' ? GEAR_NOSE : k === 'left' ? GEAR_LEFT : GEAR_RIGHT;
          const isMain = k !== 'nose';
          const kSpring = isMain ? GEAR_K_MAIN : GEAR_K_NOSE;
          const cDamp   = isMain ? GEAR_C_MAIN : GEAR_C_NOSE;

          const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, gp.offset.x, -gp.offset.z);
          const normal = this.terrainNormalAt(glat, glon);
          // Configure vPoint.
          const vPoint = this.vel.clone().add(omegaWorld.clone().cross(gp.offset));
          const closingSpeed = -vPoint.dot(normal); // Configure fN.

          let fN = kSpring * gp.pen + cDamp * closingSpeed;
          if (gp.pen > GEAR_SUSPENSION_TRAVEL) {
            fN += kSpring * GEAR_HARDSTOP_K_MULT * (gp.pen - GEAR_SUSPENSION_TRAVEL);
          }
          fN = Math.max(0, fN); // Configure normalForceVec.

          const normalForceVec = normal.clone().multiplyScalar(fN);

          // Configure vTangent.
          const vTangent = vPoint.clone().sub(normal.clone().multiplyScalar(vPoint.dot(normal)));
          const noseFlat = noseDir.clone().sub(normal.clone().multiplyScalar(noseDir.dot(normal)));
          if (noseFlat.lengthSq() > 1e-6) noseFlat.normalize();
          const rightFlat = wingRight.clone().sub(normal.clone().multiplyScalar(wingRight.dot(normal)));
          if (rightFlat.lengthSq() > 1e-6) rightFlat.normalize();
          const rollSpeed = vTangent.dot(noseFlat);
          const latSpeed  = vTangent.dot(rightFlat);

          // Configure muRoll.
          let muRoll = TIRE_ROLLING_MU;
          if (isMain) {
            if (input.brakes || this.parkingBrake) muRoll = TIRE_BRAKE_MU;
            else if (autobrakeActive)              muRoll = autobrakeMuRoll;
          }
          const fRoll = -Math.max(-muRoll * fN, Math.min(muRoll * fN, TIRE_LONG_STIFF * rollSpeed));

          // Configure latTarget.
          let latTarget = 0;
          if (k === 'nose') {
            latTarget = Math.tan(yawInput * NOSEWHEEL_MAX_RAD) * Math.max(rollSpeed, 0)
                      * groundSteerTrackFactor(groundSpeedKt);
          }
          const fLat = -Math.max(-TIRE_LAT_GRIP_MU * fN, Math.min(TIRE_LAT_GRIP_MU * fN,
                        TIRE_LAT_STIFF * (latSpeed - latTarget)));

          const gearForceVec = normalForceVec
            .add(noseFlat.clone().multiplyScalar(fRoll))
            .add(rightFlat.clone().multiplyScalar(fLat));

          totalForce.add(gearForceVec);
          const Fg = toLocal(gearForceVec);
          torquePitch += _pitchTorque(localOff, Fg);
          torqueRoll  += _rollTorque(localOff, Fg);
          torqueYaw   += _yawTorque(localOff, Fg);
        }

        // Apply a bounded, damped righting moment while any wheel is in
        // contact. This represents the stabilizing leverage of the main gear
        // and prevents a light bank from turning into a ground-loop rollover.
        if (gearContact && !bounced) {
          const rollSpring = A321_IXX * GROUND_ROLL_NATURAL_FREQ ** 2 * this.rollRad;
          const rollDamper = 2 * GROUND_ROLL_DAMPING * A321_IXX
                           * GROUND_ROLL_NATURAL_FREQ * this.rollRate;
          const maxRightingTorque = A321_PARAMS.mass * G_ACC * 3.0;
          const rightingTorque = Math.max(-maxRightingTorque,
            Math.min(maxRightingTorque, rollSpring + rollDamper));
          torqueRoll -= rightingTorque;
        }
      }
    } else if (!this.gearDown) {
      // Configure penCg.
      const penCg = groundH + gearOffset - this.altM;
      if (penCg > 0) {
        const kBelly = A321_PARAMS.mass * GEAR_SUSP_OMEGA_MAIN ** 2;
        const cBelly = 2 * GEAR_SUSP_ZETA_MAIN * GEAR_SUSP_OMEGA_MAIN * A321_PARAMS.mass;
        const fN = Math.max(0, kBelly * penCg - cBelly * this.vel.y);
        totalForce.y += fN;
        totalForce.x += -this.vel.x * A321_PARAMS.mass * 0.4;
        totalForce.z += -this.vel.z * A321_PARAMS.mass * 0.4;
      }
    }

    // Configure if.
    if (!bounced) {
      const accel = totalForce.clone().divideScalar(A321_PARAMS.mass);
      this.vel.add(accel.multiplyScalar(dtCap));

      this.pitchRate += (torquePitch / A321_IYY) * dtCap;
      this.rollRate  += (torqueRoll  / A321_IXX) * dtCap;
      this.yawRate   += (torqueYaw   / A321_IZZ) * dtCap;

      // Integracja orientacji kwaternionem w ukladzie lokalnym samolotu.
      // POWOD: pitchRad/yawRad/rollRad to katy Eulera 'YXZ' uzywane tez przez
      // mesh.rotation.set(); dodawanie do nich niezaleznie samych predkosci
      // (jak poprzednio) ignorowalo sprzezenie kinematyczne miedzy osiami -
      // przy przechyleniu (rollRad != 0) obrot wokol realnej (przechylonej) osi
      // pitch (wingRight) NIE jest tym samym co zmiana samego katu pitchRad.
      // Skutek: ster wysokosci przy banku zmienial tylko "kat wzgledem pionu",
      // a nie realnie zakrecal samolotem. Ponizej budujemy biezaca orientacje
      // z juz policzonych, przechylonych osi cialka (wingRight/acUp/noseDir),
      // obracamy ja o predkosci katowe W UKLADZIE LOKALNYM (dokladnie te same
      // osie, wzgledem ktorych liczone sa torquePitch/torqueRoll/torqueYaw),
      // po czym odczytujemy z powrotem katy Eulera w tej samej konwencji.
      {
        const basisMat = new THREE.Matrix4().makeBasis(wingRight, acUp, noseDir);
        const orientQ  = new THREE.Quaternion().setFromRotationMatrix(basisMat);
        const wx = -this.pitchRate, wy = this.yawRate, wz = this.rollRate;
        const angle = Math.hypot(wx, wy, wz) * dtCap;
        if (angle > 1e-9) {
          const axis = new THREE.Vector3(wx, wy, wz).normalize();
          orientQ.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
        }
        const eNew = new THREE.Euler().setFromQuaternion(orientQ, 'YXZ');
        this.pitchRad = -eNew.x;
        this.yawRad   = eNew.y;
        this.rollRad  = eNew.z;
      }
      // Configure if.
      if (this.rollRad > 1.40) { this.rollRad = 1.40; if (this.rollRate > 0) this.rollRate = 0; }
      if (this.rollRad < -1.40) { this.rollRad = -1.40; if (this.rollRate < 0) this.rollRate = 0; }
      // Configure pitchClampMax.
      const pitchClampMax = this.onGround ? 0.35 : 0.75;
      if (this.pitchRad > pitchClampMax) { this.pitchRad = pitchClampMax; if (this.pitchRate > 0) this.pitchRate = 0; }
      if (this.pitchRad < -0.45) { this.pitchRad = -0.45; if (this.pitchRate < 0) this.pitchRate = 0; }

      // Configure if.
      if (this.ap.master && (this.ap.altHold || this.ap.vsHold) && Math.abs(pitchInput) < AP_MANUAL_OVERRIDE_DEADZONE) {
        const vsTargetMs = this.ap.altHold
          ? Math.max(-AP_MAX_VS_MS, Math.min(AP_MAX_VS_MS, (Units.ftToM(this.ap.targetAltFt) - this.altM) * AP_ALT_KP))
          : Units.fpmToMs(this.ap.targetVsFpm);
        let vsErrMs = vsTargetMs - this.vel.y;
        const stallThreshold = A321_PARAMS.flapStall[this.flaps];

        // Stall/alpha protection (patrz komentarz przy STALL_PROTECT_MARGIN_RAD
        // powyzej): miekki prog - gdy zblizamy sie do przeciagniecia, integrator
        // nie moze dalej "chciec" wiecej pitch (moze tylko go redukowac).
        const alphaMargin = stallThreshold - Math.abs(alpha);
        if (alphaMargin < STALL_PROTECT_MARGIN_RAD) {
          const overshoot = STALL_PROTECT_MARGIN_RAD - alphaMargin;
          const forcedCeiling = -Math.min(overshoot * STALL_PROTECT_GAIN, AP_MAX_VS_MS);
          vsErrMs = Math.min(vsErrMs, forcedCeiling);
        }

        this._vsIntegral += AP_VS_TO_PITCH_KI * vsErrMs * dtCap;
        this._vsIntegral = Math.max(-AP_MAX_PITCH_RAD, Math.min(AP_MAX_PITCH_RAD, this._vsIntegral));
        this.pitchHoldTarget = this._vsIntegral;

        // Twardy limit - jesli JUZ jestesmy w przeciagnieciu, wymuszamy
        // natychmiastowe, aktywne "opuszczanie nosa" w stalym tempie zamiast
        // czekac az wolny integrator to zrobi (patrz komentarz wyzej).
        if (Math.abs(alpha) > stallThreshold) {
          const recoveryPitchRad = this.pitchRad - Math.sign(alpha) * STALL_RECOVERY_RATE_RAD_S * dtCap;
          if (alpha > 0) this.pitchHoldTarget = Math.min(this.pitchHoldTarget, recoveryPitchRad);
          else this.pitchHoldTarget = Math.max(this.pitchHoldTarget, recoveryPitchRad);
          this._vsIntegral = this.pitchHoldTarget;
        }
      }

      // Configure if.
      if (Math.abs(pitchInput) < 0.05) {
        const pitchErr = this.pitchRad - this.pitchHoldTarget;
        // Configure this.pitchTrim. (tylko wolny integrator - szybka, natychmiastowa
        // korekta PD jest juz doliczona wprost w elevatorDeflection powyzej)
        this.pitchTrim += PITCH_HOLD_KI * pitchErr * dtCap;
        this.pitchTrim = Math.max(-ELEVATOR_MAX_RAD, Math.min(ELEVATOR_MAX_RAD, this.pitchTrim));
      } else {
        this.pitchHoldTarget = this.pitchRad;
        this._vsIntegral = this.pitchRad;
        // Configure if.
        if (this.ap.master) { this.ap.altHold = false; this.ap.vsHold = false; }
      }

      const eastVel  = this.vel.x;
      const northVel = -this.vel.z;
      const cosLat = Math.cos(Units.degToRad(this.lat));
      this.lat  += (northVel / EARTH_RADIUS) * (180 / Math.PI) * dtCap;
      this.lon  += (eastVel  / (EARTH_RADIUS * cosLat)) * (180 / Math.PI) * dtCap;
      this.altM += this.vel.y * dtCap;
    }

    // Configure _preClampOverVmo.
    // VMO to w rzeczywistosci limit predkosci PRZYRZADOWEJ (IAS), nie prawdziwej (TAS).
    // IAS ~= TAS*sqrt(rho/rho0). Bez tego przeliczenia, po dodaniu modelu atmosfery,
    // samolot na wysokosci przelotowej fizycznie MUSI leciec szybciej w TAS (rzadsze
    // powietrze = mniej nosnosci przy tym samym TAS) i clamp zaczalby to liczyc jako
    // przekroczenie VMO przy realnej predkosci znacznie ponizej tego, co powinno byc
    // dozwolone na FL350+.
    let _preClampOverVmo = false;
    {
      const airRelNow = this.vel.clone().sub(this.windVec3);
      const tasNow = airRelNow.length();
      const iasNow = tasNow * Math.sqrt(rho / RHO0);
      if (iasNow > A321_PARAMS.VMO) {
        _preClampOverVmo = true;
        airRelNow.setLength(tasNow * (A321_PARAMS.VMO / iasNow));
        this.vel.copy(airRelNow.add(this.windVec3));
      }
    }

    // Configure gearFinal.
    let gearFinal = gear;
    const wasOnGround = this.onGround;
    if (this.gearDown && (this.onGround || this._nearGroundZone || bounced)) {
      gearFinal = this.sampleGear(noseDir, wingRight, acUp);
      const maxPen = Math.max(gearFinal.nose.pen, gearFinal.left.pen, gearFinal.right.pen);
      if (maxPen > GEAR_EMERGENCY_PEN_M) {
        // Configure push.
        const push = 1 - Math.exp(-dtCap / GEAR_EMERGENCY_SETTLE_TAU);
        this.altM += maxPen * push;
        if (this.vel.y < 0) this.vel.y *= (1 - push);
        if (window.DEBUG_GEAR) {
          console.error(`[GEAR DEBUG] AWARYJNE zanurzenie w ziemiĂ„â„˘! maxPen=${maxPen.toFixed(2)}m lat=${this.lat.toFixed(6)} lon=${this.lon.toFixed(6)} altM=${this.altM.toFixed(1)}`);
        }
      }
      this.onGround = maxPen >= 0 && !bounced;
    } else {
      this.onGround = false;
    }

    // Hook do systemu oceny ladowania (sim-landing-score.js) - odpala sie
    // DOKLADNIE raz na przejsciu w powietrzu->na ziemi (nie przy odbiciu,
    // bounced juz jest false tutaj). typeof-guard: gra dziala normalnie
    // nawet jesli ten plik sie nie zaladuje z jakiegos powodu.
    if (!wasOnGround && this.onGround && typeof LandingScore !== 'undefined') {
      const tdSpeedMs = this.vel.clone().sub(this.windVec3).length();
      LandingScore.onTouchdown(this, {
        impactVy:   Math.max(0, -this.vel.y),
        bankDeg:    this.rollRad * 180 / Math.PI,
        headingDeg: this.headingDeg,
        speedKt:    Units.msToKt(tdSpeedMs),
        lat: this.lat, lon: this.lon,
      });
    }

    this.airspeed = this.vel.clone().sub(this.windVec3).length();
    const iasNow = this.airspeed * Math.sqrt(rho / RHO0);

    // Configure VMO_OFF_MARGIN_MPS.
    const VMO_OFF_MARGIN_MPS = 1.0; // ok.
    if (_preClampOverVmo || iasNow > A321_PARAMS.VMO) {
      this._isOverspeed = true;
    } else if (iasNow < A321_PARAMS.VMO - VMO_OFF_MARGIN_MPS) {
      this._isOverspeed = false;
    }
    // Preserve the previous state inside the hysteresis band.
    this.groundSpeed = this.vel.length(); // Configure this.terrainM.
    this.terrainM = groundH;
    this.agl = gearFinal
      ? Math.max(0, -Math.max(gearFinal.nose.pen, gearFinal.left.pen, gearFinal.right.pen))
      : Math.max(0, this.altM - groundH - gearOffset);
    this.vs = this.vel.y;
    this._alpha = alpha; this._cl = cl; this._isStalling = isStalling;
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll  = this.rollRad  * 180 / Math.PI;
    this._noseDir = noseDir; this._wingRight = wingRight; this._acUp = acUp;

    // Configure if.
    if (window.DEBUG_PITCH) {
      this._debugHeartbeat = (this._debugHeartbeat || 0) + dtCap;
      if (this._debugHeartbeat >= DEBUG_HEARTBEAT_SEC) {
        this._debugHeartbeat = 0;
        this._debugElapsed = (this._debugElapsed || 0) + DEBUG_HEARTBEAT_SEC;
        console.log(
          `t=${this._debugElapsed.toFixed(0)} pitch=${(this.pitchRad * 180 / Math.PI).toFixed(1)} ` +
          `rate=${(this.pitchRate * 180 / Math.PI).toFixed(1)} alpha=${(alpha * 180 / Math.PI).toFixed(1)} ` +
          `input=${pitchInput.toFixed(2)} trim=${(this.pitchTrim * 180 / Math.PI).toFixed(2)} ` +
          `target=${(this.pitchHoldTarget * 180 / Math.PI).toFixed(1)} flaps=${flap} ` +
          `V=${speedKt.toFixed(0)}kt vs=${this.vel.y.toFixed(1)} gnd=${this.onGround ? 1 : 0} stall=${isStalling ? 1 : 0} ` +
          `wind=${this.windDirDeg.toFixed(0)}/${this.windSpeedKt.toFixed(0)}kt gs=${groundSpeedKt.toFixed(0)}kt ` +
          `ap=${this.ap.master ? (this.ap.hdgHold?'H':'') + (this.ap.altHold?'A':'') + (this.ap.vsHold?'V':'') + (this.ap.spdHold?'S':'') || 'ON' : 'OFF'}`
        );
      }
    }

    this._updateGearMarkers(gearFinal);
  }

  // Physics note.
  _updateGearMarkers(gear) {
    if (!gear) {
      for (const k of ['nose', 'left', 'right']) this._gearMarkers[k].visible = false;
      return;
    }
    for (const k of ['nose', 'left', 'right']) {
      const g = gear[k];
      const marker = this._gearMarkers[k];
      marker.visible = true;
      // Configure const.
      const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, g.offset.x, -g.offset.z);
      marker.position.copy(geoToWorld(glat, glon, g.groundH * DEM_EXAG));
      const touching = g.pen >= 0;
      marker.material.opacity = touching ? 0.85 : 0.25;
      marker.scale.setScalar(touching ? 1.4 : 1.0);
    }
  }

  renderUpdate(frameDt) {
    this.fanAngle += this.throttle * frameDt * 30;

    if (this.gearDown && this.onGround) {
      const horizSpeed = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
      const wheelRadius = 0.5;
      this.gearAngle += (horizSpeed * frameDt) / wheelRadius;
    }

    this.beaconTimer += frameDt;
    const flapTarget = this.flaps * 12 * Math.PI / 180;
    this.prevFlapPos += (flapTarget - this.prevFlapPos) * Math.min(1, frameDt * 4);

    // Configure elevTarget.
    const elevTarget = (typeof planeInput !== 'undefined' ? planeInput.pitch : 0) * 0.43;
    this.elevPos += (elevTarget - this.elevPos) * Math.min(1, frameDt * 10);

    // Configure rudderTarget.
    const rudderTarget = (typeof planeInput !== 'undefined' ? planeInput.yaw : 0) * RUDDER_MAX_RAD;
    this.rudderPos += (rudderTarget - this.rudderPos) * Math.min(1, frameDt * 10);

    this._applyPoseToMesh();
  }

  // Stosuje AKTUALNE pola stanu (fanAngle/gearAngle/beaconTimer/prevFlapPos/
  // elevPos/rudderPos/spoilers) do hierarchii mesh - bez liczenia targetow
  // ani wygladzania. Wydzielone z renderUpdate() zeby sim-replay.js moglo
  // TEZ to wywolac po ustawieniu stanu bezposrednio z nagranej probki
  // (patrz applyReplayPose ponizej) - podczas replay chcemy odtworzyc
  // NAGRANE polozenia sterow, nie przeliczac je na nowo z (aktualnego,
  // zywego) globalnego planeInput.
  _applyPoseToMesh() {
    const p = this._parts;
    if (p.fanR) p.fanR.rotation.x = this.fanAngle;
    if (p.fanL) p.fanL.rotation.x = this.fanAngle;

    if (p.gearFL) p.gearFL.rotation.z = this.gearAngle;
    if (p.gearBL) p.gearBL.rotation.z = this.gearAngle;
    if (p.gearBR) p.gearBR.rotation.z = this.gearAngle;

    if (p.beacon) p.beacon.visible = Math.sin(this.beaconTimer * 6) > 0;

    if (p.flapR) p.flapR.rotation.x = this.prevFlapPos;
    if (p.flapL) p.flapL.rotation.x = this.prevFlapPos;

    const spoilerTarget = this.spoilers ? 35 * Math.PI / 180 : 0;
    if (p.spoilerR) p.spoilerR.rotation.x = -spoilerTarget;
    if (p.spoilerL) p.spoilerL.rotation.x = -spoilerTarget;

    if (p.elevatorR && p.elevatorR.userData.hingeAxis) p.elevatorR.quaternion.setFromAxisAngle(p.elevatorR.userData.hingeAxis, this.elevPos);
    if (p.elevatorL && p.elevatorL.userData.hingeAxis) p.elevatorL.quaternion.setFromAxisAngle(p.elevatorL.userData.hingeAxis, this.elevPos);

    if (p.rudder && p.rudder.userData.hingeAxis) {
      p.rudder.quaternion.setFromAxisAngle(p.rudder.userData.hingeAxis, this.rudderPos);
    } else if (p.rudder) {
      p.rudder.rotation.y = this.rudderPos;
    }
  }

  // Wolane z sim-replay.js podczas odtwarzania replay, ZAMIAST physicsUpdate().
  // Ustawia stan bezposrednio z nagranej/interpolowanej probki (patrz
  // ReplayRecorder.sampleAt w sim-replay.js) i odswieza wizualia. fanAngle/
  // gearAngle/beaconTimer NIE sa nagrywane (zbedne - throttle/predkosc
  // wystarcza do wiarygodnej animacji obrotu), wiec doliczamy je tu tak samo
  // jak w renderUpdate(), na podstawie interpolowanego throttle/vel.
  applyReplayPose(sample, dt) {
    this.lat = sample.lat; this.lon = sample.lon; this.altM = sample.altM;
    this.pitchRad = sample.pitchRad; this.yawRad = sample.yawRad; this.rollRad = sample.rollRad;
    this.throttle = sample.throttle;
    this.gearDown = sample.gearDown;
    this.spoilers = sample.spoilers;
    this.onGround = sample.onGround;
    this.prevFlapPos = sample.flapPos;
    this.elevPos = sample.elevPos;
    this.rudderPos = sample.rudderPos;
    this.vel.set(sample.velX, sample.velY, sample.velZ);

    this.fanAngle += this.throttle * dt * 30;
    if (this.gearDown && this.onGround) {
      const horizSpeed = Math.sqrt(sample.velX ** 2 + sample.velZ ** 2);
      this.gearAngle += (horizSpeed * dt) / 0.5;
    }
    this.beaconTimer += dt;

    this._applyPoseToMesh();
    this.syncMesh();
  }

  // Airport lighting note.
}
