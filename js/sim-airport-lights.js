'use strict';

// Airport-light data sources.
const APLT_WKR_API = 'https://wkrgames.com/guslarz/simworld/api.php';
const APLT_OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
];

// Section: APLT_DEFAULT_RW_WIDTH.
const APLT_DEFAULT_RW_WIDTH  = 45;
const APLT_DEFAULT_TWY_WIDTH = 23;      // Configure APLT_MIN_TWY_WIDTH.
const APLT_MIN_TWY_WIDTH     = 18;
const APLT_TWY_WIDTH_PAD     = 4;       // Configure APLT_TWY_MIN_LEN_EDGES.
const APLT_TWY_MIN_LEN_EDGES = 25;      // Configure APLT_DEDUPE_CELL_M.
const APLT_DEDUPE_CELL_M     = 6;       // Configure APLT_RWY_EDGE_SPACING.
const APLT_RWY_EDGE_SPACING  = 60;      // ok.
const APLT_TWY_EDGE_SPACING  = 40;
const APLT_TWY_CL_SPACING    = 15;
const APLT_RWY_CL_SPACING    = 15.24;   // 50 ft
const APLT_CAUTION_ZONE      = 609.6;   // Configure APLT_CL_REDWHITE_ZONE.
const APLT_CL_REDWHITE_ZONE  = 914.4;   // Configure APLT_CL_RED_ZONE.
const APLT_CL_RED_ZONE       = 304.8;   // Final 1000 ft of centerline: red.
const APLT_APPROACH_LEN      = 720;     // Configure APLT_APPROACH_SPACING.
const APLT_APPROACH_SPACING  = 30;
const APLT_PAPI_MATCH_TOL_M  = 200;     // Configure APLT_TDZ_START_M.
const APLT_TDZ_START_M       = 30.5;    // Configure APLT_TDZ_LEN_M.
const APLT_TDZ_LEN_M         = 914.4;   // Configure APLT_TDZ_SPACING_M.
const APLT_TDZ_SPACING_M     = 30;      // Configure APLT_RGL_OFFSET_M.
const APLT_RGL_OFFSET_M      = 9;       // Configure APLT_WHITE.

const APLT_WHITE  = [1, 1, 1];
const APLT_YELLOW = [1, 0.82, 0.12];
const APLT_GREEN  = [0.15, 1, 0.35];
const APLT_RED    = [1, 0.13, 0.13];
const APLT_BLUE   = [0.28, 0.62, 1];
const APLT_AMBER  = [1, 0.8, 0.45];

// Section: function _apltMakeGlowTexture().
function _apltMakeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const APLT_GLOW_TEX = _apltMakeGlowTexture();

function _apltSmoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Section: function apltMoveGeo().
function apltMoveGeo(lat, lon, bearingDeg, distM) {
  const rad = Units.degToRad(bearingDeg);
  return offsetGeo(lat, lon, Math.sin(rad) * distM, Math.cos(rad) * distM);
}
// Ground elevation in scene units.
function apltGroundY(lat, lon) {
  return terrainHeightBest(lat, lon) * DEM_EXAG * Y_SCALE;
}
// Handle function apltWorldPos().
function apltWorldPos(lat, lon, hAboveGroundM) {
  const [x, zNorth] = latLonToWorld(lat, lon);
  return { x, y: apltGroundY(lat, lon) + (hAboveGroundM || 0) * Y_SCALE, z: -zNorth };
}
// Handle function apltHeadingToYawRad().
function apltHeadingToYawRad(headingDeg) {
  return Units.degToRad((180 - headingDeg + 360) % 360);
}

// Implementation note.
async function apltFetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}
function apltPick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) { const v = obj[k]; if (v !== undefined && v !== null && v !== '') return v; }
  return undefined;
}
function apltUnwrapSingle(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json[0] || null;
  if (Array.isArray(json.data)) return json.data[0] || null;
  if (json.data && typeof json.data === 'object') return json.data;
  if (json.airport) return json.airport;
  if (Array.isArray(json.result)) return json.result[0] || null;
  if (json.result) return json.result;
  return json;
}
function apltUnwrapList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.airports)) return json.airports;
  if (Array.isArray(json.runways)) return json.runways;
  return [];
}
function apltGetLat(o)     { const v = apltPick(o, ['lat', 'latitude', 'latitude_deg']); return v !== undefined ? parseFloat(v) : NaN; }
function apltGetLon(o)     { const v = apltPick(o, ['lon', 'lng', 'longitude', 'longitude_deg']); return v !== undefined ? parseFloat(v) : NaN; }
function apltGetId(o)      { return apltPick(o, ['id', 'airport_id', 'ref']); }
function apltGetIdent(o)   { return apltPick(o, ['ident', 'icao', 'icao_code', 'gps_code']); }
function apltGetName(o)    { return apltPick(o, ['name', 'airport_name']) || '(brak nazwy)'; }
function apltGetIata(o)    { return apltPick(o, ['iata_code', 'iata']); }
function apltGetCountry(o) { return apltPick(o, ['iso_country', 'country']) || '?'; }
function apltGetElevFt(o)  { const v = apltPick(o, ['elevation_ft', 'elevation']); return v !== undefined ? parseFloat(v) : NaN; }

function apltRunwayFields(r) {
  return {
    rid:      apltPick(r, ['id']),
    lenFt:    parseFloat(apltPick(r, ['length_ft', 'runway_length_ft', 'length'])),
    widthFt:  parseFloat(apltPick(r, ['width_ft', 'runway_width_ft', 'width'])),
    closed:   apltPick(r, ['closed']),
    leIdent:  apltPick(r, ['le_ident']),
    leLat:    parseFloat(apltPick(r, ['le_latitude_deg', 'le_lat'])),
    leLon:    parseFloat(apltPick(r, ['le_longitude_deg', 'le_lon'])),
    leDispFt: parseFloat(apltPick(r, ['le_displaced_threshold_ft'])),
    heIdent:  apltPick(r, ['he_ident']),
    heLat:    parseFloat(apltPick(r, ['he_latitude_deg', 'he_lat'])),
    heLon:    parseFloat(apltPick(r, ['he_longitude_deg', 'he_lon'])),
    heDispFt: parseFloat(apltPick(r, ['he_displaced_threshold_ft'])),
  };
}
function apltIsClosed(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes'; }
function apltDedupeRunways(list) {
  const seen = new Set(), out = [];
  for (const r of list) {
    const key = r.rid != null ? ('id:' + r.rid) : `${r.leIdent}-${r.heIdent}-${r.lenFt}-${r.leLat}-${r.leLon}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}
async function apltApiSearchByCode(code) {
  const json = await apltFetchJSON(`${APLT_WKR_API}?action=code&code=${encodeURIComponent(code)}`);
  const obj = apltUnwrapSingle(json);
  if (obj && !isNaN(apltGetLat(obj)) && !isNaN(apltGetLon(obj))) return obj;
  return null;
}
// Handle function apltApiSearchText().
async function apltApiSearchText(q) {
  const json = await apltFetchJSON(`${APLT_WKR_API}?action=search&q=${encodeURIComponent(q)}&limit=8`);
  return apltUnwrapList(json);
}
async function apltApiRunways(id) {
  const json = await apltFetchJSON(`${APLT_WKR_API}?action=runways&id=${encodeURIComponent(id)}`);
  return apltUnwrapList(json);
}
async function apltResolveRunways(airportObj, apiId) {
  let raw = [];
  if (airportObj && Array.isArray(airportObj.runways) && airportObj.runways.length) raw = airportObj.runways;
  else if (apiId) raw = await apltApiRunways(apiId);
  return apltDedupeRunways(raw.map(apltRunwayFields)).filter(r => !apltIsClosed(r.closed));
}

// Section: function apltAreaQuery().
function apltAreaQuery(icao) {
  return `[out:json][timeout:25];area["icao"="${icao}"]->.a;(node(area.a)["aeroway"];way(area.a)["aeroway"];relation(area.a)["aeroway"];);out geom;`;
}
async function apltOverpassFetchOne(server, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.elements)) return null;
    return json.elements; // Implementation note.
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Handle function apltOverpassRacePass().
function apltOverpassRacePass(query) {
  return new Promise(resolve => {
    let pending = APLT_OVERPASS_SERVERS.length;
    let fallbackEmpty = null;
    let settled = false;
    const finish = val => { if (!settled) { settled = true; resolve(val); } };
    for (const server of APLT_OVERPASS_SERVERS) {
      apltOverpassFetchOne(server, query).then(elements => {
        if (settled) return;
        if (elements && elements.length > 0) { finish(elements); return; }
        if (elements && elements.length === 0 && fallbackEmpty === null) fallbackEmpty = elements;
        pending--;
        if (pending === 0) finish(fallbackEmpty); // Implementation note.
      });
    }
  });
}

async function apltOverpassRun(query) {
  const MAX_PASSES = 3;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const result = await apltOverpassRacePass(query);
    if (result && result.length > 0) return result;
    if (pass === MAX_PASSES) return result || [];
    // Configure await.
    await new Promise(res => setTimeout(res, 800));
  }
  return [];
}
function apltClassifyElements(elements) {
  const out = { taxiways: [], aprons: [], runways: [], parkingPositions: [], papiNodes: [], holdingPositions: [] };
  for (const el of elements) {
    const tags = el.tags || {};
    const aeroway = tags.aeroway;
    if (!aeroway) continue;

    if (el.type === 'node') {
      if (typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
      if (aeroway === 'navigationaid' && tags.navigationaid === 'papi') {
        out.papiNodes.push({ lat: el.lat, lon: el.lon });
      } else if (aeroway === 'holding_position') {
        out.holdingPositions.push({ lat: el.lat, lon: el.lon });
      } else if (aeroway === 'parking_position' && tags.ref) {
        // Airport lighting note.
        out.parkingPositions.push({ ref: String(tags.ref), lat: el.lat, lon: el.lon, headingDeg: null });
      }
      continue;
    }

    let outerRings = [];
    if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
      outerRings = [el.geometry.map(p => ({ lat: p.lat, lon: p.lon }))];
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (!m.geometry || m.geometry.length < 2) continue;
        outerRings.push(m.geometry.map(p => ({ lat: p.lat, lon: p.lon })));
      }
    }
    if (!outerRings.length) continue;
    const isClosedRing = r => r.length > 2 &&
      Math.abs(r[0].lat - r[r.length - 1].lat) < 1e-6 &&
      Math.abs(r[0].lon - r[r.length - 1].lon) < 1e-6;

    if (aeroway === 'runway') {
      out.runways.push({ line: outerRings[0], tags });
    } else if (aeroway === 'apron') {
      if (isClosedRing(outerRings[0])) out.aprons.push({ outer: outerRings[0], tags });
      else out.taxiways.push({ line: outerRings[0], tags });
    } else if (aeroway === 'taxiway') {
      out.taxiways.push({ line: outerRings[0], tags });
    } else if (aeroway === 'parking_position' && tags.ref) {
      const ring = outerRings[0];
      if (isClosedRing(ring)) {
        // Configure lat.
        let lat = 0, lon = 0;
        for (const p of ring) { lat += p.lat; lon += p.lon; }
        lat /= ring.length; lon /= ring.length;
        out.parkingPositions.push({ ref: String(tags.ref), lat, lon, headingDeg: null });
      } else if (ring.length >= 2) {
        // Configure last.
        const last = ring[ring.length - 1], prev = ring[ring.length - 2];
        const headingDeg = geoBearing(prev.lat, prev.lon, last.lat, last.lon);
        out.parkingPositions.push({ ref: String(tags.ref), lat: last.lat, lon: last.lon, headingDeg });
      }
    }
  }
  return out;
}

// Section: function fetchAirportFullData().
async function fetchAirportFullData(icao, onProgress) {
  const airportObj = await apltApiSearchByCode(icao);
  if (onProgress) onProgress('searched', airportObj);
  const apiId = airportObj ? apltGetId(airportObj) : null;

  // Configure let.
  let [validRunways, elements] = await Promise.all([
    apltResolveRunways(airportObj, apiId),
    apltOverpassRun(apltAreaQuery(icao)),
  ]);
  const classified = apltClassifyElements(elements);

  if (!validRunways.length && classified.runways.length) {
    // Configure validRunways.
    validRunways = classified.runways.map(rw => {
      const line = rw.line, first = line[0], last = line[line.length - 1];
      const widthTag = parseFloat(rw.tags.width);
      const refParts = String(rw.tags.ref || '').split(/[\/;]/).map(s => s.trim()).filter(Boolean);
      return {
        rid: null, closed: false,
        lenFt: NaN, widthFt: !isNaN(widthTag) ? widthTag / 0.3048 : NaN,
        leIdent: refParts[0] || null, heIdent: refParts[1] || null,
        leLat: first.lat, leLon: first.lon, heLat: last.lat, heLon: last.lon,
        leDispFt: NaN, heDispFt: NaN,
      };
    });
  }
  if (onProgress) onProgress('done');
  return { airportObj, validRunways, classified };
}

// Section: function apltSampleLatLonPolyline().
function apltSampleLatLonPolyline(pts, spacing) {
  const out = [];
  let carried = 0, dist = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = geoDistM(a.lat, a.lon, b.lat, b.lon);
    if (segLen < 0.01) continue;
    const bearing = geoBearing(a.lat, a.lon, b.lat, b.lon);
    let d = carried;
    while (d < segLen) {
      const p = apltMoveGeo(a.lat, a.lon, bearing, d);
      out.push({ lat: p.lat, lon: p.lon, d: dist + d });
      d += spacing;
    }
    carried = d - segLen;
    dist += segLen;
  }
  return out;
}
// Handle function apltPolylineBearings().
function apltPolylineBearings(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    let bIn = null, bOut = null;
    if (i > 0) bIn = geoBearing(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    if (i < n - 1) bOut = geoBearing(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
    let b;
    if (bIn != null && bOut != null) {
      const r1 = Units.degToRad(bIn), r2 = Units.degToRad(bOut);
      b = Units.radToDeg(Math.atan2(Math.sin(r1) + Math.sin(r2), Math.cos(r1) + Math.cos(r2)));
    } else {
      b = bIn != null ? bIn : bOut;
    }
    out.push(((b || 0) + 360) % 360);
  }
  return out;
}

// Section: function apltMakePointsObject().
function apltMakePointsObject(items, size) {
  if (!items || !items.length) return null;
  const positions = new Float32Array(items.length * 3);
  const colors = new Float32Array(items.length * 3);
  for (let i = 0; i < items.length; i++) {
    positions[i * 3] = items[i].x;
    positions[i * 3 + 1] = items[i].y;
    positions[i * 3 + 2] = items[i].z;
    const c = items[i].color || APLT_WHITE;
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    map: APLT_GLOW_TEX, size, sizeAttenuation: true, vertexColors: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// Section: function apltBuildRunway().
function apltBuildRunway(r, acc, papi, approachMeta, papiNodes) {
  const widthM = !isNaN(r.widthFt) ? r.widthFt * 0.3048 : APLT_DEFAULT_RW_WIDTH;
  const half = widthM / 2;
  const bearingDeg = geoBearing(r.leLat, r.leLon, r.heLat, r.heLon);
  const runLenM = (!isNaN(r.lenFt) && r.lenFt > 0) ? r.lenFt * 0.3048 : geoDistM(r.leLat, r.leLon, r.heLat, r.heLon);
  const leDispM = (!isNaN(r.leDispFt) && r.leDispFt > 0) ? r.leDispFt * 0.3048 : 0;
  const heDispM = (!isNaN(r.heDispFt) && r.heDispFt > 0) ? r.heDispFt * 0.3048 : 0;

  const centerAt = d => apltMoveGeo(r.leLat, r.leLon, bearingDeg, d);
  const edgeAt = (d, sideSign) => { const c = centerAt(d); return apltMoveGeo(c.lat, c.lon, (bearingDeg + 90 * sideSign + 360) % 360, half); };

  // Configure ei.
  let ei = 0;
  for (let d = 0; d <= runLenM; d += APLT_RWY_EDGE_SPACING) {
    for (const side of [1, -1]) {
      const p = edgeAt(d, side);
      const distLE = d, distHE = runLenM - d;
      let color;
      if (leDispM > 0 && distLE < leDispM) color = (ei % 2 === 0) ? APLT_RED : APLT_YELLOW;
      else if (heDispM > 0 && distHE < heDispM) color = (ei % 2 === 0) ? APLT_RED : APLT_YELLOW;
      else if (Math.min(distLE, distHE) < APLT_CAUTION_ZONE) color = APLT_YELLOW;
      else color = APLT_WHITE;
      const wp = apltWorldPos(p.lat, p.lon, 0.4);
      acc.runwayEdge.push({ x: wp.x, y: wp.y, z: wp.z, color });
      ei++;
    }
  }

  // Configure addThresholdBar.
  const addThresholdBar = (d, color) => {
    const c = centerAt(d);
    for (let k = -2; k <= 2; k++) {
      const p = apltMoveGeo(c.lat, c.lon, (bearingDeg + 90 + 360) % 360, half * k / 2.2);
      const wp = apltWorldPos(p.lat, p.lon, 0.4);
      acc.threshold.push({ x: wp.x, y: wp.y, z: wp.z, color });
    }
  };
  if (leDispM > 0) { addThresholdBar(0, APLT_RED); addThresholdBar(leDispM, APLT_GREEN); }
  else addThresholdBar(0, APLT_GREEN);
  if (heDispM > 0) { addThresholdBar(runLenM, APLT_RED); addThresholdBar(runLenM - heDispM, APLT_GREEN); }
  else addThresholdBar(runLenM, APLT_GREEN);

  // Configure ci.
  let ci = 0;
  for (let d = 0; d <= runLenM; d += APLT_RWY_CL_SPACING) {
    const nearEnd = Math.min(d, runLenM - d);
    const color = nearEnd < APLT_CL_RED_ZONE ? APLT_RED
      : nearEnd < APLT_CL_REDWHITE_ZONE ? ((ci % 2 === 0) ? APLT_RED : APLT_WHITE)
      : APLT_WHITE;
    const c = centerAt(d);
    const wp = apltWorldPos(c.lat, c.lon, 0.35);
    acc.centerline.push({ x: wp.x, y: wp.y, z: wp.z, color });
    ci++;
  }

  // Configure d.
  for (const d of [0, runLenM]) {
    for (const side of [1, -1]) {
      const c = centerAt(d);
      const p = apltMoveGeo(c.lat, c.lon, (bearingDeg + 90 * side + 360) % 360, half * 1.2);
      const wp = apltWorldPos(p.lat, p.lon, 0.5);
      acc.reil.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_WHITE });
    }
  }

  // Configure findRealPapi.
  const findRealPapi = c => {
    let bestIdx = -1, bestD = APLT_PAPI_MATCH_TOL_M;
    for (let i = 0; i < papiNodes.length; i++) {
      const d = geoDistM(c.lat, c.lon, papiNodes[i].lat, papiNodes[i].lon);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    return bestIdx === -1 ? null : papiNodes.splice(bestIdx, 1)[0];
  };
  const addPapi = (thresholdD, travelDir) => {
    const c = centerAt(thresholdD);
    const real = findRealPapi(c);
    const perpDir = (travelDir - 90 + 360) % 360;
    const row = real || apltMoveGeo(c.lat, c.lon, perpDir, half + 12);
    const boxAngles = [2.5, 2.83, 3.17, 3.5];
    for (let i = 0; i < 4; i++) {
      // Boxes spread perpendicular to the runway (a real PAPI bar is a row running
      // sideways away from the runway edge), not along the runway bearing.
      const p = apltMoveGeo(row.lat, row.lon, perpDir, (i - 1.5) * 4.5);
      const elevM = terrainHeightBest(p.lat, p.lon);
      const wp = apltWorldPos(p.lat, p.lon, 0.8);
      papi.push({ lat: p.lat, lon: p.lon, elevM: elevM + 0.8, angleDeg: boxAngles[i], x: wp.x, y: wp.y, z: wp.z });
    }
  };
  addPapi(0, bearingDeg);
  addPapi(runLenM, (bearingDeg + 180) % 360);

  // Configure addApproach.
  const addApproach = (thresholdD, outwardBearing) => {
    const c = centerAt(thresholdD);
    let idx = 0;
    for (let d = APLT_APPROACH_SPACING; d <= APLT_APPROACH_LEN; d += APLT_APPROACH_SPACING) {
      const p = apltMoveGeo(c.lat, c.lon, outwardBearing, d);
      const wp = apltWorldPos(p.lat, p.lon, 0.4);
      acc.approach.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_WHITE });
      approachMeta.push({ seqIndex: idx });
      idx++;
    }
  };
  addApproach(0, (bearingDeg + 180) % 360);
  addApproach(runLenM, bearingDeg);

  // Configure addTdz.
  const addTdz = (thresholdD, intoSign) => {
    const tdzOffset = Math.min(half * 0.6, 15);
    for (let d = APLT_TDZ_START_M; d <= APLT_TDZ_LEN_M && d <= runLenM / 2; d += APLT_TDZ_SPACING_M) {
      const dist = thresholdD + intoSign * d;
      if (dist < 0 || dist > runLenM) continue;
      const c = centerAt(dist);
      for (const side of [1, -1]) {
        const p = apltMoveGeo(c.lat, c.lon, (bearingDeg + 90 * side + 360) % 360, tdzOffset);
        const wp = apltWorldPos(p.lat, p.lon, 0.35);
        acc.tdz.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_WHITE });
      }
    }
  };
  addTdz(0, 1);
  addTdz(runLenM, -1);
}

// Handle function apltPolylineLengthM().
function apltPolylineLengthM(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += geoDistM(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
  return len;
}

function apltBuildTaxiway(tw, edgeAcc, clAcc) {
  const pts = tw.line;
  if (!pts || pts.length < 2) return;
  const widthTag = parseFloat(tw.tags.width);
  const widthM = Math.max(APLT_MIN_TWY_WIDTH, !isNaN(widthTag) ? widthTag : APLT_DEFAULT_TWY_WIDTH) + APLT_TWY_WIDTH_PAD;
  const half = widthM / 2;
  const bearings = apltPolylineBearings(pts);

  // Configure includeEdges.
  const includeEdges = apltPolylineLengthM(pts) >= APLT_TWY_MIN_LEN_EDGES;

  if (includeEdges) {
    const leftPts = pts.map((p, i) => apltMoveGeo(p.lat, p.lon, (bearings[i] - 90 + 360) % 360, half));
    const rightPts = pts.map((p, i) => apltMoveGeo(p.lat, p.lon, (bearings[i] + 90 + 360) % 360, half));
    for (const side of [leftPts, rightPts]) {
      for (const p of apltSampleLatLonPolyline(side, APLT_TWY_EDGE_SPACING)) {
        const wp = apltWorldPos(p.lat, p.lon, 0.3);
        edgeAcc.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_BLUE });
      }
    }
  }
  for (const p of apltSampleLatLonPolyline(pts, APLT_TWY_CL_SPACING)) {
    const wp = apltWorldPos(p.lat, p.lon, 0.28);
    clAcc.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_GREEN });
  }
}

// Handle function apltDedupePoints().
function apltDedupePoints(items, cellSizeM) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = Math.round(it.x / cellSizeM) + '_' + Math.round(it.z / cellSizeM);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// Handle function apltFindNearestBearing().
function apltFindNearestBearing(lat, lon, taxiways) {
  let bestD = Infinity, bestBearing = 0;
  for (const tw of taxiways) {
    const pts = tw.line;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const midLat = (a.lat + b.lat) / 2, midLon = (a.lon + b.lon) / 2;
      const d = geoDistM(lat, lon, midLat, midLon);
      if (d < bestD) { bestD = d; bestBearing = geoBearing(a.lat, a.lon, b.lat, b.lon); }
    }
  }
  return bestBearing;
}

// Handle function apltBuildHoldingPosition().
function apltBuildHoldingPosition(hp, taxiways, rglAcc, rglMeta) {
  const bearing = apltFindNearestBearing(hp.lat, hp.lon, taxiways);
  for (const side of [1, -1]) {
    const p = apltMoveGeo(hp.lat, hp.lon, (bearing + 90 * side + 360) % 360, APLT_RGL_OFFSET_M);
    const wp = apltWorldPos(p.lat, p.lon, 0.6);
    rglAcc.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_YELLOW });
    rglMeta.push({ side });
  }
}

function apltBuildApron(ap, apronAcc) {
  const ring = ap.outer;
  if (!ring || ring.length < 3) return;
  let lat = 0, lon = 0;
  for (const p of ring) { lat += p.lat; lon += p.lon; }
  lat /= ring.length; lon /= ring.length;
  const wp = apltWorldPos(lat, lon, 0.5);
  apronAcc.push({ x: wp.x, y: wp.y, z: wp.z, color: APLT_AMBER });
}

// Section: function apltBuildAll().
function apltBuildAll(validRunways, classified) {
  const acc = { runwayEdge: [], threshold: [], centerline: [], reil: [], approach: [], tdz: [] };
  const papi = [];
  const approachMeta = [];
  const papiNodes = (classified.papiNodes || []).slice(); // Configure r.

  for (const r of validRunways) {
    if (isNaN(r.leLat) || isNaN(r.leLon) || isNaN(r.heLat) || isNaN(r.heLon)) continue;
    apltBuildRunway(r, acc, papi, approachMeta, papiNodes);
  }

  const taxiwayEdge = [], taxiwayCenterline = [];
  for (const tw of classified.taxiways) apltBuildTaxiway(tw, taxiwayEdge, taxiwayCenterline);
  // Configure taxiwayEdgeClean.
  const taxiwayEdgeClean = apltDedupePoints(taxiwayEdge, APLT_DEDUPE_CELL_M);
  const taxiwayCenterlineClean = apltDedupePoints(taxiwayCenterline, APLT_DEDUPE_CELL_M);

  const apron = [];
  for (const ap of classified.aprons) apltBuildApron(ap, apron);

  // Configure rgl.
  const rgl = [], rglMeta = [];
  for (const hp of (classified.holdingPositions || [])) apltBuildHoldingPosition(hp, classified.taxiways, rgl, rglMeta);

  const group = new THREE.Group();
  const fadeMaterials = [];
  const addPts = (items, size) => {
    const pts = apltMakePointsObject(items, size);
    if (pts) { group.add(pts); fadeMaterials.push(pts.material); }
    return pts;
  };

  addPts(acc.runwayEdge, 6);
  addPts(acc.threshold, 8);
  addPts(acc.centerline, 4);
  addPts(acc.tdz, 5);
  addPts(taxiwayEdgeClean, 5);
  addPts(taxiwayCenterlineClean, 4);
  addPts(apron, 46);
  const reilPts = addPts(acc.reil, 10);
  const approachPts = addPts(acc.approach, 6);
  // Configure rglPts.
  const rglPts = apltMakePointsObject(rgl, 7);
  if (rglPts) group.add(rglPts);

  // Configure p.
  for (const p of papi) {
    const mat = new THREE.SpriteMaterial({
      map: APLT_GLOW_TEX, color: 0xffffff, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.set(p.x, p.y, p.z);
    spr.scale.set(10, 10, 1);
    group.add(spr);
    p.sprite = spr;
  }

  // Configure beacon.
  let beacon = null;
  if (validRunways.length) {
    const midR = validRunways[0];
    const cLat = (midR.leLat + midR.heLat) / 2, cLon = (midR.leLon + midR.heLon) / 2;
    const bp = apltWorldPos(cLat, cLon, 18);
    const bmat = new THREE.SpriteMaterial({
      map: APLT_GLOW_TEX, color: 0xffffff, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    beacon = new THREE.Sprite(bmat);
    beacon.position.set(bp.x, bp.y, bp.z);
    beacon.scale.set(14, 14, 1);
    group.add(beacon);
  }

  return { group, papi, dynamic: { fadeMaterials, reilPts, approachPts, approachMeta, beacon, rglPts, rglMeta } };
}

// Section: AIRPORT_LIGHTS_CACHE.
const AIRPORT_LIGHTS_CACHE = new Map();
let apltCurrentGroup   = null;
let apltCurrentPapi    = [];
let apltCurrentDynamic = null;
let apltLoadEpoch      = 0;

// Handle function loadAirportLights().
async function loadAirportLights(icao, preFetched, onProgress) {
  if (!icao) return;
  const epoch = ++apltLoadEpoch;

  if (apltCurrentGroup) { scene.remove(apltCurrentGroup); apltCurrentGroup = null; }
  apltCurrentPapi = [];
  apltCurrentDynamic = null;

  if (AIRPORT_LIGHTS_CACHE.has(icao)) {
    const cached = AIRPORT_LIGHTS_CACHE.get(icao);
    scene.add(cached.group);
    apltCurrentGroup = cached.group;
    apltCurrentPapi = cached.papi;
    apltCurrentDynamic = cached.dynamic;
    return;
  }

  // Configure knownApt.
  const knownApt = AIRPORTS[icao];
  const prefetchLat = knownApt ? knownApt.refLat : refLat;
  const prefetchLon = knownApt ? knownApt.refLon : refLon;

  try {
    // Configure await.
    await Promise.all([
      prefetchDEM(prefetchLat, prefetchLon, 3, 17),
      prefetchDEM(prefetchLat, prefetchLon, 4, 15),
    ]);
    if (epoch !== apltLoadEpoch) return; // Configure data.

    const data = preFetched || await fetchAirportFullData(icao, onProgress);
    if (epoch !== apltLoadEpoch) return;

    const built = apltBuildAll(data.validRunways, data.classified);
    AIRPORT_LIGHTS_CACHE.set(icao, built);
    scene.add(built.group);
    apltCurrentGroup = built.group;
    apltCurrentPapi = built.papi;
    apltCurrentDynamic = built.dynamic;
  } catch (e) {
    console.error('[airport-lights] Nie udało się wczytać świateł lotniska', icao, e);
  }
}

// Section: function updateAirportLights().
function updateAirportLights() {
  if (!apltCurrentDynamic) return;
  const dyn = apltCurrentDynamic;

  // Configure nf.
  const nf = (typeof SkyState !== 'undefined') ? SkyState.nightFactor : 1;
  const opacity = _apltSmoothstep(0.12, 0.55, nf);
  for (const mat of dyn.fadeMaterials) mat.opacity = opacity;

  // Configure if.
  if (dyn.reilPts) {
    const phase = performance.now() % 1000;
    dyn.reilPts.material.opacity = (phase < 120 ? 1 : 0.05) * opacity;
  }

  // Configure if.
  if (dyn.approachPts && dyn.approachMeta.length) {
    const colAttr = dyn.approachPts.geometry.getAttribute('color');
    let maxIdx = 0;
    for (const m of dyn.approachMeta) if (m.seqIndex > maxIdx) maxIdx = m.seqIndex;
    const period = 900;
    const frac = (performance.now() % period) / period;
    const activeIdx = Math.floor(frac * (maxIdx + 4));
    for (let i = 0; i < dyn.approachMeta.length; i++) {
      const idx = dyn.approachMeta[i].seqIndex;
      const lit = idx === activeIdx || idx === activeIdx - 1;
      const b = lit ? 1 : 0.12;
      colAttr.array[i * 3] = b; colAttr.array[i * 3 + 1] = b; colAttr.array[i * 3 + 2] = b;
    }
    colAttr.needsUpdate = true;
  }

  // Configure if.
  if (dyn.rglPts && dyn.rglMeta.length) {
    const colAttr = dyn.rglPts.geometry.getAttribute('color');
    const phase = Math.floor(performance.now() / 500) % 2;
    for (let i = 0; i < dyn.rglMeta.length; i++) {
      const on = ((dyn.rglMeta[i].side > 0) ? 0 : 1) === phase;
      const b = on ? 1 : 0.12;
      colAttr.array[i * 3] = APLT_YELLOW[0] * b;
      colAttr.array[i * 3 + 1] = APLT_YELLOW[1] * b;
      colAttr.array[i * 3 + 2] = APLT_YELLOW[2] * b;
    }
    colAttr.needsUpdate = true;
  }

  // Configure if.
  if (dyn.beacon) {
    const cyc = (performance.now() / 1000) % 2;
    let color = APLT_WHITE, flashOn = false;
    if (cyc < 0.12) { color = APLT_GREEN; flashOn = true; }
    else if (cyc > 1.0 && cyc < 1.12) { color = APLT_WHITE; flashOn = true; }
    dyn.beacon.material.color.setRGB(color[0], color[1], color[2]);
    dyn.beacon.material.opacity = flashOn ? Math.max(opacity, 0.35) : Math.max(opacity * 0.08, 0.03);
  }

  // Configure if.
  if (apltCurrentPapi.length && activeEntity) {
    const ac = activeEntity;
    for (const p of apltCurrentPapi) {
      const horiz = geoDistM(p.lat, p.lon, ac.lat, ac.lon);
      const vert = ac.altM - p.elevM;
      const angleDeg = Units.radToDeg(Math.atan2(vert, Math.max(1, horiz)));
      const diff = angleDeg - p.angleDeg;
      let r, g, b;
      if (diff > 0.08) { r = 1; g = 1; b = 1; }
      else if (diff < -0.08) { r = 1; g = 0.13; b = 0.13; }
      else { r = 1; g = 0.55; b = 0.6; } // Airport lighting note.
      p.sprite.material.color.setRGB(r, g, b);
    }
  }
}
