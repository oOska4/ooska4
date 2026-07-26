'use strict';

// ════════════════════════════════════════════════════════════════════════════════
// sim-weather.js  —  Stan pogody + efekty niezależne od renderowania nieba
//
// UWAGA: sky dome, chmury wolumetryczne i deszcz 3D zostały PRZENIESIONE
// do sim-sky.js (fizyczny Rayleigh/Mie scattering + raymarching). Ten plik
// odpowiada teraz tylko za:
//   - WeatherState / WeatherPresets — jedno źródło prawdy, czytane przez sim-sky.js
//   - Wiatr (z porywami), temperaturę, ciśnienie — gettery fizyczne
//   - Pioruny (PointLight spike, zależny od zachmurzenia)
//   - Efekt kropel na szybie w trybie COCKPIT (2D canvas overlay)
//   - Mgiełkę na canvasie gdy samolot jest wewnątrz warstwy chmur
//   - Płynne przejścia między presetami pogody (lerp 8s)
//
// Śnieg NIE jest obsługiwany (na razie tylko deszcz/brak opadów).
// ════════════════════════════════════════════════════════════════════════════════

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function _lerp(a, b, t)  { return a + (b - a) * t; }
function _smooth(t)      { return t * t * (3 - 2 * t); }
function _clamp01(v)     { return Math.max(0, Math.min(1, v)); }

// Gradient przyziemny wiatru (warstwa graniczna): poniżej tej wysokości wiatr
// jest słabszy (tarcie o teren) i skręcony względem wiatru "swobodnego" —
// powyżej traktujemy wiatr jako w pełni swobodny (gradient wind). 600m ≈ 2000ft,
// typowa górna granica warstwy granicznej używana w meteorologii lotniczej.
const WIND_GRADIENT_REF_ALT_M = 600;
const WIND_GRADIENT_SURFACE_FACTOR = 0.4; // u samej ziemi wiatr ma tylko tyle % prędkości "swobodnej"
const WIND_GRADIENT_VEER_DEG = 20;        // o tyle stopni skręcony wiatr przy ziemi względem wysokości odniesienia

// Turbulencja: proces Ornsteina-Uhlenbecka (szum ze średnim powrotem), NIE
// biały szum — dzięki temu poryw narasta/zanika płynnie zamiast migotać co
// klatkę. WIND_TURB_REVERT to szybkość powrotu do zera (1/s).
const WIND_TURB_REVERT = 0.6;

// Scenariusz testowy windshear (patrz getWindshearDelta): klasyczny profil
// treningowy mikroburstu — narastający headwind (zwodniczo "lepsze" osiągi),
// potem gwałtowne przejście w tailwind + downdraft (najgroźniejsza faza),
// wreszcie powrót do normy. Czasy w sekundach, prędkości w m/s.
const WINDSHEAR_PHASE1_DUR = 6;   // narastający headwind
const WINDSHEAR_PHASE2_DUR = 10;  // gwałtowne przejście headwind -> tailwind + downdraft
const WINDSHEAR_PHASE3_DUR = 8;   // powrót do normalnego wiatru
const WINDSHEAR_HEADWIND_PEAK_MS = 12;
const WINDSHEAR_TAILWIND_PEAK_MS = 14;
const WINDSHEAR_DOWNDRAFT_PEAK_MS = 4;

class WeatherSystem {

  constructor() {
    this._isMobile = document.body.classList.contains('is-touch');
    this._time     = 0;
    this._gustTime = 0;

    // ── Turbulencja (proces OU) i windshear — patrz getWindVector3D /
    // getWindshearDelta niżej. Osobne od starego _gustTime (który zostaje,
    // bo wciąż go używa windEffective()/windWorld dla sim-sky.js).
    this._windGustSpeedMs = 0;
    this._windGustDirDeg  = 0;
    this._windGustVertMs  = 0;
    this._windshearActive = false;
    this._windshearT      = 0;

    // Stan płynnego przejścia między presetami
    this._trans = {
      from: { ...WeatherState },
      to:   { ...WeatherState },
      t:    1.0,
      dur:  8.0,
    };

    // Stan piorunów
    this._ltFlash = 0;
    this._ltTimer = 0;
    this._ltNext  = 3 + Math.random() * 5;

    this._init2DOverlay();
    this._initLightning();
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

  // Płynne "zanurzenie" w warstwie chmur: 0 = czyste powietrze, 1 = pełny
  // rdzeń gęstej warstwy. W przeciwieństwie do isInCloud (twarde progi
  // wysokości) narasta/zanika stopniowo na krawędziach pasma wysokości I
  // jest skalowane zachmurzeniem — przy rzadkich chmurach (niskie coverage)
  // przelot przez pasmo wysokości to tylko przeloty przez prześwity, a nie
  // ściana mgły. Używane przez sim-sky.js (mgła sceny) i _update2DOverlay
  // (mgiełka na canvasie) — jedno źródło prawdy zamiast osobnych progów.
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

  // ── Wiatr 3D dla FIZYKI (sim-physics.js) — w przeciwieństwie do windVector/
  // getWindAtAlt (bazowy kierunek/prędkość presetu, do wiatru na canvasie i
  // dryfu chmur w sim-sky.js) ta metoda uwzględnia:
  //  1) gradient przyziemny — słabszy i skręcony wiatr blisko ziemi (tarcie),
  //  2) turbulencję jako płynny szum (proces OU), skalowany przez
  //     getTurbulenceAt (czyli też mocniej w chmurze),
  // Zwraca wektor w RAMIE LOKALNEJ fizyki (x=wschód, y=góra, z=-północ) plus
  // prędkość/kierunek "po ludzku" (do odczytu w HUD). NIE zawiera windsheara
  // testowego — patrz getWindshearDelta, bo tamten potrzebuje kierunku dziobu
  // samolotu, którego ta metoda (celowo) nie zna.
  getWindVector3D(altAglM, dtCap) {
    const turb = this.getTurbulenceAt(altAglM);

    // Proces OU: szum ze średnim powrotem do zera, żeby poryw narastał/zanikał
    // płynnie zamiast migotać co klatkę. sqrt(dtCap) daje poprawne (w
    // przybliżeniu) skalowanie niezależne od częstotliwości klatek.
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

  // Uruchamia jednorazowy scenariusz testowy windshear (przycisk/klawisz w UI —
  // patrz sim-controls.js). Nie robi nic, jeśli już trwa.
  triggerWindshearTest() {
    if (this._windshearActive) return;
    this._windshearActive = true;
    this._windshearT = 0;
  }

  get windshearActive() { return this._windshearActive; }

  // Zwraca deltę windsheara WZGLĘDEM AKTUALNEGO KIERUNKU LOTU — czyli
  // "dodatkowy headwind/tailwind" (alongMs, dodatnie = dodatkowy headwind) i
  // pionowy downdraft (vertMs, ujemne = opadanie powietrza). sim-physics.js
  // dokłada to do wektora wiatru wzdłuż własnego `forward`, bo to jedyne
  // miejsce, które zna orientację samolotu. Profil to klasyczny trening
  // mikroburstu: narastający headwind (zwodniczo "lepsze" osiągi) -> gwałtowne
  // przejście w tailwind + downdraft (najgroźniejsza faza, realny spadek IAS i
  // wysokości) -> powrót do normy.
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
      vertMs = -WINDSHEAR_DOWNDRAFT_PEAK_MS * Math.sin(Math.PI * p); // szczyt opadania w środku fazy
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

  // Przybliżona relatywna wilgotność dla danej wysokości (0..1).
  // Jeśli jesteśmy wewnątrz chmury → 1.0. Poza chmurą przybliżamy RH na podstawie
  // zachmurzenia (im większe zachmurzenie, tym większe RH). To jest prosty
  // model używany przez Schmidt–Appleman w tej symulacji — nie jest to pełna
  // obsługa profilu wilgotności atmosferycznej, ale wystarcza do efektów.
  getRelativeHumidity(altM = null) {
    if (!activeEntity) return 0.45;
    if (altM === null) altM = activeEntity.altM;
    if (altM >= WeatherState.cloudAltitudeM && altM <= WeatherState.cloudAltitudeM + WeatherState.cloudThicknessM) return 1.0;
    // Podstawowy model: RH rośnie wraz z zachmurzeniem, waha się w zakresie 0.2..0.95
    const base = 0.35 + 0.6 * WeatherState.cloudCoverage;
    // Lekko losowy fluktuator dla naturalności
    const noise = (Math.sin(this._time * 0.13 + (altM % 1000) * 0.001) * 0.03);
    return Math.max(0.05, Math.min(0.99, base + noise));
  }

  // ── Pioruny (PointLight spike) ────────────────────────────────────────────────
  _initLightning() {
    this._ltLight = new THREE.PointLight(0xddeeff, 0, 80000);
    this._ltLight.position.set(0, 5000, 0);
    scene.add(this._ltLight);
  }

  _updateLightning(dt) {
    const cov = WeatherState.cloudCoverage;
    if (cov < 0.80) { this._ltLight.intensity = 0; return; }

    this._ltTimer += dt;

    // Zanikanie aktywnego błysku
    if (this._ltFlash > 0) {
      this._ltFlash -= dt * 14;
      this._ltLight.intensity = Math.max(0, this._ltFlash) * 3.5;
      if (this._ltFlash <= 0) { this._ltFlash = 0; this._ltLight.intensity = 0; }
    }

    // Wyzwól nowy błysk
    if (this._ltTimer > this._ltNext) {
      this._ltTimer = 0;
      this._ltNext  = 2 + Math.random() * 8 / cov;
      if (Math.random() < cov * 0.65) {
        this._ltFlash = 1.0;
        // Pozycja w chmurach blisko samolotu
        this._ltLight.position.set(
          camera.position.x + (Math.random()-.5) * 25000,
          (WeatherState.cloudAltitudeM + 300) * DEM_EXAG * Y_SCALE,
          camera.position.z + (Math.random()-.5) * 25000,
        );
      }
    }
  }

  // ── 2D Canvas Overlay ─────────────────────────────────────────────────────────
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
    // Krople na szybie (tylko COCKPIT) — deszcz widziany z orbit/zewnątrz
    // renderuje w pełni 3D sim-sky.js (rainMesh podąża za kamerą), więc
    // tu potrzebny jest tylko efekt szyby.
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

  // ── Główna pętla update ───────────────────────────────────────────────────────
  update(dt, camPos, planeAlt) {
    this._time     += dt;
    this._gustTime += dt * 0.7;
    this._updateTransition(dt);
    this._update2DOverlay(dt);
    this._updateLightning(dt);
  }

  // ── Płynne przejście (lerp 8s) ────────────────────────────────────────────────
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
    // Booleany przeskakują przy 55% przejścia
    if (k >= 0.55) {
      WeatherState.precipitation = to.precipitation;
      WeatherState.precipType    = to.precipType;
    }
  }

  // ── 2D Overlay (krople na szybie w COCKPIT + mgiełka w chmurach) ─────────────
  _update2DOverlay(dt) {
    const ctx = this._ctx2D;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const isRain    = WeatherState.precipitation && WeatherState.precipType === 'rain';
    const isCockpit = (typeof camMode !== 'undefined' && camMode === 'COCKPIT');

    // Tryb cockpit: efekt szyby zamiast lecących smug 2D (deszcz 3D w tle
    // renderuje sim-sky.js — tu tylko krople bezpośrednio "na szkle")
    if (isRain && isCockpit) {
      this._drawWindshield(ctx, dt);
    }

    // W chmurach: szara mgiełka na canvas, siła proporcjonalna do płynnego
    // "zanurzenia" w warstwie (patrz cloudImmersion) — zamiast twardego
    // włączania/wyłączania dokładnie na granicy wysokości pasma chmur.
    const immersion = this.cloudImmersion;
    if (immersion > 0.02) {
      ctx.fillStyle = `rgba(145,158,175,${(0.32 * immersion).toFixed(3)})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  // ── Efekt szyby (COCKPIT mode) ────────────────────────────────────────────────
  //  Krople pojawiają się u góry ekranu, spływają w dół z lekką sinusoidą,
  //  mają reflex (jasne centrum), i ciągną za sobą smugę.
  _drawWindshield(ctx, dt) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const intens = WeatherState.precipIntensity;

    for (const d of this._wsDrops) {
      d.age += dt;
      d.y   += d.drip * intens * dt * 0.08;
      d.x   += Math.sin(this._time * 0.4 + d.drip * 10) * 0.0003 * dt;

      const px = d.x * W, py = d.y * H, sz = d.size;
      const a  = d.alpha * Math.min(1, d.age * 0.8);

      // Ciało kropli (lekko podłużna elipsa)
      ctx.beginPath();
      ctx.ellipse(px, py, sz*0.55, sz, 0, 0, Math.PI*2);
      ctx.fillStyle = `rgba(185,215,245,${a*0.55})`;
      ctx.fill();

      // Reflex / lens (jasny punkt)
      ctx.beginPath();
      ctx.arc(px-sz*0.15, py-sz*0.25, sz*0.20, 0, Math.PI*2);
      ctx.fillStyle = `rgba(240,250,255,${a*0.50})`;
      ctx.fill();

      // Smuga spływająca (quadratic curve dla naturalności)
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

      // Respawn gdy poza ekranem lub za stara
      if (d.y > 1.12 || d.age > d.maxAge) {
        Object.assign(d, this._newWsDrop());
        d.y = Math.random() * 0.30;
      }
    }

    // Nowe krople pojawiają się częściej przy intensywnym deszczu
    if (intens > 0.65 && Math.random() < intens * 0.15 * dt * 5) {
      const rand = this._wsDrops[Math.floor(Math.random() * this._wsDrops.length)];
      Object.assign(rand, this._newWsDrop());
      rand.y = 0;
    }
  }

  // ── Preset (płynne przejście, slajdery je przerywają) ────────────────────────
  applyPreset(name) {
    const p = WeatherPresets[name];
    if (!p) return;
    this._trans.from = { ...WeatherState };
    this._trans.to   = { ...WeatherState, ...p };
    this._trans.t    = 0.0;
    // Synchro UI po snapie (booleany przeskakują przy k≥0.55)
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
