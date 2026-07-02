'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-exhaust.js  —  Realistyczne smugi kondensacyjne (contrails) A321
//
// Fizykachmur:
//  - Smugi powstają tylko przy T < -40°C (ISA: ~8200 m MSL) i wilgotności
//    wystarczającej do kondensacji — modelowane przez altitudeCF() i humidCF().
//  - Każdy z dwóch silników emituje niezależnie z dokładnej pozycji world-space
//    (transformowana przez macierz modelu samolotu co klatkę).
//  - Każdy segment smugi to quad (2 trojkąty) rozciągany prostopadle do
//    kierunku lotu — zapewnia poprawną szerokość niezależnie od kąta kamery.
//  - Smuga żyje MAX_AGE sekund: pierwsze 2s → nabiera kryształków/opacity,
//    potem stale rośnie w szerokość (turbulencja atmosferyczna) i zanika.
//  - Wiatr (WeatherState) dryfuje starsze segmenty poziomo.
//  - System używa puli (pool) segmentów → zero GC w locie, stała pamięć.
//
// Eksportuje: ExhaustSystem (klasa), exhaust (instancja tworzona po modelu)
// Wymaga:    scene, camera, activeEntity, WeatherState, weather,
//            Y_SCALE, DEM_EXAG (sim-constants.js)
// ════════════════════════════════════════════════════════════════════════════════

// ── Stałe segmentu smugi ──────────────────────────────────────────────────────
const CT_MAX_AGE        = 55.0;   // s  — czas życia segmentu smugi
const CT_INIT_WIDTH     = 1.2;    // m  — początkowa szerokość tuż za silnikiem
const CT_MAX_WIDTH      = 320.0;  // m  — maksymalna szerokość (turbulencja)
const CT_EMIT_INTERVAL  = 0.055;  // s  — co ile sekund nowy segment
const CT_POOL_SIZE      = 2200;   // segmenty × 2 silniki (pula łączna)
const CT_FADE_IN        = 2.2;    // s  — czas narastania opacity
const CT_FADE_OUT_START = 0.62;   // frakcja życia → zaczyna zanikać
const CT_MAX_OPACITY    = 0.82;   // peak opacity przy dobrej wilgotności
const CT_ALT_MIN_M      = 7800;   // m MSL — minimalna wysokość powstawania
const CT_ALT_FULL_M     = 9500;   // m MSL — pełne warunki od tej wysokości
const CT_TEMP_COEFF     = 0.98;   // wrażliwość na temperaturę ISA

// Odsunięcie silnika od centrum modelu [m] — kalibrowane do a321.obj
// X: boczne (±), Y: w dół od osi, Z: do tyłu (oś -Z samolotu = do przodu)
const ENG_OFFSET_X =  9.6;
const ENG_OFFSET_Y = -2.8;
const ENG_OFFSET_Z = 22.0;  // do tyłu od centrum (Z+ = tył)

// Pomocnicze
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _up  = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

// ── Warunki kondensacyjne ─────────────────────────────────────────────────────
// Zwraca 0..1 — jak sprzyjające są warunki do tworzenia smug.
// Realistycznie: potrzeba T < -40°C (ok. 8km MSL w ISA) i wysokiej wilgotności.
function contrailFactor(altM) {
  // Składnik wysokości (temperatura ISA): nieliniowy próg
  const altCF = Math.max(0, Math.min(1,
    (altM - CT_ALT_MIN_M) / (CT_ALT_FULL_M - CT_ALT_MIN_M)
  ));
  if (altCF <= 0) return 0;

  // Składnik wilgotności: suche powietrze (preset "clear") → krótsze smugi,
  // wilgotne (rain/overcast) → pełne smugi. Ale przy zerowej wilgotności
  // i tak jest minimalne 20% jeśli jesteśmy wystarczająco wysoko.
  const precip   = WeatherState.precipitation ? 1.0 : 0.0;
  const coverage = WeatherState.cloudCoverage;
  const humidCF  = 0.2 + 0.5 * coverage + 0.3 * precip;

  // Turbulencja atmosferyczna rozbija smugi (wysokie WeatherState.turbulence)
  const turbPenalty = WeatherState.turbulence * 0.5;

  return Math.max(0, altCF * humidCF * CT_TEMP_COEFF - turbPenalty);
}

// ── Shader smug ───────────────────────────────────────────────────────────────
// Segment = quad z 4 wierzchołkami. Attribute `aAge` [0..1], `aOpacity` [0..1].
// Kolor: biało-niebieski lód, z lekkim zabarwieniem słońca/nocy przez dayFactor.
const CT_VERT = `
attribute float aAge;
attribute float aOpacity;
varying float vAge;
varying float vOpacity;

void main() {
  vAge     = aAge;
  vOpacity = aOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CT_FRAG = `
uniform float uDayFactor;
uniform float uNightFactor;
varying float vAge;
varying float vOpacity;

void main() {
  if (vOpacity < 0.004) discard;

  // Kolor lodowych kryształków: biały w dzień, bardzo lekko niebieski w nocy
  vec3 dayColor   = vec3(0.97, 0.98, 1.00);
  vec3 nightColor = vec3(0.72, 0.80, 0.92);
  vec3 col = mix(dayColor, nightColor, uNightFactor * 0.6);

  // Przy zachodzie/wschodzie słońca lekki ciepły odcień krawędzi
  float duskTint = (1.0 - uDayFactor) * (1.0 - uNightFactor);
  col = mix(col, vec3(1.00, 0.88, 0.75), duskTint * 0.18);

  // Miękkie krawędzie (fadeout przez całą szerokość)
  gl_FragColor = vec4(col, vOpacity);
}
`;

// ── Klasa systemu smug ────────────────────────────────────────────────────────
class ExhaustSystem {
  constructor() {
    // Pula segmentów: każdy przechowuje dane w Float32Array dla szybkości
    // position (12 floatów = 4 wierzchołki × 3), age, opacity, alive
    this._pool     = [];
    this._poolHead = 0;   // indeks następnego wolnego slotu (ring buffer)
    this._emitAcc  = [0, 0];  // akumulatory czasu dla silnika L i R

    this._dayFactor   = 1.0;
    this._nightFactor = 0.0;

    // Macierz modelu samolotu (pobierana z entity.mesh)
    this._modelMat = new THREE.Matrix4();

    this._initGeometry();
  }

  // ── Geometria (dynamiczna, aktualizowana co klatkę) ────────────────────────
  _initGeometry() {
    const N = CT_POOL_SIZE;
    // Każdy segment = quad = 4 wierzchołki, 2 trójkąty (6 indeksów)
    const positions = new Float32Array(N * 4 * 3);
    const ages      = new Float32Array(N * 4);
    const opacities = new Float32Array(N * 4);
    const indices   = new Uint32Array(N * 6);

    for (let i = 0; i < N; i++) {
      const vi = i * 4;
      const ii = i * 6;
      // Dwa trójkąty tworzące quad: 0-1-2, 2-1-3
      indices[ii+0] = vi+0; indices[ii+1] = vi+1; indices[ii+2] = vi+2;
      indices[ii+3] = vi+2; indices[ii+4] = vi+1; indices[ii+5] = vi+3;
    }

    this._geo = new THREE.BufferGeometry();
    this._geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    this._ageAttr = new THREE.BufferAttribute(ages, 1);
    this._ageAttr.setUsage(THREE.DynamicDrawUsage);
    this._opAttr  = new THREE.BufferAttribute(opacities, 1);
    this._opAttr.setUsage(THREE.DynamicDrawUsage);
    this._geo.setAttribute('position', this._posAttr);
    this._geo.setAttribute('aAge',     this._ageAttr);
    this._geo.setAttribute('aOpacity', this._opAttr);
    this._geo.setDrawRange(0, 0);  // nic nie renderuj dopóki nie ma segmentów

    this._mat = new THREE.ShaderMaterial({
      vertexShader:   CT_VERT,
      fragmentShader: CT_FRAG,
      uniforms: {
        uDayFactor:   { value: 1.0 },
        uNightFactor: { value: 0.0 },
      },
      transparent:  true,
      depthWrite:   false,
      side:         THREE.DoubleSide,
      blending:     THREE.NormalBlending,
    });

    this._mesh = new THREE.Mesh(this._geo, this._mat);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder   = 5;  // po terenie, przed HUD
    scene.add(this._mesh);

    // Pula danych segmentów (CPU-side)
    for (let i = 0; i < N; i++) {
      this._pool.push({
        alive:     false,
        age:       0,
        maxAge:    CT_MAX_AGE,
        cf:        0,      // contrail factor 0..1 w chwili emisji
        // Pozycja środkowego punktu segmentu (world-space)
        cx:        0, cy: 0, cz: 0,
        // Wektor prostopadły (right) w momencie emisji
        rx:        0, ry: 0, rz: 0,
        // Dryf wiatru
        windX:     0, windZ: 0,
      });
    }
  }

  // ── Aktualizuj dzień/noc (przekazywane z sim-sky.js) ──────────────────────
  setDayNight(dayFactor, nightFactor) {
    this._dayFactor   = dayFactor;
    this._nightFactor = nightFactor;
    this._mat.uniforms.uDayFactor.value   = dayFactor;
    this._mat.uniforms.uNightFactor.value = nightFactor;
  }

  // ── Oblicz pozycję silnika w world-space ─────────────────────────────────
  _engineWorldPos(sideSign, out) {
    // Offset w lokalnej przestrzeni modelu
    _v3a.set(ENG_OFFSET_X * sideSign, ENG_OFFSET_Y, ENG_OFFSET_Z);
    // Transformuj przez macierz modelu samolotu
    out.copy(_v3a).applyMatrix4(this._modelMat);
  }

  // ── Emituj nowy segment ───────────────────────────────────────────────────
  _emit(cx, cy, cz, velX, velY, velZ, cf) {
    const idx  = this._poolHead % CT_POOL_SIZE;
    this._poolHead++;
    const seg  = this._pool[idx];

    // Wektor "right" prostopadły do kierunku lotu i osi Y
    _v3b.set(velX, velY, velZ).normalize();
    _v3c.crossVectors(_v3b, _up).normalize();
    if (_v3c.lengthSq() < 0.01) _v3c.set(1, 0, 0);

    const ww = weather ? weather.windWorld : { x: 0, z: 0 };

    seg.alive  = true;
    seg.age    = 0;
    seg.maxAge = CT_MAX_AGE * (0.7 + cf * 0.3);
    seg.cf     = cf;
    seg.cx     = cx; seg.cy = cy; seg.cz = cz;
    seg.rx     = _v3c.x; seg.ry = _v3c.y; seg.rz = _v3c.z;
    seg.windX  = ww.x;
    seg.windZ  = ww.z;
  }

  // ── Główna pętla ──────────────────────────────────────────────────────────
  update(dt) {
    const ent = activeEntity;
    if (!ent || !ent.mesh) {
      this._mesh.visible = false;
      return;
    }

    // Pobierz macierz modelu i wysokość
    this._modelMat.copy(ent.mesh.matrixWorld);
    const altM = ent.altM || 0;
    const cf   = contrailFactor(altM);

    // Prędkość w world-space (m/s → jednostki sceny / s)
    const velX = ent.vel ? ent.vel.x : 0;
    const velY = ent.vel ? ent.vel.y * Y_SCALE : 0;
    const velZ = ent.vel ? ent.vel.z : 0;
    const spd  = Math.sqrt(velX*velX + velY*velY + velZ*velZ);

    // Emituj tylko gdy lecisz (prędkość > ~60 kt w m/s ≈ 30 m/s world units)
    const flying = spd > 15 && altM > CT_ALT_MIN_M * 0.6;

    if (flying && cf > 0.02) {
      // Silnik L i R
      for (let side = 0; side < 2; side++) {
        this._emitAcc[side] += dt;
        if (this._emitAcc[side] >= CT_EMIT_INTERVAL) {
          this._emitAcc[side] -= CT_EMIT_INTERVAL;
          const sideSign = side === 0 ? -1 : 1;
          this._engineWorldPos(sideSign, _v3a);
          this._emit(_v3a.x, _v3a.y, _v3a.z, velX, velY, velZ, cf);
        }
      }
    } else {
      this._emitAcc[0] = this._emitAcc[1] = 0;
    }

    // Aktualizuj wszystkie segmenty i przepisuj do GPU bufora
    const posArr = this._posAttr.array;
    const ageArr = this._ageAttr.array;
    const opArr  = this._opAttr.array;
    let   drawVerts = 0;

    const ww = weather ? weather.windWorld : { x: 0, z: 0 };

    for (let i = 0; i < CT_POOL_SIZE; i++) {
      const seg = this._pool[i];
      const vi  = i * 4 * 3;
      const ai  = i * 4;

      if (!seg.alive) {
        // Wyzeruj opacity — indeksy wciąż istnieją w buforze, ale są niewidoczne
        opArr[ai] = opArr[ai+1] = opArr[ai+2] = opArr[ai+3] = 0;
        continue;
      }

      seg.age += dt;
      if (seg.age > seg.maxAge) { seg.alive = false; opArr[ai]=opArr[ai+1]=opArr[ai+2]=opArr[ai+3]=0; continue; }

      // Dryf wiatrem (wiatr zmienia się, używamy chwilowego)
      seg.cx += ww.x * dt;
      seg.cz += ww.z * dt;
      // Lekkie opadanie (kryształki opadają ~0.2 m/s)
      seg.cy -= 0.08 * Y_SCALE * dt;

      const t       = seg.age / seg.maxAge;
      const cf_s    = seg.cf;

      // Szerokość: rośnie z czasem (dyfuzja atmosferyczna), wolniej przy niskiej wilgotności
      // Model: w(t) = init + (max - init) * smoothstep(0, 0.9, t)^0.6
      const growT   = Math.min(t / 0.9, 1.0);
      const grow    = growT * growT * (3 - 2 * growT);  // smoothstep
      const halfW   = (CT_INIT_WIDTH + (CT_MAX_WIDTH - CT_INIT_WIDTH) * Math.pow(grow, 0.55) * cf_s) * 0.5;

      // Opacity: fade-in → plateau → fade-out
      let op;
      if (t < CT_FADE_IN / seg.maxAge) {
        op = (t / (CT_FADE_IN / seg.maxAge));
      } else if (t < CT_FADE_OUT_START) {
        op = 1.0;
      } else {
        op = 1.0 - (t - CT_FADE_OUT_START) / (1.0 - CT_FADE_OUT_START);
      }
      op = Math.max(0, op) * CT_MAX_OPACITY * cf_s;

      // 4 wierzchołki quada
      const rx = seg.rx * halfW, ry = seg.ry * halfW, rz = seg.rz * halfW;
      // Lewa górna
      posArr[vi+0]  = seg.cx - rx; posArr[vi+1]  = seg.cy - ry + halfW * 0.12; posArr[vi+2]  = seg.cz - rz;
      // Prawa górna
      posArr[vi+3]  = seg.cx + rx; posArr[vi+4]  = seg.cy + ry + halfW * 0.12; posArr[vi+5]  = seg.cz + rz;
      // Lewa dolna
      posArr[vi+6]  = seg.cx - rx; posArr[vi+7]  = seg.cy - ry - halfW * 0.12; posArr[vi+8]  = seg.cz - rz;
      // Prawa dolna
      posArr[vi+9]  = seg.cx + rx; posArr[vi+10] = seg.cy + ry - halfW * 0.12; posArr[vi+11] = seg.cz + rz;

      // Wiek 0..1 dla shadera
      const normAge = t;
      ageArr[ai] = ageArr[ai+1] = ageArr[ai+2] = ageArr[ai+3] = normAge;
      opArr[ai]  = opArr[ai+1] = opArr[ai+2] = opArr[ai+3] = op;

      drawVerts = (i + 1) * 4;
    }

    this._posAttr.needsUpdate = true;
    this._ageAttr.needsUpdate = true;
    this._opAttr.needsUpdate  = true;
    this._geo.setDrawRange(0, drawVerts / 4 * 6);
    this._mesh.visible = true;
  }
}

// Instancja tworzona po załadowaniu modelu (activeEntity musi istnieć)
function initExhaust() {
  if (exhaust) { scene.remove(exhaust._mesh); }
  exhaust = new ExhaustSystem();
}
