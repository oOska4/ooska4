'use strict';

// ── System smug kondensacyjnych (kontraili) ────────────────────────────────────
//
// Zastępuje CAŁKOWICIE poprzedni system dymu z silników (cząsteczki-punkty
// emitowane zawsze, niezależnie od wysokości). Kontrail w realnym świecie
// powstaje tylko wtedy, gdy gorące, wilgotne spaliny silnika mieszają się
// z wystarczająco zimnym powietrzem otoczenia, żeby para wodna natychmiast
// skropliła się/zamarzła (uproszczone kryterium Schmidt-Appleman). W
// atmosferze wzorcowej (ISA, lapse rate 6.5°C/1000m) odpowiada to zwykle
// wysokościom ok. 8000–10000 m — czyli klasycznemu poziomowi przelotowemu
// dużych odrzutowców. Poniżej tego pasma silniki nie zostawiają już żadnego
// widocznego śladu (tak jak w rzeczywistości — brak "dymu" przy starcie/kołowaniu).
//
// Publiczne API zachowane 1:1 z poprzednią wersją (klasa tworzona raz w
// sim-main.js, potem co klatkę: emit() per silnik + update(dt) raz na klatkę),
// więc reszta kodu (sim-main.js, sim-controls.js/emitExhaust) nie musi się
// tym przejmować — jedyna zmiana w wywołujących: emit() dostaje teraz
// dodatkowo identyfikator silnika ('L'/'R') i wysokość samolotu w metrach,
// żeby moduł mógł sam ocenić warunki termiczne bez zgadywania na podstawie
// współrzędnych world-space (te są przeskalowane przez DEM_EXAG/Y_SCALE).
//
// Renderowanie: zamiast chmury punktów-sprite'ów, każdy silnik dostaje własną
// "wstążkę" (ribbon) zbudowaną z pary wierzchołków na każdy zapamiętany punkt
// trajektorii, zawsze zwróconą ku kamerze (billboard wzdłuż lokalnej stycznej
// do smugi). Punkty starzeją się, dryfują z wiatrem, powoli rozszerzają się
// (dyfuzja turbulentna) i zanikają — dokładnie tak, jak prawdziwy kontrail.

// ── Strojenie ────────────────────────────────────────────────────────────────
const CONTRAIL_MAX_POINTS   = 500;   // punktów smugi na silnik (limit pamięci/geo)
const CONTRAIL_MIN_SPACING  = 14;    // [m] min. odstęp między kolejnymi punktami (przy dużej prędkości)
const CONTRAIL_MAX_SPAWN_S  = 0.12;  // [s] maks. czas między punktami — gwarantuje CIĄGŁOŚĆ nawet przy małej prędkości (bez tego przy wolnym locie/kołowaniu smuga "pykała" nowym segmentem co kilka sekund zamiast płynnie rosła)
const CONTRAIL_BASE_WIDTH   = 1.2;   // [m] szerokość tuż za silnikiem
const CONTRAIL_WIDTH_GROWTH = 0.5;   // [m/s wieku] tempo rozszerzania smugi
const CONTRAIL_MAX_WIDTH    = 85;    // [m] górny limit szerokości (czytelność/perf)
const CONTRAIL_FADE_IN_S    = 0.35;  // [s] czas narastania przezroczystości przy dyszy
// Próg formowania (uproszczone Schmidt-Appleman): pełny kontrail przy ≤ -40°C,
// zero przy ≥ -26°C, płynne przejście pomiędzy.
const CONTRAIL_TEMP_FULL = -40;
const CONTRAIL_TEMP_NONE = -26;

// ── TYMCZASOWE dla testów wyglądu ───────────────────────────────────────────
// Gdy true: pomija próg temperatury/wysokości, smuga formuje się zawsze
// (przy dowolnym throttle > progu jałowego), żeby dało się ocenić wygląd
// (szerokość, kolor, falowanie, zanikanie) bez wznoszenia się na FL250+.
// USTAW Z POWROTEM NA false, żeby wrócić do realistycznego zachowania.
const CONTRAIL_DEBUG_ALWAYS_ON = true;

function _ctClamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function _ctLerp(a, b, t) { return a + (b - a) * t; }

// Wektory-pomocnicze, ponownie używane co klatkę (bez alokacji w pętli).
const _ctCamPos = new THREE.Vector3();
const _ctTan    = new THREE.Vector3();
const _ctToCam  = new THREE.Vector3();
const _ctRight  = new THREE.Vector3();

// Bufor indeksów jest identyczny niezależnie od liczby aktywnie narysowanych
// punktów (topologia paska trójkątów) — budujemy go raz dla maksymalnej
// liczby punktów i tylko przycinamy zasięg rysowania (setDrawRange) co klatkę.
function _ctBuildIndex(maxPoints) {
  const idx = new Uint16Array((maxPoints - 1) * 6);
  for (let i = 0; i < maxPoints - 1; i++) {
    const o = i * 6, v = i * 2;
    idx[o]     = v;     idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
  }
  return idx;
}
const CONTRAIL_INDEX = _ctBuildIndex(CONTRAIL_MAX_POINTS);

function _ctMakeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite:  false,
    depthTest:   false,   // tak jak poprzednio: teren nie ma szans przesłonić smugi
    side:        THREE.DoubleSide,
    blending:    THREE.NormalBlending,
    uniforms: {
      uSunGlow: { value: 0.6 },  // 0 = noc, 1 = pełny dzień — steruje ogólną jasnością
      uWarm:    { value: 0.0 },  // 0..1 — bliskość horyzontu słonecznego (wschód/zachód)
    },
    vertexShader: `
      attribute float alpha;
      attribute float edge;
      varying float vAlpha;
      varying float vEdge;
      void main() {
        vAlpha = alpha;
        vEdge  = edge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uSunGlow;
      uniform float uWarm;
      varying float vAlpha;
      varying float vEdge;
      void main() {
        // Miękka krawędź w poprzek wstążki — środek smugi gęstszy, brzegi
        // rozmyte, tak jak rzeczywisty przekrój kontrailu.
        float e = abs(vEdge);
        float edgeFade = 1.0 - smoothstep(0.45, 1.0, e);
        float a = vAlpha * edgeFade;
        if (a < 0.008) discard;
        vec3 base    = mix(vec3(0.50,0.53,0.58), vec3(0.95,0.96,0.98), uSunGlow);
        vec3 warmTint = vec3(1.0, 0.78, 0.55);
        vec3 col = mix(base, warmTint, uWarm * 0.35);
        gl_FragColor = vec4(col, a);
      }`,
  });
}

class ContrailSystem {
  constructor() {
    this.trails = new Map();  // engineId -> { points: [{x,y,z,age,strength,seed}] }
    this.meshes = new Map();  // engineId -> { geo, mesh }
    this._sharedMaterial = _ctMakeMaterial();
  }

  // pos: THREE.Vector3 (world space, pozycja dyszy silnika)
  // throttle: 0..1
  // backDir: nieużywane w nowym systemie (kontrail nie "wystrzeliwuje" cząstek,
  //          tylko zostawia ślad w miejscu, gdzie faktycznie był silnik) —
  //          parametr zostawiony dla zgodności wywołania z sim-controls.js.
  // engineId: 'L' / 'R' (albo dowolny unikalny klucz) — osobna smuga per silnik.
  // altM: wysokość samolotu w metrach (prawdziwa, nieprzeskalowana) — potrzebna
  //       do oceny temperatury otoczenia.
  emit(pos, throttle, backDir, engineId, altM) {
    if (altM == null || !Number.isFinite(altM)) return;
    const key = engineId || 'default';

    // Prosty model ISA (identyczny jak weather.temperature w sim-weather.js,
    // celowo powielony tutaj zamiast odwoływać się do globalnego `weather`,
    // żeby moduł działał niezależnie od kolejności ładowania/inicjalizacji).
    const tempC = 15.0 - Math.min(Math.max(altM, 0), 11000) * 0.0065;
    const tempFactor = CONTRAIL_DEBUG_ALWAYS_ON
      ? 1
      : _ctClamp01((CONTRAIL_TEMP_NONE - tempC) / (CONTRAIL_TEMP_NONE - CONTRAIL_TEMP_FULL));
    // Przy bardzo niskim ciągu (bieg jałowy, zniżanie) spaliny są chłodniejsze
    // i mniej wilgotne — smuga słabnie, choć nie znika całkowicie od razu.
    const thrFactor = _ctClamp01((throttle - 0.05) / 0.25);
    const strength = tempFactor * thrFactor;

    let trail = this.trails.get(key);
    if (!trail) { trail = { points: [], timeSinceSpawn: 0 }; this.trails.set(key, trail); }

    if (strength < 0.03) return; // za ciepło / silniki na jałowym — brak śladu

    const pts = trail.points;
    const last = pts[pts.length - 1];
    if (last) {
      const dx = pos.x - last.x, dy = pos.y - last.y, dz = pos.z - last.z;
      const distOk = (dx * dx + dy * dy + dz * dz) >= CONTRAIL_MIN_SPACING * CONTRAIL_MIN_SPACING;
      const timeOk = trail.timeSinceSpawn >= CONTRAIL_MAX_SPAWN_S;
      if (!distOk && !timeOk) return;
    }
    trail.timeSinceSpawn = 0;
    pts.push({ x: pos.x, y: pos.y, z: pos.z, age: 0, strength, seed: Math.random() * 1000 });
    if (pts.length > CONTRAIL_MAX_POINTS) pts.splice(0, pts.length - CONTRAIL_MAX_POINTS);
  }

  update(dt) {
    const windWorld = (typeof weather !== 'undefined' && weather) ? weather.windWorld : { x: 0, z: 0 };
    const cloudCov  = (typeof WeatherState !== 'undefined') ? WeatherState.cloudCoverage : 0.3;
    const turb      = (typeof WeatherState !== 'undefined') ? WeatherState.turbulence   : 0.1;
    // Wilgotniejsze/bardziej zachmurzone powietrze -> smuga żyje dłużej, zanim
    // rozproszy się na tyle, że staje się niewidoczna (persistent contrail).
    // Suche, czyste powietrze -> krótkotrwały ślad, znika szybko.
    const lifetime = _ctLerp(20, 110, _ctClamp01(cloudCov));

    // Ogólna jasność/odcień zależny od pozycji słońca — kontrail w nocy jest
    // ledwo widoczny, o świcie/zmierzchu łapie ciepłą poświatę.
    let sunGlow = 0.55, warm = 0;
    if (typeof sunWorldDir !== 'undefined') {
      const sunAlt = sunWorldDir.y;
      sunGlow = _ctClamp01((sunAlt + 0.15) / 0.5);
      warm    = _ctClamp01(1 - Math.abs(sunAlt) / 0.25);
    }

    for (const [key, trail] of this.trails) {
      trail.timeSinceSpawn = (trail.timeSinceSpawn || 0) + dt;
      const pts = trail.points;
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.age += dt;
        if (p.age > lifetime) { pts.splice(i, 1); continue; }

        // Adwekcja wiatrem (world X/Z ≈ metry, tak samo jak w rainWorld/sim-sky.js).
        p.x += windWorld.x * dt;
        p.z += windWorld.z * dt;

        // Powolne opadanie w pierwszych ~18s (wir za skrzydłem ciągnie ślad
        // w dół), potem zanika — realny kontrail robi to samo, zanim się wypłaszcza.
        const settle = Math.max(0, 1 - p.age / 18);
        p.y -= 0.06 * settle * dt;

        // Turbulentne falowanie, narastające z wiekiem (dyfuzja) i z
        // aktualną turbulencją atmosfery.
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
    const posArr   = new Float32Array(CONTRAIL_MAX_POINTS * 3 * 2);
    const alphaArr = new Float32Array(CONTRAIL_MAX_POINTS * 2);
    const edgeArr  = new Float32Array(CONTRAIL_MAX_POINTS * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha',    new THREE.BufferAttribute(alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('edge',     new THREE.BufferAttribute(edgeArr, 1).setUsage(THREE.DynamicDrawUsage));
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

    const pts = trail.points;
    const n = pts.length;
    if (n < 2) { rec.geo.setDrawRange(0, 0); return; }

    const posAttr   = rec.geo.attributes.position;
    const alphaAttr = rec.geo.attributes.alpha;
    const edgeAttr  = rec.geo.attributes.edge;
    const posArr = posAttr.array, alphaArr = alphaAttr.array, edgeArr = edgeAttr.array;

    _ctCamPos.copy(camera.position);

    for (let i = 0; i < n; i++) {
      const p = pts[i];

      // Styczna do trajektorii smugi (kierunek "wzdłuż") — z sąsiednich punktów.
      if (i === 0)          _ctTan.set(pts[1].x - p.x, pts[1].y - p.y, pts[1].z - p.z);
      else if (i === n - 1) _ctTan.set(p.x - pts[i-1].x, p.y - pts[i-1].y, p.z - pts[i-1].z);
      else                  _ctTan.set(pts[i+1].x - pts[i-1].x, pts[i+1].y - pts[i-1].y, pts[i+1].z - pts[i-1].z);
      if (_ctTan.lengthSq() < 1e-6) _ctTan.set(0, 0, 1); else _ctTan.normalize();

      // Wektor "w bok" prostopadły do stycznej I do kierunku na kamerę —
      // dzięki temu wstążka zawsze zwrócona jest możliwie płasko ku widzowi
      // (billboard trail), zamiast być cienką kreską pod pewnymi kątami.
      _ctToCam.set(_ctCamPos.x - p.x, _ctCamPos.y - p.y, _ctCamPos.z - p.z).normalize();
      _ctRight.crossVectors(_ctTan, _ctToCam);
      if (_ctRight.lengthSq() < 1e-6) _ctRight.set(1, 0, 0); else _ctRight.normalize();

      const width = Math.min(CONTRAIL_MAX_WIDTH, CONTRAIL_BASE_WIDTH + p.age * CONTRAIL_WIDTH_GROWTH);
      const half  = width * 0.5;

      const fadeIn  = Math.min(1, p.age / CONTRAIL_FADE_IN_S);
      const fadeOut = Math.pow(Math.max(0, 1 - p.age / lifetime), 1.4);
      const alpha   = _ctClamp01(p.strength * fadeIn * fadeOut * 0.85);

      const i6 = i * 6, i2 = i * 2;
      posArr[i6+0] = p.x - _ctRight.x*half; posArr[i6+1] = p.y - _ctRight.y*half; posArr[i6+2] = p.z - _ctRight.z*half;
      posArr[i6+3] = p.x + _ctRight.x*half; posArr[i6+4] = p.y + _ctRight.y*half; posArr[i6+5] = p.z + _ctRight.z*half;
      alphaArr[i2] = alpha; alphaArr[i2+1] = alpha;
      edgeArr[i2]  = -1;    edgeArr[i2+1]  = 1;
    }

    posAttr.needsUpdate   = true;
    alphaAttr.needsUpdate = true;
    edgeAttr.needsUpdate  = true;
    rec.geo.setDrawRange(0, (n - 1) * 6);
  }
}
