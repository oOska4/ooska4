'use strict';

// Configure weatherUI.

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

    // Precipitation (select + intensity) only "None"/"Rain" (snow unsupported)
    const precipEl = document.getElementById('dw-precip');
    if (precipEl) precipEl.addEventListener('change', () => {
      WeatherState.precipitation = precipEl.value !== 'none';
      WeatherState.precipType    = 'rain';
    });

    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => weather?.applyPreset(btn.dataset.preset));
    });

    // SKY: time / date / animation / cloud quality
    this._bindSkyControls();
  },

  // Binds a slider to a WeatherState field + label.
  _bind(id, setter, unit, labelFn) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (!el) return;
    const fmt = labelFn || (v => v + (unit || ''));
    el.addEventListener('input', () => {
      if (weather && weather._trans) weather._trans.t = 1.0;  // cancel any preset transition
      setter(el.value);
      if (lbl) lbl.textContent = fmt(el.value);
    });
  },

  // Sky controls (time/date/animation/quality) sim-sky.js
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

    // Time animation toggle button
    document.getElementById('dw-anim')?.addEventListener('click', () => {
      TimeState.animating = !TimeState.animating;
      this._setAnimBtnLabel(TimeState.animating);
    });
    // Animation speed (simulated minutes per real second)
    const speedEl = document.getElementById('dw-anim-speed');
    if (speedEl) {
      speedEl.addEventListener('change', () => {
        TimeState.animMinutesPerSecond = parseFloat(speedEl.value);
      });
      TimeState.animMinutesPerSecond = parseFloat(speedEl.value);
    }

    // Rendering note.
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

  // Rendering note.
  syncSkyUI() {
    this._setTimeLabel('dw-time', TimeState.minutesOfDay);
    this._setDateLabel('dw-date', TimeState.dayOfYear);
  },

  // Syncs the UI from WeatherState (e.g.
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
