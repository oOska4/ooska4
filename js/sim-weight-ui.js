'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// sim-weight-ui.js — UI do ustawiania wagi samolotu (paliwo + payload)
// Zależy od: sim-physics.js (AircraftWeight, computeAircraftWeight,
//            A321_DEFAULT_FUEL_KG, A321_DEFAULT_PAYLOAD_KG, A321_MAX_FUEL_KG,
//            A321_MAX_PAYLOAD_KG)
//
// WAŻNE — zgodnie z decyzją projektową: te suwaki NIGDY nie dotykają fizyki
// bezpośrednio. Przesunięcie suwaka zmienia tylko AircraftWeight.pendingFuelKg/
// pendingPayloadKg — realnie stosowane jest to dopiero w A321Entity.reset()
// (patrz sim-physics.js), czyli przy starcie/restarcie, tak jak tankowanie i
// załadunek dzieją się w prawdziwym samolocie przed lotem, nie w trakcie.
// Tutaj liczymy tylko PODGLĄD na żywo (computeAircraftWeight — czysta funkcja,
// bez efektów ubocznych na fizyce) — masa całkowita / przesunięcie CG /
// ostrzeżenie MTOW pod suwakiem, żeby było widać skutek PRZED Resetem.
// ═══════════════════════════════════════════════════════════════════════════════

// Popup mobile: natychmiastowy bind niezależny od reszty UI — ten sam wzorzec
// co bindWeatherPopupEarly() w sim-weather-ui.js.
(function bindWeightPopupEarly() {
  function tryBind() {
    const popup = document.getElementById('weight-popup');
    const close = document.getElementById('mwpop-close');
    if (!popup) return;

    if (close) {
      close.addEventListener('click', () => { popup.style.display = 'none'; });
    }
    // Zamknij po kliknieciu poza popupem (ale nie w przycisk co go otwiera
    // — ten jest w innym popupie, mob-menu-popup) LUB bezposrednio na
    // przyciemnione tlo (#weight-popup to teraz peloekranowy backdrop).
    document.addEventListener('click', (e) => {
      if (popup.style.display === 'flex' &&
          e.target.id !== 'mpop-weight' &&
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

// Otwiera popup wagi na mobile — wołane z sim-controls.js (przycisk
// mpop-weight w menu mobilnym, patrz _btn('mpop-weight', ...)).
function openWeightPopup() {
  const popup = document.getElementById('weight-popup');
  if (popup) popup.style.display = 'flex';
  weightUI.syncUI();
}

const weightUI = {
  _open: false,

  init() {
    // Suwaki: desktop (dg-) i mobile (mw-) — wspólny setter, każdy aktualizuje
    // AircraftWeight.pending* + własną etykietę, a _refreshReadouts()
    // odświeża oba zestawy readoutów (masa/CG/ostrzeżenie) na raz.
    this._bind('dg-fuel',    v => { AircraftWeight.pendingFuelKg    = +v; });
    this._bind('mw-fuel',    v => { AircraftWeight.pendingFuelKg    = +v; });
    this._bind('dg-payload', v => { AircraftWeight.pendingPayloadKg = +v; });
    this._bind('mw-payload', v => { AircraftWeight.pendingPayloadKg = +v; });

    // Toggle panelu desktop (ten sam wzorzec co przy pogodzie)
    document.getElementById('btn-weight-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('weight-panel');
      if (!panel) return;
      this._open = !this._open;
      panel.style.display = this._open ? 'block' : 'none';
      document.getElementById('btn-weight-toggle').textContent = this._open ? '▲' : '▼';
    });

    // Presety — desktop i mobile osobno (różne atrybuty data-*), ale ta sama logika
    document.querySelectorAll('[data-wpreset]').forEach(btn => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.wpreset));
    });
    document.querySelectorAll('[data-wpreset-mob]').forEach(btn => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.wpresetMob));
    });

    this.syncUI();
  },

  // Bind pojedynczego suwaka → setter (zapisuje do AircraftWeight.pending*) +
  // własna etykieta w kg + odśwież readouty masy/CG/MTOW.
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

    // Zaznacz aktywny przycisk presetu (osobno w panelu desktop i popupie mobile)
    document.querySelectorAll('[data-wpreset]').forEach(b => b.classList.toggle('active', b.dataset.wpreset === name));
    document.querySelectorAll('[data-wpreset-mob]').forEach(b => b.classList.toggle('active', b.dataset.wpresetMob === name));

    this.syncUI();
  },

  // Ustawia wartości suwaków + etykiet na podstawie AircraftWeight.pending*
  // (np. po zastosowaniu presetu, albo raz przy starcie gry) i odświeża readouty.
  syncUI() {
    const fuel = AircraftWeight.pendingFuelKg, payload = AircraftWeight.pendingPayloadKg;
    for (const [id, val] of [['dg-fuel', fuel], ['mw-fuel', fuel], ['dg-payload', payload], ['mw-payload', payload]]) {
      const el  = document.getElementById(id);
      const lbl = document.getElementById(id + '-lbl');
      if (el)  el.value = val;
      if (lbl) lbl.textContent = Math.round(val) + ' kg';
    }
    this._refreshReadouts();
  },

  // Przelicza PODGLĄD przez computeAircraftWeight() (czysta funkcja z
  // sim-physics.js, zero efektów ubocznych na fizyce) i pokazuje masę
  // całkowitą / przesunięcie CG / ostrzeżenie MTOW jednocześnie w panelu
  // desktop i popupie mobile.
  _refreshReadouts() {
    const { total, cgShiftZ, exceededBy } = computeAircraftWeight(
      AircraftWeight.pendingFuelKg, AircraftWeight.pendingPayloadKg
    );
    const cgAbs = Math.abs(cgShiftZ);
    const cgTxt = (cgAbs < 0.02)
      ? '0.0 m'
      : (cgShiftZ > 0 ? '+' : '−') + cgAbs.toFixed(2) + ' m (' + (cgShiftZ > 0 ? 'dziób' : 'ogon') + ')';

    for (const [totalId, cgId, warnId] of [
      ['dg-total-lbl', 'dg-cg-lbl', 'dg-mtow-warn'],
      ['mw-total-lbl', 'mw-cg-lbl', 'mw-mtow-warn'],
    ]) {
      const totalEl = document.getElementById(totalId);
      const cgEl    = document.getElementById(cgId);
      const warnEl  = document.getElementById(warnId);
      if (totalEl) totalEl.textContent = Math.round(total) + ' kg';
      if (cgEl)    cgEl.textContent    = cgTxt;
      if (warnEl)  warnEl.style.display = exceededBy > 0 ? '' : 'none';
    }
  },
};
