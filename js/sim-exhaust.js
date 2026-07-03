'use strict';

// ── System smug kondensacyjnych (kontraili) ────────────────────────────────────
//
// Zastępuje CAŁKOWICIE poprzedni system dymu z silników. Kontrail w realnym
// świecie powstaje tylko wtedy, gdy gorące, wilgotne spaliny silnika mieszają
// się z wystarczająco zimnym powietrzem otoczenia, żeby para wodna natychmiast
// skropliła się/zamarzła (uproszczone kryterium Schmidt-Appleman). W
// atmosferze wzorcowej (ISA, lapse rate 6.5°C/1000m) odpowiada to zwykle
// wysokościom ok. 8000–10000 m — czyli klasycznemu poziomowi przelotowemu
// dużych odrzutowców. Poniżej tego pasma silniki nie zostawiają widocznego
// śladu (tak jak w rzeczywistości).
//
// GEOMETRIA: pierwsza wersja renderowała smugę jako płaską wstążkę zawsze
// zwróconą "na styk" ku kamerze (billboard trail). To wygląda dobrze z boku,
// ale WIDZIANE MNIEJ WIĘCEJ WZDŁUŻ SMUGI (a to dokładnie kąt kamery za
// samolotem, patrzącej w kierunku lotu) taka wstążka zapada się optycznie do
// cienkiej kreski — bo płaszczyzna wstążki jest wtedy prawie równoległa do
// kierunku patrzenia. Dlatego teraz smuga to prawdziwa RURA (tube) — pierścień
// wierzchołków wokół osi smugi w KAŻDYM punkcie, o orientacji ustalonej w
// przestrzeni świata (transport równoległy wzdłuż stycznej), a nie zależnej
// od kamery. Dzięki temu ma faktyczną objętość i wygląda poprawnie z każdego
// kąta, łącznie z widokiem "od tyłu". Dodatkowo przekrój nie jest idealnym
// kołem (lekko "pomarszczony" per-bok) i lekko "oddycha" wzdłuż długości —
// żeby nie wyglądało jak gładka plastikowa rurka, tylko jak puszysta chmura.
// Proste cieniowanie (Lambert względem Słońca) daje jej czytelną krągłość.
//
// Publiczne API zachowane 1:1 (sim-main.js: new ContrailSystem(), potem co
// klatkę emit() per silnik + update(dt) raz na klatkę).

// ── Strojenie ────────────────────────────────────────────────────────────────
const CONTRAIL_MAX_POINTS   = 420;   // punktów smugi na silnik (limit pamięci/geo)
const CONTRAIL_SIDES        = 8;     // boków przekroju rury (im więcej, tym okrąglejsza)
const CONTRAIL_MIN_SPACING  = 14;    // [m] min. odstęp między kolejnymi punktami (przy dużej prędkości)
const CONTRAIL_MAX_SPAWN_S  = 0.12;  // [s] maks. czas między punktami — gwarantuje ciągłość nawet przy małej prędkości
const CONTRAIL_BASE_RADIUS  = 0.9;   // [m] promień tuż za silnikiem
const CONTRAIL_RADIUS_GROWTH= 0.28;  // [m/s wieku] tempo rozszerzania smugi
const CONTRAIL_MAX_RADIUS   = 45;    // [m] górny limit promienia (czytelność/perf)
const CONTRAIL_FADE_IN_S    = 0.35;  // [s] czas narastania przezroczystości przy dyszy
// Próg formowania (uproszczone Schmidt-Appleman): pełny kontrail przy ≤ -40°C,
// zero przy ≥ -26°C, płynne przejście pomiędzy.
const CONTRAIL_TEMP_FULL = -40;
const CONTRAIL_TEMP_NONE = -26;

// ── TYMCZASOWE dla testów wyglądu ───────────────────────────────────────────
// Gdy true: pomija próg temperatury/wysokości, smuga formuje się zawsze.
// USTAW Z POWROTEM NA false, żeby wrócić do realistycznego zachowania.
const CONTRAIL_DEBUG_ALWAYS_ON = true;

function _ctClamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function _ctLerp(a, b, t) { return a + (b - a) * t; }

// Lekko "pomarszczony" przekrój — nie idealne koło, żeby wyglądało bardziej
// organicznie/chmurzasto niż gładka rurka.
const CONTRAIL_PUFF = [1.00, 0.84, 1.08, 0.90, 1.12, 0.86, 1.04, 0.92];

function _ctBuildRing(sides) {
  const cos = new Float32Array(sides), sin = new Float32Array(sides);
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    cos[s] = Math.cos(a); sin[s] = Math.sin(a);
  }
  return { cos, sin };
}
const CONTRAIL_RING = _ctBuildRing(CONTRAIL_SIDES);

// Bufor indeksów jest identyczny niezależnie od tego, ile punktów jest
// aktualnie aktywnych (topologia rury) — budujemy go raz dla maksymalnej
// liczby punktów i tylko przycinamy zasięg rysowania (setDrawRange) co klatkę.
function _ctBuildTubeIndex(maxPoints, sides) {
  const segs = maxPoints - 1;
  const idx  = new Uint16Array(segs * sides * 6);
  let o = 0;
  for (let seg = 0; seg < segs; seg++) {
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a = seg * sides + s;
      const b = seg * sides + s2;
      const c = (seg + 1) * sides + s2;
      const d = (seg + 1) * sides + s;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = a; idx[o++] = c; idx[o++] = d;
    }
  }
  return idx;
}
const CONTRAIL_INDEX = _ctBuildTubeIndex(CONTRAIL_MAX_POINTS, CONTRAIL_SIDES);

// Wektory-pomocnicze, ponownie używane co klatkę (bez alokacji w pętli).
const _ctCamPos  = new THREE.Vector3();
const _ctTan     = new THREE.Vector3();
const _ctRight   = new THREE.Vector3();
const _ctUp      = new THREE.Vector3();
const _ctWorldUp = new THREE.Vector3(0, 1, 0);
const _ctFallbackAxis = new THREE.Vector3(1, 0, 0);
const _ctSunDir  = new THREE.Vector3(0.3, 0.6, 0.3).normalize();

function _ctMakeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite:  false,
    depthTest:   false,   // teren nie ma szans przesłonić smugi (renderowana bardzo wysoko)
    side:        THREE.DoubleSide,
    blending:    THREE.NormalBlending,
    uniforms: {
      uSunGlow: { value: 0.6 },                    // 0 = noc, 1 = pełny dzień
      uWarm:    { value: 0.0 },                     // bliskość horyzontu słonecznego
      uSunDir:  { value: _ctSunDir.clone() },       // kierunek do Słońca (world space)
    },
    vertexShader: `
      attribute float alpha;
      attribute vec3 aNormal;
      varying float vAlpha;
      varying vec3 vNormal;
      void main() {
        vAlpha  = alpha;
        vNormal = aNormal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uSunGlow;
      uniform float uWarm;
      uniform vec3 uSunDir;
      varying float vAlpha;
      varying vec3 vNormal;
      void main() {
        if (vAlpha < 0.008) discard;
        // Proste cieniowanie Lambertowskie względem Słońca + wysoka podłoga
        // ambientu (to półprzezroczysta chmura lodowa, nie lite ciało) —
        // dzięki temu rura wyraźnie "okrągła" z każdego kąta patrzenia,
        // zamiast płaskiego jednolitego koloru.
        float diff  = max(dot(normalize(vNormal), uSunDir), 0.0);
        float shade = 0.55 + 0.45 * diff;
        vec3 base    = mix(vec3(0.40,0.43,0.48), vec3(0.97,0.98,1.0), uSunGlow) * shade;
        vec3 warmTint = vec3(1.0, 0.80, 0.58) * shade;
        vec3 col = mix(base, warmTint, uWarm * 0.35);
        gl_FragColor = vec4(col, vAlpha);
      }`,
  });
}

class ContrailSystem {
  constructor() {
    this.trails = new Map();  // engineId -> { points:[{x,y,z,age,strength,seed,rx,ry,rz}], timeSinceSpawn }
    this.meshes = new Map();  // engineId -> { geo, mesh }
    this._sharedMaterial = _ctMakeMaterial();
  }

  // pos: THREE.Vector3 (world space, pozycja dyszy silnika)
  // throttle: 0..1
  // backDir: kierunek "do tyłu" od dyszy (world space, znormalizowany) — używany
  //          tylko jako startowa styczna dla PIERWSZEGO punktu nowej smugi.
  // engineId: 'L' / 'R' — osobna smuga per silnik.
  // altM: prawdziwa (nieprzeskalowana) wysokość samolotu w metrach.
  emit(pos, throttle, backDir, engineId, altM) {
    if (altM == null || !Number.isFinite(altM)) return;
    const key = engineId || 'default';

    // Prosty model ISA (ta sama formuła co weather.temperature w sim-weather.js,
    // celowo powielona, żeby moduł nie zależał od kolejności ładowania/inicjalizacji).
    const tempC = 15.0 - Math.min(Math.max(altM, 0), 11000) * 0.0065;
    const tempFactor = CONTRAIL_DEBUG_ALWAYS_ON
      ? 1
      : _ctClamp01((CONTRAIL_TEMP_NONE - tempC) / (CONTRAIL_TEMP_NONE - CONTRAIL_TEMP_FULL));
    const thrFactor = _ctClamp01((throttle - 0.05) / 0.25);
    const strength  = tempFactor * thrFactor;

    let trail = this.trails.get(key);
    if (!trail) { trail = { points: [], timeSinceSpawn: 0 }; this.trails.set(key, trail); }
    if (strength < 0.03) return; // za ciepło / silniki na jałowym — brak śladu

    const pts  = trail.points;
    const prev = pts[pts.length - 1];
    if (prev) {
      const dx = pos.x - prev.x, dy = pos.y - prev.y, dz = pos.z - prev.z;
      const distOk = (dx * dx + dy * dy + dz * dz) >= CONTRAIL_MIN_SPACING * CONTRAIL_MIN_SPACING;
      const timeOk = trail.timeSinceSpawn >= CONTRAIL_MAX_SPAWN_S;
      if (!distOk && !timeOk) return;
    }
    trail.timeSinceSpawn = 0;

    // Styczna do nowego punktu: z przemieszczenia względem poprzedniego, albo
    // (dla pierwszego punktu świeżej smugi) z kierunku wylotu spalin.
    if (prev) _ctTan.set(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
    else      _ctTan.set(-backDir.x, -backDir.y, -backDir.z);
    if (_ctTan.lengthSq() < 1e-8) _ctTan.set(0, 0, 1);
    _ctTan.normalize();

    // Lokalna ramka (right) prostopadła do stycznej — TRANSPORTOWANA
    // RÓWNOLEGLE z poprzedniego punktu (stabilna w przestrzeni świata, bez
    // migotania i bez zależności od kamery — to jest sedno naprawy).
    if (prev) {
      _ctRight.set(prev.rx, prev.ry, prev.rz);
      _ctRight.addScaledVector(_ctTan, -_ctRight.dot(_ctTan));
      if (_ctRight.lengthSq() < 1e-8) _ctRight.crossVectors(_ctTan, _ctWorldUp);
    } else {
      _ctRight.crossVectors(_ctTan, _ctWorldUp);
      if (_ctRight.lengthSq() < 1e-8) _ctRight.crossVectors(_ctTan, _ctFallbackAxis);
    }
    _ctRight.normalize();

    pts.push({
      x: pos.x, y: pos.y, z: pos.z, age: 0, strength, seed: Math.random() * 1000,
      rx: _ctRight.x, ry: _ctRight.y, rz: _ctRight.z,
    });
    if (pts.length > CONTRAIL_MAX_POINTS) pts.splice(0, pts.length - CONTRAIL_MAX_POINTS);
  }

  update(dt) {
    const windWorld = (typeof weather !== 'undefined' && weather) ? weather.windWorld : { x: 0, z: 0 };
    const cloudCov  = (typeof WeatherState !== 'undefined') ? WeatherState.cloudCoverage : 0.3;
    const turb      = (typeof WeatherState !== 'undefined') ? WeatherState.turbulence   : 0.1;
    // Wilgotniejsze/bardziej zachmurzone powietrze -> smuga żyje dłużej, zanim
    // się rozproszy (persistent contrail). Suche powietrze -> znika szybko.
    const lifetime = _ctLerp(20, 110, _ctClamp01(cloudCov));

    let sunGlow = 0.55, warm = 0;
    if (typeof sunWorldDir !== 'undefined') {
      const sunAlt = sunWorldDir.y;
      sunGlow = _ctClamp01((sunAlt + 0.15) / 0.5);
      warm    = _ctClamp01(1 - Math.abs(sunAlt) / 0.25);
      _ctSunDir.copy(sunWorldDir);
    }

    for (const [key, trail] of this.trails) {
      trail.timeSinceSpawn = (trail.timeSinceSpawn || 0) + dt;
      const pts = trail.points;
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.age += dt;
        if (p.age > lifetime) { pts.splice(i, 1); continue; }

        // Adwekcja wiatrem (world X/Z ≈ metry, tak samo jak reszta sim-sky.js).
        p.x += windWorld.x * dt;
        p.z += windWorld.z * dt;

        // Powolne opadanie w pierwszych ~18s (wir za skrzydłem), potem zanika.
        const settle = Math.max(0, 1 - p.age / 18);
        p.y -= 0.06 * settle * dt;

        // Turbulentne falowanie, narastające z wiekiem (dyfuzja) i turbulencją.
        const jitter = (0.4 + p.age * 0.05) * (0.25 + turb);
        p.x += Math.sin(p.age * 0.7 + p.seed) * jitter * dt;
        p.z += Math.cos(p.age * 0.5 + p.seed * 1.3) * jitter * dt;
      }
      if (pts.length > CONTRAIL_MAX_POINTS) pts.splice(0, pts.length - CONTRAIL_MAX_POINTS);

      this._rebuildMesh(key, trail, lifetime, sunGlow, warm);
    }
  }

  _createMeshRecord() {
    const geo = new THREE.BufferGeometry();
    const vcount = CONTRAIL_MAX_POINTS * CONTRAIL_SIDES;
    const posArr    = new Float32Array(vcount * 3);
    const normArr   = new Float32Array(vcount * 3);
    const alphaArr  = new Float32Array(vcount);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aNormal',  new THREE.BufferAttribute(normArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha',    new THREE.BufferAttribute(alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(CONTRAIL_INDEX, 1));
    geo.setDrawRange(0, 0);

    const mesh = new THREE.Mesh(geo, this._sharedMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder    = 950;
    scene.add(mesh);
    return { geo, mesh };
  }

  _rebuildMesh(key, trail, lifetime, sunGlow, warm) {
    let rec = this.meshes.get(key);
    if (!rec) { rec = this._createMeshRecord(); this.meshes.set(key, rec); }

    this._sharedMaterial.uniforms.uSunGlow.value = sunGlow;
    this._sharedMaterial.uniforms.uWarm.value    = warm;
    this._sharedMaterial.uniforms.uSunDir.value.copy(_ctSunDir);

    const pts = trail.points;
    const n = pts.length;
    if (n < 2) { rec.geo.setDrawRange(0, 0); return; }

    const posAttr   = rec.geo.attributes.position;
    const normAttr  = rec.geo.attributes.aNormal;
    const alphaAttr = rec.geo.attributes.alpha;
    const posArr = posAttr.array, normArr = normAttr.array, alphaArr = alphaAttr.array;
    const ringCos = CONTRAIL_RING.cos, ringSin = CONTRAIL_RING.sin;
    const sides = CONTRAIL_SIDES;

    for (let i = 0; i < n; i++) {
      const p = pts[i];

      // Styczna w punkcie renderowania (może się nieco różnić od tej przy
      // spawnie — punkty dryfują z wiatrem) — z sąsiednich punktów.
      if (i === 0)          _ctTan.set(pts[1].x - p.x, pts[1].y - p.y, pts[1].z - p.z);
      else if (i === n - 1) _ctTan.set(p.x - pts[i-1].x, p.y - pts[i-1].y, p.z - pts[i-1].z);
      else                  _ctTan.set(pts[i+1].x - pts[i-1].x, pts[i+1].y - pts[i-1].y, pts[i+1].z - pts[i-1].z);
      if (_ctTan.lengthSq() < 1e-8) _ctTan.set(0, 0, 1); else _ctTan.normalize();

      // Samokorygujący się "right": startuje od zapisanego przy spawnie
      // wektora (transport równoległy — stabilny, bez migotania), ale co
      // klatkę ponownie rzutowany prostopadle do AKTUALNEJ stycznej.
      _ctRight.set(p.rx, p.ry, p.rz);
      _ctRight.addScaledVector(_ctTan, -_ctRight.dot(_ctTan));
      if (_ctRight.lengthSq() < 1e-8) _ctRight.crossVectors(_ctTan, _ctWorldUp);
      if (_ctRight.lengthSq() < 1e-8) _ctRight.crossVectors(_ctTan, _ctFallbackAxis);
      _ctRight.normalize();
      _ctUp.crossVectors(_ctRight, _ctTan).normalize();

      const radiusBase = Math.min(CONTRAIL_MAX_RADIUS, CONTRAIL_BASE_RADIUS + p.age * CONTRAIL_RADIUS_GROWTH);
      const bulge  = 1 + 0.15 * Math.sin(p.age * 1.3 + p.seed * 2.1);
      const radius = radiusBase * bulge;

      const fadeIn  = Math.min(1, p.age / CONTRAIL_FADE_IN_S);
      const fadeOut = Math.pow(Math.max(0, 1 - p.age / lifetime), 1.4);
      const alpha   = _ctClamp01(p.strength * fadeIn * fadeOut * 0.85);

      const ringBase = i * sides;
      for (let s = 0; s < sides; s++) {
        const puff = CONTRAIL_PUFF[s];
        const cs = ringCos[s] * puff, sn = ringSin[s] * puff;
        let nx = _ctRight.x * cs + _ctUp.x * sn;
        let ny = _ctRight.y * cs + _ctUp.y * sn;
        let nz = _ctRight.z * cs + _ctUp.z * sn;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;

        const vi = ringBase + s, o3 = vi * 3;
        posArr[o3]   = p.x + nx * radius;
        posArr[o3+1] = p.y + ny * radius;
        posArr[o3+2] = p.z + nz * radius;
        normArr[o3]   = nx;
        normArr[o3+1] = ny;
        normArr[o3+2] = nz;
        alphaArr[vi]  = alpha;
      }
    }

    posAttr.needsUpdate   = true;
    normAttr.needsUpdate  = true;
    alphaAttr.needsUpdate = true;
    rec.geo.setDrawRange(0, (n - 1) * sides * 6);
  }
}
