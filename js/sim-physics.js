'use strict';

// ── Ładowanie modelu A321 z a321.obj + a321.mtl ───────────────────────────────
// (a321.mtl wskazuje tekstury w folderze objwmtl/ — ścieżki względne, nie
// trzeba ich tu powtarzać; wystarczy wczytać .mtl, a potem .obj z tymi materiałami)

const A321_OBJ_URL = './a321.obj';
const A321_MTL_URL = './a321.mtl';

// Jeśli po wczytaniu samolot będzie odwrócony nosem w złą stronę albo źle przechylony,
// zmień tę wartość (np. Math.PI/2, -Math.PI/2, Math.PI) aż dziób wskaże w +Z w lokalnym układzie.
const A321_MODEL_ROT_Y = Math.PI / 2;
// Jeśli samolot będzie zbyt duży/mały względem terenu, zmień skalę (np. 0.01 jeśli model jest w cm).
const A321_MODEL_SCALE = 0.25;
// Jeśli samolot będzie przesunięty w górę/dół względem terenu, zmień przesunięcie (np. 0.01 jeśli model jest w cm).
const A321_MODEL_TRANSLATE_Y = -3.75;

// Obiekty w a321.obj o nazwie zaczynającej się od tego prefiksu (gears_back_tires,
// gears_covers, gears_front_tire, gears_holder_*) trafiają do wspólnej grupy
// "gearGroup", tak jak wcześniej, gdy każdy z nich był osobnym plikiem .obj —
// dzięki temu chowanie/pokazywanie podwozia (updateGearVisibility) działa bez zmian.
const A321_GEAR_PREFIX = 'gears_';

function _explainModelLoadError(url, err) {
  if (location.protocol === 'file:') {
    console.error(`[A321] Nie można wczytać "${url}" z pliku lokalnego. Uruchom stronę przez lokalny serwer HTTP, np. python -m http.server 8000.`);
  }
  const cause = err && err.message ? err.message : err;
  return new Error(`[A321] Błąd ładowania ${url}: ${cause}`);
}

async function loadA321Model() {
  // 1) Wczytaj definicje materiałów z .mtl (tekstury objwmtl/*.png są w nim
  //    zapisane ścieżkami względnymi do lokalizacji samego .mtl).
  const materials = await new Promise((resolve, reject) => {
    new THREE.MTLLoader().load(A321_MTL_URL, resolve, undefined,
      err => reject(_explainModelLoadError(A321_MTL_URL, err)));
  });
  materials.preload();

  // Mapa "nazwa części" → gotowy materiał z tą częścią powiązany, wyprowadzona
  // bezpośrednio z wpisów map_Kd w .mtl (np. "objwmtl/cockpit_inside.png" →
  // część "cockpit_inside"). Używamy jej jako niezawodnego planu B: nazwa
  // części w a321.obj ("o cockpit_inside") jest zawsze taka sama jak nazwa
  // pliku tekstury, więc to działa niezależnie od tego, czy wewnętrzne
  // dopasowanie usemtl↔newmtl w OBJLoaderze się powiedzie.
  const partNameToMaterial = {};
  for (const matName in materials.materialsInfo) {
    const mapKd = materials.materialsInfo[matName] && materials.materialsInfo[matName].map_kd;
    if (!mapKd) continue;
    const partName = mapKd.split('/').pop().replace(/\.[a-zA-Z0-9]+$/, '');
    partNameToMaterial[partName] = materials.create(matName);
  }

  // 2) Wczytaj geometrię .obj z już przygotowanymi materiałami z .mtl —
  //    OBJLoader sam dopasuje materiał do każdej części wg "usemtl" w pliku.
  const group = await new Promise((resolve, reject) => {
    new THREE.OBJLoader()
      .setMaterials(materials)
      .load(A321_OBJ_URL, resolve, undefined,
        err => reject(_explainModelLoadError(A321_OBJ_URL, err)));
  });

  // 3) Tak jak wcześniej: dwustronne renderowanie, poprawny color space tekstur,
  //    anizotropia — i wydzielenie podwozia do osobnej grupy. Plus zabezpieczenie:
  //    jeśli część nie ma tekstury (mapa się nie dopasowała), wymuszamy ją po
  //    nazwie części z mapy zbudowanej wyżej.
  const gearGroup = new THREE.Group();
  gearGroup.name = 'gearGroup';
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  for (const child of [...group.children]) {
    const fallbackMat = partNameToMaterial[child.name];
    child.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      const hasMap = node.material && !Array.isArray(node.material) && node.material.map;
      if (!hasMap && fallbackMat) {
        node.material = fallbackMat;
        console.warn(`[A321] "${child.name}" nie dostał tekstury z OBJLoadera — wymuszono materiał po nazwie części.`);
      }
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.side = THREE.DoubleSide;
        if (mat.map) {
          mat.map.encoding   = THREE.sRGBEncoding;
          mat.map.anisotropy = maxAniso;
        }
        // Dodatkowy stały "fill" (+20,20,20 w skali 0-255) niezależny od
        // oświetlenia sceny — samolot inaczej gubił się w cieniu własnym,
        // gęstej mgle albo nocą, gdy sunLight/hemiLight są słabe. emissive
        // dodaje stałą jasność niezależnie od padającego światła.
        if (mat.emissive) mat.emissive.addScalar(20 / 255);
      }
    });
    if (child.name.startsWith(A321_GEAR_PREFIX)) gearGroup.add(child); // .add() sam usuwa z poprzedniego rodzica
  }

  if (gearGroup.children.length) group.add(gearGroup);
  return group;
}

// ── Parametry fizyki A321 ──────────────────────────────────────────────────────

const G_ACC = 9.81;
const RHO   = 1.225;

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
  flapCl:     [0.0, 0.70, 1.20, 1.80],
  flapCd:     [0.0, 0.040, 0.085, 0.160],
  flapStall:  [0.285, 0.32, 0.36, 0.40],
  cdGear:     0.060,
  groundRunThrustBoost: 2.20,
  groundRunDragScale:   0.30,
  groundRunLiftScale:   0.80,
  spoilerCd:  0.30,
  spoilerLiftLoss: 0.35,
  V1: 69.4, VR: 74.7, V2: 79.8, Vstall: 62, VMO: 189,
};

// ── Geometria i zawieszenie podwozia ───────────────────────────────────────────
//
// Współrzędne 3 punktów styczności kół z ziemią w LOKALNYM układzie samolotu
// (ten sam co reszta fizyki: +X = prawe skrzydło,
// +Y = góra, +Z = dziób), w metrach względem "origin" encji (this.altM/lat/lon).
// Wyznaczone bezpośrednio z geometrii a321.obj (dolne punkty opon), a nie
// zgadnięte — dzięki temu naturalny kąt spoczynkowy samolotu na 3 kołach
// wynika z samego modelu, a nie ze stałej "gearOffset" jak wcześniej.
const GEAR_NOSE  = { x: -0.17, y: -3.53, z: 15.34 };
const GEAR_LEFT  = { x: -3.96, y: -3.75, z: -1.20 };
const GEAR_RIGHT = { x:  3.62, y: -3.75, z: -1.20 };
// Przybliżona wysokość "spoczynkowa" origin encji nad terenem, gdy podwozie
// stoi na płaskiej ziemi — używana tylko jako sensowna wysokość startowa w
// reset() (dokładny kąt/wysokość i tak dociąga się w pierwszej klatce fizyki).
const GEAR_MAIN_REST_OFFSET = -GEAR_LEFT.y;

// Zawieszenie (amortyzacja goleni) — na razie WYŁĄCZNIE fizyczne (wpływa na
// wysokość kadłuba), bez animacji ugięcia samej goleni/opony (to osobny,
// wizualny krok na później). Każda goleń ma własny, niezależny stan "wgniecenia".
const GEAR_SUSPENSION_TRAVEL   = 0.42; // maks. całkowite wgniecenie w ziemię (m)
const GEAR_STATIC_SAG          = 0.05; // ugięcie w spoczynku pod ciężarem samolotu (m)
const GEAR_IMPACT_SINK_PER_MS  = 0.08; // dodatkowe wgniecenie na 1 m/s prędkości pionowej przy dotknięciu
const GEAR_IMPACT_MAIN_SINK_MULT = 1.35; // główne koła mogą ugiąć się jeszcze mocniej przy lądowaniu
const GEAR_SINK_SETTLE_TAU     = 0.18; // stała czasowa powrotu wgniecenia do wartości spoczynkowej (s)
const GEAR_ATTITUDE_SETTLE_TAU = 0.35; // stała czasowa "osiadania" pitch/roll na podwoziu (s) — łagodna, żeby nie "przyklejać" dziobu podczas rozbiegu przed VR

// Środek między kołami głównymi (lewym i prawym) — najniższy, najbardziej
// reprezentatywny pojedynczy punkt do TANIEGO sprawdzania odległości od ziemi,
// gdy samolot jest wysoko (patrz GEAR_FAR_CHECK_* niżej).
const GEAR_MAIN_MID = { x: (GEAR_LEFT.x + GEAR_RIGHT.x) / 2, y: GEAR_LEFT.y, z: GEAR_LEFT.z };

// Z dala od ziemi nie ma sensu liczyć dokładnie WSZYSTKICH 3 punktów podwozia
// co klatkę — zamiast tego co klatkę sprawdzamy TYLKO wysokość GEAR_MAIN_MID
// nad terenem (jeden tani odczyt zamiast trzech). To wciąż dzieje się co
// klatkę (60x/s), a nie rzadziej — przy sprawdzaniu np. co 0.2 s samolot przy
// dużej prędkości mógłby "wjechać" w strome zbocze/górę między dwoma
// sprawdzeniami, zanim zdąży przełączyć się na tryb dokładny. Gdy wysokość
// spadnie poniżej GEAR_FAR_CHECK_ENTER_AGL, przechodzimy w tryb dokładny (3
// punkty, co klatkę) i zostajemy w nim, dopóki nie oddalimy się z zapasem
// powyżej GEAR_FAR_CHECK_EXIT_AGL (histereza, żeby nie przełączać się w kółko).
const GEAR_FAR_CHECK_ENTER_AGL = 120; // m — poniżej tej wysokości włącz dokładne sprawdzanie 3 punktów
const GEAR_FAR_CHECK_EXIT_AGL  = 150; // m — powyżej tej wysokości wróć do taniego sprawdzania 1 punktem (zapas histerezy jak wcześniej)

// Jeśli którekolwiek koło jest zanurzone w terenie głębiej niż to (kilka metrów,
// znacznie więcej niż normalne ugięcie zawieszenia GEAR_SUSPENSION_TRAVEL) —
// to nie jest zwykłe lądowanie, tylko prawdziwa sytuacja awaryjna (np. stromy
// lot nurkowy, teleportacja, spawn w złym miejscu) — samolot szybko (ale
// płynnie, nie w jednej klatce) wraca na powierzchnię — patrz GEAR_EMERGENCY_SETTLE_TAU.
const GEAR_EMERGENCY_PEN_M = 10; // m
const GEAR_EMERGENCY_SETTLE_TAU = 0.05; // s — znacznie szybsze niż normalne osiadanie, ale nie natychmiastowe (łagodniejszy "wypchnij na powierzchnię")

// DEBUG: pomaga namierzyć przypadki zapadania się samolotu pod ziemię (patrz
// sampleGearPoint/_debugZoomWarn i settleOnGear). Wyłącz w konsoli przeglądarki
// wpisując: DEBUG_GEAR = false
window.DEBUG_GEAR = window.DEBUG_GEAR ?? true;
const GEAR_DEBUG_HEARTBEAT_SEC = 1.0; // co ile sekund wypisywać bieżący stan (patrz koniec physicsUpdate)

// ── Kulki-znaczniki 3 punktów kolizji podwozia ─────────────────────────
//
// Małe kolorowe kule pokazujące dokładnie te same 3 punkty, które silnik fizyki
// używa do wykrywania kontaktu z ziemią (GEAR_NOSE/GEAR_LEFT/GEAR_RIGHT) — świecą
// pełnym kolorem gdy dane koło dotyka/koliduje z terenem, są przygaszone gdy nie.
// Czysto wizualny debug/feedback, nie wpływa na fizykę.
const GEAR_MARKER_RADIUS = 0.35; // m
const GEAR_MARKER_COLORS = {
  nose:  0xffdd33, // żółty  — przednie koło
  left:  0x33ccff, // niebieski — lewe główne koło
  right: 0xff3355, // czerwony — prawe główne koło
};

// ── Prawdziwy cień 3D samolotu (rzut RZECZYWISTEJ geometrii modelu na teren
//    wzdłuż kierunku Słońca) ────────────────────────────────────────────────
//
// W przeciwieństwie do poprzedniej wersji (ręcznie narysowany, przybliżony
// obrys), obrys cienia jest teraz wyliczony z PRAWDZIWYCH wierzchołków
// wczytanego a321.obj: po wczytaniu modelu bierzemy WSZYSTKIE wierzchołki
// wszystkich części (kadłub, skrzydła, statecznik — z wyłączeniem elementów
// wewnętrznych typu cockpit_inside/interface, które i tak są w całości
// wewnątrz bryły kadłuba i nie mogą poszerzyć sylwetki), rzutujemy je na
// płaszczyznę X-Z (widok z góry, w LOKALNYM układzie samolotu — ten sam co
// GEAR_NOSE/LEFT/RIGHT) i liczymy 2D convex hull (otoczkę wypukłą) tego rzutu.
// To daje dokładny, prawdziwy kontur sylwetki samolotu z góry — bez
// zgadywania wymiarów, i bez ryzyka samoprzecinających się trójkątów (hull
// jest z definicji wypukły, więc triangulacja "fan" od centroidu zawsze
// wychodzi poprawnie, inaczej niż przy ręcznie rysowanym, nie do końca
// wypukłym obrysie).
//
// Liczenie hull z ~35 tys. wierzchołków trwa rzędu kilkudziesięciu
// milisekund — WYKONYWANE WYŁĄCZNIE RAZ, zaraz po wczytaniu modelu (patrz
// .then() w konstruktorze), NIE co klatkę. Co klatkę (_updateShadow) używamy
// już tylko tego gotowego, małego zestawu punktów obrysu (typowo kilkanaście-
// kilkadziesiąt), dokładnie tak jak poprzednio dla ręcznego obrysu.

// Nazwy części modelu POMIJANE przy liczeniu obrysu — elementy wnętrza
// kokpitu leżą całkowicie wewnątrz bryły zewnętrznej kadłuba i tylko
// spowalniałyby liczenie hull bez żadnego wpływu na wynik.
const SHADOW_HULL_EXCLUDE_PREFIXES = ['cockpit_inside', 'cockpit_interface'];

// Andrew's monotone chain — 2D convex hull, O(n log n), zwraca punkty w
// kolejności przeciwnej do ruchu wskazówek zegara (CCW), bez duplikatu
// punktu początkowego na końcu.
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

// Wyciąga WSZYSTKIE wierzchołki geometrii z modelu (a321.obj) PO zastosowaniu
// jego własnej transformacji (rotation.y=A321_MODEL_ROT_Y, scale, translateY —
// ustawione w konstruktorze PRZED wywołaniem tej funkcji), ale NIEZALEżNIE od
// pozycji/orientacji całej encji w świecie (`grp`) — czyli dokładnie w tych
// samych, lokalnych współrzędnych względem origin encji co GEAR_NOSE/LEFT/RIGHT.
// Liczymy transformację KAŻDEGO node'a względem `model` ręcznie (idziemy w
// górę łańcucha rodziców aż do `model` włącznie), a NIE przez
// `node.matrixWorld` — to ostatnie włączyłoby też aktualną, zmienną w czasie
// pozycję `grp` w świecie, której tu NIE chcemy (hull liczymy raz, niezależnie
// od tego, gdzie samolot akurat lata). Rzutuje na płaszczyznę X-Z (widok z
// góry) i liczy convex hull. Zwraca tablicę { x, z } gotową do użycia jako
// obrys cienia.
function computeShadowHullFromModel(model) {
  const pts = [];
  const v = new THREE.Vector3();
  model.updateMatrix();
  const modelMatrix = model.matrix;
  model.traverse(node => {
    if (!node.isMesh || !node.geometry || node === model) return;
    if (SHADOW_HULL_EXCLUDE_PREFIXES.some(p => node.name.startsWith(p))) return;
    const posAttr = node.geometry.attributes.position;
    if (!posAttr) return;

    // Łańcuch macierzy lokalnych od `model` (wyłącznie) do `node` włącznie.
    const chain = [];
    let cur = node;
    while (cur && cur !== model) {
      cur.updateMatrix();
      chain.unshift(cur.matrix);
      cur = cur.parent;
    }
    const full = modelMatrix.clone();
    for (const m of chain) full.multiply(m);

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(full);
      pts.push({ x: v.x, z: v.z });
    }
  });
  if (pts.length < 3) return null;
  return _convexHull2D(pts);
}

// Triangulacja "fan" od centroidu — poprawna dla WYPUKŁEGO wielokąta (convex
// hull jest z definicji wypukły, więc to zawsze daje poprawną, nieprzecinającą
// się triangulację, w przeciwieństwie do ręcznie rysowanego obrysu wcześniej).
function _buildShadowFanIndices(n) {
  const idx = [];
  for (let i = 0; i < n; i++) {
    idx.push(0, 1 + i, 1 + ((i + 1) % n));
  }
  return new Uint16Array(idx);
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

// ── Autorytet steru wysokości (elevator authority) ─────────────────────────────
//
// Zamiast sztywnego progu "poniżej VR nic nie robi, od VR*0.98 pełen auto-rotate",
// siła, z jaką ster wysokości potrafi obrócić samolot wokół kół głównych, rośnie
// PŁYNNIE z ciśnieniem dynamicznym (q ~ prędkość²) — dokładnie tak jak w realnym
// samolocie: skuteczność powierzchni sterowych zależy od naporu powietrza na nie,
// więc rośnie z kwadratem prędkości, nie liniowo. Efekt: przy 10 kt praktycznie
// nic nie da się zrobić (brak przepływu nad usterzeniem ogonowym), a im szybciej,
// tym łatwiej unieść i UTRZYMAĆ nos w górze — bez sztucznego "pociągnięcia za sznurek"
// przy jednej konkretnej prędkości.
const ELEVATOR_MIN_KT  = 15;  // poniżej tej prędkości ster wysokości praktycznie nie działa (brak przepływu)
const ELEVATOR_FULL_KT = 95;  // od tej prędkości pełna skuteczność steru (dalej już nie rośnie)

function elevatorAuthority(speedKt) {
  if (speedKt <= ELEVATOR_MIN_KT) return 0;
  if (speedKt >= ELEVATOR_FULL_KT) return 1;
  // Normalizowany zakres 0..1 w paśmie [MIN, FULL], podniesiony do kwadratu —
  // odzwierciedla to, że siła aerodynamiczna na sterze ~ q ~ v², a nie samo v.
  const t = (speedKt - ELEVATOR_MIN_KT) / (ELEVATOR_FULL_KT - ELEVATOR_MIN_KT);
  return t * t;
}

// ── Odbicie sprężyste przy mocnym/nietypowym uderzeniu w teren ────────────────
//
// Normalne, łagodne osiadanie na 3 punktach podwozia (patrz settleOnGear) zostaje
// bez zmian — to obsługuje zwykłe lądowania i kołowanie. Ale gdy samolot uderzy
// w teren z dużą prędkością PIONOWĄ (twarde lądowanie / "zaorywanie" ziemi) albo
// wjedzie w stromą ścianę terenu przy dużej prędkości POZIOMEJ (np. w zbocze
// góry), to nie jest już "osiadanie zawieszenia" — to zderzenie, które powinno
// fizycznie odrzucić samolot: odbicie wektora prędkości względem normalnej
// terenu w miejscu uderzenia, z tłumieniem (coefficient of restitution) — część
// energii uderzenia jest tracona (deformacja/hałas/ciepło), reszta wraca jako
// odbicie, dokładnie jak przy zderzeniu sprężystym z tłumieniem.
const BOUNCE_TRIGGER_VSPEED   = 7.2;  // m/s prędkości pionowej w dół — od tego uznajemy uderzenie za "twarde" (nie zwykłe osiadanie)
const BOUNCE_TRIGGER_HSPEED_INTO_SLOPE = 8.5; // m/s składowej prędkości WCHODZĄCEJ w stromy teren (wzdłuż normalnej), przy locie w zbocze
const BOUNCE_RESTITUTION      = 0.28; // ułamek prędkości normalnej odbitej z powrotem (0=brak odbicia/pochłonięte, 1=idealnie sprężyste)
const BOUNCE_TANGENT_DAMPING  = 0.82; // ułamek prędkości stycznej zachowanej po uderzeniu (tarcie/poślizg podczas odbicia)
const BOUNCE_MIN_UP_SPEED     = 1.8;  // m/s — minimalna prędkość "w górę" nadana przy odbiciu, żeby efekt był czytelny nawet przy uderzeniu prawie stycznym
const BOUNCE_ON_GROUND_SLOPE_DEG = 20; //° — przy wejściu w zbocze o takim kącie lub większym, a przy dużej prędkości po ziemi, samolot odskakuje zamiast "przyklejać" się do terenu
const BOUNCE_ON_GROUND_MIN_SPEED = 24.0; // m/s — minimalna prędkość po ziemi, przy której aktywujemy ten efekt
const GROUND_SLOPE_ACCEL_GAIN = 0.55; // mnożnik przyspieszenia grawitacyjnego wzdłuż spadku terenu
const GROUND_SLOPE_DAMPING = 0.99965; // lekki tłumik, żeby ruch po ziemi nie był zbyt sztywny

const planeInput = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false,
  brakes: false,
};

// ── Bufory wielokrotnego użytku dla _updateShadow() ────────────────────────
// Alokowane RAZ (nie co klatkę/punkt) — _updateShadow() liczy do 18 punktów co
// klatkę, więc unikanie alokacji tu ma realne znaczenie dla GC/framerate.
const _shadowLightDir  = new THREE.Vector3();
const _shadowLocalVec  = new THREE.Vector3();
const _shadowWorldVec  = new THREE.Vector3();
const _shadowHitVec    = new THREE.Vector3();
const _shadowEuler     = new THREE.Euler();
const _shadowQuat      = new THREE.Quaternion();
let   _shadowLastGroundY = 0;
function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── Encja samolotu A321 ────────────────────────────────────────────────────────

class A321Entity extends Entity {
  constructor(opts = {}) {
    super(Object.assign({ type: 'aircraft' }, opts));
    this.yawRad   = opts.yawRad   ?? 0;
    this.pitchRad = opts.pitchRad ?? 0;
    this.rollRad  = 0;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel = new THREE.Vector3(0, 0, 0);
    this.throttle = 0;
    this.flaps = 1;
    this.gearDown = true;
    this.spoilers = false;
    this.onGround = true;
    // Niezależny stan "wgniecenia" zawieszenia każdej goleni (m) + flaga, czy
    // dana goleń aktualnie dotyka ziemi (do wykrywania chwili uderzenia) — patrz sampleGear()/settleOnGear().
    this.gearSink = { nose: 0, left: 0, right: 0 };
    this._gearTouch = { nose: false, left: false, right: false };
    // Tryb dokładnego sprawdzania podwozia (patrz GEAR_FAR_CHECK_* i sampleGearPoint/sampleGear).
    // Start jako "blisko ziemi" — bezpieczny domyślny stan tuż po starcie/spawnie.
    this._nearGroundZone = true;
    this.autoRotateArmed = false;
    this.airspeed = 0;
    this.vs = 0;
    this._alpha = 0; this._cl = 0; this._isStalling = false;
    this.terrainZoom = 15; // maks. dostępna dokładność danych wysokościowych (~3 m/px) — tyle samo, co dla renderowanego terenu (patrz sim-terrain.js: buildMeshWithNeighbors ogranicza DEM do z15)

    const grp = new THREE.Group();
    this.mesh = grp;
    this.modelLoaded = false;
    this._parts = {}; // cache animowanych części — wypełniane po wczytaniu modelu

    // Kulki-znaczniki 3 punktów kolizji podwozia (patrz GEAR_MARKER_*) — osobne
    // meshe DODANE BEZPOŚREDNIO DO SCENY (nie do `grp`), bo mają własną pozycję
    // światową liczoną z sampleGear() (a nie transformację względem samolotu).
    this._gearMarkers = {};
    for (const k of ['nose', 'left', 'right']) {
      const mat = new THREE.MeshBasicMaterial({ color: GEAR_MARKER_COLORS[k], transparent: true, opacity: 0.35, depthTest: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(GEAR_MARKER_RADIUS, 12, 10), mat);
      m.renderOrder = 999;
      m.visible = false;
      scene.add(m);
      this._gearMarkers[k] = m;
    }
    // Cień 3D w kształcie PRAWDZIWEJ sylwetki modelu — nie możemy zbudować go
    // TERAZ (model jeszcze się nie wczytał, a hull=obrys zależy od jego
    // geometrii). Zbudujemy go leniwie, w .then() poniżej, zaraz po
    // computeShadowHullFromModel(). Do tego czasu cień po prostu nie istnieje
    // (nie jest jeszcze dodany do sceny) — to bezpieczne, bo _updateShadow()
    // sprawdza `if (!this._shadow) return;` na starcie.
    this._shadow = null;
    this._shadowHull = null;
    this._shadowPos = null;
    // Stan odbicia sprężystego (patrz applyBounce()) — licznik krótkiego "cooldownu"
    // żeby jedno mocne uderzenie nie wywoływało kilku odbić pod rzędem w kolejnych
    // klatkach, zanim samolot zdąży się realnie oddalić od terenu.
    this._bounceCooldown = 0;

    loadA321Model().then(model => {
      model.rotation.y = A321_MODEL_ROT_Y;
      model.scale.setScalar(A321_MODEL_SCALE);
      model.translateY(A321_MODEL_TRANSLATE_Y);
      grp.add(model);
      this.modelLoaded = true;
      this.updateGearVisibility();

      // Buduj cień z PRAWDZIWEJ geometrii modelu, TERAZ gdy model.matrix jest
      // już ustawiona (rotation.y/scale/translateY wyżej) — patrz
      // computeShadowHullFromModel(). Liczone WYŁĄCZNIE RAZ (koszt rzędu
      // kilkudziesięciu ms dla ~35 tys. wierzchołków), NIE co klatkę.
      const hull = computeShadowHullFromModel(model);
      if (hull && hull.length >= 3) {
        this._shadowHull = hull;
        const n = hull.length;
        const shadowGeo = new THREE.BufferGeometry();
        const shadowPosArr = new Float32Array((n + 1) * 3);
        shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPosArr, 3));
        shadowGeo.setIndex(new THREE.BufferAttribute(_buildShadowFanIndices(n), 1));
        this._shadow = new THREE.Mesh(
          shadowGeo,
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          })
        );
        this._shadow.renderOrder = 998;
        this._shadow.frustumCulled = false;
        this._shadow.visible = false;
        this._shadowPos = shadowPosArr;
        scene.add(this._shadow);
      } else {
        console.warn('[A321] Nie udało się policzyć obrysu cienia z geometrii modelu (za mało wierzchołków?) — cień będzie wyłączony.');
      }

      // Wyszukaj animowane części RAZ — getObjectByName() przechodzi cały graf
      // sceny, więc robienie tego co klatkę (jak wcześniej w renderUpdate) jest
      // niepotrzebnym kosztem. Wynik cache'ujemy raz, po wczytaniu modelu.
      this._parts = {
        fanR:      this.mesh.getObjectByName('fan_R'),
        fanL:      this.mesh.getObjectByName('fan_L'),
        beacon:    this.mesh.getObjectByName('beacon'),
        flapR:     this.mesh.getObjectByName('flap_R'),
        flapL:     this.mesh.getObjectByName('flap_L'),
        spoilerR:  this.mesh.getObjectByName('spoiler_R'),
        spoilerL:  this.mesh.getObjectByName('spoiler_L'),
        elevatorR: this.mesh.getObjectByName('elevator_R'),
        elevatorL: this.mesh.getObjectByName('elevator_L'),
        rudder:    this.mesh.getObjectByName('rudder'),
      };

    }).catch(err => console.error('[A321] Błąd wczytywania modelu:', err));

    this.fanAngle = 0;
    this.beaconTimer = 0;
    this.prevFlapPos = 0;
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
    this.flaps = opts.flaps ?? 1;
    this.gearDown = opts.gearDown ?? true;
    this.spoilers = false;
    this.onGround = opts.onGround ?? true;
    this.gearSink = { nose: 0, left: 0, right: 0 };
    this._gearTouch = { nose: false, left: false, right: false };
    this._nearGroundZone = opts.onGround ?? true;
    this.autoRotateArmed = false;
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll = 0;
    this.updateGearVisibility();
  }

  updateGearVisibility() {
    const gearGrp = this.mesh.getObjectByName('gearGroup');
    if (gearGrp) gearGrp.visible = this.gearDown;
  }

  // DEBUG: rzuca ostrzeżenie w konsoli, gdy wysokość terenu pod danym punktem
  // NIE pochodzi z najdokładniejszego dostępnego DEM (this.terrainZoom, domyślnie
  // Z15) — czyli w tym miejscu jeszcze się nie wczytał. Throttlowane per punkt,
  // żeby nie zasypać konsoli, gdyby to trwało dłuższą chwilę. Wyłączane przez
  // window.DEBUG_GEAR = false w konsoli przeglądarki.
  _debugZoomWarn(label, lat, lon, zoomUsed) {
    if (!window.DEBUG_GEAR) return;
    if (!this._debugZoomLog) this._debugZoomLog = {};
    const now = performance.now();
    const last = this._debugZoomLog[label];
    if (last && last.zoom === zoomUsed && now - last.t < 2000) return;
    this._debugZoomLog[label] = { zoom: zoomUsed, t: now };
    console.warn(
      `[GEAR DEBUG] "${label}": brak DEM Z${this.terrainZoom} w (${lat.toFixed(6)}, ${lon.toFixed(6)}) ` +
      `— użyto Z${zoomUsed} zamiast. onGround=${this.onGround} altM=${this.altM.toFixed(1)}`
    );
  }

  // Próbkuje teren pod JEDNYM punktem lokalnym samolotu (offset w metrach
  // względem origin encji, w lokalnym układzie +X prawo/+Y góra/+Z dziób).
  // noseDir/wingRight/acUp to jednostkowe wektory lokalnych osi samolotu już
  // przeliczone na przestrzeń świata — liczone wcześniej w physicsUpdate().
  // Zwraca: przesunięcie względem origin encji, wysokość n.p.m. tego punktu,
  // wysokość terenu pod nim, penetrację (dodatnia = punkt już w/pod ziemią) i
  // zoomUsed (DEBUG: z jakiego zoomu DEM faktycznie pochodzi wysokość).
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

  // Próbkuje teren NIEZALEŻNIE pod każdym z 3 punktów podwozia (przednie koło,
  // lewe i prawe główne) — patrz sampleGearPoint().
  sampleGear(noseDir, wingRight, acUp) {
    return {
      nose:  this.sampleGearPoint(GEAR_NOSE,  noseDir, wingRight, acUp, 'nose'),
      left:  this.sampleGearPoint(GEAR_LEFT,  noseDir, wingRight, acUp, 'left'),
      right: this.sampleGearPoint(GEAR_RIGHT, noseDir, wingRight, acUp, 'right'),
    };
  }

  // Liczy przybliżoną normalną terenu (jednostkowy wektor w górę, prostopadły do
  // zbocza) pod dowolnym punktem geo, próbkując wysokość w 4 sąsiednich punktach
  // (różnice centralne) — potrzebne do applyBounce(), żeby odbicie od stromego
  // zbocza szło w sensownym kierunku, nie tylko pionowo w górę.
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

  // Odbicie sprężyste przy mocnym/nietypowym uderzeniu w teren (patrz BOUNCE_*).
  // Wywoływane raz, w chwili świeżego, twardego kontaktu — modyfikuje this.vel
  // bezpośrednio (odbija składową normalną, tłumi składową styczną). Zwraca true
  // jeśli faktycznie doszło do odbicia.
  applyBounce(gear, opts = {}) {
    if (this._bounceCooldown > 0) return false;
    const impactVy = Math.max(0, -this.vel.y);
    const best = this.bestGearPoint(gear);
    const off = best.point.offset;
    const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
    const normal = this.terrainNormalAt(glat, glon);
    const slopeAngleDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;

    const velIntoSlope  = -this.vel.dot(normal);
    const hardVertical   = impactVy >= BOUNCE_TRIGGER_VSPEED;
    const hardIntoSlope  = velIntoSlope >= BOUNCE_TRIGGER_HSPEED_INTO_SLOPE;
    const hardGroundDrop = !!opts.allowWhileOnGround && this.onGround && this.gearDown &&
      this.vel.length() >= BOUNCE_ON_GROUND_MIN_SPEED &&
      slopeAngleDeg >= BOUNCE_ON_GROUND_SLOPE_DEG &&
      velIntoSlope >= 4.5;
    if (!hardVertical && !hardIntoSlope && !hardGroundDrop) return false;

    const vNormal  = normal.clone().multiplyScalar(this.vel.dot(normal));
    const vTangent = this.vel.clone().sub(vNormal);
    const incomingNormalSpeed = Math.max(0, -this.vel.dot(normal));
    const flatGroundScale = slopeAngleDeg < 8 ? 0.35 : slopeAngleDeg < 16 ? 0.6 : 1.0;
    const bounceSpeed = Math.max(incomingNormalSpeed * (hardGroundDrop ? 0.72 : BOUNCE_RESTITUTION * flatGroundScale), hardGroundDrop ? 5.5 : BOUNCE_MIN_UP_SPEED * flatGroundScale);
    const newVel = vTangent.multiplyScalar(hardGroundDrop ? 0.45 : BOUNCE_TANGENT_DAMPING).addScaledVector(normal, bounceSpeed);

    this.vel.copy(newVel);
    this._bounceCooldown = hardGroundDrop ? 0.24 : 0.35;
    this.onGround = false;
    this._nearGroundZone = true;

    if (window.DEBUG_GEAR) {
      console.warn(`[BOUNCE] Twarde uderzenie w teren (${best.key}) — impactVy=${impactVy.toFixed(1)} m/s, velIntoSlope=${velIntoSlope.toFixed(1)} m/s, slope=${slopeAngleDeg.toFixed(1)}° → odbicie ${bounceSpeed.toFixed(1)} m/s wzdłuż normalnej.`);
    }
    return true;
  }

  // Osadza samolot na podwoziu na podstawie próbki z sampleGear(): aktualizuje
  // "wgniecenie" zawieszenia każdej goleni (mocniejsze przy twardszym dotknięciu,
  // potem wraca do niewielkiego ugięcia spoczynkowego — na razie czysto
  // fizycznie, bez animacji samej goleni, to osobny krok na później), dociąga
  // pitch/roll do kąta wynikającego z RZECZYWISTEGO terenu pod kołami (samolot
  // nie może np. stać z uniesionym przednim kołem w powietrzu — musi ono opaść),
  // i ustawia altM tak, by koło główne stało dokładnie na (obniżonym o wgniecenie) terenie.
  settleOnGear(gear, dtCap, isRotating) {
    const impactVy = Math.max(0, -this.vel.y); // prędkość opadania w chwili tej klatki
    for (const k of ['nose', 'left', 'right']) {
      const touching = gear[k].pen >= 0;
      if (touching && !this._gearTouch[k]) {
        // świeże dotknięcie tej goleni — "wbij" amortyzator proporcjonalnie do prędkości uderzenia
        const baseImpact = Math.min(GEAR_SUSPENSION_TRAVEL - GEAR_STATIC_SAG, impactVy * GEAR_IMPACT_SINK_PER_MS);
        const extraMainImpact = (k === 'left' || k === 'right') ? baseImpact * GEAR_IMPACT_MAIN_SINK_MULT : baseImpact;
        this.gearSink[k] = Math.min(GEAR_SUSPENSION_TRAVEL, this.gearSink[k] + GEAR_STATIC_SAG + extraMainImpact);
      }
      this._gearTouch[k] = touching;
      const target = touching ? GEAR_STATIC_SAG : 0;
      const blend  = 1 - Math.exp(-dtCap / GEAR_SINK_SETTLE_TAU);
      this.gearSink[k] += (target - this.gearSink[k]) * blend;
    }

    const gN = gear.nose.groundH  - this.gearSink.nose;
    const gL = gear.left.groundH  - this.gearSink.left;
    const gR = gear.right.groundH - this.gearSink.right;
    const gMainAvg = (gL + gR) * 0.5;

    // Przechył: samolot zawsze "ślizga się" do kąta wynikającego z terenu pod
    // lewym/prawym kołem głównym — na kołach nie da się utrzymać banku samemu.
    const rollTarget  = (gL - gR) / (GEAR_RIGHT.x - GEAR_LEFT.x);
    // Pochylenie: kąt, przy którym i przednie, i główne koło dotykają swojego
    // (już obniżonego o wgniecenie) terenu jednocześnie.
    const pitchTarget = (gN - gMainAvg - (GEAR_NOSE.y - GEAR_LEFT.y)) / (GEAR_NOSE.z - GEAR_LEFT.z);

    // Normalnie pitch/roll płynnie "dociąga się" do kąta spoczynkowego (efekt
    // zawieszenia). Ale jeśli samolot jest już wyraźnie pod ziemią (patrz
    // GEAR_EMERGENCY_PEN_M) — to sytuacja awaryjna, nie zwykłe lądowanie — wtedy
    // ustawiamy pitch/roll (a więc i altM niżej) od razu, bez płynnego przejścia.
    const maxPen = Math.max(gear.nose.pen, gear.left.pen, gear.right.pen);
    const isEmergency = maxPen > GEAR_EMERGENCY_PEN_M;
    if (isEmergency && window.DEBUG_GEAR) {
      // DEBUG: throttlowany pełny zrzut stanu w chwili awaryjnego zanurzenia —
      // pozwala sprawdzić m.in. czy to kwestia brakującego DEM (zoomUsed < 15
      // na którejś goleni) czy czegoś innego. Wyłączane przez window.DEBUG_GEAR = false.
      const now = performance.now();
      if (!this._debugEmergencyLastLog || now - this._debugEmergencyLastLog > 300) {
        this._debugEmergencyLastLog = now;
        console.error(
          `[GEAR DEBUG] AWARYJNE zanurzenie w ziemię! maxPen=${maxPen.toFixed(2)}m ` +
          `lat=${this.lat.toFixed(6)} lon=${this.lon.toFixed(6)} altM=${this.altM.toFixed(1)} ` +
          `vel=(${this.vel.x.toFixed(1)},${this.vel.y.toFixed(1)},${this.vel.z.toFixed(1)}) ` +
          `onGround=${this.onGround} pitch=${(this.pitchRad * 180 / Math.PI).toFixed(1)}° roll=${(this.rollRad * 180 / Math.PI).toFixed(1)}°\n` +
          `  nose:  pen=${gear.nose.pen.toFixed(2)}  groundH=${gear.nose.groundH.toFixed(1)}  zoom=Z${gear.nose.zoomUsed}\n` +
          `  left:  pen=${gear.left.pen.toFixed(2)}  groundH=${gear.left.groundH.toFixed(1)}  zoom=Z${gear.left.zoomUsed}\n` +
          `  right: pen=${gear.right.pen.toFixed(2)}  groundH=${gear.right.groundH.toFixed(1)}  zoom=Z${gear.right.zoomUsed}`
        );
      }
    }
    const attBlend = isEmergency
      ? 1 - Math.exp(-dtCap / GEAR_EMERGENCY_SETTLE_TAU)
      : 1 - Math.exp(-dtCap / GEAR_ATTITUDE_SETTLE_TAU);

    this.rollRad += (rollTarget - this.rollRad) * attBlend;
    // Podczas rotacji na starcie (isRotating=true, patrz isRotatingGround w
    // physicsUpdate) pitchem steruje bezpośrednio pilot przez elevatorAuthority —
    // tu go nie dotykamy, żeby nie "ściągać" dziobu z powrotem w trakcie odrywania koła.
    if (!isRotating) this.pitchRad += (pitchTarget - this.pitchRad) * attBlend;

    // Koło główne zawsze "przyklejone" do terenu pod nim, przy aktualnym pochyleniu.
    this.altM = gMainAvg - (GEAR_LEFT.y + GEAR_LEFT.z * this.pitchRad);
  }

  integrate(dt) {}

  get worldPos() {
    return geoToWorld(this.lat, this.lon, this.altM * DEM_EXAG);
  }

  syncMesh() {
    if (!this.mesh) return;
    const p = this.worldPos;
    this.mesh.position.copy(p);
    this.mesh.rotation.set(-this.pitchRad, this.yawRad, this.rollRad, 'YXZ');
  }

  physicsUpdate(dt, input) {
    const dtCap = Math.min(dt, 0.05);
    const airspeed = this.vel.length();
    if (this._bounceCooldown > 0) this._bounceCooldown = Math.max(0, this._bounceCooldown - dtCap);

    if (input.throttleUp)   this.throttle = Math.min(1, this.throttle + dtCap * 0.6);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dtCap * 0.8);

    const speedKt = Units.msToKt(airspeed);
    // Autorytet steru wysokości/lotek w powietrzu (jak wcześniej: rośnie z prędkością
    // od 12 do 52 m/s) — używany TYLKO gdy samolot lata. Na ziemi rotacją (unoszeniem
    // przedniego koła) rządzi teraz osobno elevatorAuthority(speedKt) niżej, bo
    // fizyka steru wysokości przy kołowaniu/rozbiegu jest inna niż w locie (działa
      // wokół kół głównych, nie wokół środka masy).
    const ctrlEff = Math.max(0, Math.min(1.0, (airspeed - 12.0) / 40.0));
    const pitchInput = input.pitch;
    const rollInput  = input.roll;
    const yawInput   = input.yaw;

    // ── Unoszenie przedniego koła (rotacja) na ziemi ────────────────────
    // Realistyczny model: siła dostępna na sterze wysokości rośnie PŁYNNIE z
    // ciśnieniem dynamicznym (prawie zero <15kt, pełna skuteczność >=95kt — patrz
    // elevatorAuthority()). To ZASTĘPUJE dawny sztywny próg "autoRotateArmed" przy
    // VR*0.98: teraz można zacząć delikatnie unosić nos już przy kilkudziesięciu
    // węzłach, ale wymaga to trzymania drążka — im wolniej, tym słabszy efekt i
    // łatwiej nos opadnie z powrotem, dokładnie jak w prawdziwym samolocie.
    const groundElevAuth = this.onGround ? elevatorAuthority(speedKt) : 0;
    // Rotacja aktywna, gdy pilot RZECZYWIŚCIE ciągnie drążek do siebie na ziemi z
    // jakąkolwiek dostępną siłą steru — to zastępuje stary autoRotateArmed/VR i
    // pozwala settleOnGear() nie "przyklejac" nosa, gdy pilot aktywnie ciągnie.
    const isRotatingGround = this.onGround && pitchInput > 0.02 && groundElevAuth > 0.001;

    if (this.onGround) {
      // Na ziemi pitch rate reaguje na siłę steru wg elevatorAuthority — nos nie
      // "skacze" przy jednej konkretnej prędkości, tylko płynnie łatwiej reaguje z
      // prędkością. Pchnięcie drążka od siebie (pitchInput<0) zawsze działa z pełną
      // siłą niezależnie od prędkości — opuszczenie przedniego koła z powrotem na
      // ziemię nie wymaga przepływu nad usterzeniem, wystarczy grawitacja/moment.
      const pushDown = pitchInput < 0 ? -pitchInput * 1.4 : 0;
      const pullUp   = pitchInput > 0 ? pitchInput * 1.9 * groundElevAuth : 0;
      this.pitchRate += (pullUp - pushDown) * dtCap;
      this.pitchRate *= Math.pow(0.06, dtCap);
      this.rollRate = 0; // na 3 kołach nie da się samemu przechylić — o kąt banku decyduje wyłącznie teren pod kołami (patrz settleOnGear)
    } else {
      this.pitchRate += pitchInput * 1.4 * ctrlEff * dtCap;
      this.pitchRate *= Math.pow(0.05, dtCap);
      this.rollRate  += rollInput * 1.6 * ctrlEff * dtCap;
      this.rollRate  *= Math.pow(0.04, dtCap);
    }

    this.pitchRad += this.pitchRate * dtCap;
    this.rollRad  += this.rollRate  * dtCap;
    // Limit górny pitch na ziemi to kąt "tail strike" — dalej ogon zaryje w pas.
    this.pitchRad  = Math.max(-0.45, Math.min(this.onGround ? 0.22 : 0.52, this.pitchRad));
    this.rollRad   = Math.max(-1.40, Math.min(1.40, this.rollRad));

    const forward = new THREE.Vector3(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    if (this.onGround) {
      this.yawRad += (yawInput * 1.8 + rollInput * 0.3) * dtCap;
      forward.set(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
    } else if (airspeed > 8) {
      this.yawRad -= (G_ACC * Math.tan(this.rollRad) / airspeed) * dtCap;
      this.yawRad += yawInput * 0.4 * ctrlEff * dtCap;
    }

    const noseDir = new THREE.Vector3(
      forward.x * Math.cos(this.pitchRad),
      Math.sin(this.pitchRad),
      forward.z * Math.cos(this.pitchRad)
    ).normalize();
    const worldUp  = new THREE.Vector3(0, 1, 0);
    const rightVec = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
    const rollQ    = new THREE.Quaternion().setFromAxisAngle(noseDir, -this.rollRad);
    const wingRight = rightVec.clone().applyQuaternion(rollQ);
    const acUp     = new THREE.Vector3().crossVectors(noseDir, wingRight).normalize();

    const fpa = airspeed > 2
      ? Math.asin(Math.max(-1, Math.min(1, this.vel.y / airspeed)))
      : 0;
    const alpha = this.pitchRad - fpa;

    const flap = this.flaps;
    const isStalling = !this.onGround && Math.abs(alpha) > A321_PARAMS.flapStall[flap];
    let cl;
    if (isStalling) {
      const over = Math.abs(alpha) - A321_PARAMS.flapStall[flap];
      cl = Math.sign(alpha) * Math.max(0.15, (A321_PARAMS.clMax + A321_PARAMS.flapCl[flap]) - over * 4.0);
    } else {
      cl = A321_PARAMS.cl0 + A321_PARAMS.flapCl[flap] + A321_PARAMS.clAlpha * alpha;
    }
    if (this.spoilers) cl -= A321_PARAMS.spoilerLiftLoss;
    const groundRun = this.onGround && this.gearDown;
    const liftScale = groundRun ? A321_PARAMS.groundRunLiftScale : 1.0;
    const dragScale = groundRun ? A321_PARAMS.groundRunDragScale : 1.0;
    cl *= liftScale;
    cl = Math.max(-0.3, Math.min(A321_PARAMS.clMax + A321_PARAMS.flapCl[flap], cl));

    const groundH = this.groundHeight();
    const gearOffset = this.gearDown ? 3.15 : 0.5;
    const agl_now = this.altM - groundH - gearOffset;
    const gef = groundEffectFactor(agl_now, A321_PARAMS.span);
    const cdi = (cl * cl) / (Math.PI * A321_PARAMS.eOswald * A321_PARAMS.AR) * gef;
    const cd  = (A321_PARAMS.cdMin + A321_PARAMS.flapCd[flap] + (this.gearDown ? A321_PARAMS.cdGear : 0)
              + cdi + A321_PARAMS.cdAlpha * alpha * alpha + (this.spoilers ? A321_PARAMS.spoilerCd : 0)) * dragScale;

    const q       = 0.5 * RHO * airspeed * airspeed;
    const liftMag = q * A321_PARAMS.wingArea * cl;
    const dragMag = q * A321_PARAMS.wingArea * Math.max(0, cd);

    const weightN   = A321_PARAMS.mass * G_ACC;
    const thrustScale = groundRun ? A321_PARAMS.groundRunThrustBoost : 1.0;
    const thrustVec = noseDir.clone().multiplyScalar(this.throttle * A321_PARAMS.maxThrust * thrustScale);
    const dragVec   = airspeed > 0.1 ? this.vel.clone().normalize().multiplyScalar(-dragMag) : new THREE.Vector3();
    const liftVec   = acUp.clone().multiplyScalar(liftMag);

    // ── Kontakt z ziemią: 3 niezależne punkty (przednie koło + lewe/prawe
    //    główne koło), każdy z własnym pomiarem terenu pod sobą — patrz
    //    sampleGear(). Z dala od ziemi liczymy co klatkę tylko JEDEN, tani punkt
    //    (środek kół głównych) zamiast wszystkich trzech; gdy to pokaże
    //    zbliżanie się do ziemi, przełączamy się na dokładne sprawdzanie 3
    //    punktów (this._nearGroundZone) aż do oddalenia się z zapasem. Dla
    //    schowanego podwozia (lądowanie na kadłubie) zostaje stary,
    //    jednopunktowy model (gearOffset) — patrz gałąź powietrzna niżej.
    if (this.gearDown && !this.onGround && !this._nearGroundZone) {
      const mid = this.sampleGearPoint(GEAR_MAIN_MID, noseDir, wingRight, acUp, 'mid');
      if (-mid.pen < GEAR_FAR_CHECK_ENTER_AGL) this._nearGroundZone = true;
    }

    let gear = null;
    if (this.gearDown && (this.onGround || this._nearGroundZone)) {
      gear = this.sampleGear(noseDir, wingRight, acUp);
    }
    const gearContact = !!gear && Math.max(gear.nose.pen, gear.left.pen, gear.right.pen) >= 0;

    if (this.gearDown && !this.onGround && this._nearGroundZone && gear) {
      const mainAgl = -((gear.left.pen + gear.right.pen) / 2);
      if (mainAgl > GEAR_FAR_CHECK_EXIT_AGL) this._nearGroundZone = false;
    }

    // ── Odbicie sprężyste przy świeżym, TWARDYM kontakcie ────────────────
    // Wykrywane nie tylko przy pierwszym kontakcie z ziemią, ale też wtedy, gdy
    // samolot jedzie po ziemi w stronę stromego spadku i nagle wpada w jego
    // ścianę — wtedy zamiast bezwładnie "przyklejać" się do terenu, powinien
    // odskoczyć. Jeśli applyBounce() uzna uderzenie za wystarczająco twarde,
    // ustawia this.onGround=false i modyfikuje vel — wtedy POMIJAMY settleOnGear
    // w tej samej klatce (samolot już "odskakuje").
    let bounced = false;
    if (gearContact && this.gearDown && gear) {
      bounced = this.applyBounce(gear, { allowWhileOnGround: this.onGround });
    }

    if (bounced) {
      // nic więcej do zrobienia w tej klatce — vel już ustawiony przez applyBounce,
      // samolot przechodzi do gałęzi "w powietrzu" niżej w NASTĘPNEJ klatce.
    } else if (this.onGround || gearContact) {
      if (gearContact) this.onGround = true;

      // Zawsze koryguj pozycję/pochylenie na podwoziu, gdy wykryto kontakt —
      // NIEZALEŻNIE od tego, czy zaraz potem samolot odklei się od ziemi dzięki
      // wystarczającej sile nośnej. Bez tego (dawny błąd): jeśli samolot miał
      // dość siły nośnej żeby "chcieć" lecieć, korekta w ogóle się nie
      // wykonywała (bo `onGround` od razu wracało na false niżej) i samolot mógł
      // zostać zamurowany pod terenem na długi czas, choć formalnie "miał dosyć
      // siły nośnej, żeby lecieć".
      if (this.gearDown && gear) {
        this.settleOnGear(gear, dtCap, isRotatingGround);
      } else if (!this.gearDown) {
        this.altM = groundH + gearOffset; // lądowanie na kadłubie (gear w górze) — bez zmian
      }

      if (liftVec.y >= weightN) {
        this.onGround = false;
      } else {
        const hs = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
        const brake = input.brakes ? 5.0 : 0.06;
        const spoilerBrake = this.spoilers ? 8.0 : 0;
        const totalBrake = brake + spoilerBrake;

        // Przyspieszenie po stromym terenie: gdy koła są na ziemi i samolot
        // zjeżdża po zboczu, dodatkowo „ciągnie” go w dół po powierzchni, co
        // daje bardziej naturalne przyspieszenie i poczucie „staczania się z góry".
        const best = this.bestGearPoint(gear);
        const off = best.point.offset;
        const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
        const normal = this.terrainNormalAt(glat, glon);
        const tangent = new THREE.Vector3(0, -1, 0).sub(normal.clone().multiplyScalar(normal.y));
        let slopeAngleDeg = 0;
        if (tangent.lengthSq() > 1e-6) {
          tangent.normalize();
          const slopeAngle = Math.acos(Math.max(-1, Math.min(1, normal.y)));
          slopeAngleDeg = slopeAngle * 180 / Math.PI;
          const slopeAccel = slopeAngleDeg > 8 && hs > 10
            ? G_ACC * Math.sin(slopeAngle) * GROUND_SLOPE_ACCEL_GAIN * Math.min(1.0, Math.max(0.2, hs / 35.0))
            : 0;
          this.vel.x += tangent.x * slopeAccel * dtCap;
          this.vel.z += tangent.z * slopeAccel * dtCap;
        }

        this.vel.x += ((thrustVec.x + dragVec.x) / A321_PARAMS.mass - (hs > 0.05 ? this.vel.x / hs * totalBrake : 0)) * dtCap;
        this.vel.z += ((thrustVec.z + dragVec.z) / A321_PARAMS.mass - (hs > 0.05 ? this.vel.z / hs * totalBrake : 0)) * dtCap;
        const turnDemand = Math.min(1, Math.abs(yawInput) + Math.abs(rollInput) * 0.35);
        if (turnDemand > 0.01) {
          const horizSpeed = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
          const steerFactor = groundSteerTrackFactor(Units.msToKt(horizSpeed));
          if (horizSpeed > 0.5 && steerFactor > 0) {
            const trackDir = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
            const align = 1.0 - Math.exp(-5.2 * steerFactor * turnDemand * dtCap);
            const newTrackDir = trackDir.lerp(forward, align).normalize();
            this.vel.x = newTrackDir.x * horizSpeed;
            this.vel.z = newTrackDir.z * horizSpeed;
          }
        }
        const groundFriction = slopeAngleDeg > 3 ? GROUND_SLOPE_DAMPING : 0.99992;
        this.vel.x *= groundFriction;
        this.vel.z *= groundFriction;
        this.vel.y = 0;
      }
    } else {
      const ax = (thrustVec.x + dragVec.x + liftVec.x) / A321_PARAMS.mass;
      const ay = (thrustVec.y + dragVec.y + liftVec.y) / A321_PARAMS.mass - G_ACC;
      const az = (thrustVec.z + dragVec.z + liftVec.z) / A321_PARAMS.mass;
      this.vel.x += ax * dtCap;
      this.vel.y += ay * dtCap;
      this.vel.z += az * dtCap;

      const newAirspeed = this.vel.length();
      if (newAirspeed > 5) {
        const horizVel = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        const horizSpeed = horizVel.length();
        if (horizSpeed > 0.5) {
          const noseDirXZ = new THREE.Vector3(noseDir.x, 0, noseDir.z).normalize();
          const steer = Math.min(0.12, (q * A321_PARAMS.wingArea * 0.8 / A321_PARAMS.mass) * dtCap);
          const newHorizDir = horizVel.clone().normalize().lerp(noseDirXZ, steer).normalize();
          this.vel.x = newHorizDir.x * horizSpeed;
          this.vel.z = newHorizDir.z * horizSpeed;
        }
      }

      // Fallback wyłącznie dla schowanego podwozia (kadłub) — gear w dole
      // zawsze przechodzi przez gałąź wyżej dzięki wcześniejszemu wykryciu (gearContact).
      if (!this.gearDown && (this.altM - (groundH + gearOffset)) <= 0) {
        this.vel.y = this.vel.y < -3 ? this.vel.y * -0.1 : 0;
        this.altM = groundH + gearOffset;
        this.onGround = true;
      }
    }

    if (this.vel.length() > A321_PARAMS.VMO) this.vel.setLength(A321_PARAMS.VMO);

    const eastVel  = this.vel.x;
    const northVel = -this.vel.z;
    const cosLat = Math.cos(Units.degToRad(this.lat));
    this.lat += (northVel / EARTH_RADIUS) * (180 / Math.PI) * dtCap;
    this.lon += (eastVel  / (EARTH_RADIUS * cosLat)) * (180 / Math.PI) * dtCap;
    this.altM += this.vel.y * dtCap;

    this.airspeed = this.vel.length();
    this.terrainM = groundH;
    this.agl = gear
      ? Math.max(0, -Math.max(gear.nose.pen, gear.left.pen, gear.right.pen))
      : Math.max(0, this.altM - groundH - gearOffset);
    this.vs = this.vel.y;
    this._alpha = alpha; this._cl = cl; this._isStalling = isStalling;
    this.heading = this.headingDeg;
    this.pitch = this.pitchRad * 180 / Math.PI;
    this.roll  = this.rollRad  * 180 / Math.PI;
    this._noseDir = noseDir; this._wingRight = wingRight; this._acUp = acUp;

    // DEBUG: co GEAR_DEBUG_HEARTBEAT_SEC sekund wypisz obecny stan, niezależnie
    // od tego, czy dzieje się coś nietypowego — żeby widać było na bieżąco
    // wysokość samolotu vs teren, nawet jeśli żadne z powyższych zabezpieczeń nie
    // zadziałało. Wyłączane przez window.DEBUG_GEAR = false w konsoli.
    if (window.DEBUG_GEAR) {
      this._debugHeartbeat = (this._debugHeartbeat || 0) + dtCap;
      if (this._debugHeartbeat >= GEAR_DEBUG_HEARTBEAT_SEC) {
        this._debugHeartbeat = 0;
        const gearInfo = gear
          ? ` | nose:${gear.nose.pen.toFixed(2)}(Z${gear.nose.zoomUsed}) left:${gear.left.pen.toFixed(2)}(Z${gear.left.zoomUsed}) right:${gear.right.pen.toFixed(2)}(Z${gear.right.zoomUsed})`
          : ' | (daleko od ziemi — sprawdzany tylko 1 punkt co klatkę)';
        console.warn(
          `[GEAR DEBUG] altM=${this.altM.toFixed(1)} groundH(CG)=${groundH.toFixed(1)} agl=${this.agl.toFixed(1)} ` +
          `vel.y=${this.vel.y.toFixed(1)} onGround=${this.onGround} gearDown=${this.gearDown} nearGroundZone=${this._nearGroundZone} ` +
          `lat=${this.lat.toFixed(6)} lon=${this.lon.toFixed(6)}${gearInfo}`
        );
      }
    }

    this._updateGearMarkers(gear);
  }

  // Aktualizuje pozycję/widoczność/kolor 3 kulek-markerów kolizji podwozia
  // (patrz GEAR_MARKER_*): widoczne TYLKO gdy sampleGear() faktycznie zostało
  // policzone w tej klatce (this._nearGroundZone lub onGround — patrz gear
  // wyżej w physicsUpdate), bo tylko wtedy znamy ich rzeczywistą pozycję.
  // Pełna jasność = koło aktualnie dotyka/koliduje z terenem (pen >= 0),
  // przygaszona = w pobliżu ziemi ale jeszcze w powietrzu — daje wizualny
  // podgląd dokładnie tych samych 3 punktów, których używa silnik fizyki.
  _updateGearMarkers(gear) {
    if (!gear) {
      for (const k of ['nose', 'left', 'right']) this._gearMarkers[k].visible = false;
      return;
    }
    for (const k of ['nose', 'left', 'right']) {
      const g = gear[k];
      const marker = this._gearMarkers[k];
      marker.visible = true;
      // Pozycja w świecie: ten sam punkt geo co użyty w sampleGearPoint(), na
      // wysokości terenu w tym miejscu (a nie na wysokości koła) — tak marker
      // zawsze "leży" na ziemi, dobrze pokazując gdzie fizyka sprawdza kontakt.
      const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, g.offset.x, -g.offset.z);
      marker.position.copy(geoToWorld(glat, glon, g.groundH * DEM_EXAG));
      const touching = g.pen >= 0;
      marker.material.opacity = touching ? 0.85 : 0.25;
      marker.scale.setScalar(touching ? 1.4 : 1.0);
    }
  }

  renderUpdate(dt) {
    this.fanAngle += this.throttle * dt * 30;
    const p = this._parts;
    if (p.fanR) p.fanR.rotation.x = this.fanAngle;
    if (p.fanL) p.fanL.rotation.x = this.fanAngle;
    this.beaconTimer += dt;
    if (p.beacon) p.beacon.visible = Math.sin(this.beaconTimer * 6) > 0;
    const flapTarget = this.flaps * 12 * Math.PI / 180;
    this.prevFlapPos += (flapTarget - this.prevFlapPos) * Math.min(1, dt * 4);
    if (p.flapR) p.flapR.rotation.x = this.prevFlapPos;
    if (p.flapL) p.flapL.rotation.x = this.prevFlapPos;
    const spoilerTarget = this.spoilers ? 35 * Math.PI / 180 : 0;
    if (p.spoilerR) p.spoilerR.rotation.x = -spoilerTarget;
    if (p.spoilerL) p.spoilerL.rotation.x = -spoilerTarget;
    const elevDefl = -this.pitchRate * 0.8;
    if (p.elevatorR) p.elevatorR.rotation.x = elevDefl;
    if (p.elevatorL) p.elevatorL.rotation.x = elevDefl;
    if (p.rudder) p.rudder.rotation.y = this.yawRate * 2;

    this._updateShadow();
  }

  // Prawdziwy cień 3D: liczy pozycję KAŻDEGO punktu obrysu samolotu osobno
  // (nie jednej figury sztywno przeskalowanej) — obraca obrys pełną orientacją
  // samolotu, przesuwa do jego pozycji w świecie, a potem rzutuje każdy punkt
  // na teren WZDŁUŻ kierunku promieni słonecznych (z doprecyzowaniem wysokości
  // terenu w miejscu trafienia w kilku iteracjach, bo teren pod cieniem nie musi
  // być płaski — np. na zboczu albo przy krawędzi pasa). Bez Słońca nad
  // horyzontem (noc) cień jest po prostu ukryty.
  _updateShadow() {
    if (!this._shadow || !this._shadowHull) return;
    const sunDir = typeof sunWorldDir !== 'undefined' ? sunWorldDir : null;
    if (!sunDir || sunDir.y <= 0.006) {
      this._shadow.visible = false;
      return;
    }

    const outline = this._shadowHull;
    const n = outline.length;
    const planePos = this.worldPos;
    // Kierunek W KTÓRYM PADAJĄ promienie (od Słońca w dół/na zewnątrz) —
    // dokładnie przeciwny do wektora "do Słońca" używanego przez reszę sceny.
    const lightDir = _shadowLightDir.copy(sunDir).negate().normalize();
    const invLy = 1 / Math.max(-lightDir.y, 0.035); // ograniczone, żeby cień nie "uciekał" w nieskończoność tuż przy horyzoncie

    // Ta sama macierz orientacji, której używa syncMesh() (kolejność 'YXZ':
    // najpierw pitch wokół X, potem yaw wokół Y, na końcu roll wokół Z) — dzięki
    // temu cień zawsze odpowiada RZECZYWISTEJ, aktualnej pozie samolotu.
    _shadowEuler.set(-this.pitchRad, this.yawRad, this.rollRad, 'YXZ');
    _shadowQuat.setFromEuler(_shadowEuler);

    let cx = 0, cz = 0, cy = 0;

    for (let i = 0; i < n; i++) {
      const local = outline[i];
      _shadowLocalVec.set(local.x, 0, local.z).applyQuaternion(_shadowQuat);
      _shadowWorldVec.set(
        planePos.x + _shadowLocalVec.x,
        planePos.y + _shadowLocalVec.y,
        planePos.z + _shadowLocalVec.z
      );

      // Rzut wzdłuż promienia słonecznego na teren: zaczynamy od przybliżenia
      // wysokością terenu z poprzedniej klatki, potem doprecyzowujemy 2x
      // wysokością terenu FAKTYCZNIE pod punktem trafienia — wystarczająco
      // dokładne dla cienia (rzędy metrów błędu przy stromym terenie znikają po
      // 2 iteracjach), dużo tańsze niż prawdziwy raymarching przez DEM.
      let groundY = _shadowLastGroundY;
      for (let iter = 0; iter < 3; iter++) {
        const travel = (_shadowWorldVec.y - groundY) * invLy;
        _shadowHitVec.set(
          _shadowWorldVec.x + lightDir.x * travel,
          _shadowWorldVec.y + lightDir.y * travel,
          _shadowWorldVec.z + lightDir.z * travel
        );
        const geo = worldToGeo(_shadowHitVec);
        groundY = terrainHeightBest(geo.lat, geo.lon) * DEM_EXAG * Y_SCALE;
      }
      _shadowLastGroundY = groundY;

      const hitY = groundY + 0.05; // mały offset, żeby cień nie migotał (z-fighting) z terenem
      this._shadowPos[(i + 1) * 3 + 0] = _shadowHitVec.x;
      this._shadowPos[(i + 1) * 3 + 1] = hitY;
      this._shadowPos[(i + 1) * 3 + 2] = _shadowHitVec.z;
      cx += _shadowHitVec.x; cy += hitY; cz += _shadowHitVec.z;
    }

    // Centroid (indeks 0 w buforze) — środek triangulacji typu "fan".
    this._shadowPos[0] = cx / n;
    this._shadowPos[1] = cy / n;
    this._shadowPos[2] = cz / n;

    this._shadow.geometry.attributes.position.needsUpdate = true;

    // Słońce nisko nad horyzontem → kontakt cienia z ziemią jest w rzeczywistości
    // słabszy/bardziej rozmyty — lekko przyciemniamy cień przy wysokim słońcu
    // (ostry cień w południe) i rozjaśniamy przy niskim (słabszy o świcie/zmierzchu).
    const sunElevFactor = _clamp01(sunDir.y / 0.5);
    this._shadow.material.opacity = 0.20 + 0.30 * sunElevFactor;
    this._shadow.visible = true;
  }
}
