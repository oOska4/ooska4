'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Natychmiastowy binding guzika popup — nie czeka na weatherUI.init()
// Działa niezależnie od tego czy WeatherSystem się zainicjował
// ═══════════════════════════════════════════════════════════════════════════════
(function bindWeatherPopupEarly() {
  function tryBind() {
    const btn   = document.getElementById('mb-weather');
    const popup = document.getElementById('weather-popup');
    const close = document.getElementById('wpop-close');
    if (!btn || !popup) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popup.style.display === 'flex';
      popup.style.display = isOpen ? 'none' : 'flex';
      btn.classList.toggle('active', !isOpen);
    });

    if (close) {
      close.addEventListener('click', () => {
        popup.style.display = 'none';
        btn.classList.remove('active');
      });
    }

    // Zamknij po kliknięciu poza popupem
    document.addEventListener('click', (e) => {
      if (popup.style.display === 'flex' &&
          !popup.contains(e.target) && e.target !== btn) {
        popup.style.display = 'none';
        btn.classList.remove('active');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBind);
  } else {
    tryBind();
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════
// sim-weather-ui.js  —  UI do sterowania pogodą
// Zależy od: sim-weather.js (WeatherState, WeatherPresets, weather)
// ═══════════════════════════════════════════════════════════════════════════════

const weatherUI = {
  _open: false,

  init() {
    // Definiuj setter-y raz, binduj do obu zestawów (desktop dw- i mobile w-)
    const bindings = [
      ['coverage', v => { WeatherState.cloudCoverage = v / 100; },          v => Math.round(v) + '%'],
      ['alt',      v => { WeatherState.cloudAltitudeM = +v; weather?._repositionClouds(); }, v => v + ' m'],
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
    for (const [name, setter, fmt] of bindings) {
      this._bind('dw-' + name, setter, fmt);  // desktop
      this._bind('w-'  + name, setter, fmt);  // mobile
    }

    // Opady (select + intensywność)
    for (const id of ['w-precip', 'dw-precip']) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        WeatherState.precipitation = el.value !== 'none';
        WeatherState.precipType    = el.value === 'none' ? 'rain' : el.value;
      });
    }

    // Presety desktop
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => weather?.applyPreset(btn.dataset.preset));
    });

    // Toggle panelu pogody (desktop)
    document.getElementById('btn-weather-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('weather-panel');
      if (!panel) return;
      this._open = !this._open;
      panel.style.display = this._open ? 'block' : 'none';
      document.getElementById('btn-weather-toggle').textContent = this._open ? '▲' : '▼';
    });

    // Mobile popup binding — obsługiwany przez bindWeatherPopupEarly() powyżej

    // Presety w mobile popup
    document.querySelectorAll('[data-preset-mob]').forEach(btn => {
      btn.addEventListener('click', () => {
        weather?.applyPreset(btn.dataset.presetMob);
        // Aktualizuj wygląd aktywnego presetu
        document.querySelectorAll('[data-preset-mob]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  },

  // Bind slider → WeatherState + label
  _bind(id, setter, unit, labelFn) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (!el) return;
    const fmt = labelFn || (v => v + (unit || ''));
    el.addEventListener('input', () => {
      setter(el.value);
      if (lbl) lbl.textContent = fmt(el.value);
    });
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
    for (const [name, val] of Object.entries(vals)) {
      this._setSlider('dw-' + name, val);
      this._setSlider('w-'  + name, val);
    }
    for (const id of ['w-precip', 'dw-precip']) {
      const el = document.getElementById(id);
      if (el) el.value = s.precipitation ? s.precipType : 'none';
    }
  },

  _setSlider(id, val) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (el)  el.value = val;
    if (lbl) lbl.textContent = val;
  },
};
