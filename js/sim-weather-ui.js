'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-weather-ui.js  —  UI do sterowania pogodą + niebem (czas/data/jakość)
// Zależy od: sim-weather.js (WeatherState, WeatherPresets, weather)
//            sim-sky.js     (TimeState, formatTimeHHMM, formatDayOfYear,
//                             setSkyQuality, QualityPresets)
//
// Jedna zakładka (🌦 POGODA) w szufladzie MCDU (sim-mcdu.js) — jeden zestaw
// elementów (dw-*), bez oddzielnego panelu desktop + popupu mobile jak
// wcześniej (dublowanie usunięte razem z konsolidacją menu — patrz #mcdu-drawer
// w simworld.html). Widoczność strony steruje sama szuflada (.mcdu-page.active),
// więc nie ma tu już własnego collapse/toggle.
// ═══════════════════════════════════════════════════════════════════════════════

const weatherUI = {
  init() {
    const bindings = [
      ['coverage', v => { WeatherState.cloudCoverage = v / 100; },          v => Math.round(v) + '%'],
      ['alt',      v => { WeatherState.cloudAltitudeM = +v; },              v => v + ' m'],
      ['wind',     v => { WeatherState.windSpeedMs = +v; },                  v => v + ' m/s'],
      ['wdir',     v => { WeatherState.windDirectionDeg = +v; }, v => {
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(v / 22.5) % 16] + ' ' + Math.round(v) + '°';
      }],
      ['vis',      v => { WeatherState.visibilityM = +v; },                  v => (+v >= 1000 ? (+v/1000).toFixed(0)+' km' : v+' m')],
      ['gust',     v => { WeatherState.gustMs = +v; },                       v => v + ' m/s'],
      ['turb',     v => { WeatherState.turbulence = v / 100; },              v => Math.round(v) + '%'],
      ['precip-int', v => { WeatherState.precipIntensity = v / 100; },       v => Math.round(v) + '%'],
    ];
    for (const [name, setter, fmt] of bindings) this._bind('dw-' + name, setter, fmt);

    // Opady (select + intensywność) — tylko "Brak"/"Deszcz" (śnieg nieobsługiwany)
    const precipEl = document.getElementById('dw-precip');
    if (precipEl) precipEl.addEventListener('change', () => {
      WeatherState.precipitation = precipEl.value !== 'none';
      WeatherState.precipType    = 'rain';
    });

    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => weather?.applyPreset(btn.dataset.preset));
    });

    // ── NIEBO: czas / data / animacja / jakość chmur ──────────────────────────
    this._bindSkyControls();
  },

  // Bind slider → WeatherState + label
  _bind(id, setter, unit, labelFn) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (!el) return;
    const fmt = labelFn || (v => v + (unit || ''));
    el.addEventListener('input', () => {
      if (weather && weather._trans) weather._trans.t = 1.0;  // przerwij preset transition
      setter(el.value);
      if (lbl) lbl.textContent = fmt(el.value);
    });
  },

  // ── Sterowanie niebem (czas/data/animacja/jakość) — sim-sky.js ──────────────
  _bindSkyControls() {
    const timeEl = document.getElementById('dw-time');
    if (timeEl) timeEl.addEventListener('input', () => {
      TimeState.animating = false;
      this._setAnimBtnLabel(false);
      TimeState.minutesOfDay = parseFloat(timeEl.value);
      this._setTimeLabel('dw-time', TimeState.minutesOfDay);
    });
    const dateEl = document.getElementById('dw-date');
    if (dateEl) dateEl.addEventListener('input', () => {
      TimeState.dayOfYear = parseInt(dateEl.value, 10);
      this._setDateLabel('dw-date', TimeState.dayOfYear);
    });

    // Animacja czasu — przycisk toggle
    document.getElementById('dw-anim')?.addEventListener('click', () => {
      TimeState.animating = !TimeState.animating;
      this._setAnimBtnLabel(TimeState.animating);
    });
    // Prędkość animacji (minuty symulacji na sekundę realnego czasu)
    const speedEl = document.getElementById('dw-anim-speed');
    if (speedEl) {
      speedEl.addEventListener('change', () => {
        TimeState.animMinutesPerSecond = parseFloat(speedEl.value);
      });
      TimeState.animMinutesPerSecond = parseFloat(speedEl.value);
    }

    // Jakość chmur (Niska/Średnia/Wysoka) — teraz w zakładce ⚙ JAKOŚĆ, ale
    // logika zostaje tu (ten sam atrybut data-qual, niezależnie od tego w
    // której zakładce fizycznie leży w HTML).
    document.querySelectorAll('[data-qual]').forEach(btn => {
      btn.addEventListener('click', () => setSkyQuality(btn.dataset.qual));
    });

    this._setTimeLabel('dw-time', TimeState.minutesOfDay);
    this._setDateLabel('dw-date', TimeState.dayOfYear);
  },

  _setAnimBtnLabel(animating) {
    const el = document.getElementById('dw-anim');
    if (!el) return;
    el.textContent = animating ? '⏸ Zatrzymaj' : '▶ Animuj czas';
    el.classList.toggle('active', animating);
  },

  _setTimeLabel(id, minutes) {
    const lbl = document.getElementById(id + '-lbl');
    const el  = document.getElementById(id);
    if (el)  el.value = minutes;
    if (lbl) lbl.textContent = formatTimeHHMM(minutes);
  },

  _setDateLabel(id, doy) {
    const lbl = document.getElementById(id + '-lbl');
    const el  = document.getElementById(id);
    if (el)  el.value = doy;
    if (lbl) lbl.textContent = formatDayOfYear(doy);
  },

  // Wołane z sim-sky.js co klatkę, TYLKO gdy animacja czasu jest aktywna —
  // aktualizuje położenie suwaków bez wywoływania ich 'input' (brak pętli).
  syncSkyUI() {
    this._setTimeLabel('dw-time', TimeState.minutesOfDay);
    this._setDateLabel('dw-date', TimeState.dayOfYear);
  },

  // Synchronizuj UI z WeatherState (np. po zmianie presetu)
  syncUI() {
    const s = WeatherState;
    const vals = {
      'coverage':   Math.round(s.cloudCoverage * 100),
      'alt':        s.cloudAltitudeM,
      'wind':       s.windSpeedMs,
      'wdir':       s.windDirectionDeg,
      'vis':        s.visibilityM,
      'gust':       s.gustMs,
      'turb':       Math.round(s.turbulence * 100),
      'precip-int': Math.round(s.precipIntensity * 100),
    };
    for (const [name, val] of Object.entries(vals)) this._setSlider('dw-' + name, val);
    const precipEl = document.getElementById('dw-precip');
    if (precipEl) precipEl.value = s.precipitation ? 'rain' : 'none';
  },

  _setSlider(id, val) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (el)  el.value = val;
    if (lbl) lbl.textContent = val;
  },
};
