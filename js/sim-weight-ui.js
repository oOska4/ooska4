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
//
// Jedna zakładka (⚖ WAGA) w szufladzie MCDU (sim-mcdu.js) — jeden zestaw
// elementów (dg-*), bez oddzielnego panelu desktop + popupu mobile jak
// wcześniej.
// ═══════════════════════════════════════════════════════════════════════════════

const weightUI = {
  init() {
    this._bind('dg-fuel',    v => { AircraftWeight.pendingFuelKg    = +v; });
    this._bind('dg-payload', v => { AircraftWeight.pendingPayloadKg = +v; });

    document.querySelectorAll('[data-wpreset]').forEach(btn => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.wpreset));
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

    document.querySelectorAll('[data-wpreset]').forEach(b => b.classList.toggle('active', b.dataset.wpreset === name));

    this.syncUI();
  },

  // Ustawia wartości suwaków + etykiet na podstawie AircraftWeight.pending*
  // (np. po zastosowaniu presetu, albo raz przy starcie gry) i odświeża readouty.
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

  // Przelicza PODGLĄD przez computeAircraftWeight() (czysta funkcja z
  // sim-physics.js, zero efektów ubocznych na fizyce) i pokazuje masę
  // całkowitą / przesunięcie CG / ostrzeżenie MTOW.
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
