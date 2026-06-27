'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-weather.js  —  system pogody
// Zależy od: sim-shaders.js, sim-scene.js (scene, camera)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Stan pogody ───────────────────────────────────────────────────────────────
const WeatherState = {
  cloudCoverage:    0.30,  // 0–1, % zachmurzenia
  cloudAltitudeM:   2000,  // m MSL, podstawa chmur
  cloudThicknessM:  700,   // m, grubość warstwy
  precipitation:    false,
  precipType:      'rain', // 'rain' | 'snow'
  precipIntensity:  0.60,  // 0–1
  windSpeedMs:      5,     // m/s
  windDirectionDeg: 270,   // stopnie (skąd wieje, konwencja met.)
  gustMs:           2,     // m/s porywy
  visibilityM:      20000, // m
  turbulence:       0.10,  // 0–1
};

// ── Presety ───────────────────────────────────────────────────────────────────
const WeatherPresets = {
  clear:   { cloudCoverage:0.04, cloudAltitudeM:4000, precipitation:false, windSpeedMs:3,  gustMs:1, visibilityM:50000, turbulence:0.0 },
  cloudy:  { cloudCoverage:0.60, cloudAltitudeM:1800, precipitation:false, windSpeedMs:8,  gustMs:3, visibilityM:20000, turbulence:0.2 },
  overcast:{ cloudCoverage:0.95, cloudAltitudeM:700,  precipitation:false, windSpeedMs:10, gustMs:4, visibilityM:6000,  turbulence:0.35},
  rain:    { cloudCoverage:0.90, cloudAltitudeM:600,  precipitation:true,  precipType:'rain', precipIntensity:0.70, windSpeedMs:12, gustMs:5, visibilityM:2500, turbulence:0.55 },
  storm:   { cloudCoverage:1.00, cloudAltitudeM:350,  precipitation:true,  precipType:'rain', precipIntensity:1.00, windSpeedMs:22, gustMs:9, visibilityM:800,  turbulence:0.95 },
  snow:    { cloudCoverage:0.85, cloudAltitudeM:900,  precipitation:true,  precipType:'snow', precipIntensity:0.55, windSpeedMs:5,  gustMs:2, visibilityM:1800, turbulence:0.20 },
  fog:     { cloudCoverage:0.70, cloudAltitudeM:100,  precipitation:false, windSpeedMs:2,  gustMs:0, visibilityM:400,  turbulence:0.05},
};

// ── WeatherSystem ─────────────────────────────────────────────────────────────
class WeatherSystem {
  constructor() {
    this._isMobile = document.body.classList.contains('is-touch');
    this._time     = 0;
    this._gustTime = 0;

    // Liczba cząsteczek — mniejsze liczby na mobile
    this._N_CLOUD = this._isMobile ?  80 : 280;
    this._N_RAIN  = this._isMobile ? 800 : 2500;
    this._N_SNOW  = this._isMobile ? 600 : 1800;
    this._N_2D    = this._isMobile ?  80 : 200;

    this._cloudGeo   = null;
    this._cloudMesh  = null;
    this._rainGeo    = null;
    this._rainMesh   = null;
    this._snowGeo    = null;
    this._snowMesh   = null;

    // Wewnętrzne bufory pozycji cząsteczek (CPU side)
    this._rainPos  = null;  // Float32Array N*3
    this._snowPos  = null;  // Float32Array N*3
    this._cloudPos = null;  // Float32Array N*3

    // 2D overlay
    this._canvas2D = null;
    this._ctx2D    = null;
    this._drops2D  = [];

    // Zapisane kolory sceny (przywracamy gdy brak pogody)
    this._origFogNear = scene.fog ? scene.fog.near : 60000;
    this._origFogFar  = scene.fog ? scene.fog.far  : 400000;
    this._origBg      = scene.background ? scene.background.clone() : new THREE.Color(0x9fc3e6);

    this._initClouds();
    this._initRain();
    this._initSnow();
    this._init2DOverlay();
    this._applyFogSky();
  }

  // ── Gettery fizyczne ─────────────────────────────────────────────────────────

  /** Temperatura w °C (ISA + offset terenu) */
  get temperature() {
    const altM = activeEntity ? activeEntity.altM : 0;
    const isa  = 15.0 - Math.min(altM, 11000) * 0.0065;
    return Math.round(isa * 10) / 10;
  }

  /** Ciśnienie w hPa (ISA) */
  get pressure() {
    const altM = activeEntity ? activeEntity.altM : 0;
    return Math.round(1013.25 * Math.pow(Math.max(0, 1 - 2.2557e-5 * altM), 5.2559) * 10) / 10;
  }

  /** Prędkość wiatru z porywami (m/s) */
  get windSpeedMs() {
    const gust = Math.sin(this._gustTime * 2.3) * 0.5 + 0.5;
    return WeatherState.windSpeedMs + gust * WeatherState.gustMs;
  }

  /** Wektor wiatru w układzie geo (x=E, y=N) m/s */
  get windVector() {
    const toRad = ((WeatherState.windDirectionDeg + 180) % 360) * Math.PI / 180;
    const spd   = this.windSpeedMs;
    return { x: Math.sin(toRad) * spd, y: Math.cos(toRad) * spd };
  }

  /** Kierunek wiatru (dokąd) w stopniach (0=N, 90=E) */
  get windToDirection() {
    return (WeatherState.windDirectionDeg + 180) % 360;
  }

  /** Czy samolot jest w chmurach */
  get isInCloud() {
    if (!activeEntity) return false;
    const alt = activeEntity.altM;
    return alt >= WeatherState.cloudAltitudeM &&
           alt <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM;
  }

  /** Wiatr na danej wysokości (przyszła integracja z fizyką) */
  getWindAtAlt(altM) { return this.windVector; }

  /** Turbulencja 0–1 na danej wysokości */
  getTurbulenceAt(altM) {
    // Silniejsza w chmurach i przy burzy
    const inCloud = altM >= WeatherState.cloudAltitudeM &&
                    altM <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM;
    return WeatherState.turbulence * (inCloud ? 1.4 : 1.0);
  }

  // ── Inicjalizacja chmur ───────────────────────────────────────────────────────
  _initClouds() {
    const N   = this._N_CLOUD;
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const op  = new Float32Array(N);
    const tp  = new Float32Array(N);  // type: 0=cumulus, 1=stratus

    this._cloudPos = pos;

    for (let i = 0; i < N; i++) {
      const r = 3000 + Math.random() * 22000;
      const a = Math.random() * Math.PI * 2;
      const altY = (WeatherState.cloudAltitudeM +
                    Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      pos[i*3]   = Math.cos(a) * r;
      pos[i*3+1] = altY;
      pos[i*3+2] = Math.sin(a) * r;
      sz[i]  = 300 + Math.random() * 500;
      op[i]  = 0.35 + Math.random() * 0.55;
      tp[i]  = Math.random() < 0.3 ? 1 : 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(op, 1));
    geo.setAttribute('aType',    new THREE.BufferAttribute(tp, 1));
    this._cloudGeo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent:    true,
      depthWrite:     false,
      uniforms: {
        uCoverage: { value: WeatherState.cloudCoverage },
        uTime:     { value: 0 },
        uSkyColor: { value: new THREE.Color(0x9fc3e6) },
      },
    });

    this._cloudMesh = new THREE.Points(geo, mat);
    this._cloudMesh.frustumCulled = false;
    this._cloudMesh.renderOrder   = 50;
    scene.add(this._cloudMesh);
  }

  // ── Inicjalizacja deszczu 3D ──────────────────────────────────────────────────
  _initRain() {
    const N   = this._N_RAIN;
    const pos = new Float32Array(N * 3);
    const lf  = new Float32Array(N);
    const R   = 180;

    this._rainPos = pos;

    for (let i = 0; i < N; i++) {
      const r = Math.random() * R, a = Math.random() * Math.PI * 2;
      pos[i*3]   = Math.cos(a) * r;
      pos[i*3+1] = Math.random() * 120;
      pos[i*3+2] = Math.sin(a) * r;
      lf[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife',    new THREE.BufferAttribute(lf, 1));
    this._rainGeo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      uniforms: { uIntensity: { value: 0 } },
    });

    this._rainMesh = new THREE.Points(geo, mat);
    this._rainMesh.frustumCulled = false;
    this._rainMesh.renderOrder   = 200;
    // Dodany do sceny tylko gdy pada
  }

  // ── Inicjalizacja śniegu 3D ───────────────────────────────────────────────────
  _initSnow() {
    const N   = this._N_SNOW;
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const R   = 150;

    this._snowPos = pos;

    for (let i = 0; i < N; i++) {
      const r = Math.random() * R, a = Math.random() * Math.PI * 2;
      pos[i*3]   = Math.cos(a) * r;
      pos[i*3+1] = Math.random() * 100;
      pos[i*3+2] = Math.sin(a) * r;
      sz[i] = 0.8 + Math.random() * 1.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz, 1));
    this._snowGeo = geo;

    const mat = new THREE.ShaderMaterial({
      vertexShader:   SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      uniforms: { uIntensity: { value: 0 } },
    });

    this._snowMesh = new THREE.Points(geo, mat);
    this._snowMesh.frustumCulled = false;
    this._snowMesh.renderOrder   = 200;
  }

  // ── Canvas 2D overlay (krople na szybie) ─────────────────────────────────────
  _init2DOverlay() {
    this._canvas2D = document.getElementById('weather-overlay');
    if (!this._canvas2D) return;
    this._ctx2D = this._canvas2D.getContext('2d');
    this._canvas2D.width  = innerWidth;
    this._canvas2D.height = innerHeight;
    window.addEventListener('resize', () => {
      if (!this._canvas2D) return;
      this._canvas2D.width  = innerWidth;
      this._canvas2D.height = innerHeight;
    });
    for (let i = 0; i < this._N_2D; i++) {
      this._drops2D.push({
        x:   Math.random() * innerWidth,
        y:   Math.random() * innerHeight,
        len: 8 + Math.random() * 16,
        spd: 12 + Math.random() * 10,
        op:  0.3 + Math.random() * 0.4,
      });
    }
  }

  // ── Główna pętla aktualizacji ─────────────────────────────────────────────────
  update(dt, camPos, planeAlt) {
    this._time     += dt;
    this._gustTime += dt;

    this._updateClouds(dt, camPos, planeAlt);
    this._updatePrecip(dt, camPos);
    this._update2DOverlay(dt);
    this._applyFogSky(planeAlt);
  }

  _updateClouds(dt, camPos, planeAlt) {
    if (!this._cloudMesh) return;

    // Widoczność: ukryj gdy brak chmur
    this._cloudMesh.visible = WeatherState.cloudCoverage > 0.02;
    if (!this._cloudMesh.visible) return;

    // Aktualizuj uniformy
    this._cloudMesh.material.uniforms.uCoverage.value = WeatherState.cloudCoverage;
    this._cloudMesh.material.uniforms.uTime.value     = this._time;

    // Kolor nieba → shader wie jak okolorować krawędzie chmur
    const sky = scene.background;
    if (sky && sky.isColor) this._cloudMesh.material.uniforms.uSkyColor.value.copy(sky);

    // Recykluj chmury za daleko od kamery (max 10 na klatkę)
    const pos   = this._cloudGeo.attributes.position;
    const RECYCLE_DSQ = 24000 * 24000;
    let recycled = 0;

    for (let i = 0; i < this._N_CLOUD && recycled < 10; i++) {
      const dx = pos.getX(i) - camPos.x;
      const dz = pos.getZ(i) - camPos.z;
      if (dx*dx + dz*dz > RECYCLE_DSQ) {
        const r = 4000 + Math.random() * 18000;
        const a = Math.random() * Math.PI * 2;
        const altY = (WeatherState.cloudAltitudeM +
                      Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
        pos.setX(i, camPos.x + Math.cos(a) * r);
        pos.setY(i, altY);
        pos.setZ(i, camPos.z + Math.sin(a) * r);
        recycled++;
      }
    }
    if (recycled > 0) pos.needsUpdate = true;
  }

  _updatePrecip(dt, camPos) {
    const isRain = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isSnow = WeatherState.precipitation && WeatherState.precipType === 'snow';

    // Zarządzaj obecnością w scenie
    if (isRain && !this._rainMesh.parent) scene.add(this._rainMesh);
    if (!isRain && this._rainMesh.parent) scene.remove(this._rainMesh);
    if (isSnow && !this._snowMesh.parent) scene.add(this._snowMesh);
    if (!isSnow && this._snowMesh.parent) scene.remove(this._snowMesh);

    const wind     = this.windVector;
    const windX    = wind.x * dt * Y_SCALE * 0.3;
    const windZ    = wind.y * dt * Y_SCALE * 0.3;
    const RAIN_R   = 180;
    const FALL_SPD = (6 + WeatherState.precipIntensity * 6) * dt * Y_SCALE;
    const SNOW_SPD = (1 + WeatherState.precipIntensity * 1.5) * dt * Y_SCALE;

    if (isRain) {
      const intensity = WeatherState.precipIntensity;
      this._rainMesh.material.uniforms.uIntensity.value = intensity;
      this._rainMesh.position.copy(camPos);

      const pos = this._rainGeo.attributes.position;
      for (let i = 0; i < this._N_RAIN; i++) {
        let x = pos.getX(i) + windX;
        let y = pos.getY(i) - FALL_SPD;
        let z = pos.getZ(i) + windZ;
        if (y < -30) { y = 80 + Math.random() * 40; }
        const r = Math.sqrt(x*x + z*z);
        if (r > RAIN_R) {
          const a = Math.random() * Math.PI * 2;
          x = Math.cos(a) * (10 + Math.random() * RAIN_R * 0.8);
          z = Math.sin(a) * (10 + Math.random() * RAIN_R * 0.8);
        }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    if (isSnow) {
      this._snowMesh.material.uniforms.uIntensity.value = WeatherState.precipIntensity;
      this._snowMesh.position.copy(camPos);

      const pos = this._snowGeo.attributes.position;
      const R   = 150;
      for (let i = 0; i < this._N_SNOW; i++) {
        // Śnieg: powolny opad z bujaniem
        const swing = Math.sin(this._time * 0.8 + i * 0.42) * 0.3;
        let x = pos.getX(i) + windX * 0.8 + swing * dt;
        let y = pos.getY(i) - SNOW_SPD;
        let z = pos.getZ(i) + windZ * 0.8;
        if (y < -20) { y = 80 + Math.random() * 30; }
        const r2 = x*x + z*z;
        if (r2 > R*R) {
          const a = Math.random() * Math.PI * 2;
          x = Math.cos(a) * Math.random() * R;
          z = Math.sin(a) * Math.random() * R;
        }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  _update2DOverlay(dt) {
    const ctx = this._ctx2D;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const isRain = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isSnow = WeatherState.precipitation && WeatherState.precipType === 'snow';
    if (!isRain && !isSnow) return;

    const intensity = WeatherState.precipIntensity;
    const toRad = this.windToDirection * Math.PI / 180;
    const wx    = Math.sin(toRad) * this.windSpeedMs;
    const wy    = 0;
    const W     = ctx.canvas.width, H = ctx.canvas.height;
    const gravity = isRain ? 18 : 4;

    const angleX = wx / 30;   // przechylenie od wiatru
    const speedY = gravity * intensity;

    if (isRain) {
      ctx.strokeStyle = `rgba(180, 210, 240, ${0.18 + intensity * 0.22})`;
      ctx.lineWidth   = 1.0;
      ctx.beginPath();
      for (const d of this._drops2D) {
        d.x += angleX  * d.spd * dt * 4;
        d.y += speedY * d.spd * dt * 4;
        if (d.y > H + 20) { d.y = -20; d.x = Math.random() * W; }
        if (d.x > W + 20) d.x = -20;
        if (d.x < -20)    d.x = W + 20;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - angleX * d.len, d.y - d.len);
      }
      ctx.stroke();
    } else {
      // Śnieg: okrągłe płatki
      ctx.fillStyle = `rgba(220, 230, 255, ${0.45 * intensity})`;
      for (const d of this._drops2D) {
        const swing = Math.sin(this._time * 1.2 + d.spd) * 1.5;
        d.x += (angleX + swing) * d.spd * dt * 2;
        d.y += speedY * d.spd * dt * 2;
        if (d.y > H + 10) { d.y = -10; d.x = Math.random() * W; }
        if (d.x > W + 10) d.x = -10;
        if (d.x < -10)    d.x = W + 10;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.5 + d.op * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _applyFogSky(planeAlt) {
    if (!scene.fog) return;
    const cov  = WeatherState.cloudCoverage;
    const vis  = WeatherState.visibilityM;

    // Mgła: widzialność + pogrubienie w chmurach
    const inCloud = this.isInCloud;
    const fogFar  = inCloud ? Math.min(vis, 600) : vis;
    const fogNear = fogFar * 0.08;

    scene.fog.far  = fogFar;
    scene.fog.near = fogNear;

    // Kolor nieba: ciemnieje i szarzeje ze wzrostem zachmurzenia
    const t   = cov * 0.85 + (inCloud ? 0.15 : 0);
    const base = this._origBg;
    const r   = base.r * (1 - t * 0.55);
    const g   = base.g * (1 - t * 0.45);
    const b   = base.b * (1 - t * 0.30);
    scene.background.setRGB(Math.max(r, 0.12), Math.max(g, 0.14), Math.max(b, 0.20));
    scene.fog.color.copy(scene.background);
  }

  // ── Zastosuj preset ───────────────────────────────────────────────────────────
  applyPreset(name) {
    const p = WeatherPresets[name];
    if (!p) return;
    Object.assign(WeatherState, p);
    // Przebuduj chmury na nowej wysokości
    this._repositionClouds();
    weatherUI.syncUI();
  }

  _repositionClouds() {
    if (!this._cloudGeo) return;
    const pos = this._cloudGeo.attributes.position;
    const cam = camera.position;
    for (let i = 0; i < this._N_CLOUD; i++) {
      const r = 3000 + Math.random() * 20000;
      const a = Math.random() * Math.PI * 2;
      const altY = (WeatherState.cloudAltitudeM +
                    Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      pos.setX(i, cam.x + Math.cos(a) * r);
      pos.setY(i, altY);
      pos.setZ(i, cam.z + Math.sin(a) * r);
    }
    pos.needsUpdate = true;
  }

  // ── Informacje dla HUD ────────────────────────────────────────────────────────
  getHUDString() {
    const w = WeatherState;
    const from = w.windDirectionDeg.toFixed(0).padStart(3,'0');
    const spd  = this.windSpeedMs.toFixed(0);
    return `${from}°/${spd}m/s  T:${this.temperature}°C  P:${this.pressure}hPa`;
  }
}

// Globalna instancja — tworzona po init w sim-main.js
let weather = null;
