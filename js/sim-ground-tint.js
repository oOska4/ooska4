'use strict';

// ════════════════════════════════════════════════════════════════════════════
// sim-ground-tint.js
//
// Niewielkie dodatkowe stonowanie terenu i budynków PONAD fizyczne
// oświetlenie (sim-shadows.js/sim-sky.js).
//
// TEREN: mnożnik koloru (GROUND_TINT_*) działa tylko wtedy, gdy jest jakieś
// realne światło do wzmocnienia (kolor × światło) — za dnia owszem, więc
// lekkie przyciemnienie (GROUND_TINT_DAY) realnie tłumi przejaskrawienie
// zdjęcia satelitarnego w pełnym słońcu. Ale w NOCY sunLight/hemiLight i tak
// spadają niemal do zera, więc żaden mnożnik koloru nic tam nie zdziała
// (cokolwiek × prawie-zero = wciąż prawie zero) — terenowi trzeba dać
// EMISYJNOŚĆ (GROUND_EMISSIVE_NIGHT), czyli stały "poblask" niezależny od
// realnej ilości światła. To DOKŁADNIE ta sama sztuczka, co już jest użyta
// dla silników A321 (mat.emissive.addScalar(...) w sim-physics.js) — stąd
// materiał terenu to teraz MeshPhongMaterial (sim-terrain.js), bo tylko takie
// materiały (Phong/Standard) mają w ogóle .emissive.
//
// BUDYNKI: mają JEDEN wspólny nieoświetlony materiał (buildingMat,
// sim-buildings.js, MeshBasicMaterial + vertex colors) — nie reagują na
// światła sceny WCALE, więc bez tej korekty są zawsze "w pełnym słońcu" także
// o północy i rażąco odstają od (teraz poprawnie ciemnego) terenu. Jedyna
// dostępna dla nich kontrola jasności to mnożnik .color, więc w nocy schodzi
// dużo niżej niż dla terenu (BUILDING_TINT_NIGHT), żeby wyglądały na
// przygaszone/w cieniu, a nie świecące.
//
// Wołane co kilka klatek z sim-main.js (updateGroundTint(), NIE co klatkę —
// ton zmienia się bardzo powoli wraz z porą dnia).
//
// Wydajność: teren ma osobny materiał na kafelek, ale liczba jednocześnie
// aktywnych kafelków jest mała i ograniczona (tileMeshes) — iteracja jest
// tania. Budynki mają JEDEN wspólny materiał — zmiana .color/.emissive to
// operacja O(1), niezależna od liczby budynków na scenie.
// ════════════════════════════════════════════════════════════════════════════

const GROUND_TINT_DAY       = 0.62; // pełne słońce — wyraźniej przyciemnione (korekta przejaskrawienia)
const GROUND_TINT_NIGHT     = 1.0;  // noc — neutralny (i tak prawie nie ma czego mnożyć, patrz wyżej)
const GROUND_EMISSIVE_NIGHT = 0.06; // noc — stały "poblask" terenu, niezależny od realnego światła

const BUILDING_TINT_DAY   = GROUND_TINT_DAY; // budynki mają kolor sprobkowany WPROST z tej samej tekstury co teren (samplePixelColor w sim-buildings.js) - więc ten sam ton co ziemia pod nimi
const BUILDING_TINT_NIGHT = 0.09;             // budynki NIE mają emisyjności (MeshBasicMaterial, nieoświetlony) - jedyna kontrola to mnożnik, więc w nocy schodzi rzędem wielkości do GROUND_EMISSIVE_NIGHT, żeby wizualnie pasował do (teraz naprawdę ciemnego) terenu

function updateGroundTint() {
  const nf = (typeof SkyState !== 'undefined') ? SkyState.nightFactor : 0;

  const groundTint = GROUND_TINT_DAY + (GROUND_TINT_NIGHT - GROUND_TINT_DAY) * nf;
  const groundEmis = GROUND_EMISSIVE_NIGHT * nf;

  // Teren — każdy kafelek ma własny materiał (sim-terrain.js), mnożymy
  // ZAPAMIĘTANY kolor bazowy (biały z teksturą / zielony bez niej — patrz
  // mat.userData.baseColor w loadTile()) przez ton i dokładamy nocny poblask.
  for (const mesh of tileMeshes.values()) {
    const mat = mesh.material;
    const base = mat.userData.baseColor;
    if (base) mat.color.copy(base).multiplyScalar(groundTint);
    if (mat.emissive) mat.emissive.setScalar(groundEmis);
  }

  // Budynki — JEDEN wspólny materiał na wszystkie budynki na scenie, więc to
  // pojedyncze przypisanie, a nie pętla po tysiącach wierzchołków/budynków.
  if (typeof buildingMat !== 'undefined') {
    const buildingTint = BUILDING_TINT_DAY + (BUILDING_TINT_NIGHT - BUILDING_TINT_DAY) * nf;
    buildingMat.color.setScalar(buildingTint);
  }
}
