'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-ap-ui.js — UI autopilota (HDG HOLD / ALT HOLD / V-S HOLD / autothrust)
// Zależy od: sim-physics.js (activeEntity.ap — patrz konstruktor A321Entity)
//
// W przeciwieństwie do wagi/paliwa (sim-weight-ui.js), autopilot działa NA
// ŻYWO — zmiana wartości na suwaku/przycisku widoczna jest w fizyce już w
// następnej klatce (bo tak działa prawdziwy MCP: nakręcasz nową wysokość,
// A/P od razu zaczyna do niej lecieć). Dlatego syncFromEntity() jest wołane
// co klatkę z HUD (patrz sim-hud.js) — żeby panel odzwierciedlał też
// AUTONOMICZNE rozłączenia trybów (np. ręczne przejęcie steru odłącza oś w
// fizyce, a UI musi to pokazać bez czekania na kolejne kliknięcie).
//
// Jedna zakładka (🅰 AUTOPILOT) w szufladzie MCDU (sim-mcdu.js) — jeden zestaw
// elementów (dg-ap-*). Szybki master toggle na pasku akcji (#ar-ap, patrz
// sim-controls.js) woła te same _toggleMaster()/syncFromEntity() co przycisk
// w szufladzie, więc oba miejsca są zawsze zsynchronizowane.
// ═══════════════════════════════════════════════════════════════════════════════

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

  toggleMaster() { this._toggleMaster(); }, // wołane też z #ar-ap (pasek akcji, sim-controls.js)

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
      p.ap.master = true; // włączenie dowolnego trybu automatycznie włącza główny wyłącznik AP
      // ALT i V/S wykluczają się (dokładnie jak na prawdziwym MCP)
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

  // Odświeża panel na podstawie stanu encji — wołane po każdej interakcji UI
  // ORAZ co klatkę z HUD (patrz komentarz na górze pliku), żeby złapać
  // autonomiczne rozłączenia trybów przez fizykę. Odświeża też #ar-ap (szybki
  // toggle na pasku akcji), żeby oba miejsca zawsze pokazywały to samo.
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
