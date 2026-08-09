'use strict';

// ============================================================================
// Airport terrain smoothing
// ----------------------------------------------------------------------------
// Terrarium DEM tiles are sometimes noisy/blocky right where an airport sits
// (visible as a jagged, "crumpled" ground mesh under an otherwise flat runway).
// That's bad source data, not a rendering bug - so instead of trying to "fix"
// the DEM globally, we smooth terrain height ONLY in the footprint of the
// actual airport surfaces (runways/taxiways/aprons/helipads), fetched from
// Overpass, with a soft falloff so it blends into the surrounding raw terrain.
//
// Deliberately NOT a flatten: the smoothing is a local moving-average low-pass
// filter over the raw DEM, so it keeps whatever large-scale slope the terrain
// actually has. An airport built on a real slope (e.g. VNLK/Lukla) keeps its
// slope - only the small-scale jitter gets removed. Areas with no aeroway
// tag at all (e.g. the mountainside around Lukla's runway) are never touched,
// since the mask only covers the mapped airport surfaces plus a small buffer.
// ============================================================================

const ATS_BUFFER_M          = 25;    // Extra half-width added around runway/taxiway/apron polygons.
const ATS_FALLOFF_M         = 90;    // Distance over which smoothing fades back out to raw DEM.
const ATS_SAMPLE_STEP_M     = 8;     // Grid resolution for the precomputed smoothing mask.
const ATS_AVG_RADIUS_M      = 35;    // Radius of the local moving-average low-pass filter.
const ATS_AVG_SAMPLES       = 8;     // Ring samples used per averaging point (kept small for perf).
const ATS_MAX_FOOTPRINT_PTS = 4000;  // Safety cap on stored footprint polygon points.

const ATS_CACHE = new Map();   // icao -> { minX, minZ, maxX, maxZ, cell, cols, rows, weight:Float32Array } | null
let   ATS_ACTIVE = null;       // Currently active smoothing field (for the loaded airport).
let   atsLoadEpoch = 0;

function _atsWorldXZ(lat, lon) {
  // Same projection sim-constants.js uses (geoToWorld), but we only need XZ ground-plane meters, unscaled by Y_SCALE.
  const cosRef = Math.cos(Units.degToRad(refLat));
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const z = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  return [x, -z]; // matches buildMeshWithNeighbors()'s world Z sign (world z = -northing)
}

// Overpass query: only surfaces that actually carry pavement (skip navaids, lit points, etc).
function _atsAreaQuery(icao) {
  return `[out:json][timeout:25];area["icao"="${icao}"]->.a;` +
    `(way(area.a)["aeroway"~"^(runway|taxiway|apron|helipad)$"];` +
    `relation(area.a)["aeroway"~"^(runway|taxiway|apron|helipad)$"];);` +
    `out geom;`;
}

// Extracts one or more polylines/rings (as [x,z] world-meter point arrays) per element.
function _atsElementsToLines(elements) {
  const lines = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const isRunway = tags.aeroway === 'runway';
    let widthM = parseFloat(tags.width);
    if (isNaN(widthM)) widthM = isRunway ? APLT_DEFAULT_RW_WIDTH : APLT_DEFAULT_TWY_WIDTH;

    const ringsGeo = [];
    if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
      ringsGeo.push(el.geometry);
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) if (m.geometry && m.geometry.length > 1) ringsGeo.push(m.geometry);
    }
    for (const ring of ringsGeo) {
      const pts = ring.map(p => _atsWorldXZ(p.lat, p.lon));
      if (pts.length >= 2) lines.push({ pts, halfWidth: widthM / 2 + ATS_BUFFER_M });
    }
  }
  return lines;
}

// Distance (meters) from point [px,pz] to segment [ax,az]-[bx,bz].
function _atsPointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// Minimum distance from a point to a buffered polyline; returns Infinity if far outside its own bbox+falloff.
function _atsDistToLine(px, pz, line) {
  let best = Infinity;
  const pts = line.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = _atsPointSegDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best - line.halfWidth; // <=0 means inside the paved+buffer strip
}

function _atsSmoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// Builds the precomputed weight grid (and bounds) for one airport's fetched surfaces.
function _atsBuildField(lines) {
  if (!lines.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of lines) {
    for (const [x, z] of l.pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const pad = ATS_FALLOFF_M + ATS_AVG_RADIUS_M + 20;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const cell = ATS_SAMPLE_STEP_M;
  const cols = Math.min(2000, Math.max(1, Math.ceil((maxX - minX) / cell)));
  const rows = Math.min(2000, Math.max(1, Math.ceil((maxZ - minZ) / cell)));
  const weight = new Float32Array((cols + 1) * (rows + 1));

  for (let r = 0; r <= rows; r++) {
    const pz = minZ + r * cell;
    for (let c = 0; c <= cols; c++) {
      const px = minX + c * cell;
      let minDist = Infinity;
      for (const line of lines) {
        const d = _atsDistToLine(px, pz, line);
        if (d < minDist) minDist = d;
        if (minDist <= 0) break;
      }
      // minDist <= 0 -> inside paved strip -> weight 1. Fades to 0 over ATS_FALLOFF_M.
      const w = minDist <= 0 ? 1 : 1 - _atsSmoothstep(minDist / ATS_FALLOFF_M);
      weight[r * (cols + 1) + c] = w;
    }
  }

  return { minX, minZ, maxX, maxZ, cell, cols, rows, weight };
}

function _atsSampleWeight(field, x, z) {
  if (!field) return 0;
  if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) return 0;
  const fc = (x - field.minX) / field.cell, fr = (z - field.minZ) / field.cell;
  const c0 = fc | 0, r0 = fr | 0;
  const c1 = Math.min(field.cols, c0 + 1), r1 = Math.min(field.rows, r0 + 1);
  const tx = fc - c0, tz = fr - r0;
  const w = field.weight;
  const stride = field.cols + 1;
  const w00 = w[r0 * stride + c0], w10 = w[r0 * stride + c1];
  const w01 = w[r1 * stride + c0], w11 = w[r1 * stride + c1];
  const wx0 = w00 + (w10 - w00) * tx, wx1 = w01 + (w11 - w01) * tx;
  return wx0 + (wx1 - wx0) * tz;
}

// Loads + caches the smoothing field for an airport. Safe to call multiple times.
async function loadAirportTerrainSmoothing(icao) {
  if (!icao) return;
  const epoch = ++atsLoadEpoch;
  if (ATS_CACHE.has(icao)) { ATS_ACTIVE = ATS_CACHE.get(icao); return; }
  try {
    const elements = await apltOverpassRun(_atsAreaQuery(icao));
    if (epoch !== atsLoadEpoch) return;
    const lines = _atsElementsToLines(elements || []);
    const field = _atsBuildField(lines);
    ATS_CACHE.set(icao, field); // cache null too, so a data-less airport doesn't re-query every load
    if (epoch === atsLoadEpoch) ATS_ACTIVE = field;
  } catch (e) {
    console.error('[terrain-smooth] failed for', icao, e);
    if (epoch === atsLoadEpoch) ATS_ACTIVE = null;
  }
}

function clearAirportTerrainSmoothing() {
  ATS_ACTIVE = null;
  atsLoadEpoch++;
}

// ----------------------------------------------------------------------------
// Height smoothing entry point used by sim-terrain.js's mesh builder.
// (worldX, worldZ) are the same ground-plane meters buildMeshWithNeighbors()
// already computes; rawHeightM is the raw (unscaled, meters) DEM height it
// just looked up for that vertex. sampleRawFn(worldX, worldZ) => meters, used
// by the local low-pass average (falls back to rawHeightM if unavailable).
// Returns the possibly-blended height in meters (same units as rawHeightM).
// ----------------------------------------------------------------------------
function smoothAirportTerrainHeight(worldX, worldZ, rawHeightM, sampleRawFn) {
  const field = ATS_ACTIVE;
  if (!field) return rawHeightM;
  const weight = _atsSampleWeight(field, worldX, worldZ);
  if (weight <= 0.001) return rawHeightM;

  // Local moving-average low-pass: ring of samples around the point, averaged
  // with the center. This removes small jitter while preserving the terrain's
  // real large-scale slope (critical for sloped runways like Lukla, though in
  // practice weight is already ~0 there since only mapped pavement is covered).
  let sum = rawHeightM, n = 1;
  for (let i = 0; i < ATS_AVG_SAMPLES; i++) {
    const a = (i / ATS_AVG_SAMPLES) * Math.PI * 2;
    const sx = worldX + Math.cos(a) * ATS_AVG_RADIUS_M;
    const sz = worldZ + Math.sin(a) * ATS_AVG_RADIUS_M;
    const h = sampleRawFn ? sampleRawFn(sx, sz) : null;
    if (h != null && Number.isFinite(h)) { sum += h; n++; }
  }
  const avg = sum / n;
  return rawHeightM + (avg - rawHeightM) * weight;
}
