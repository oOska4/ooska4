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
  spoilerCd:  0.30,
  spoilerLiftLoss: 0.35,
  V1: 69.4, VR: 74.7, V2: 79.8, Vstall: 62, VMO: 189,
};

// ── Geometria i zawieszenie podwozia ───────────────────────────────────────────
//
// Współrzędne 3 punktów styczności kół z ziemią w LOKALNYM układzie samolotu
// (ten sam, co w sim-controls.js przy emitExhaust: +X = prawe skrzydło,
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
const GEAR_SUSPENSION_TRAVEL   = 0.22; // maks. całkowite wgniecenie w ziemię (m)
const GEAR_STATIC_SAG          = 0.04; // ugięcie w spoczynku pod ciężarem samolotu (m)
const GEAR_IMPACT_SINK_PER_MS  = 0.05; // dodatkowe wgniecenie na 1 m/s prędkości pionowej przy dotknięciu
const GEAR_SINK_SETTLE_TAU     = 0.12; // stała czasowa powrotu wgniecenia do wartości spoczynkowej (s)
const GEAR_ATTITUDE_SETTLE_TAU = 0.18; // stała czasowa "osiadania" pitch/roll na podwoziu (s)

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

const planeInput = {
  pitch: 0, roll: 0, yaw: 0,
  throttleUp: false, throttleDown: false,
  brakes: false,
};

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
    this.autoRotateArmed = false;
    this.airspeed = 0;
    this.vs = 0;
    this._alpha = 0; this._cl = 0; this._isStalling = false;
    this.terrainZoom = 13;

    const grp = new THREE.Group();
    this.mesh = grp;
    this.modelLoaded = false;
    this._parts = {}; // cache animowanych części — wypełniane po wczytaniu modelu

    loadA321Model().then(model => {
      model.rotation.y = A321_MODEL_ROT_Y;
      model.scale.setScalar(A321_MODEL_SCALE);
      model.translateY(A321_MODEL_TRANSLATE_Y);
      grp.add(model);
      this.modelLoaded = true;
      this.updateGearVisibility();
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
    let h = terrainHeightM(this.lat, this.lon, this.terrainZoom);
    if (h <= 0) h = terrainHeightBest(this.lat, this.lon);
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

  // Próbkuje teren NIEZALEŻNIE pod każdym z 3 punktów podwozia (przednie koło,
  // lewe i prawe główne), z uwzględnieniem aktualnego pitch/roll/yaw. noseDir/
  // wingRight/acUp to jednostkowe wektory lokalnych osi samolotu (odpowiednio
  // +Z/+X/+Y) już przeliczone na przestrzeń świata — liczone wcześniej w
  // physicsUpdate(). Zwraca dla każdej goleni: przesunięcie względem origin
  // encji, wysokość n.p.m. tej goleni, wysokość terenu pod nią i penetrację
  // (dodatnia = koło już w/pod ziemią).
  sampleGear(noseDir, wingRight, acUp) {
    const sampleOne = (local) => {
      const off = wingRight.clone().multiplyScalar(local.x)
        .addScaledVector(acUp, local.y)
        .addScaledVector(noseDir, local.z);
      const worldAlt = this.altM + off.y;
      const { lat: glat, lon: glon } = offsetGeo(this.lat, this.lon, off.x, -off.z);
      let gH = terrainHeightM(glat, glon, this.terrainZoom);
      if (gH <= 0) gH = terrainHeightBest(glat, glon);
      return { offset: off, worldAlt, groundH: gH, pen: gH - worldAlt };
    };
    return { nose: sampleOne(GEAR_NOSE), left: sampleOne(GEAR_LEFT), right: sampleOne(GEAR_RIGHT) };
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
        const impact = Math.min(GEAR_SUSPENSION_TRAVEL - GEAR_STATIC_SAG, impactVy * GEAR_IMPACT_SINK_PER_MS);
        this.gearSink[k] = Math.min(GEAR_SUSPENSION_TRAVEL, this.gearSink[k] + GEAR_STATIC_SAG + impact);
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

    const attBlend = 1 - Math.exp(-dtCap / GEAR_ATTITUDE_SETTLE_TAU);
    this.rollRad += (rollTarget - this.rollRad) * attBlend;
    // Podczas rotacji na starcie pitchem steruje istniejąca logika autoRotate —
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

    if (input.throttleUp)   this.throttle = Math.min(1, this.throttle + dtCap * 0.6);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dtCap * 0.8);

    const ctrlEff = Math.max(0, Math.min(1.0, (airspeed - 12.0) / 40.0));
    const pitchInput = input.pitch;
    const rollInput  = input.roll;
    const yawInput   = input.yaw;

    if (this.onGround && airspeed >= A321_PARAMS.VR * 0.98 && this.throttle > 0.15) this.autoRotateArmed = true;
    if (!this.onGround) this.autoRotateArmed = false;
    const autoRotate = (this.autoRotateArmed && pitchInput > 0) ? 0.5 : 0;

    this.pitchRate += (pitchInput + autoRotate) * 1.4 * ctrlEff * dtCap;
    this.pitchRate *= Math.pow(0.05, dtCap);
    this.rollRate  += rollInput * 1.6 * ctrlEff * dtCap;
    this.rollRate  *= Math.pow(0.04, dtCap);

    this.pitchRad += this.pitchRate * dtCap;
    this.rollRad  += this.rollRate  * dtCap;
    this.pitchRad  = Math.max(-0.45, Math.min(this.onGround ? 0.35 : 0.52, this.pitchRad));
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
    cl = Math.max(-0.3, Math.min(A321_PARAMS.clMax + A321_PARAMS.flapCl[flap], cl));

    const groundH = this.groundHeight();
    const gearOffset = this.gearDown ? 3.15 : 0.5;
    const agl_now = this.altM - groundH - gearOffset;
    const gef = groundEffectFactor(agl_now, A321_PARAMS.span);
    const cdi = (cl * cl) / (Math.PI * A321_PARAMS.eOswald * A321_PARAMS.AR) * gef;
    const cd  = A321_PARAMS.cdMin + A321_PARAMS.flapCd[flap] + (this.gearDown ? A321_PARAMS.cdGear : 0)
              + cdi + A321_PARAMS.cdAlpha * alpha * alpha + (this.spoilers ? A321_PARAMS.spoilerCd : 0);

    const q       = 0.5 * RHO * airspeed * airspeed;
    const liftMag = q * A321_PARAMS.wingArea * cl;
    const dragMag = q * A321_PARAMS.wingArea * Math.max(0, cd);

    const weightN   = A321_PARAMS.mass * G_ACC;
    const thrustVec = noseDir.clone().multiplyScalar(this.throttle * A321_PARAMS.maxThrust);
    const dragVec   = airspeed > 0.1 ? this.vel.clone().normalize().multiplyScalar(-dragMag) : new THREE.Vector3();
    const liftVec   = acUp.clone().multiplyScalar(liftMag);

    // ── Kontakt z ziemią: 3 niezależne punkty (przednie koło + lewe/prawe
    //    główne koło), każdy z własnym pomiarem terenu pod sobą — patrz
    //    sampleGear(). Podwozie próbkowane jest już od 15 m AGL, więc ten próg
    //    zawsze "widzi" zbliżanie się do ziemi z dużym zapasem przed faktycznym
    //    dotknięciem. Dla schowanego podwozia (lądowanie na kadłubie) zostaje
    //    stary, jednopunktowy model (gearOffset) — patrz gałąź powietrzna niżej.
    let gear = null;
    if (this.gearDown && (this.onGround || agl_now < 15)) {
      gear = this.sampleGear(noseDir, wingRight, acUp);
    }
    const gearContact = !!gear && Math.max(gear.nose.pen, gear.left.pen, gear.right.pen) >= 0;

    if (this.onGround || gearContact) {
      if (gearContact) this.onGround = true;
      if (liftVec.y >= weightN) {
        this.onGround = false;
      } else {
        const hs = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
        const brake = input.brakes ? 5.0 : 0.06;
        const spoilerBrake = this.spoilers ? 8.0 : 0;
        const totalBrake = brake + spoilerBrake;
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
        this.vel.y = 0;
        if (this.gearDown && gear) {
          this.settleOnGear(gear, dtCap, autoRotate > 0);
        } else {
          this.altM = groundH + gearOffset; // lądowanie na kadłubie (gear w górze) — bez zmian
        }
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
  }
}
