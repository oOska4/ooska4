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
// GEOMETRIA: smuga to prawdziwa RURA 3D (pierścień wierzchołków wokół osi w
// każdym punkcie), o orientacji ustalonej w przestrzeni świata (transport
// równoległy wzdłuż stycznej) — NIE billboard zwrócony do kamery, bo taki
// zapada się optycznie do kreski widziany "wzdłuż" (typowy kąt kamery za
// samolotem). Rura ma realną objętość z każdego kąta.
//
// SHADER (wersja "maksymalna jakość"):
//  • proceduralny szum 3D (value noise + fbm, 4 oktawy) przesuwa wierzchołki
//    wzdłuż normalnej — organiczne, kłębiaste wybrzuszenia zamiast gładkiej
//    rurki, narastające z wiekiem punktu (świeży ślad przy dyszy jest ciasny
//    i gładki, stary — rozedrgany i puchaty, tak jak dyfundujący realny lód);
//  • drugi, drobniejszy szum w fragment shaderze targa krawędzią sylwetki
//    (postrzępione, "wystrzępione" brzegi zamiast twardej linii geometrii);
//  • rozpraszanie światła słonecznego w przód (przybliżenie funkcji fazowej
//    Henyeya-Greensteina) — smuga wyraźnie jaśnieje/"świeci", gdy patrzy się
//    przez nią w stronę Słońca, dokładnie jak prawdziwe kryształki lodu;
//  • fresnel na sylwetce (miękka, rozmyta poświata na krawędzi) — tani, ale
//    skuteczny trik na wrażenie objętości bez prawdziwego raymarchingu.
//
// Publiczne API zachowane 1:1 (sim-main.js: new ContrailSystem(), potem co
// klatkę emit() per silnik + update(dt) raz na klatkę).

// ── Strojenie: kształt i fizyka ─────────────────────────────────────────────
const CONTRAIL_MAX_POINTS   = 600;   // punktów smugi na silnik (jakość > wydajność)
const CONTRAIL_SIDES        = 10;    // boków przekroju rury
const CONTRAIL_MIN_SPACING  = 12;    // [m] min. odstęp między kolejnymi punktami
const CONTRAIL_MAX_SPAWN_S  = 0.1;   // [s] maks. czas między punktami — gwarancja ciągłości przy małej prędkości
const CONTRAIL_BASE_RADIUS  = 0.9;   // [m] promień tuż za silnikiem
const CONTRAIL_RADIUS_GROWTH= 0.28;  // [m/s wieku] tempo rozszerzania smugi
const CONTRAIL_MAX_RADIUS   = 48;    // [m] górny limit promienia
const CONTRAIL_FADE_IN_S    = 0.3;   // [s] czas narastania przezroczystości przy dyszy
// Próg formowania (uproszczone Schmidt-Appleman): pełny kontrail przy ≤ -40°C,
// zero przy ≥ -26°C, płynne przejście pomiędzy.
const CONTRAIL_TEMP_FULL = -40;
const CONTRAIL_TEMP_NONE = -26;

// ── Strojenie: jakość wizualna / shader ─────────────────────────────────────
const CONTRAIL_DISP_MAX_YOUNG = 0.12;  // [m] przemieszczenie szumem tuż przy dyszy (prawie zerowe — świeży ślad gładki)
const CONTRAIL_DISP_MAX_OLD   = 2.4;   // [m] przemieszczenie szumem po ~40s wieku (rozedrgane, puchate)
const CONTRAIL_DISP_AGE_S     = 40.0;  // [s] po ilu sekundach przemieszczenie osiąga maksimum
const CONTRAIL_HG_G           = 0.86;  // anizotropia rozpraszania Henyeya-Greensteina (0..1, bliżej 1 = ostrzejsza poświata w stronę słońca)

// ── TYMCZASOWE dla testów wyglądu ───────────────────────────────────────────
// Gdy true: pomija próg temperatury/wysokości, smuga formuje się zawsze.
// USTAW Z POWROTEM NA false, żeby wrócić do realistycznego zachowania.
const CONTRAIL_DEBUG_ALWAYS_ON = true;

function _ctClamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function _ctLerp(a, b, t) { return a + (b - a) * t; }

// Lekko "pomarszczony" przekrój — nie idealne koło.
const CONTRAIL_PUFF = [1.00, 0.85, 1.08, 0.90, 1.12, 0.86, 1.05, 0.92, 1.10, 0.88];

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
const _ctTan     = new THREE.Vector3();
const _ctRight   = new THREE.Vector3();
const _ctUp      = new THREE.Vector3();
const _ctWorldUp = new THREE.Vector3(0, 1, 0);
const _ctFallbackAxis = new THREE.Vector3(1, 0, 0);
const _ctSunDir  = new THREE.Vector3(0.3, 0.6, 0.3).normalize();

// Wspólny fragment GLSL (hash + value-noise 3D + fbm), wklejany do obu
// shaderów — bez tego rura wygląda jak gładki plastik zamiast kłębiastej
// chmury lodowej.
const CONTRAIL_NOISE_GLSL = `
  float ctHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float ctNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = ctHash(i + vec3(0.0,0.0,0.0));
    float n100 = ctHash(i + vec3(1.0,0.0,0.0));
    float n010 = ctHash(i + vec3(0.0,1.0,0.0));
    float n110 = ctHash(i + vec3(1.0,1.0,0.0));
    float n001 = ctHash(i + vec3(0.0,0.0,1.0));
    float n101 = ctHash(i + vec3(1.0,0.0,1.0));
    float n011 = ctHash(i + vec3(0.0,1.0,1.0));
    float n111 = ctHash(i + vec3(1.0,1.0,1.0));
    float nx00 = mix(n000, n100, f.x), nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x), nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y), nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }
  float ctFbm(vec3 p, int octaves) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      v += a * ctNoise(p);
      p = p * 2.03 + vec3(11.1, 7.7, 19.3);
      a *= 0.5;
    }
    return v;
  }
`;

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
      uCamPos:  { value: new THREE.Vector3() },     // pozycja kamery (world space)
      uTime:    { value: 0 },                       // powolny zegar do animacji szumu
    },
    vertexShader: `
      uniform float uTime;
      attribute float alpha;
      attribute float aAge;
      attribute vec3 aNormal;
      varying float vAlpha;
      varying float vAge;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${CONTRAIL_NOISE_GLSL}

      void main() {
        vAlpha = alpha;
        vAge   = aAge;
        vNormal = aNormal;

        // Proceduralne, organiczne wybrzuszenia — ciasne i gładkie tuż przy
        // dyszy, coraz bardziej rozedrgane i puchate z wiekiem punktu (dokładnie
        // jak realna dyfuzja turbulentna kryształków lodu w ślad za silnikiem).
        float ageT = clamp(aAge / ${CONTRAIL_DISP_AGE_S.toFixed(1)}, 0.0, 1.0);
        float dispAmt = mix(${CONTRAIL_DISP_MAX_YOUNG.toFixed(3)}, ${CONTRAIL_DISP_MAX_OLD.toFixed(3)}, ageT);
        vec3 noiseCoord = position * 0.045 + vec3(uTime * 0.025, uTime * 0.017, uTime * 0.021);
        float disp = ctFbm(noiseCoord, 4) - 0.5;
        vec3 displaced = position + aNormal * disp * dispAmt;

        vWorldPos = displaced;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }`,
    fragmentShader: `
      uniform float uSunGlow;
      uniform float uWarm;
      uniform vec3 uSunDir;
      uniform vec3 uCamPos;
      uniform float uTime;
      varying float vAlpha;
      varying float vAge;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${CONTRAIL_NOISE_GLSL}

      void main() {
        vec3 N = normalize(vNormal);
        vec3 viewDir = normalize(uCamPos - vWorldPos);

        // Drobny szum powierzchni — postrzępione, "wystrzępione" krawędzie
        // zamiast twardej linii geometrii; świeży ślad gładszy, stary bardziej targany.
        float surfN = ctFbm(vWorldPos * 0.09 + vec3(uTime * 0.05, uTime * 0.03, uTime * 0.04), 3);
        float tatterAmt = clamp(vAge / 10.0, 0.0, 1.0) * 0.8;
        float edgeNoise = mix(1.0, surfN * 1.4, tatterAmt);

        float a = vAlpha * clamp(edgeNoise, 0.0, 1.3);

        // Fresnel na sylwetce — miękka poświata na krawędzi, tani zamiennik
        // prawdziwej objętości/raymarchingu.
        float rim = pow(1.0 - clamp(abs(dot(viewDir, N)), 0.0, 1.0), 2.2);
        a = clamp(a + rim * vAlpha * 0.28, 0.0, 1.0);
        if (a < 0.01) discard;

        // Rozpraszanie światła słonecznego w przód (Henyey-Greenstein) —
        // smuga wyraźnie jaśnieje, gdy patrzysz przez nią w stronę Słońca.
        float cosTheta = dot(viewDir, uSunDir);
        float g = ${CONTRAIL_HG_G.toFixed(2)};
        float g2 = g * g;
        float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.0001), 1.5);
        hg *= 0.032;
        float glare = pow(max(cosTheta, 0.0), 55.0) * 1.1;

        float diff  = max(dot(N, uSunDir), 0.0);
        float shade = 0.5 + 0.5 * diff;

        vec3 base     = mix(vec3(0.42,0.45,0.50), vec3(0.97,0.98,1.0), uSunGlow) * shade;
        vec3 warmTint = vec3(1.0, 0.82, 0.60) * shade;
        vec3 col = mix(base, warmTint, uWarm * 0.35);

        vec3 sunColor = mix(vec3(1.0,0.95,0.85), vec3(1.0,0.65,0.42), uWarm);
        col += sunColor * (hg + glare) * mix(0.35, 1.0, uSunGlow);

        gl_FragColor = vec4(col, a);
      }`,
  });
}

class ContrailSystem {
  constructor() {
    this.trails = new Map();  // engineId -> { points:[{x,y,z,age,strength,seed,rx,ry,rz}], timeSinceSpawn }
    this.meshes = new Map();  // engineId -> { geo, mesh }
    this._sharedMaterial = _ctMakeMaterial();
    this._clock = 0;
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
    // migotania i bez zależności od kamery — to jest sedno naprawy z wcześniej).
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
    this._clock += dt;
    this._sharedMaterial.uniforms.uTime.value = this._clock;
    if (typeof camera !== 'undefined') this._sharedMaterial.uniforms.uCamPos.value.copy(camera.position);

    const windWorld = (typeof weather !== 'undefined' && weather) ? weather.windWorld : { x: 0, z: 0 };
    const cloudCov  = (typeof WeatherState !== 'undefined') ? WeatherState.cloudCoverage : 0.3;
    const turb      = (typeof WeatherState !== 'undefined') ? WeatherState.turbulence   : 0.1;
    // Wilgotniejsze/bardziej zachmurzone powietrze -> smuga żyje dłużej, zanim
    // się rozproszy (persistent contrail). Suche powietrze -> znika szybko.
    const lifetime = _ctLerp(20, 130, _ctClamp01(cloudCov));

    let sunGlow = 0.55, warm = 0;
    if (typeof sunWorldDir !== 'undefined') {
      const sunAlt = sunWorldDir.y;
      sunGlow = _ctClamp01((sunAlt + 0.15) / 0.5);
      warm    = _ctClamp01(1 - Math.abs(sunAlt) / 0.25);
      _ctSunDir.copy(sunWorldDir);
    }
    this._sharedMaterial.uniforms.uSunGlow.value = sunGlow;
    this._sharedMaterial.uniforms.uWarm.value    = warm;
    this._sharedMaterial.uniforms.uSunDir.value.copy(_ctSunDir);

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

      this._rebuildMesh(key, trail, lifetime);
    }
  }

  _createMeshRecord() {
    const geo = new THREE.BufferGeometry();
    const vcount = CONTRAIL_MAX_POINTS * CONTRAIL_SIDES;
    const posArr   = new Float32Array(vcount * 3);
    const normArr  = new Float32Array(vcount * 3);
    const alphaArr = new Float32Array(vcount);
    const ageArr   = new Float32Array(vcount);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aNormal',  new THREE.BufferAttribute(normArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha',    new THREE.BufferAttribute(alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge',     new THREE.BufferAttribute(ageArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(CONTRAIL_INDEX, 1));
    geo.setDrawRange(0, 0);

    const mesh = new THREE.Mesh(geo, this._sharedMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder    = 950;
    scene.add(mesh);
    return { geo, mesh };
  }

  _rebuildMesh(key, trail, lifetime) {
    let rec = this.meshes.get(key);
    if (!rec) { rec = this._createMeshRecord(); this.meshes.set(key, rec); }

    const pts = trail.points;
    const n = pts.length;
    if (n < 2) { rec.geo.setDrawRange(0, 0); return; }

    const posAttr   = rec.geo.attributes.position;
    const normAttr  = rec.geo.attributes.aNormal;
    const alphaAttr = rec.geo.attributes.alpha;
    const ageAttr   = rec.geo.attributes.aAge;
    const posArr = posAttr.array, normArr = normAttr.array, alphaArr = alphaAttr.array, ageArr = ageAttr.array;
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
        ageArr[vi]    = p.age;
      }
    }

    posAttr.needsUpdate   = true;
    normAttr.needsUpdate  = true;
    alphaAttr.needsUpdate = true;
    ageAttr.needsUpdate   = true;
    rec.geo.setDrawRange(0, (n - 1) * sides * 6);
  }
}
