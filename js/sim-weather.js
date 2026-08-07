'use strict';

// Section: WeatherState.

const WeatherState = {
  cloudCoverage:    0.30,
  cloudAltitudeM:   2000,
  cloudThicknessM:  700,
  precipitation:    false,
  precipType:      'rain',
  precipIntensity:  0.60,
  windSpeedMs:      5,
  windDirectionDeg: 270,   // Implementation note.
  gustMs:           2,
  visibilityM:      35000,
  turbulence:       0.10,
};

const WeatherPresets = {
  clear:    { cloudCoverage:0.04, cloudAltitudeM:4000, cloudThicknessM:500,  precipitation:false, windSpeedMs:3,  gustMs:1, visibilityM:100000, turbulence:0.00 },
  cloudy:   { cloudCoverage:0.55, cloudAltitudeM:1800, cloudThicknessM:800,  precipitation:false, windSpeedMs:8,  gustMs:3, visibilityM:32000, turbulence:0.20 },
  overcast: { cloudCoverage:0.92, cloudAltitudeM:700,  cloudThicknessM:600,  precipitation:false, windSpeedMs:10, gustMs:4, visibilityM:9000,  turbulence:0.35 },
  rain:     { cloudCoverage:0.88, cloudAltitudeM:600,  cloudThicknessM:500,  precipitation:true,  precipType:'rain', precipIntensity:0.70, windSpeedMs:12, gustMs:5, visibilityM:3500, turbulence:0.55 },
  storm:    { cloudCoverage:1.00, cloudAltitudeM:350,  cloudThicknessM:400,  precipitation:true,  precipType:'rain', precipIntensity:1.00, windSpeedMs:22, gustMs:9, visibilityM:1200, turbulence:0.95 },
  fog:      { cloudCoverage:0.65, cloudAltitudeM:80,   cloudThicknessM:300,  precipitation:false, windSpeedMs:2,  gustMs:0, visibilityM:400,   turbulence:0.05 },
};

// Helpers
function _lerp(a, b, t)  { return a + (b - a) * t; }
function _smooth(t)      { return t * t * (3 - 2 * t); }
function _clamp01(v)     { return Math.max(0, Math.min(1, v)); }

// Configure WIND_GRADIENT_REF_ALT_M.
const WIND_GRADIENT_REF_ALT_M = 600;
const WIND_GRADIENT_SURFACE_FACTOR = 0.4; // Configure WIND_GRADIENT_VEER_DEG.
const WIND_GRADIENT_VEER_DEG = 20;        // Configure WIND_TURB_REVERT.

// Configure WIND_TURB_REVERT.
const WIND_TURB_REVERT = 0.6;

// Configure WINDSHEAR_PHASE1_DUR.
const WINDSHEAR_PHASE1_DUR = 6;   // Configure WINDSHEAR_PHASE2_DUR.
const WINDSHEAR_PHASE2_DUR = 10;  // Configure WINDSHEAR_PHASE3_DUR.
const WINDSHEAR_PHASE3_DUR = 8;   // Configure WINDSHEAR_HEADWIND_PEAK_MS.
const WINDSHEAR_HEADWIND_PEAK_MS = 12;
const WINDSHEAR_TAILWIND_PEAK_MS = 14;
const WINDSHEAR_DOWNDRAFT_PEAK_MS = 4;

class WeatherSystem {

  constructor() {
    this._isMobile = document.body.classList.contains('is-touch');
    this._time     = 0;
    this._gustTime = 0;

    // Section: this._windGustSpeedMs.
    this._windGustSpeedMs = 0;
    this._windGustDirDeg  = 0;
    this._windGustVertMs  = 0;
    this._windshearActive = false;
    this._windshearT      = 0;

    // Configure this._trans.
    this._trans = {
      from: { ...WeatherState },
      to:   { ...WeatherState },
      t:    1.0,
      dur:  8.0,
    };

    // Configure this._ltFlash.
    this._ltFlash = 0;
    this._ltTimer = 0;
    this._ltNext  = 3 + Math.random() * 5;

    this._init2DOverlay();
    this._initLightning();
  }

  // Gettery fizyczne
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

  windEffective() { return this.windSpeedEffective; }

  get windWorld() {
    const toRad = ((WeatherState.windDirectionDeg + 180) % 360) * Math.PI / 180;
    const spd   = this.windEffective();
    return { x: Math.sin(toRad) * spd, z: -Math.cos(toRad) * spd };
  }

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

  // Configure get.
  get cloudImmersion() {
    if (!activeEntity) return 0;
    const altM   = activeEntity.altM;
    const base   = WeatherState.cloudAltitudeM;
    const thick  = Math.max(50, WeatherState.cloudThicknessM);
    const margin = Math.max(60, thick * 0.25);
    if (altM < base - margin || altM > base + thick + margin) return 0;
    const enterT = _clamp01((altM - (base - margin)) / margin);
    const exitT  = _clamp01(((base + thick + margin) - altM) / margin);
    const depth  = Math.min(enterT, exitT);
    return depth * _lerp(0.12, 1.0, WeatherState.cloudCoverage);
  }

  getWindAtAlt(altM)    { return this.windVector; }
  getTurbulenceAt(altM) { return WeatherState.turbulence * (this.isInCloud ? 1.4 : 1.0); }

  // Rendering note.
  getWindVector3D(altAglM, dtCap) {
    const turb = this.getTurbulenceAt(altAglM);

    // Configure sq.
    const sq = Math.sqrt(Math.max(dtCap, 0.0001));
    this._windGustSpeedMs += -WIND_TURB_REVERT * this._windGustSpeedMs * dtCap
      + (Math.random() * 2 - 1) * turb * 4.0 * sq;
    this._windGustDirDeg  += -WIND_TURB_REVERT * this._windGustDirDeg * dtCap
      + (Math.random() * 2 - 1) * turb * 15 * sq;
    this._windGustVertMs  += -WIND_TURB_REVERT * this._windGustVertMs * dtCap
      + (Math.random() * 2 - 1) * turb * 2.5 * sq;

    const hFrac = Math.max(0, Math.min(1, altAglM / WIND_GRADIENT_REF_ALT_M));
    const speedFactor = WIND_GRADIENT_SURFACE_FACTOR + (1 - WIND_GRADIENT_SURFACE_FACTOR) * hFrac;
    const dirVeerDeg  = WIND_GRADIENT_VEER_DEG * (1 - hFrac);

    const speedMs    = Math.max(0, WeatherState.windSpeedMs * speedFactor + this._windGustSpeedMs);
    const dirFromDeg = (WeatherState.windDirectionDeg + dirVeerDeg + this._windGustDirDeg + 360) % 360;

    const toRad = ((dirFromDeg + 180) % 360) * Math.PI / 180;
    return {
      x: Math.sin(toRad) * speedMs,
      y: this._windGustVertMs,
      z: -Math.cos(toRad) * speedMs,
      speedMs, dirFromDeg,
    };
  }

  // UI layout note.
  triggerWindshearTest() {
    if (this._windshearActive) return;
    this._windshearActive = true;
    this._windshearT = 0;
  }

  get windshearActive() { return this._windshearActive; }

  // Physics note.
  getWindshearDelta(dtCap) {
    if (!this._windshearActive) return { alongMs: 0, vertMs: 0 };
    this._windshearT += dtCap;
    const t = this._windshearT;
    let alongMs, vertMs;
    if (t < WINDSHEAR_PHASE1_DUR) {
      const p = t / WINDSHEAR_PHASE1_DUR;
      alongMs = WINDSHEAR_HEADWIND_PEAK_MS * p;
      vertMs = 0;
    } else if (t < WINDSHEAR_PHASE1_DUR + WINDSHEAR_PHASE2_DUR) {
      const p = (t - WINDSHEAR_PHASE1_DUR) / WINDSHEAR_PHASE2_DUR;
      alongMs = _lerp(WINDSHEAR_HEADWIND_PEAK_MS, -WINDSHEAR_TAILWIND_PEAK_MS, p);
      vertMs = -WINDSHEAR_DOWNDRAFT_PEAK_MS * Math.sin(Math.PI * p); // Implementation note.
    } else if (t < WINDSHEAR_PHASE1_DUR + WINDSHEAR_PHASE2_DUR + WINDSHEAR_PHASE3_DUR) {
      const p = (t - WINDSHEAR_PHASE1_DUR - WINDSHEAR_PHASE2_DUR) / WINDSHEAR_PHASE3_DUR;
      alongMs = _lerp(-WINDSHEAR_TAILWIND_PEAK_MS, 0, p);
      vertMs = 0;
    } else {
      this._windshearActive = false;
      alongMs = 0; vertMs = 0;
    }
    return { alongMs, vertMs };
  }

  // Rendering note.
  getRelativeHumidity(altM = null) {
    if (!activeEntity) return 0.45;
    if (altM === null) altM = activeEntity.altM;
    if (altM >= WeatherState.cloudAltitudeM && altM <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM) return 1.0;
    // Configure base.
    const base = 0.35 + 0.6 * WeatherState.cloudCoverage;
    // Configure noise.
    const noise = (Math.sin(this._time * 0.13 + (altM % 1000) * 0.001) * 0.03);
    return Math.max(0.05, Math.min(0.99, base + noise));
  }

  // Pioruny (PointLight spike)
  _initLightning() {
    this._ltLight = new THREE.PointLight(0xddeeff, 0, 80000);
    this._ltLight.position.set(0, 5000, 0);
    scene.add(this._ltLight);
  }

  _updateLightning(dt) {
    const cov = WeatherState.cloudCoverage;
    if (cov < 0.80) { this._ltLight.intensity = 0; return; }

    this._ltTimer += dt;

    // Configure if.
    if (this._ltFlash > 0) {
      this._ltFlash -= dt * 14;
      this._ltLight.intensity = Math.max(0, this._ltFlash) * 3.5;
      if (this._ltFlash <= 0) { this._ltFlash = 0; this._ltLight.intensity = 0; }
    }

    // Configure if.
    if (this._ltTimer > this._ltNext) {
      this._ltTimer = 0;
      this._ltNext  = 2 + Math.random() * 8 / cov;
      if (Math.random() < cov * 0.65) {
        this._ltFlash = 1.0;
        // Position in the cloud layer near the aircraft.
        this._ltLight.position.set(
          camera.position.x + (Math.random()-.5) * 25000,
          (WeatherState.cloudAltitudeM + 300) * DEM_EXAG * Y_SCALE,
          camera.position.z + (Math.random()-.5) * 25000,
        );
      }
    }
  }

  // 2D Canvas Overlay
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
    // Configure this._wsDrops.
    this._wsDrops = Array.from({ length: 20 }, () => this._newWsDrop());
  }

  _newWsDrop() {
    return {
      x:      0.05 + Math.random() * 0.90,
      y:      Math.random() * 0.35,
      size:   4 + Math.random() * 9,
      drip:   0.04 + Math.random() * 0.12,
      alpha:  0.35 + Math.random() * 0.40,
      age:    Math.random() * 4,
      maxAge: 3 + Math.random() * 5,
    };
  }

  // Implementation note.
  update(dt, camPos, planeAlt) {
    this._time     += dt;
    this._gustTime += dt * 0.7;
    this._updateTransition(dt);
    this._update2DOverlay(dt);
    this._updateLightning(dt);
  }

  // Implementation note.
  _updateTransition(dt) {
    if (this._trans.t >= 1.0) return;
    this._trans.t = Math.min(1.0, this._trans.t + dt / this._trans.dur);
    const k            = _smooth(this._trans.t);
    const { from, to } = this._trans;

    WeatherState.cloudCoverage   = _lerp(from.cloudCoverage,   to.cloudCoverage,   k);
    WeatherState.cloudAltitudeM  = _lerp(from.cloudAltitudeM,  to.cloudAltitudeM,  k);
    WeatherState.cloudThicknessM = _lerp(from.cloudThicknessM, to.cloudThicknessM, k);
    WeatherState.windSpeedMs     = _lerp(from.windSpeedMs,      to.windSpeedMs,     k);
    WeatherState.gustMs          = _lerp(from.gustMs,           to.gustMs,          k);
    WeatherState.visibilityM     = _lerp(from.visibilityM,      to.visibilityM,     k);
    WeatherState.turbulence      = _lerp(from.turbulence,       to.turbulence,      k);
    WeatherState.precipIntensity = _lerp(from.precipIntensity,  to.precipIntensity, k);
    // Configure if.
    if (k >= 0.55) {
      WeatherState.precipitation = to.precipitation;
      WeatherState.precipType    = to.precipType;
    }
  }

  // Rendering note.
  _update2DOverlay(dt) {
    const ctx = this._ctx2D;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const isRain    = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isCockpit = (typeof camMode !== 'undefined' && camMode === 'COCKPIT');

    // Configure if.
    if (isRain && isCockpit) {
      this._drawWindshield(ctx, dt);
    }

    // Configure immersion.
    const immersion = this.cloudImmersion;
    if (immersion > 0.02) {
      ctx.fillStyle = `rgba(145,158,175,${(0.32 * immersion).toFixed(3)})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  // Implementation note.
  _drawWindshield(ctx, dt) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const intens = WeatherState.precipIntensity;

    for (const d of this._wsDrops) {
      d.age += dt;
      d.y   += d.drip * intens * dt * 0.08;
      d.x   += Math.sin(this._time * 0.4 + d.drip * 10) * 0.0003 * dt;

      const px = d.x * W, py = d.y * H, sz = d.size;
      const a  = d.alpha * Math.min(1, d.age * 0.8);

      // Implementation note.
      ctx.beginPath();
      ctx.ellipse(px, py, sz*0.55, sz, 0, 0, Math.PI*2);
      ctx.fillStyle = `rgba(185,215,245,${a*0.55})`;
      ctx.fill();

      // Reflex / lens (jasny punkt)
      ctx.beginPath();
      ctx.arc(px-sz*0.15, py-sz*0.25, sz*0.20, 0, Math.PI*2);
      ctx.fillStyle = `rgba(240,250,255,${a*0.50})`;
      ctx.fill();

      // Configure if.
      if (d.drip > 0.05 && d.age > 0.3) {
        const dLen = sz * (2 + intens*7) * Math.min(1, d.age*0.4);
        ctx.beginPath();
        ctx.moveTo(px, py + sz);
        ctx.quadraticCurveTo(
          px + Math.sin(this._time*0.6 + d.drip*5) * sz*0.6,
          py + sz + dLen*0.5,
          px + (Math.random()-.5) * sz*0.4,
          py + sz + dLen,
        );
        ctx.strokeStyle = `rgba(175,210,242,${a*0.28})`;
        ctx.lineWidth   = sz * 0.35;
        ctx.stroke();
      }

      // Respawn when off-screen or too old.
      if (d.y > 1.12 || d.age > d.maxAge) {
        Object.assign(d, this._newWsDrop());
        d.y = Math.random() * 0.30;
      }
    }

    // Configure if.
    if (intens > 0.65 && Math.random() < intens * 0.15 * dt * 5) {
      const rand = this._wsDrops[Math.floor(Math.random() * this._wsDrops.length)];
      Object.assign(rand, this._newWsDrop());
      rand.y = 0;
    }
  }

  // Implementation note.
  applyPreset(name) {
    const p = WeatherPresets[name];
    if (!p) return;
    this._trans.from = { ...WeatherState };
    this._trans.to   = { ...WeatherState, ...p };
    this._trans.t    = 0.0;
    // UI layout note.
    setTimeout(() => {
      if (typeof weatherUI !== 'undefined') weatherUI.syncUI();
    }, 100);
  }

  getHUDString() {
    const w = WeatherState;
    return `${w.windDirectionDeg.toFixed(0).padStart(3,'0')}°/${this.windEffective().toFixed(0)}m/s  T:${this.temperature}°C  Q:${this.pressure}hPa`;
  }
}

let weather = null;
