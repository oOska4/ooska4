'use strict';

// ════════════════════════════════════════════════════════════════════════════
// sim-shadows.js
//
// Naprawia efekt "teren zawsze wygląda tak samo niezależnie od pory dnia":
// kafelki terenu (sim-terrain.js) używały MeshBasicMaterial, który IGNORUJE
// wszystkie światła sceny — sunLight/hemiLight w sim-sky.js od dawna poprawnie
// zmieniają intensywność/kolor z porą dnia, problem był WYŁĄCZNIE w materiale
// terenu. Teraz kafelki dostają MeshLambertMaterial (tanie, wystarczające dla
// satelitarnej tekstury — patrz sim-terrain.js) + realne normalne wierzchołków
// (potrzebne do jakiegokolwiek oświetlenia, wcześniej ich brakowało), więc
// nachylenia gór realnie ciemnieją/jaśnieją zależnie od kąta Słońca.
//
// Cienie (terenu i SAMOLOTU — celowo BEZ budynków, na życzenie): jedno
// DirectionalLight (sunLight z sim-sky.js) rzuca cień. Ponieważ reprezentuje
// Słońce w nieskończoności, jego dosłowna pozycja w świecie nie ma znaczenia
// fizycznego — liczy się tylko KIERUNEK (sunWorldDir, sim-sky.js). Kamera
// cienia (ortho, mały ograniczony frustum) MUSI więc podążać za samolotem
// (updateShadowFollow(), wołane co klatkę z sim-main.js PO updateSky(), żeby
// mieć świeży sunWorldDir) — inaczej zostałaby przy (0,0,0) świata, gdzie
// samolot rzadko bywa (świat to realne metry od punktu odniesienia lotniska).
//
// 4 poziomy jakości (Wyłączone/Niska/Średnia/Wysoka) — przyciski
// [data-shadowqual] w panelu POGODA (desktop + mobile popup), dokładnie ten
// sam wzorzec co JAKOŚĆ CHMUR ([data-qual]/setSkyQuality w sim-sky.js).
// "Wysoka"/"Średnia" włączają dodatkowo samo-cieniowanie terenu (góry rzucają
// cień na doliny — ważne przy nisko stojącym Słońcu), "Niska" tylko cień
// samolotu na teren (taniej), "Wyłączone" wyłącza cienie całkowicie (zero
// kosztu, renderer.shadowMap.enabled=false).
// ════════════════════════════════════════════════════════════════════════════

const SHADOW_QUALITY_PRESETS = {
  off:  null,
  low:  { mapSize: 1024, radiusM: 400,  softness: 1, terrainCast: false },
  med:  { mapSize: 2048, radiusM: 700,  softness: 2, terrainCast: true  },
  high: { mapSize: 4096, radiusM: 1100, softness: 3, terrainCast: true  },
};
let shadowQuality = 'med';

// Kamera cienia sunLight (ortho) NIE stoi przy realnej pozycji Słońca — jej
// target musi być częścią sceny, żeby macierz świata aktualizowała się przy
// podążaniu za samolotem (patrz updateShadowFollow()).
scene.add(sunLight.target);

function applyShadowQuality(name) {
  if (!(name in SHADOW_QUALITY_PRESETS)) return;
  shadowQuality = name;
  const preset = SHADOW_QUALITY_PRESETS[name];

  if (!preset) {
    renderer.shadowMap.enabled = false;
    sunLight.castShadow = false;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sunLight.castShadow = true;
    const r = preset.radiusM;
    sunLight.shadow.mapSize.set(preset.mapSize, preset.mapSize);
    sunLight.shadow.camera.left = -r; sunLight.shadow.camera.right = r;
    sunLight.shadow.camera.top = r;   sunLight.shadow.camera.bottom = -r;
    sunLight.shadow.camera.near = 1;  sunLight.shadow.camera.far = r * 6;
    // Dostrojone eksperymentalnie do skali realnych metrów świata (bias
    // ujemny ogranicza "peter-panning" cienia odklejonego od modelu, normalBias
    // ogranicza acne na nachylonym terenie) — Oskar może doregulować wg gustu.
    sunLight.shadow.bias = -0.0012;
    sunLight.shadow.normalBias = 0.6;
    sunLight.shadow.radius = preset.softness;
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null; // wymusza przebudowę mapy cienia w nowym rozmiarze
  }

  // Włącz/wyłącz samo-cieniowanie terenu (góra rzuca cień na dolinę) na
  // WSZYSTKICH już wczytanych kafelkach na żywo — tylko flaga na Meshu, tanie,
  // bez przebudowy geometrii. Nowe kafelki (loadTile() w sim-terrain.js) same
  // odczytują shadowTerrainCastEnabled() przy tworzeniu.
  const castTerrain = !!(preset && preset.terrainCast);
  for (const mesh of tileMeshes.values()) mesh.castShadow = castTerrain;

  document.querySelectorAll('[data-shadowqual]').forEach(b => {
    b.classList.toggle('active', b.dataset.shadowqual === name);
  });
}

// Odczytywane przez loadTile() (sim-terrain.js) przy tworzeniu NOWEGO kafelka.
function shadowTerrainCastEnabled() {
  const preset = SHADOW_QUALITY_PRESETS[shadowQuality];
  return !!(preset && preset.terrainCast);
}

// ── Podążanie kamery cienia za samolotem (patrz komentarz na górze pliku) ────
function updateShadowFollow() {
  if (!sunLight.castShadow) return;
  const followPos = (activeEntity && activeEntity.mesh) ? activeEntity.mesh.position : null;
  if (!followPos) return;
  sunLight.target.position.copy(followPos);
  sunLight.position.copy(followPos).addScaledVector(sunWorldDir, 1000);
  sunLight.position.y = Math.max(sunLight.position.y, followPos.y + 5);
  sunLight.target.updateMatrixWorld();
}

// ── UI (dokładnie wzorzec [data-qual]/setSkyQuality z sim-sky.js) ───────────
document.querySelectorAll('[data-shadowqual]').forEach(btn => {
  btn.addEventListener('click', () => applyShadowQuality(btn.dataset.shadowqual));
});

applyShadowQuality(shadowQuality);
