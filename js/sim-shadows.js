'use strict';

// Configure SHADOW_QUALITY_PRESETS.

const SHADOW_QUALITY_PRESETS = {
  off:  null,
  low:  { mapSize: 1024, radiusM: 400,  softness: 1, terrainCast: false },
  med:  { mapSize: 2048, radiusM: 700,  softness: 2, terrainCast: true  },
  high: { mapSize: 4096, radiusM: 1100, softness: 3, terrainCast: true  },
};
let shadowQuality = 'med';

// Airport lighting note.
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
    // Configure sunLight.shadow.bias.
    sunLight.shadow.bias = -0.0012;
    sunLight.shadow.normalBias = 0.6;
    sunLight.shadow.radius = preset.softness;
    sunLight.shadow.camera.updateProjectionMatrix();
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null; // forces the shadow map to rebuild at the new size
  }

  // Configure castTerrain.
  const castTerrain = !!(preset && preset.terrainCast);
  for (const mesh of tileMeshes.values()) mesh.castShadow = castTerrain;

  document.querySelectorAll('[data-shadowqual]').forEach(b => {
    b.classList.toggle('active', b.dataset.shadowqual === name);
  });
}

// Read by loadTile() (sim-terrain.js) when creating a NEW tile.
function shadowTerrainCastEnabled() {
  const preset = SHADOW_QUALITY_PRESETS[shadowQuality];
  return !!(preset && preset.terrainCast);
}

// Shadow camera following the aircraft (see file header)
function updateShadowFollow() {
  if (!sunLight.castShadow) return;
  const followPos = (activeEntity && activeEntity.mesh) ? activeEntity.mesh.position : null;
  if (!followPos) return;
  sunLight.target.position.copy(followPos);
  sunLight.position.copy(followPos).addScaledVector(sunWorldDir, 1000);
  sunLight.position.y = Math.max(sunLight.position.y, followPos.y + 5);
  sunLight.target.updateMatrixWorld();
}

// UI (same [data-qual]/setSkyQuality pattern as sim-sky.js)
document.querySelectorAll('[data-shadowqual]').forEach(btn => {
  btn.addEventListener('click', () => applyShadowQuality(btn.dataset.shadowqual));
});

applyShadowQuality(shadowQuality);
