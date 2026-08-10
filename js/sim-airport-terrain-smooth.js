'use strict';

// ============================================================================
// Airport terrain smoothing
// ----------------------------------------------------------------------------
// Terrarium DEM tiles are sometimes noisy/blocky right where an airport sits
// (visible as a jagged, "crumpled" ground mesh under an otherwise flat runway).
// That's bad source data, not a rendering bug - so instead of trying to "fix"
// the DEM globally, we smooth terrain height ONLY in the footprint of the
// actual airport surfaces (runways/taxiways/aprons/stands), with a soft
// falloff so it blends into the surrounding raw terrain.
//
// Deliberately NOT a flatten: the smoothing is a local moving-average low-pass
// filter over the raw DEM, so it keeps whatever large-scale slope the terrain
// actually has. An airport built on a real slope (e.g. VNLK/Lukla) keeps its
// slope - only the small-scale jitter gets removed. Areas with no aeroway
// tag at all (e.g. the mountainside around Lukla's runway) are never touched,
// since the mask only covers the mapped airport surfaces plus a small buffer.
//
// PERFORMANCE NOTE: This module does NOT make its own Overpass request. It's
// fed the `classified` data sim-airport-lights.js already fetched via
// apltAreaQuery() (one query covers runways/taxiways/aprons/stands/etc for
// both the light layout AND this smoothing field) - Overpass is slow and
// flaky enough that a second independent query per airport load would double
// the odds of a stall, so we reuse the single successful response fully.
//
// It also does NOT compute anything per-vertex at mesh-build time. Building
// the smoothing field precomputes a full height grid up front (using whatever
// DEM tiles are already cached from the normal prefetch), so buildMeshWithNeighbors()
// in sim-terrain.js only ever does one cheap bilinear lookup per vertex - same
// cost class as the raw DEM sample it replaces, instead of 8 extra trig-heavy
// samples per vertex on every tile rebuild near an airport.
// ============================================================================

const ATS_BUFFER_M          = 25;    // Extra half-width added around runway/taxiway/apron polygons.
const ATS_STAND_RADIUS_M    = 20;    // Radius treated as "paved" around each parking position/stand.
const ATS_FALLOFF_M         = 90;    // Distance over which smoothing fades back out to raw DEM.
const ATS_SAMPLE_STEP_M     = 10;    // Grid resolution for the precomputed field (both weight + height).
const ATS_AVG_RADIUS_M      = 35;    // Radius of the local moving-average low-pass filter.
const ATS_AVG_SAMPLES       = 8;     // Ring samples used per averaging point (precompute-time only now).
const ATS_MAX_CELLS         = 260000; // Safety cap (cols*rows) on the precomputed field size.
const ATS_ROWS_PER_CHUNK    = 12;    // Rows computed per chunk before yielding back to the event loop.
const ATS_START_DELAY_MS    = 1500;  // Wait this long after an airport load before starting the field
                                      // build at all, so it never competes with the initial burst of
                                      // tile/building/DEM loading right at startup.
const ATS_MAX_DELTA_M       = 50;    // Sanity clamp: smoothing can never move a vertex more than this
                                      // far from the raw DEM height. Real runways are graded gently, so
                                      // a bigger delta means bad/missing input data somewhere upstream
                                      // (e.g. a DEM tile not cached yet) - better to fall back to the
                                      // raw (jagged but truthful) terrain than carve a fake cliff/pit.

const ATS_CACHE = new Map();   // icao -> field object | null
let   ATS_ACTIVE = null;       // Currently active smoothing field (for the loaded airport).
let   atsLoadEpoch = 0;
let   atsBuildToken = 0;       // Bumped to cancel an in-progress chunked field build.

function _atsWorldXZ(lat, lon) {
  const cosRef = Math.cos(Units.degToRad(refLat));
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const z = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  return [x, -z]; // matches buildMeshWithNeighbors()'s world Z sign (world z = -northing)
}

// ----------------------------------------------------------------------------
// Build "paved shapes" (buffered lines + buffered points) straight from the
// classified Overpass elements sim-airport-lights.js already parsed.
// ----------------------------------------------------------------------------
function _atsShapesFromClassified(classified) {
  const lines = [];   // { pts:[[x,z],...], halfWidth }
  const points = [];  // { x, z, radius }

  const addLine = (ring, tagWidth, isRunway) => {
    if (!ring || ring.length < 2) return;
    let widthM = parseFloat(tagWidth);
    if (isNaN(widthM)) widthM = isRunway ? APLT_DEFAULT_RW_WIDTH : APLT_DEFAULT_TWY_WIDTH;
    const pts = ring.map(p => _atsWorldXZ(p.lat, p.lon));
    lines.push({ pts, halfWidth: widthM / 2 + ATS_BUFFER_M });
  };

  for (const rw of classified.runways || [])
    addLine(rw.line, rw.tags && rw.tags.width, true);
  for (const tw of classified.taxiways || [])
    addLine(tw.line, tw.tags && tw.tags.width, false);
  for (const ap of classified.aprons || []) {
    // Apron polygons: treat the outer ring itself as the paved line (buffered),
    // which comfortably covers the interior for the sizes aprons come in.
    addLine(ap.outer, ap.tags && ap.tags.width, false);
  }
  for (const pp of classified.parkingPositions || []) {
    if (typeof pp.lat !== 'number' || typeof pp.lon !== 'number') continue;
    const [x, z] = _atsWorldXZ(pp.lat, pp.lon);
    points.push({ x, z, radius: ATS_STAND_RADIUS_M + ATS_BUFFER_M });
  }

  return { lines, points };
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

function _atsDistToLine(px, pz, line) {
  let best = Infinity;
  const pts = line.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = _atsPointSegDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best - line.halfWidth;
}

function _atsDistToPoint(px, pz, pt) {
  return Math.hypot(px - pt.x, pz - pt.z) - pt.radius;
}

function _atsSmoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

// ----------------------------------------------------------------------------
// Precomputes BOTH the blend-weight grid and the already-smoothed height grid
// for the airport, using currently-cached raw DEM samples. This is the only
// place that does the (relatively) expensive per-cell low-pass averaging -
// it runs once per airport load, not once per vertex per tile rebuild.
//
// Split into a cheap bounds/allocation step (_atsFieldBounds) and a chunked
// row-filling step (_atsFillFieldChunk) so the caller can spread the actual
// work across multiple event-loop turns instead of blocking one frame.
// ----------------------------------------------------------------------------
function _atsFieldBounds(lines, points) {
  if (!lines.length && !points.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of lines) for (const [x, z] of l.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  for (const p of points) {
    if (p.x - p.radius < minX) minX = p.x - p.radius;
    if (p.x + p.radius > maxX) maxX = p.x + p.radius;
    if (p.z - p.radius < minZ) minZ = p.z - p.radius;
    if (p.z + p.radius > maxZ) maxZ = p.z + p.radius;
  }
  if (!Number.isFinite(minX)) return null;

  const pad = ATS_FALLOFF_M + ATS_AVG_RADIUS_M + 20;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  let cell = ATS_SAMPLE_STEP_M;
  let cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  let rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  // Coarsen the grid automatically for very large airports instead of a hard
  // cap that would just truncate coverage - keeps memory/time bounded for
  // sprawling international airports without losing the far edges.
  while (cols * rows > ATS_MAX_CELLS) {
    cell *= 1.3;
    cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  }

  const weight = new Float32Array((cols + 1) * (rows + 1));
  const height = new Float32Array((cols + 1) * (rows + 1));
  return { minX, minZ, maxX, maxZ, cell, cols, rows, weight, height };
}

// Fills grid rows [rowStart, rowEnd) of an already-allocated field in place.
function _atsFillFieldRows(field, lines, points, sampleRawFn, rowStart, rowEnd) {
  const { minX, minZ, cell, cols, weight, height } = field;
  const stride = cols + 1;
  for (let r = rowStart; r < rowEnd; r++) {
    const pz = minZ + r * cell;
    for (let c = 0; c <= cols; c++) {
      const px = minX + c * cell;
      let minDist = Infinity;
      for (const line of lines) {
        const d = _atsDistToLine(px, pz, line);
        if (d < minDist) minDist = d;
        if (minDist <= 0) break;
      }
      if (minDist > 0) for (const pt of points) {
        const d = _atsDistToPoint(px, pz, pt);
        if (d < minDist) minDist = d;
        if (minDist <= 0) break;
      }
      const w = minDist <= 0 ? 1 : 1 - _atsSmoothstep(minDist / ATS_FALLOFF_M);
      const idx = r * stride + c;

      if (w > 0.001) {
        const rawHere = sampleRawFn(px, pz);
        if (rawHere == null) {
          // No cached DEM tile covers this cell yet (can happen on huge/mountain
          // airports where not every nearby tile is prefetched by the time the
          // field builds). Falling back to height=0 here would be catastrophic:
          // weight would still be >0, so smoothAirportTerrainHeight() would blend
          // the real terrain toward sea level and carve a fake cliff/pit into the
          // mesh. Zero the weight instead, so this cell is simply left untouched
          // (raw DEM passes through unchanged) rather than "smoothed" toward 0m.
          weight[idx] = 0;
          height[idx] = 0;
          continue;
        }
        weight[idx] = w;
        let sum = rawHere, n = 1;
        for (let i = 0; i < ATS_AVG_SAMPLES; i++) {
          const a = (i / ATS_AVG_SAMPLES) * Math.PI * 2;
          const h = sampleRawFn(px + Math.cos(a) * ATS_AVG_RADIUS_M, pz + Math.sin(a) * ATS_AVG_RADIUS_M);
          if (h != null) { sum += h; n++; }
        }
        const avg = sum / n;
        height[idx] = rawHere + (avg - rawHere) * w;
      } else {
        weight[idx] = 0;
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Bilinear sample of the precomputed field. Returns { weight, height } where
// height is only meaningful where weight > 0 (elsewhere it's 0/unused).
// ----------------------------------------------------------------------------
function _atsSampleField(field, x, z) {
  if (!field) return null;
  if (x < field.minX || x > field.maxX || z < field.minZ || z > field.maxZ) return null;
  const fc = (x - field.minX) / field.cell, fr = (z - field.minZ) / field.cell;
  const c0 = fc | 0, r0 = fr | 0;
  const c1 = Math.min(field.cols, c0 + 1), r1 = Math.min(field.rows, r0 + 1);
  const tx = fc - c0, tz = fr - r0;
  const stride = field.cols + 1;
  const i00 = r0 * stride + c0, i10 = r0 * stride + c1;
  const i01 = r1 * stride + c0, i11 = r1 * stride + c1;
  const w = field.weight, h = field.height;
  const w00 = w[i00], w10 = w[i10], w01 = w[i01], w11 = w[i11];
  const weight = (w00 + (w10 - w00) * tx) * (1 - tz) + (w01 + (w11 - w01) * tx) * tz;
  if (weight <= 0.001) return { weight: 0, height: 0 };
  const h00 = h[i00], h10 = h[i10], h01 = h[i01], h11 = h[i11];
  const height = (h00 + (h10 - h00) * tx) * (1 - tz) + (h01 + (h11 - h01) * tx) * tz;
  return { weight, height };
}

// ----------------------------------------------------------------------------
// Public entry point. Call with the SAME `classified` object returned by
// fetchAirportFullData() (sim-airport-lights.js) - no separate Overpass
// request is made here. sampleRawFn(worldX, worldZ) => raw DEM meters (or
// null), used to build the low-pass average; pass _terrainRawHeightAtWorldXZ
// from sim-terrain.js.
// Returns the built field ({minX,minZ,maxX,maxZ,...}) or null (no paved
// surfaces found / build was superseded) - callers use the bounds to rebuild
// only the tiles that actually need it instead of the whole scene.
// ----------------------------------------------------------------------------
async function loadAirportTerrainSmoothing(icao, classified, sampleRawFn) {
  if (!icao || !classified) return null;
  const epoch = ++atsLoadEpoch;
  if (ATS_CACHE.has(icao)) { ATS_ACTIVE = ATS_CACHE.get(icao); return ATS_ACTIVE; }

  const { lines, points } = _atsShapesFromClassified(classified);
  if (!lines.length && !points.length) {
    ATS_CACHE.set(icao, null);
    if (epoch === atsLoadEpoch) ATS_ACTIVE = null;
    return null;
  }

  // Field build is pure CPU math over cached DEM tiles (no network), but a
  // single-shot version can still take long enough on a big airport to be
  // felt as a stutter - and worse, it used to fire immediately alongside the
  // initial burst of tile/building/DEM loading at startup. So: wait a bit
  // before starting at all, then fill the grid a handful of rows per turn
  // via setTimeout(0), yielding back to the event loop between chunks.
  const myToken = ++atsBuildToken;
  const field = await _atsBuildFieldYielding(lines, points, sampleRawFn, myToken);
  if (epoch !== atsLoadEpoch || myToken !== atsBuildToken) return null;

  ATS_CACHE.set(icao, field);
  ATS_ACTIVE = field;
  return field;
}

function _atsDelay(ms) { return new Promise(res => setTimeout(res, ms)); }

// Chunked field build: waits ATS_START_DELAY_MS before doing any work, then
// fills ATS_ROWS_PER_CHUNK rows at a time with a setTimeout(0) yield between
// chunks, so it never occupies the main thread for more than a few ms at a
// stretch - even for a very large airport's field. Cancellable via myToken.
async function _atsBuildFieldYielding(lines, points, sampleRawFn, myToken) {
  if (!lines.length && !points.length) return null;

  await _atsDelay(ATS_START_DELAY_MS);
  if (myToken !== atsBuildToken) return null;

  const field = _atsFieldBounds(lines, points);
  if (!field) return null;

  for (let r = 0; r <= field.rows; r += ATS_ROWS_PER_CHUNK) {
    if (myToken !== atsBuildToken) return null;
    const rowEnd = Math.min(field.rows + 1, r + ATS_ROWS_PER_CHUNK);
    _atsFillFieldRows(field, lines, points, sampleRawFn, r, rowEnd);
    // Yield back to the event loop so rendering/input/other loads get a turn.
    await _atsDelay(0);
  }
  if (myToken !== atsBuildToken) return null;
  return field;
}

function clearAirportTerrainSmoothing() {
  ATS_ACTIVE = null;
  atsLoadEpoch++;
  atsBuildToken++;
}

// ----------------------------------------------------------------------------
// Height smoothing entry point used by sim-terrain.js's mesh builder. Pure
// grid lookup - no trig, no DEM re-sampling - so it's cheap enough to call
// per vertex.
// ----------------------------------------------------------------------------
function smoothAirportTerrainHeight(worldX, worldZ, rawHeightM) {
  const field = ATS_ACTIVE;
  if (!field) return rawHeightM;
  const sample = _atsSampleField(field, worldX, worldZ);
  if (!sample || sample.weight <= 0.001) return rawHeightM;
  const blended = rawHeightM + (sample.height - rawHeightM) * sample.weight;
  // Last-line-of-defense sanity clamp: if the field build hit missing/bad DEM
  // data somewhere (e.g. a tile not cached yet on a sprawling mountain
  // airport), a bogus blend could otherwise carve a fake cliff/pit into the
  // mesh. A real runway is graded gently, so a huge delta means "don't trust
  // this sample" - fall back to the untouched raw terrain instead.
  if (Math.abs(blended - rawHeightM) > ATS_MAX_DELTA_M) return rawHeightM;
  return blended;
}
