'use strict';

// ════════════════════════════════════════════════════════════════════════════
// sim-ground-tint.js
//
// Niewielkie dodatkowe stonowanie terenu i budynków PONAD fizyczne
// oświetlenie (sim-shadows.js/sim-sky.js): teren lekko CIEMNIEJSZY za dnia
// (zdjęcia satelitarne w pełnym słońcu potrafią wyglądać zbyt jaskrawo) i
// lekko JAŚNIEJSZY nocą (żeby teren nie stawał się prawie czarny — ważne przy
// lataniu po zmroku, gdzie orientacja w terenie wciąż ma znaczenie).
//
// Wołane co kilka klatek z sim-main.js (updateGroundTint(), NIE co klatkę —
// ton zmienia się bardzo powoli wraz z porą dnia, częstsze odświeżanie nie
// dałoby żadnej widocznej różnicy, tylko zbędny koszt).
//
// Wydajność: teren ma OSOBNY materiał na każdy kafelek (sim-terrain.js), ale
// liczba jednocześnie aktywnych kafelków jest mała i ograniczona (Mapa
// tileMeshes), więc iteracja po nich jest tania. Budynki mają JEDEN wspólny
// materiał (buildingMat, sim-buildings.js, vertex colors) — zmiana jego
// .color to pojedyncza operacja NIEZALEŻNA od liczby budynków na scenie, więc
// dopasowanie koloru budynków do tonu terenu nie kosztuje NIC dodatkowego,
// bez względu na to, ile budynków akurat widać (0 czy 10 000).
// ════════════════════════════════════════════════════════════════════════════

const GROUND_TINT_DAY   = 0.88; // pełne słońce — lekko przyciemnione
const GROUND_TINT_NIGHT = 1.16; // noc — lekko rozjaśnione (czytelność terenu)

function updateGroundTint() {
  const nf = (typeof SkyState !== 'undefined') ? SkyState.nightFactor : 0;
  const tint = GROUND_TINT_DAY + (GROUND_TINT_NIGHT - GROUND_TINT_DAY) * nf;

  // Teren — każdy kafelek ma własny materiał (sim-terrain.js), mnożymy
  // ZAPAMIĘTANY kolor bazowy (biały z teksturą / zielony bez niej — patrz
  // mat.userData.baseColor w loadTile()) przez ton, żeby nie zgubić różnicy
  // między kafelkami z teksturą satelitarną a bez niej.
  for (const mesh of tileMeshes.values()) {
    const mat = mesh.material;
    const base = mat.userData.baseColor;
    if (base) mat.color.copy(base).multiplyScalar(tint);
  }

  // Budynki — JEDEN wspólny materiał na wszystkie budynki na scenie, więc to
  // pojedyncze przypisanie, a nie pętla po tysiącach wierzchołków/budynków.
  if (typeof buildingMat !== 'undefined') buildingMat.color.setScalar(tint);
}
