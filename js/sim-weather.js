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

    this._cloudGeo  = null;
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

  // ── Inicjalizacja chmur ───────────────────────────────────────────────────────
  _initClouds() {
    const N = this._N_CLOUD;
    const pos = new Float32Array(N * 3);
    const sz  = new Float32Array(N);
    const op  = new Float32Array(N);
    const tp  = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const r = 3000 + Math.random() * 22000, a = Math.random() * Math.PI * 2;
      const altY = (WeatherState.cloudAltitudeM + Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      pos[i*3] = Math.cos(a)*r; pos[i*3+1] = altY; pos[i*3+2] = Math.sin(a)*r;
      sz[i] = 300 + Math.random() * 500;
      op[i] = 0.35 + Math.random() * 0.55;
      tp[i] = Math.random() < 0.3 ? 1 : 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz,  1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(op,  1));
    geo.setAttribute('aType',    new THREE.BufferAttribute(tp,  1));
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

  // ── Chmury (recykling) ────────────────────────────────────────────────────────
  _updateClouds(dt, camPos, planeAlt) {
    if (!this._cloudMesh) return;
    this._cloudMesh.visible = WeatherState.cloudCoverage > 0.02;
    if (!this._cloudMesh.visible) return;

    this._cloudMesh.material.uniforms.uCoverage.value = WeatherState.cloudCoverage;
    this._cloudMesh.material.uniforms.uTime.value     = this._time;
    const sky = scene.background;
    if (sky && sky.isColor) this._cloudMesh.material.uniforms.uSkyColor.value.copy(sky);

    const pos = this._cloudGeo.attributes.position;
    const RECYCLE_DSQ = 24000 * 24000;
    let recycled = 0;
    for (let i = 0; i < this._N_CLOUD && recycled < 10; i++) {
      const dx = pos.getX(i) - camPos.x, dz = pos.getZ(i) - camPos.z;
      if (dx*dx + dz*dz > RECYCLE_DSQ) {
        const r = 4000 + Math.random() * 18000, a = Math.random() * Math.PI * 2;
        const altY = (WeatherState.cloudAltitudeM + Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
        pos.setX(i, camPos.x + Math.cos(a) * r);
        pos.setY(i, altY);
        pos.setZ(i, camPos.z + Math.sin(a) * r);
        recycled++;
      }
    }
    if (recycled > 0) pos.needsUpdate = true;
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

      // Aparentna prędkość deszczu względem kamery (world space)
      _rainApparent.set(
        _windVel.x - _acVel.x,
        -FALL * Y_SCALE - _acVel.y,
        _windVel.z - _acVel.z
      );

      // Wektory osi kamery z kwaternionu (brak alokacji)
      _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);

      // Projekcja na płaszczyznę ekranu (dot product)
      const scr_x =  _rainApparent.dot(_camRight);   // prawo
      const scr_y =  _rainApparent.dot(_camUp);      // góra (świat)
      // scr_y ujemne = deszcz idzie w dół na ekranie ✓

      // Kąt smugi od pionu + długość
      const angle  = Math.atan2(-scr_x, scr_y);          // od pionu
      const speed  = Math.sqrt(scr_x*scr_x + scr_y*scr_y);
      const baseLen = 12 + WeatherState.precipIntensity * 8;
      const len    = baseLen * Math.min(5, 1 + speed * 0.04);  // max 5× długość
      const alpha  = 0.15 + WeatherState.precipIntensity * 0.25;

      const ca = Math.cos(angle), sa = Math.sin(angle);

      ctx.strokeStyle = `rgba(180, 210, 240, ${alpha})`;
      ctx.lineWidth   = 1.0;
      ctx.beginPath();

      for (const d of this._drops2D) {
        // Przesuwaj kroplę z prędkością aparentną (skalowaną)
        d.x += -scr_x * d.spd * dt * 0.8;
        d.y +=  scr_y * d.spd * dt * 0.8;   // scr_y ujemne = w dół ✓

        // Zawijaj
        if (d.x < -10)  d.x = W + 10;
        if (d.x > W+10) d.x = -10;
        if (d.y < -10)  d.y = H + 10;
        if (d.y > H+10) d.y = -10;

        // Rysuj smugę w kierunku kąta aparentnego
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + sa * len, d.y - ca * len);
      }
      ctx.stroke();

    } else if (isSnow) {
      // Śnieg: wolno, okrągłe płatki, lekki drft z wiatrem
      _camRight.set(1,0,0).applyQuaternion(camera.quaternion);
      _camUp.set(0,1,0).applyQuaternion(camera.quaternion);
      _rainApparent.set(_windVel.x - _acVel.x, -3*Y_SCALE - _acVel.y, _windVel.z - _acVel.z);
      const scr_x = _rainApparent.dot(_camRight);
      const scr_y = _rainApparent.dot(_camUp);

      ctx.fillStyle = `rgba(220,230,255,${0.40 * WeatherState.precipIntensity})`;
      for (const d of this._drops2D) {
        const swing = Math.sin(this._time * 1.1 + d.spd) * 0.8;
        d.x += (-scr_x * 0.4 + swing) * d.spd * dt;
        d.y +=  scr_y * 0.4 * d.spd * dt;
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
    if (!this._cloudGeo) return;
    const pos = this._cloudGeo.attributes.position;
    const cp  = camera.position;
    for (let i = 0; i < this._N_CLOUD; i++) {
      const r = 3000 + Math.random() * 20000, a = Math.random() * Math.PI * 2;
      const altY = (WeatherState.cloudAltitudeM + Math.random() * WeatherState.cloudThicknessM) * Y_SCALE;
      pos.setX(i, cp.x + Math.cos(a) * r);
      pos.setY(i, altY);
      pos.setZ(i, cp.z + Math.sin(a) * r);
    }
    pos.needsUpdate = true;
  }

  getHUDString() {
    const w   = WeatherState;
    const from = w.windDirectionDeg.toFixed(0).padStart(3,'0');
    const spd  = this.windEffective().toFixed(0);
    return `${from}°/${spd}m/s  T:${this.temperature}°C  Q:${this.pressure}hPa`;
  }
}

let weather = null;
