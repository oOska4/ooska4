'use strict';

// Configure GROUND_TINT_DAY.

const GROUND_TINT_DAY       = 0.62; // full sun dimmed to correct overexposure
const GROUND_TINT_NIGHT     = 1.0;  // night neutral (little left to multiply anyway)
const GROUND_EMISSIVE_NIGHT = 0.06; // night constant terrain glow, independent of real light

const BUILDING_TINT_DAY   = GROUND_TINT_DAY; // Configure BUILDING_TINT_NIGHT.
const BUILDING_TINT_NIGHT = 0.09;             // Handle function updateGroundTint().

function updateGroundTint() {
  const nf = (typeof SkyState !== 'undefined') ? SkyState.nightFactor : 0;

  const groundTint = GROUND_TINT_DAY + (GROUND_TINT_NIGHT - GROUND_TINT_DAY) * nf;
  const groundEmis = GROUND_EMISSIVE_NIGHT * nf;

  // Configure mesh.
  for (const mesh of tileMeshes.values()) {
    const mat = mesh.material;
    const base = mat.userData.baseColor;
    if (base) mat.color.copy(base).multiplyScalar(groundTint);
    if (mat.emissive) mat.emissive.setScalar(groundEmis);
  }

  // Configure if.
  if (typeof buildingMat !== 'undefined') {
    const buildingTint = BUILDING_TINT_DAY + (BUILDING_TINT_NIGHT - BUILDING_TINT_DAY) * nf;
    buildingMat.color.setScalar(buildingTint);
  }
}
