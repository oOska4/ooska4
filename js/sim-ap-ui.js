'use strict';

// Configure AP_STEP.

const AP_STEP = { hdg: 1, alt: 100, vs: 100, spd: 5 };
const AP_RANGE = {
  alt: [0, 41000],
  vs:  [-4000, 4000],
  spd: [90, 350],
};

const apUI = {
  init() {
    document.getElementById('dg-ap-master')?.addEventListener('click', () => this._toggleMaster());

    document.querySelectorAll('.ap-step').forEach(btn => {
      btn.addEventListener('click', () => this._step(btn.dataset.ap, +btn.dataset.dir));
    });
    document.querySelectorAll('.ap-eng').forEach(btn => {
      btn.addEventListener('click', () => this._toggleMode(btn.dataset.mode));
    });

    document.getElementById('btn-windshear-test')?.addEventListener('click', () => weather?.triggerWindshearTest());

    this.syncFromEntity(activeEntity);
  },

  toggleMaster() { this._toggleMaster(); }, // also called from #ar-ap (action rail, sim-controls.js)

  _toggleMaster() {
    const p = activeEntity; if (!p) return;
    p.ap.master = !p.ap.master;
    if (!p.ap.master) { p.ap.hdgHold = p.ap.altHold = p.ap.vsHold = p.ap.spdHold = false; }
    this.syncFromEntity(p);
  },

  _toggleMode(mode) {
    const p = activeEntity; if (!p) return;
    p.ap[mode] = !p.ap[mode];
    if (p.ap[mode]) {
      p.ap.master = true; // Configure if.
      if (mode === 'altHold') p.ap.vsHold = false;
      if (mode === 'vsHold')  p.ap.altHold = false;
    }
    this.syncFromEntity(p);
  },

  _step(key, dir) {
    const p = activeEntity; if (!p) return;
    const field = { hdg: 'targetHdgDeg', alt: 'targetAltFt', vs: 'targetVsFpm', spd: 'targetSpdKt' }[key];
    let v = p.ap[field] + dir * AP_STEP[key];
    if (key === 'hdg') {
      v = ((v % 360) + 360) % 360;
    } else {
      const [lo, hi] = AP_RANGE[key];
      v = Math.max(lo, Math.min(hi, v));
    }
    p.ap[field] = v;
    this.syncFromEntity(p);
  },

  // Physics note.
  syncFromEntity(p) {
    if (!p) return;
    const masterEl = document.getElementById('dg-ap-master');
    if (masterEl) {
      masterEl.textContent = p.ap.master ? 'WŁĄCZONY' : 'WYŁĄCZONY';
      masterEl.classList.toggle('active', p.ap.master);
    }
    const railEl = document.getElementById('ar-ap');
    if (railEl) railEl.classList.toggle('active', p.ap.master);

    const vals = {
      hdg: Math.round(p.ap.targetHdgDeg) + '°',
      alt: Math.round(p.ap.targetAltFt) + 'ft',
      vs:  (p.ap.targetVsFpm >= 0 ? '+' : '') + Math.round(p.ap.targetVsFpm) + 'fpm',
      spd: Math.round(p.ap.targetSpdKt) + 'kt',
    };
    const modeOf = { hdg: 'hdgHold', alt: 'altHold', vs: 'vsHold', spd: 'spdHold' };
    for (const key of ['hdg', 'alt', 'vs', 'spd']) {
      const valEl = document.getElementById('dg-ap-' + key + '-val');
      if (valEl) valEl.textContent = vals[key];
      const engEl = document.getElementById('dg-ap-' + key + '-eng');
      if (engEl) engEl.classList.toggle('active', !!p.ap[modeOf[key]]);
    }
  },
};
