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
// ═══════════════════════════════════════════════════════════════════════════════

const AP_STEP = { hdg: 1, alt: 100, vs: 100, spd: 5 };
const AP_RANGE = {
  alt: [0, 41000],
  vs:  [-4000, 4000],
  spd: [90, 350],
};

// Popup mobile: natychmiastowy bind niezależny od reszty UI — ten sam wzorzec
// co bindWeightPopupEarly() w sim-weight-ui.js.
(function bindApPopupEarly() {
  function tryBind() {
    const popup = document.getElementById('ap-popup');
    const close = document.getElementById('apwpop-close');
    if (!popup) return;
    if (close) close.addEventListener('click', () => { popup.style.display = 'none'; });
    // Zamknij tez po kliknieciu bezposrednio na przyciemnione tlo
    // (#ap-popup to teraz peloekranowy backdrop, e.target===popup znaczy
    // klikniecie poza karta .popup-card).
    document.addEventListener('click', (e) => {
      if (popup.style.display === 'flex' && e.target.id !== 'mpop-ap' &&
          (e.target === popup || !popup.contains(e.target))) {
        popup.style.display = 'none';
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBind);
  } else {
    tryBind();
  }
})();

// Otwiera popup autopilota na mobile — wołane z sim-controls.js (przycisk
// mpop-ap w menu mobilnym).
function openApPopup() {
  const popup = document.getElementById('ap-popup');
  if (popup) popup.style.display = 'flex';
  apUI.syncFromEntity(activeEntity);
}

const apUI = {
  _open: false,

  init() {
    document.getElementById('btn-ap-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('ap-panel');
      if (!panel) return;
      this._open = !this._open;
      panel.style.display = this._open ? 'block' : 'none';
      document.getElementById('btn-ap-toggle').textContent = this._open ? '▲' : '▼';
    });

    document.getElementById('dg-ap-master')?.addEventListener('click', () => this._toggleMaster());
    document.getElementById('mw-ap-master')?.addEventListener('click', () => this._toggleMaster());

    document.querySelectorAll('.ap-step').forEach(btn => {
      btn.addEventListener('click', () => this._step(btn.dataset.ap, +btn.dataset.dir));
    });
    document.querySelectorAll('.ap-eng').forEach(btn => {
      btn.addEventListener('click', () => this._toggleMode(btn.dataset.mode));
    });

    document.getElementById('btn-windshear-test')?.addEventListener('click', () => weather?.triggerWindshearTest());
    document.getElementById('mwpop-windshear-test')?.addEventListener('click', () => weather?.triggerWindshearTest());

    this.syncFromEntity(activeEntity);
  },

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

  // Odświeża CAŁY panel (desktop + mobile) na podstawie stanu encji — wołane
  // po każdej interakcji UI ORAZ co klatkę z HUD (patrz komentarz na górze
  // pliku), żeby złapać autonomiczne rozłączenia trybów przez fizykę.
  syncFromEntity(p) {
    if (!p) return;
    const masterTxt = p.ap.master ? 'WŁĄCZONY' : 'WYŁĄCZONY';
    for (const id of ['dg-ap-master', 'mw-ap-master']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = masterTxt;
      el.classList.toggle('active', p.ap.master);
    }

    const vals = {
      hdg: Math.round(p.ap.targetHdgDeg) + '°',
      alt: Math.round(p.ap.targetAltFt) + 'ft',
      vs:  (p.ap.targetVsFpm >= 0 ? '+' : '') + Math.round(p.ap.targetVsFpm) + 'fpm',
      spd: Math.round(p.ap.targetSpdKt) + 'kt',
    };
    for (const key of ['hdg', 'alt', 'vs', 'spd']) {
      for (const prefix of ['dg-ap-', 'mw-ap-']) {
        const el = document.getElementById(prefix + key + '-val');
        if (el) el.textContent = vals[key];
      }
    }

    const modeOf = { hdg: 'hdgHold', alt: 'altHold', vs: 'vsHold', spd: 'spdHold' };
    for (const key of ['hdg', 'alt', 'vs', 'spd']) {
      for (const prefix of ['dg-ap-', 'mw-ap-']) {
        const el = document.getElementById(prefix + key + '-eng');
        if (el) el.classList.toggle('active', !!p.ap[modeOf[key]]);
      }
    }
  },
};
