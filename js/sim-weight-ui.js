'use strict';

// Configure weightUI.

const weightUI = {
  init() {
    this._bind('dg-fuel',    v => { AircraftWeight.pendingFuelKg    = +v; });
    this._bind('dg-payload', v => { AircraftWeight.pendingPayloadKg = +v; });

    document.querySelectorAll('[data-wpreset]').forEach(btn => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.wpreset));
    });

    this.syncUI();
  },

  // Implementation note.
  _bind(id, setter) {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-lbl');
    if (!el) return;
    el.addEventListener('input', () => {
      setter(el.value);
      if (lbl) lbl.textContent = Math.round(el.value) + ' kg';
      this._refreshReadouts();
    });
  },

  _applyPreset(name) {
    if (name === 'empty')   { AircraftWeight.pendingFuelKg = 0;                   AircraftWeight.pendingPayloadKg = 0; }
    if (name === 'default') { AircraftWeight.pendingFuelKg = A321_DEFAULT_FUEL_KG; AircraftWeight.pendingPayloadKg = A321_DEFAULT_PAYLOAD_KG; }
    if (name === 'full')    { AircraftWeight.pendingFuelKg = A321_MAX_FUEL_KG;     AircraftWeight.pendingPayloadKg = A321_MAX_PAYLOAD_KG; }

    document.querySelectorAll('[data-wpreset]').forEach(b => b.classList.toggle('active', b.dataset.wpreset === name));

    this.syncUI();
  },

  // Implementation note.
  syncUI() {
    const fuel = AircraftWeight.pendingFuelKg, payload = AircraftWeight.pendingPayloadKg;
    for (const [id, val] of [['dg-fuel', fuel], ['dg-payload', payload]]) {
      const el  = document.getElementById(id);
      const lbl = document.getElementById(id + '-lbl');
      if (el)  el.value = val;
      if (lbl) lbl.textContent = Math.round(val) + ' kg';
    }
    this._refreshReadouts();
  },

  // Physics note.
  _refreshReadouts() {
    const { total, cgShiftZ, exceededBy } = computeAircraftWeight(
      AircraftWeight.pendingFuelKg, AircraftWeight.pendingPayloadKg
    );
    const cgAbs = Math.abs(cgShiftZ);
    const cgTxt = (cgAbs < 0.02)
      ? '0.0 m'
      : (cgShiftZ > 0 ? '+' : '−') + cgAbs.toFixed(2) + ' m (' + (cgShiftZ > 0 ? 'dziób' : 'ogon') + ')';

    const totalEl = document.getElementById('dg-total-lbl');
    const cgEl    = document.getElementById('dg-cg-lbl');
    const warnEl  = document.getElementById('dg-mtow-warn');
    if (totalEl) totalEl.textContent = Math.round(total) + ' kg';
    if (cgEl)    cgEl.textContent    = cgTxt;
    if (warnEl)  warnEl.style.display = exceededBy > 0 ? '' : 'none';
  },
};
