'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-weather.js  —  realistyczny system pogody z fizyką względną
//
// FIZYKA OPADÓW:
//   Prędkość wizualna deszczu/śniegu = prędkość opadów_świat - prędkość_kamery
//   → przy 300 kt deszcz leci prawie poziomo od przodu (jak w rzeczywistości)
//
// 3D cząsteczki: ruch względny w każdej klatce (mesh śledzi kamerę)
// 2D overlay:    kąt smug obliczony przez projekcję na płaszczyznę ekranu
//               via kwaternion kamery (działa w orbit i cockpit)
// ═══════════════════════════════════════════════════════════════════════════════

const WeatherState = {
  cloudCoverage:    0.30,
  cloudAltitudeM:   2000,
  cloudThicknessM:  700,
  precipitation:    false,
  precipType:      'rain',
  precipIntensity:  0.60,
  windSpeedMs:      5,
  windDirectionDeg: 270,   // skąd wieje (konwencja met.)
  gustMs:           2,
  visibilityM:      20000,
  turbulence:       0.10,
};

const WeatherPresets = {
  clear:   { cloudCoverage:0.04, cloudAltitudeM:4000, precipitation:false,windSpeedMs:3,  gustMs:1, visibilityM:50000, turbulence:0.0  },
  cloudy:  { cloudCoverage:0.60, cloudAltitudeM:1800, precipitation:false,windSpeedMs:8,  gustMs:3, visibilityM:20000, turbulence:0.2  },
  overcast:{ cloudCoverage:0.95, cloudAltitudeM:700,  precipitation:false,windSpeedMs:10, gustMs:4, visibilityM:6000,  turbulence:0.35 },
  rain:    { cloudCoverage:0.90, cloudAltitudeM:600,  precipitation:true, precipType:'rain',precipIntensity:0.70,windSpeedMs:12,gustMs:5,visibilityM:2500,turbulence:0.55 },
  storm:   { cloudCoverage:1.00, cloudAltitudeM:350,  precipitation:true, precipType:'rain',precipIntensity:1.00,windSpeedMs:22,gustMs:9,visibilityM:800, turbulence:0.95 },
  snow:    { cloudCoverage:0.85, cloudAltitudeM:900,  precipitation:true, precipType:'snow',precipIntensity:0.55,windSpeedMs:5, gustMs:2,visibilityM:1800,turbulence:0.20 },
  fog:     { cloudCoverage:0.70, cloudAltitudeM:100,  precipitation:false,windSpeedMs:2,  gustMs:0, visibilityM:400,  turbulence:0.05 },
};

// ── Pre-alokowane wektory (brak GC w pętli renderowania) ─────────────────────
const _wv3         = new THREE.Vector3();
const _camRight    = new THREE.Vector3();
const _camUp       = new THREE.Vector3();
const _camFwd      = new THREE.Vector3();
const _rainApparent= new THREE.Vector3();
const _acVel       = new THREE.Vector3();
const _windVel     = new THREE.Vector3();

class WeatherSystem {
  constructor() {
    this._isMobile = document.body.classList.contains('is-touch');
    this._time     = 0;
    this._gustTime = 0;

    this._N_CLOUD = this._isMobile ?  80 : 280;
    this._N_RAIN  = this._isMobile ? 800 : 2500;
    this._N_SNOW  = this._isMobile ? 600 : 1800;
    this._N_2D    = this._isMobile ?  80 : 200;

    this._cloudMesh = null;
    this._rainGeo   = null;
    this._rainMesh  = null;
    this._snowGeo   = null;
    this._snowMesh  = null;

    this._canvas2D = null;
    this._ctx2D    = null;
    this._drops2D  = [];

    this._origFogNear = scene.fog ? scene.fog.near : 60000;
    this._origFogFar  = scene.fog ? scene.fog.far  : 400000;
    this._origBg      = scene.background ? scene.background.clone() : new THREE.Color(0x9fc3e6);

    this._initClouds();
    this._initRain();
    this._initSnow();
    this._init2DOverlay();
    this._applyFogSky(0);
  }

  // ── Gettery fizyczne ─────────────────────────────────────────────────────────

  get temperature() {
    const altM = activeEntity ? activeEntity.altM : 0;
    return Math.round((15.0 - Math.min(altM, 11000) * 0.0065) * 10) / 10;
  }

  get pressure() {
    const altM = activeEntity ? activeEntity.altM : 0;
    return Math.round(1013.25 * Math.pow(Math.max(0, 1 - 2.2557e-5 * altM), 5.2559) * 10) / 10;
  }

  get windSpeedEffective() {
    const gust = (Math.sin(this._gustTime * 2.3) * 0.5 + 0.5);
    return WeatherState.windSpeedMs + gust * WeatherState.gustMs;
  }

  /** Wektor wiatru w świecie Three.js: x=east, y=0, z=-north  (m/s) */
  get windWorld() {
    const toRad = ((WeatherState.windDirectionDeg + 180) % 360) * Math.PI / 180;
    const spd   = this.windEffective();
    return { x: Math.sin(toRad) * spd, z: -Math.cos(toRad) * spd };
  }

  windEffective() { return this.windSpeedEffective; }

  /** Wektor wiatru geo (x=east, y=north) m/s — getter do integracji z fizyką */
  get windVector() {
    const w = this.windWorld;
    return { x: w.x, y: -w.z };
  }

  get windToDirection() { return (WeatherState.windDirectionDeg + 180) % 360; }

  get isInCloud() {
    if (!activeEntity) return false;
    const a = activeEntity.altM;
    return a >= WeatherState.cloudAltitudeM &&
           a <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM;
  }

  getWindAtAlt(altM)    { return this.windVector; }
  getTurbulenceAt(altM) {
    const inCloud = activeEntity &&
      activeEntity.altM >= WeatherState.cloudAltitudeM &&
      activeEntity.altM <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM;
    return WeatherState.turbulence * (inCloud ? 1.4 : 1.0);
  }

  // ── Tekstura chmury z Canvas (soft multi-blob cumulus) ───────────────────────
  _makeCloudTex() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S, S);

    // Wiele zachodzących na siebie miękkich kół = kształt cumulus
    const blobs = [
      [0.50, 0.60, 0.36],   // [cx, cy, r] w jednostkach 0–1
      [0.26, 0.66, 0.26],
      [0.74, 0.66, 0.29],
      [0.50, 0.44, 0.23],
      [0.37, 0.54, 0.21],
      [0.63, 0.54, 0.21],
      [0.50, 0.72, 0.19],
      [0.20, 0.74, 0.16],
      [0.80, 0.74, 0.16],
    ];
    for (const [bx, by, br] of blobs) {
      const g = ctx.createRadialGradient(bx*S, by*S, 0, bx*S, by*S, br*S);
      g.addColorStop(0.0, 'rgba(255,255,255,0.88)');
      g.addColorStop(0.5, 'rgba(250,250,250,0.55)');
      g.addColorStop(0.8, 'rgba(240,240,242,0.20)');
      g.addColorStop(1.0, 'rgba(255,255,255,0.00)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    // Lekkie przyciemnienie dolnej części (cień chmury)
    const shadow = ctx.createLinearGradient(0, S*0.55, 0, S);
    shadow.addColorStop(0, 'rgba(160,170,180,0.00)');
    shadow.addColorStop(1, 'rgba(140,155,170,0.30)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, 0, S, S);

    const tex = new THREE.CanvasTexture(cv);
    tex.premultiplyAlpha = false;
    return tex;
  }

  // ── Inicjalizacja chmur — InstancedMesh + billboard ──────────────────────────
  // InstancedMesh: 1 draw call, brak limitu gl_PointSize, prawdziwe billboard.
  // Każda "chmura bazowa" ma N_PUFFS puffsów rozrzuconych wokół niej → realistyczny kształt.
  _initClouds() {
    // Generuj klastry puffsów
    this._cloudPos    = [];   // {x,y,z} — pozycja każdego puffsa w świecie
    this._cloudScale  = [];   // rozmiar każdego puffsa (world units)
    this._cloudBright = [];   // jasność (0=ciemniejszy spód, 1=jasny)
    this._cloudBaseIdx = [];  // indeks chmury bazowej dla recyklingu

    const N_BASE = Math.ceil(this._N_CLOUD / 5);  // ~56 chmur bazowych
    const basePositions = [];

    for (let c = 0; c < N_BASE; c++) {
      const r = 3000 + Math.random() * 22000;
      const a = Math.random() * Math.PI * 2;
      const altY = (WeatherState.cloudAltitudeM + Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      basePositions.push({ x: Math.cos(a)*r, y: altY, z: Math.sin(a)*r });

      const nPuffs = 4 + Math.floor(Math.random() * 4);  // 4–7 puffsów per chmura
      for (let p = 0; p < nPuffs && this._cloudPos.length < this._N_CLOUD; p++) {
        const spread = 300 + Math.random() * 400;
        this._cloudPos.push({
          x: Math.cos(a)*r + (Math.random()-0.5)*spread,
          y: altY + (Math.random()-0.5)*80*Y_SCALE,
          z: Math.sin(a)*r + (Math.random()-0.5)*spread,
        });
        this._cloudScale.push(250 + Math.random() * 450);
        this._cloudBright.push(0.85 + Math.random() * 0.15);
        this._cloudBaseIdx.push(c);
      }
    }

    this._cloudBases = basePositions;
    const N = this._cloudPos.length;

    // Płaszczyzna z szerokim aspect ratio (chmury są szersze niż wyższe)
    const geo = new THREE.PlaneGeometry(1, 0.55);
    const mat = new THREE.MeshBasicMaterial({
      map:          this._makeCloudTex(),
      transparent:  true,
      depthWrite:   false,
      depthTest:    false,
      side:         THREE.DoubleSide,
      opacity:      1.0,
    });

    this._cloudMesh   = new THREE.InstancedMesh(geo, mat, N);
    this._cloudMesh.frustumCulled = false;
    this._cloudMesh.renderOrder   = 50;
    this._cloudDummy  = new THREE.Object3D();
    scene.add(this._cloudMesh);
  }

  // ── Inicjalizacja deszczu 3D ──────────────────────────────────────────────────
  _initRain() {
    const N = this._N_RAIN;
    const pos = new Float32Array(N * 3);
    const R   = 200;
    for (let i = 0; i < N; i++) {
      const r = Math.random() * R, a = Math.random() * Math.PI * 2;
      pos[i*3]   = Math.cos(a) * r;
      pos[i*3+1] = Math.random() * 120 - 20;
      pos[i*3+2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife',    new THREE.BufferAttribute(new Float32Array(N).fill(1), 1));
    this._rainGeo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent:    true, depthWrite: false, depthTest: false,
      uniforms: { uIntensity: { value: 0 } },
    });
    this._rainMesh = new THREE.Points(geo, mat);
    this._rainMesh.frustumCulled = false;
    this._rainMesh.renderOrder   = 200;
  }

  // ── Inicjalizacja śniegu 3D ───────────────────────────────────────────────────
  _initSnow() {
    const N = this._N_SNOW;
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const R   = 160;
    for (let i = 0; i < N; i++) {
      const r = Math.random() * R, a = Math.random() * Math.PI * 2;
      pos[i*3]   = Math.cos(a) * r;
      pos[i*3+1] = Math.random() * 100;
      pos[i*3+2] = Math.sin(a) * r;
      sz[i] = 0.8 + Math.random() * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz,  1));
    this._snowGeo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent:    true, depthWrite: false, depthTest: false,
      uniforms: { uIntensity: { value: 0 } },
    });
    this._snowMesh = new THREE.Points(geo, mat);
    this._snowMesh.frustumCulled = false;
    this._snowMesh.renderOrder   = 200;
  }

  // ── Canvas 2D ─────────────────────────────────────────────────────────────────
  _init2DOverlay() {
    this._canvas2D = document.getElementById('weather-overlay');
    if (!this._canvas2D) return;
    this._ctx2D = this._canvas2D.getContext('2d');
    this._canvas2D.width = innerWidth; this._canvas2D.height = innerHeight;
    window.addEventListener('resize', () => {
      if (!this._canvas2D) return;
      this._canvas2D.width = innerWidth; this._canvas2D.height = innerHeight;
    });
    for (let i = 0; i < this._N_2D; i++) {
      this._drops2D.push({
        x:   Math.random() * innerWidth,
        y:   Math.random() * innerHeight,
        spd: 10 + Math.random() * 8,
        op:  0.3 + Math.random() * 0.4,
      });
    }
  }

  // ── Główna pętla ──────────────────────────────────────────────────────────────
  update(dt, camPos, planeAlt) {
    this._time     += dt;
    this._gustTime += dt * 0.7;
    this._updateClouds(dt, camPos, planeAlt);
    this._updatePrecip3D(dt, camPos);
    this._update2DOverlay(dt);
    this._applyFogSky(planeAlt);
  }

  // ── Chmury — billboard InstancedMesh ─────────────────────────────────────────
  _updateClouds(dt, camPos) {
    if (!this._cloudMesh || !this._cloudPos) return;

    const cov = WeatherState.cloudCoverage;
    this._cloudMesh.visible = cov > 0.02;
    if (!this._cloudMesh.visible) return;

    // Opacity skalowana z zachmurzeniem
    this._cloudMesh.material.opacity = Math.min(1, cov * 1.8);

    const dummy   = this._cloudDummy;
    const N       = this._cloudPos.length;
    const RECYCLE = 23000 * 23000;

    // Pobierz kwaternion kamery raz (billboard = każdy plane zwrócony do kamery)
    const camQ = camera.quaternion;

    for (let i = 0; i < N; i++) {
      const p = this._cloudPos[i];

      // Recykling: za daleka chmura → losowa pozycja w pobliżu kamery
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      if (dx*dx + dz*dz > RECYCLE) {
        const r = 4000 + Math.random() * 18000;
        const a = Math.random() * Math.PI * 2;
        p.x = camPos.x + Math.cos(a) * r;
        p.z = camPos.z + Math.sin(a) * r;
        p.y = (WeatherState.cloudAltitudeM +
               Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      }

      // Ustaw macierz instancji: pozycja + billboard rotation + skala
      dummy.position.set(p.x, p.y, p.z);
      dummy.quaternion.copy(camQ);
      dummy.scale.setScalar(this._cloudScale[i]);
      dummy.updateMatrix();
      this._cloudMesh.setMatrixAt(i, dummy.matrix);
    }

    this._cloudMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Opady 3D — fizyka względna ────────────────────────────────────────────────
  //
  // Prędkość deszczu w świecie = wiatr (poziomo) + spadanie (pionowo)
  // Prędkość kamery           = prędkość samolotu
  // Prędkość względna         = deszcz_świat - kamera
  //
  // Cząsteczki są przechowywane WZGLĘDEM kamery (mesh.position = camPos),
  // więc każdą klatkę przesuwamy je o prędkość_względną * dt.
  // Przy 300 kt deszcz leci prawie poziomo od przodu — dokładnie jak w rzeczywistości.
  //
  _updatePrecip3D(dt, camPos) {
    const isRain = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isSnow = WeatherState.precipitation && WeatherState.precipType === 'snow';

    if (isRain  && !this._rainMesh.parent) scene.add(this._rainMesh);
    if (!isRain && this._rainMesh.parent)  scene.remove(this._rainMesh);
    if (isSnow  && !this._snowMesh.parent) scene.add(this._snowMesh);
    if (!isSnow && this._snowMesh.parent)  scene.remove(this._snowMesh);

    // Prędkość samolotu w układzie świata (m/s → world units)
    // vel.x = east, vel.y = pionowo (real m/s), vel.z = -north
    // Wertykalna: świat Y = altM * Y_SCALE, więc dY/dt = vel.y * Y_SCALE
    const ac   = activeEntity;
    const ac_vx = ac ? ac.vel.x : 0;
    const ac_vy = ac ? ac.vel.y * Y_SCALE : 0;  // world Y units/s
    const ac_vz = ac ? ac.vel.z : 0;

    // Wiatr w świecie Three.js (world units/s ≈ m/s poziomo)
    const ww = this.windWorld;

    if (isRain) {
      const FALL  = (6 + WeatherState.precipIntensity * 5) * Y_SCALE;  // world Y/s
      const RAIN_R = 200;

      // Relative rain velocity per frame (world units)
      // = (wind - aircraft) + rain_fall_downward
      const rx = (ww.x - ac_vx) * dt;
      const ry = -(FALL + ac_vy) * dt;
      const rz = (ww.z - ac_vz) * dt;

      this._rainMesh.material.uniforms.uIntensity.value = WeatherState.precipIntensity;
      this._rainMesh.position.copy(camPos);

      const pos = this._rainGeo.attributes.position;
      for (let i = 0; i < this._N_RAIN; i++) {
        let x = pos.getX(i) + rx;
        let y = pos.getY(i) + ry;
        let z = pos.getZ(i) + rz;

        // Recykluj gdy za nisko lub za daleko
        if (y < -50) {
          // Odradzaj przy górze w przód (naprzeciwko kierunku ruchu)
          y = 80 + Math.random() * 50;
          x = (Math.random() - 0.5) * RAIN_R * 2;
          z = (Math.random() - 0.5) * RAIN_R * 2;
        }
        if (x*x + z*z > RAIN_R * RAIN_R) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * RAIN_R;
          x = Math.cos(a) * r; z = Math.sin(a) * r;
        }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    if (isSnow) {
      const FALL   = (1.0 + WeatherState.precipIntensity * 1.5) * Y_SCALE;
      const SNOW_R = 160;

      const sx = (ww.x * 0.7 - ac_vx) * dt;
      const sy = -(FALL + ac_vy) * dt;
      const sz = (ww.z * 0.7 - ac_vz) * dt;

      this._snowMesh.material.uniforms.uIntensity.value = WeatherState.precipIntensity;
      this._snowMesh.position.copy(camPos);

      const pos = this._snowGeo.attributes.position;
      for (let i = 0; i < this._N_SNOW; i++) {
        const swing = Math.sin(this._time * 0.9 + i * 0.41) * 0.25 * dt;
        let x = pos.getX(i) + sx + swing;
        let y = pos.getY(i) + sy;
        let z = pos.getZ(i) + sz;

        if (y < -20) { y = 80 + Math.random() * 30; x = (Math.random()-0.5)*SNOW_R*2; z = (Math.random()-0.5)*SNOW_R*2; }
        if (x*x + z*z > SNOW_R * SNOW_R) { const a = Math.random()*Math.PI*2; x = Math.cos(a)*Math.random()*SNOW_R; z = Math.sin(a)*Math.random()*SNOW_R; }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  // ── 2D Overlay — kąt smug z projekcji aparentnej prędkości ───────────────────
  //
  // 1. Oblicz APARENTNY wektor deszczu w przestrzeni świata:
  //    apparent = wind_world + rain_fall - aircraft_velocity
  //
  // 2. Przekształć do przestrzeni kamery (przez kwaternion):
  //    cam.x = prawo, cam.y = góra, cam.z = od kamery
  //
  // 3. Kąt smugi na ekranie = atan2(cam.x, -cam.y)
  //    Długość smugi ∝ szybkość aparentna pozioma
  //
  _update2DOverlay(dt) {
    const ctx = this._ctx2D;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const isRain = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isSnow = WeatherState.precipitation && WeatherState.precipType === 'snow';
    if (!isRain && !isSnow) return;

    const W = ctx.canvas.width, H = ctx.canvas.height;
    const ac  = activeEntity;
    const ww  = this.windWorld;

    // Prędkość samolotu w świecie (world units/s)
    _acVel.set(
      ac ? ac.vel.x      : 0,
      ac ? ac.vel.y * Y_SCALE : 0,
      ac ? ac.vel.z      : 0
    );

    // Prędkość wiatru w świecie
    _windVel.set(ww.x, 0, ww.z);

    if (isRain) {
      const FALL = 8 + WeatherState.precipIntensity * 5;

      // Aparentna prędkość deszczu w przestrzeni świata (world units/s)
      _rainApparent.set(
        _windVel.x - _acVel.x,
        -FALL * Y_SCALE - _acVel.y,
        _windVel.z - _acVel.z
      );

      // Osie kamery z kwaternionu (bez alokacji)
      _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

      // Projekcja na płaszczyznę ekranu
      const scr_x = _rainApparent.dot(_camRight);   // + = prawo w camera = prawo na ekranie
      const scr_y = _rainApparent.dot(_camUp);      // + = góra w camera = góra na ekranie

      // Kierunek na ekranie canvas (Y odwrócone względem camera):
      //   ndx = scr_x  (prawo = prawo ✓)
      //   ndy = -scr_y (góra camera = góra canvas, ale canvas Y rośnie w dół)
      //          scr_y ujemny (deszcz spada) → ndy dodatni → w dół na canvas ✓
      const speed = Math.sqrt(scr_x * scr_x + scr_y * scr_y);
      if (speed < 0.001) return;

      const ndx    = scr_x / speed;
      const ndy    = -scr_y / speed;
      const baseLen = 12 + WeatherState.precipIntensity * 10;
      const len    = Math.min(baseLen * (1 + speed * 0.045), baseLen * 6);
      const alpha  = 0.15 + WeatherState.precipIntensity * 0.25;
      // Szybkość ruchu kropel na ekranie (skalowana do ~1 przy normalnym deszczu)
      const moveScale = speed * 0.05 * dt;

      ctx.strokeStyle = `rgba(180, 210, 240, ${alpha})`;
      ctx.lineWidth   = 1.0;
      ctx.beginPath();

      for (const d of this._drops2D) {
        d.x += ndx * d.spd * moveScale;
        d.y += ndy * d.spd * moveScale;

        if (d.x < -10)  d.x = W + 10;
        if (d.x > W+10) d.x = -10;
        if (d.y < -10)  d.y = H + 10;
        if (d.y > H+10) d.y = -10;

        // Smuga w kierunku ruchu deszczu
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + ndx * len, d.y + ndy * len);
      }
      ctx.stroke();

    } else if (isSnow) {
      // Śnieg: wolno, okrągłe płatki, lekki drft z wiatrem
      _camRight.set(1,0,0).applyQuaternion(camera.quaternion);
      _camUp.set(0,1,0).applyQuaternion(camera.quaternion);
      _rainApparent.set(_windVel.x - _acVel.x, -3*Y_SCALE - _acVel.y, _windVel.z - _acVel.z);
      const scr_x = _rainApparent.dot(_camRight);
      const scr_y = _rainApparent.dot(_camUp);
      // Canvas: Y odwrócone
      const sndx = scr_x, sndy = -scr_y;

      ctx.fillStyle = `rgba(220,230,255,${0.40 * WeatherState.precipIntensity})`;
      for (const d of this._drops2D) {
        const swing = Math.sin(this._time * 1.1 + d.spd) * 0.8;
        d.x += (sndx * 0.4 + swing) * d.spd * dt;
        d.y += sndy * 0.4 * d.spd * dt;
        if (d.x < -5)  d.x = W + 5;
        if (d.x > W+5) d.x = -5;
        if (d.y < -5)  d.y = H + 5;
        if (d.y > H+5) d.y = -5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.5 + d.op * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Mgła i kolor nieba ────────────────────────────────────────────────────────
  _applyFogSky(planeAlt) {
    if (!scene.fog) return;
    const cov     = WeatherState.cloudCoverage;
    const vis     = WeatherState.visibilityM;
    const inCloud = this.isInCloud;

    scene.fog.far  = inCloud ? Math.min(vis, 500) : vis;
    scene.fog.near = scene.fog.far * 0.06;

    const t  = Math.min(1, cov * 0.85 + (inCloud ? 0.15 : 0));
    const b  = this._origBg;
    scene.background.setRGB(
      Math.max(b.r * (1 - t * 0.55), 0.10),
      Math.max(b.g * (1 - t * 0.45), 0.12),
      Math.max(b.b * (1 - t * 0.30), 0.18)
    );
    scene.fog.color.copy(scene.background);
  }

  // ── Preset + repozyqcja chmur ─────────────────────────────────────────────────
  applyPreset(name) {
    const p = WeatherPresets[name]; if (!p) return;
    Object.assign(WeatherState, p);
    this._repositionClouds();
    if (typeof weatherUI !== 'undefined') weatherUI.syncUI();
  }

  _repositionClouds() {
    if (!this._cloudPos) return;
    const cp = camera.position;
    // Grupuj po chmurze bazowej i przesuń całe klastry
    const baseMoved = new Set();
    for (let i = 0; i < this._cloudPos.length; i++) {
      const bi = this._cloudBaseIdx[i];
      if (!baseMoved.has(bi)) {
        const r = 3000 + Math.random() * 20000;
        const a = Math.random() * Math.PI * 2;
        const altY = (WeatherState.cloudAltitudeM +
                      Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
        if (this._cloudBases[bi]) {
          this._cloudBases[bi].x = cp.x + Math.cos(a) * r;
          this._cloudBases[bi].y = altY;
          this._cloudBases[bi].z = cp.z + Math.sin(a) * r;
        }
        baseMoved.add(bi);
      }
      const base = this._cloudBases[this._cloudBaseIdx[i]];
      if (base) {
        const spread = 300 + Math.random() * 400;
        this._cloudPos[i].x = base.x + (Math.random()-0.5)*spread;
        this._cloudPos[i].y = base.y + (Math.random()-0.5)*80*Y_SCALE;
        this._cloudPos[i].z = base.z + (Math.random()-0.5)*spread;
      }
    }
  }

  getHUDString() {
    const w   = WeatherState;
    const from = w.windDirectionDeg.toFixed(0).padStart(3,'0');
    const spd  = this.windEffective().toFixed(0);
    return `${from}°/${spd}m/s  T:${this.temperature}°C  Q:${this.pressure}hPa`;
  }
}

let weather = null;
