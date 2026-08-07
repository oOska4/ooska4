'use strict';

// OSM building config
const BLDG_ZOOM      = 15;
const BLDG_RADIUS    = 2;
const BLDG_MAX_DIST  = 80_000;
const BLDG_MIN_DIST  = 0;
const BLDG_TIMEOUT   = 12_000;
const BLDG_SCENE_MAX = 6;
const BLDG_CACHE_MAX = 14;
const COLOR_SAT_ZOOM = 15;

const BLDG_KEY  = '59fcc2e8';
const BLDG_URLS = ['a', 'b', 'c'].map(s =>
  `https://${s}.data.osmbuildings.org/0.2/${BLDG_KEY}/tile/{z}/{x}/{y}.json`);

// One shared material for all buildings (vertex colors)
const buildingMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide });

const buildingMeshes = new Map();
const buildingOrder  = [];
const buildingCache  = new Map();
let lastBldgKey = null;
let bldgCtrl    = new AbortController();
let bldgEpoch   = 0;

// Building tile management

function evictBldgTile(k) {
  const m = buildingMeshes.get(k);
  if (!m) return;
  scene.remove(m);
  m.geometry.dispose();
  buildingMeshes.delete(k);
  const i = buildingOrder.indexOf(k);
  if (i !== -1) buildingOrder.splice(i, 1);
}

function clearAllBldg() {
  for (const k of [...buildingMeshes.keys()]) evictBldgTile(k);
}

function registerBldgTile(k, m) {
  if (buildingMeshes.has(k)) evictBldgTile(k);
  buildingMeshes.set(k, m);
  buildingOrder.push(k);
  while (buildingOrder.length > BLDG_SCENE_MAX) evictBldgTile(buildingOrder[0]);
}

function putBldgCache(k, items) {
  if (buildingCache.has(k)) buildingCache.delete(k);
  buildingCache.set(k, items);
  while (buildingCache.size > BLDG_CACHE_MAX)
    buildingCache.delete(buildingCache.keys().next().value);
}

// Helpers

function sampleDemHeight(dem, lat, lon, zoom) {
  if (!dem) return 0;
  const n  = 1 << zoom;
  const lr = lat * Math.PI / 180;
  const xf = (lon + 180) / 360 * n;
  const yf = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const px = Math.max(0, Math.min(255, Math.floor((xf - Math.floor(xf)) * 255)));
  const py = Math.max(0, Math.min(255, Math.floor((yf - Math.floor(yf)) * 255)));
  return Math.max(0, dem[py * 256 + px]) * DEM_EXAG * Y_SCALE;
}

function buildingColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const ranges  = [[15, 45], [25, 55], [200, 230], [30, 50], [10, 40]];
  const range   = ranges[Math.abs(h) % ranges.length];
  const hue     = range[0] + ((h >> 8)  & 0xff) / 255 * (range[1] - range[0]);
  const sat     = 8  + ((h >> 16) & 0xff) / 255 * 22;
  const lit     = 52 + ((h >> 4)  & 0xff) / 255 * 28;
  const s = sat / 100, l = lit / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x2 = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if      (hue < 60)  { r = c;  g = x2; b = 0;  }
  else if (hue < 120) { r = x2; g = c;  b = 0;  }
  else if (hue < 180) { r = 0;  g = c;  b = x2; }
  else if (hue < 240) { r = 0;  g = x2; b = c;  }
  else if (hue < 300) { r = x2; g = 0;  b = c;  }
  else                { r = c;  g = 0;  b = x2; }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

function extrudeBldgInto(positions, colors, indices, points, height, baseY, colorHex) {
  if (!points || points.length < 3) return;
  const r = ((colorHex >> 16) & 0xff) / 255;
  const g = ((colorHex >> 8)  & 0xff) / 255;
  const b = ( colorHex        & 0xff) / 255;
  const scaledH = Math.max(1, height) * Y_SCALE;
  const botY = baseY - 1, topY = baseY + scaledH;
  const base = positions.length / 3, n = points.length;
  const wp   = points.map(p => latLonToWorld(p[0], p[1]));
  for (const [wx, wz] of wp) { positions.push(wx, botY, -wz); colors.push(r * 0.4, g * 0.4, b * 0.4); }
  for (const [wx, wz] of wp) { positions.push(wx, topY, -wz); colors.push(r, g, b); }
  let cx = 0, cz = 0;
  for (const [wx, wz] of wp) { cx += wx; cz += wz; }
  cx /= n; cz /= n;
  const ri = base + 2 * n;
  positions.push(cx, topY, -cz);
  colors.push(Math.min(1, r * 1.15), Math.min(1, g * 1.15), Math.min(1, b * 1.15));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, b0 = base + i, b1 = base + j, t0 = base + n + i, t1 = base + n + j;
    indices.push(b0, b1, t1, b0, t1, t0);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(ri, base + n + i, base + n + j);
  }
}

function buildBatchMesh(items) {
  const pos = [], col = [], idx = [];
  for (const it of items) extrudeBldgInto(pos, col, idx, it.points, it.height, it.baseY, it.colorHex);
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, buildingMat);
}

async function fetchBldgJson(url, signal, ms = BLDG_TIMEOUT) {
  const tc  = new AbortController();
  const tid = setTimeout(() => tc.abort(), ms);
  signal.addEventListener('abort', () => tc.abort(), { once: true });
  try {
    const r = await fetch(url, { method: 'GET', mode: 'cors', signal: tc.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    if (signal.aborted) throw e;
    if (e?.name === 'AbortError') return null;
    throw e;
  } finally { clearTimeout(tid); }
}

function geoRingToLatLon(ring) {
  const pts = [];
  for (const c of ring || []) {
    if (!Array.isArray(c) || c.length < 2) continue;
    pts.push([c[1], c[0]]);
  }
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  }
  return pts;
}

function parseBldgHeight(tags) {
  if (tags?.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (Number.isFinite(h) && h > 0) return h;
  }
  if (tags?.['building:levels']) {
    const lv = parseFloat(String(tags['building:levels']).replace(',', '.'));
    if (Number.isFinite(lv) && lv > 0) return Math.max(4, lv * 3);
  }
  return 8;
}

// Main building-loading function

async function loadBuildings(lat, lon, camGroundDist) {
  const shouldShow = camGroundDist <= BLDG_MAX_DIST && camGroundDist >= BLDG_MIN_DIST;
  if (!shouldShow) {
    if (buildingMeshes.size > 0) { clearAllBldg(); lastBldgKey = null; }
    return;
  }
  const [cx, cy] = deg2tile(lat, lon, BLDG_ZOOM);
  const bKey = `${BLDG_ZOOM}_${cx}_${cy}`;
  if (bKey === lastBldgKey && buildingMeshes.has(bKey)) return;
  lastBldgKey = bKey;
  bldgCtrl.abort();
  bldgCtrl  = new AbortController();
  bldgEpoch++;
  const epoch = bldgEpoch, sig = bldgCtrl.signal;

  // Fast path: cached data
  if (buildingCache.has(bKey)) {
    const cached = buildingCache.get(bKey);
    buildingCache.delete(bKey);
    buildingCache.set(bKey, cached);
    const m = buildBatchMesh(cached);
    if (m) { scene.add(m); registerBldgTile(bKey, m); }
    return;
  }

  try {
    const tileCoords = [];
    for (let dy = -BLDG_RADIUS; dy <= BLDG_RADIUS; dy++)
      for (let dx = -BLDG_RADIUS; dx <= BLDG_RADIUS; dx++)
        tileCoords.push([cx + dx, cy + dy]);

    const jsonResults = await Promise.all(tileCoords.map(async ([tx, ty]) => {
      for (const tpl of BLDG_URLS) {
        const url = tpl.replace('{z}', BLDG_ZOOM).replace('{x}', tx).replace('{y}', ty);
        let data;
        try { data = await fetchBldgJson(url, sig); } catch (e) { if (e?.name === 'AbortError') throw e; continue; }
        if (data) return { tx, ty, data };
      }
      return null;
    }));
    if (epoch !== bldgEpoch || sig.aborted) return;

    // Parse building GeoJSON
    const raw = [];
    for (const res of jsonResults) {
      if (!res) continue;
      const { tx, ty, data } = res;
      const features = Array.isArray(data.features) ? data.features : [];
      let li = 0;
      for (const f of features) {
        const props  = f.properties || {};
        const height = parseBldgHeight(props) * BUILDING_H_SCALE;
        const geom   = f.geometry || {};
        const parts  = [];
        if      (geom.type === 'Polygon')      parts.push(geom.coordinates);
        else if (geom.type === 'MultiPolygon') parts.push(...geom.coordinates);
        else continue;
        for (const poly of parts) {
          if (!poly?.length || !poly[0] || poly[0].length < 3) continue;
          const ring = geoRingToLatLon(poly[0]);
          if (ring.length < 3) continue;
          raw.push({ id: `b_${tx}_${ty}_${f.id ?? (props.osm_id ?? li++)}`, ring, height, center: polygonCenter(ring) });
        }
      }
    }
    if (epoch !== bldgEpoch || sig.aborted) return;

    // Fetch DEM + color pixels for buildings
    const satZ    = activeTileZoom ?? COLOR_SAT_ZOOM;
    const demKeys = new Set(), satKeys = new Set();
    for (const b of raw) {
      const [cl, co] = b.center;
      const [dtx, dty] = deg2tile(cl, co, BLDG_ZOOM);
      demKeys.add(`${BLDG_ZOOM}_${dtx}_${dty}`);
      const { tx: stx, ty: sty } = latLonToTilePixel(cl, co, satZ);
      satKeys.add(`${satZ}_${stx}_${sty}`);
    }
    await Promise.all([
      ...[...demKeys].map(k => { const [z, x, y] = k.split('_').map(Number); return loadDemData(z, x, y, sig); }),
      ...[...satKeys].map(k => { const [z, x, y] = k.split('_').map(Number); return loadTilePixels(z, x, y, sig); }),
    ]);
    if (epoch !== bldgEpoch || sig.aborted) return;

    // Build data ready for extrusion
    const items = [];
    for (const b of raw) {
      const [cl, co] = b.center;
      const [dtx, dty] = deg2tile(cl, co, BLDG_ZOOM);
      const dem = demDataCache.get(`${BLDG_ZOOM}_${dtx}_${dty}`) ?? null;
      if (!dem) continue;
      const baseY = sampleDemHeight(dem, cl, co, BLDG_ZOOM);
      const { tx: stx, ty: sty, px, py } = latLonToTilePixel(cl, co, satZ);
      const pixels   = colorPixelCache.get(`${satZ}_${stx}_${sty}`) ?? null;
      const colorHex = pixels ? samplePixelColor(pixels, px, py) : buildingColor(b.id);
      items.push({ id: b.id, points: b.ring, height: b.height, baseY, colorHex });
    }
    putBldgCache(bKey, items);
    const m = buildBatchMesh(items);
    if (m) { scene.add(m); registerBldgTile(bKey, m); }

  } catch (e) { if (e?.name !== 'AbortError') console.error('[buildings]', e); }
}
