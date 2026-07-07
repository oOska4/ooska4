'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-contrails.js  —  Smugi kondensacyjne (contrails) silników A321
//
// Renderowanie 1:1 przeniesione z referencyjnego prototypu (GemContrails.html):
// te same shadery (vertex/fragment), ten sam THREE.Points + NormalBlending +
// depthWrite:false, ten sam sposób "starzenia" cząsteczek (uTime/aSpawnTime).
// NIE zmieniamy tego potoku renderowania — tylko podłączamy go do prawdziwych
// pozycji silników A321 (dwa punkty emisji zamiast jednego) w skali świata
// simworld (Y_SCALE / DEM_EXAG jak reszta sceny — patrz sim-constants.js).
//
// UWAGA log-depth: renderer.js (sim-scene.js) używa logarithmicDepthBuffer:true.
// Próba ręcznego dopisania logiki logarytmicznej głębi do tego custom
// ShaderMaterial (przez #include Three.js LUB przez ręczny zapis do
// gl_FragDepthEXT) okazała się kruche i psuło kompilację shadera na części
// konfiguracji GPU/przeglądarek. Zamiast tego — dokładnie tak jak sim-sky.js
// robi to dla chmur wolumetrycznych i sky dome (depthTest:false, depthWrite:
// false, renderOrder ustawiony tak by rysować się na wierzchu) — smugi mają
// depthTest:false: zawsze widoczne, niezależnie od tego co jest "przed" nimi
// w buforze głębi. To rozwiązuje problem "smuga renderuje się za terenem" w
// najprostszy, najbardziej niezawodny sposób kosztem tego, że teoretycznie
// smuga schowana za górą/budynkiem też by "prześwitywała" — w praktyce
// smugi lecą na wysokości przelotowej dużo ponad terenem, więc to nie
// występuje w normalnym użytkowaniu.
//
// Na razie smugi są ZAWSZE aktywne (emitowane niezależnie od warunków
// atmosferycznych) — later TODO: kryterium Schmidt-Appleman (temperatura,
// wilgotność, ciśnienie na wysokości przelotu) do włączania/wyłączania emisji.
// ════════════════════════════════════════════════════════════════════════════════

const CONTRAIL_VERT = `
    uniform float uTime;
    uniform float uMaxLife;
    uniform float uBaseSize;

    attribute vec3 aSpawnPosition;
    attribute float aSpawnTime;
    attribute float aRandom;

    varying float vAge;
    varying float vRandom;
    varying vec3 vWorldPos;

    void main() {
        vRandom = aRandom;
        float age = uTime - aSpawnTime;
        vAge = age;

        if (age < 0.0 || age > uMaxLife) {
            gl_Position = vec4(9999.0, 9999.0, 9999.0, 1.0);
            return;
        }

        // Bardzo subtelne, kontrolowane puchnięcie chmury w czasie
        float expansion = 1.0 + pow(age, 0.45) * 4.0;

        // Pozycja z lekkim turbulencyjnym rozrzutem bocznym
        vec3 currentPos = aSpawnPosition;
        currentPos.x += sin(age * 1.5 + aRandom * 20.0) * 0.15 * age;
        currentPos.y += cos(age * 1.0 + aRandom * 20.0) * 0.15 * age;

        vWorldPos = currentPos;

        vec4 mvPosition = modelViewMatrix * vec4(currentPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Rozmiar bazowy skalowany do metrycznej skali świata simworld (kamera
        // bywa setki metrów od smugi) — na tyle duży, by smuga (średnica rzędu
        // kilku metrów przy dyszy, rosnąca z wiekiem) była widoczna z typowego
        // dystansu orbitu/kokpitu, ale bez zamieniania jej w plamę.
        gl_PointSize = uBaseSize * expansion * (700.0 / -mvPosition.z);
    }
`;

const CONTRAIL_FRAG = `
    uniform float uTime;
    uniform float uMaxLife;
    varying float vAge;
    varying float vRandom;
    varying vec3 vWorldPos;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
    }

    // 3-warstwowy szum FBM dla uzyskania wyraźnej tekstury kłębów dymu
    float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 3; ++i) {
            v += a * noise(p); p = p * 2.8; a *= 0.5;
        }
        return v;
    }

    void main() {
        vec2 uv = gl_PointCoord;

        // Zaokrąglenie cząsteczki
        float dist = length(uv - vec2(0.5));
        if (dist > 0.5) discard;
        float sphereShape = smoothstep(0.5, 0.1, dist);

        // Miks lokalnego UV z pozycją w świecie generuje unikalną strukturę chmury
        vec2 noiseUV = uv * 2.2 + vWorldPos.xz * 0.4 + vec2(vRandom * 30.0, vAge * 0.3);
        float cloudNoise = fbm(noiseUV);

        // Przerwa kondensacyjna tuż za dyszą silnika
        float fadeIn = smoothstep(0.08, 0.4, vAge);
        float fadeOut = smoothstep(uMaxLife, uMaxLife * 0.75, vAge);

        // Obliczanie finalnej gęstości z wysokim kontrastem szumu
        float density = sphereShape * (cloudNoise * 1.8) * fadeIn * fadeOut;

        // Porzucamy renderowanie przezroczystych pikseli chmury (anti-lag)
        if (density < 0.22) discard;

        // Trójwymiarowe cieniowanie wewnętrzne kłębów (przestrzenność)
        vec3 iceColor = vec3(1.0, 1.0, 1.0);
        vec3 shadowColor = vec3(0.78, 0.83, 0.9);
        vec3 finalColor = mix(shadowColor, iceColor, smoothstep(0.2, 0.6, cloudNoise * sphereShape));

        gl_FragColor = vec4(finalColor, density * 0.5);
    }
`;

// ── Manager pojedynczej smugi (jeden silnik) — identyczny z prototypem ───────
class ContrailEmitter {
  constructor(maxParticles = 1000) {
    this.maxParticles = maxParticles;
    this.particleIndex = 0;

    this.geometry = new THREE.BufferGeometry();

    this.spawnPositions = new Float32Array(this.maxParticles * 3);
    this.spawnTimes = new Float32Array(this.maxParticles);
    this.randoms = new Float32Array(this.maxParticles);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxParticles * 3), 3));
    this.geometry.setAttribute('aSpawnPosition', new THREE.BufferAttribute(this.spawnPositions, 3));
    this.geometry.setAttribute('aSpawnTime', new THREE.BufferAttribute(this.spawnTimes, 1));
    this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(this.randoms, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: CONTRAIL_VERT,
      fragmentShader: CONTRAIL_FRAG,
      uniforms: {
        uTime:     { value: 0 },
        uMaxLife:  { value: 12.0 },
        uBaseSize: { value: 2.2 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 500;
    scene.add(this.mesh);
  }

  // Emitujemy tylko 1-2 cząsteczki na klatkę, żeby smuga nie zlewała się w gruby pas
  emit(worldPosition, clockTime, count = 1) {
    for (let i = 0; i < count; i++) {
      const idx = this.particleIndex;

      const spread = 0.08;
      this.spawnPositions[idx * 3]     = worldPosition.x + (Math.random() - 0.5) * spread;
      this.spawnPositions[idx * 3 + 1] = worldPosition.y + (Math.random() - 0.5) * spread;
      this.spawnPositions[idx * 3 + 2] = worldPosition.z + (Math.random() - 0.5) * spread;

      this.spawnTimes[idx] = clockTime;
      this.randoms[idx] = Math.random();

      this.particleIndex = (this.particleIndex + 1) % this.maxParticles;
    }

    this.geometry.attributes.aSpawnPosition.needsUpdate = true;
    this.geometry.attributes.aSpawnTime.needsUpdate = true;
    this.geometry.attributes.aRandom.needsUpdate = true;
  }

  update(time) {
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// SYSTEM SMUG SAMOLOTU — dwa emitery (silnik lewy/prawy), podpięte pod
// world-space pozycje realnych punktów fan_L/fan_R modelu A321 (gdy model jest
// już wczytany), z fallbackiem na przybliżony offset zanim model się załaduje.
// ════════════════════════════════════════════════════════════════════════════════

// Przybliżony offset silnika względem origin encji w LOKALNYM układzie
// samolotu (ten sam co reszta fizyki: +X = prawe skrzydło, +Y = góra,
// +Z = dziób) — używany zanim model jest wczytany / gdyby fan_L/fan_R nie
// zostały odnalezione w scenie. Wartości przybliżone z geometrii A321
// (silniki pod skrzydłem, nieco przed i poniżej linii kadłuba).
const CONTRAIL_ENGINE_OFFSET_L = { x: -5.9, y: -2.0, z: 3.0 };
const CONTRAIL_ENGINE_OFFSET_R = { x:  5.9, y: -2.0, z: 3.0 };

// Zawsze aktywne na razie — TODO: podłączyć kryterium Schmidt-Appleman.
const CONTRAIL_ALWAYS_ACTIVE = true;

class AircraftContrailSystem {
  constructor(entity) {
    this.entity = entity;
    this.left  = new ContrailEmitter(1000);
    this.right = new ContrailEmitter(1000);
    this._tmpOffset = new THREE.Vector3();
    this._tmpWorld  = new THREE.Vector3();
  }

  // Zwraca pozycję świata (world-space, ze skalą Y_SCALE/DEM_EXAG spójną z
  // resztą sceny) danego silnika. Używamy PRAWDZIWEJ macierzy świata węzła
  // fan_L/fan_R modelu (dokładne dopasowanie do geometrii), a nie fallbacku
  // z lokalnego offsetu — ten drugi służy TYLKO zanim model się wczyta.
  //
  // WAŻNE: mesh.matrixWorld samolotu jest normalnie przeliczane dopiero
  // wewnątrz renderer.render() (w renderFrame()), które w pętli animate()
  // wywołuje się PO contrails.emit(). Bez jawnego updateMatrixWorld() tutaj,
  // getWorldPosition() czytałoby macierz sprzed jednej klatki obrotu —
  // dokładnie to powodowało "odklejanie się" punktu emisji od kadłuba przy
  // obrocie w osi Y (yaw). Wymuszamy świeżą macierz TU, zaraz po syncMesh().
  _engineWorldPos(fanNode, localOffset, out) {
    if (fanNode) {
      this.entity.mesh.updateMatrixWorld(true);
      return fanNode.getWorldPosition(out);
    }
    const e = this.entity;
    const noseDir   = e._noseDir   || new THREE.Vector3(Math.sin(e.yawRad || 0), 0, Math.cos(e.yawRad || 0));
    const wingRight = e._wingRight || new THREE.Vector3(Math.cos(e.yawRad || 0), 0, -Math.sin(e.yawRad || 0));
    const acUp      = e._acUp      || new THREE.Vector3(0, 1, 0);

    this._tmpOffset.set(0, 0, 0)
      .addScaledVector(wingRight, localOffset.x)
      .addScaledVector(acUp, localOffset.y)
      .addScaledVector(noseDir, localOffset.z);

    // worldPos encji już zawiera skalowanie Y_SCALE*DEM_EXAG (geoToWorld) —
    // offset lokalny w metrach realnych trzeba przeskalować tak samo w Y,
    // żeby "opadanie" silnika pod kadłubem nie wyglądało na zbyt duże/małe.
    const basePos = e.worldPos;
    out.set(
      basePos.x + this._tmpOffset.x,
      basePos.y + this._tmpOffset.y * Y_SCALE * DEM_EXAG,
      basePos.z - this._tmpOffset.z
    );
    return out;
  }

  emit(clockTime) {
    if (!CONTRAIL_ALWAYS_ACTIVE) return;
    const parts = this.entity._parts || {};

    const posL = this._engineWorldPos(parts.fanL, CONTRAIL_ENGINE_OFFSET_L, this._tmpWorld);
    this.left.emit(posL, clockTime, 1);

    const posR = this._engineWorldPos(parts.fanR, CONTRAIL_ENGINE_OFFSET_R, new THREE.Vector3());
    this.right.emit(posR, clockTime, 1);
  }

  update(time) {
    this.left.update(time);
    this.right.update(time);
  }

  dispose() {
    this.left.dispose();
    this.right.dispose();
  }
}
