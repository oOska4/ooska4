'use strict';

// Section: DEM_URL.
const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SAT_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const SAT_OSM = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

// Cache DEM
const demDataCache  = new Map();
const demInflight   = new Map();
const DEM_CACHE_MAX = 900;

// Timeout dla fetch() - bez tego, przy niestabilnym/wolnym internecie, fetch
// moze "wisiec" w nieskonczonosc (bez bledu, bez timeoutu przegladarki w
// rozsadnym czasie) i zarazic demInflight/colorPixelInfl cache martwym
// promise na zawsze (bo .delete(key) odpala sie dopiero PO zakonczeniu
// fetcha - ktore nigdy nie nastapi). Objaw: ekran ladowania stoi w miejscu,
// zero bledow w konsoli. Po timeout traktujemy to tak samo jak zwykly blad
// sieci (catch lapie AbortError, zwraca null -> istniejacy fallback: plaski
// zielony teren / brak tekstury).
const FETCH_TIMEOUT_MS = 15000;

function _withTimeout(signal, ms) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const t = setTimeout(() => ac.abort(), ms);
  return {
    signal: ac.signal,
    cleanup: () => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); },
  };
}

async function loadImageBlob(url, signal) {
  const startedAt = performance.now();
  if (typeof simLoadLog === 'function') simLoadLog('image:fetch:start', url);
  const { signal: combinedSignal, cleanup } = _withTimeout(signal, FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { mode: 'cors', signal: combinedSignal });
    if (!r.ok) {
      if (typeof simLoadLog === 'function') simLoadLog('image:fetch:http-error', `${r.status} ${url}`);
      return null;
    }
    const objectUrl = URL.createObjectURL(await r.blob());
    if (typeof simLoadLog === 'function') simLoadLog('image:fetch:done', `${Math.round(performance.now() - startedAt)}ms ${url}`);
    return objectUrl;
  } catch (e) {
    if (typeof simLoadError === 'function') simLoadError(`image:fetch:failed ${url}`, e);
    return null;
  }
  finally { cleanup(); }
}

function _decodeDEM(src) {
  return new Promise(res => {
    if (typeof simLoadLog === 'function') simLoadLog('dem:image:start');
    const img = new Image();
    img.onload = () => {
      try {
        const cv2 = document.createElement('canvas');
        cv2.width = cv2.height = 256;
        cv2.getContext('2d').drawImage(img, 0, 0);
        const px = cv2.getContext('2d').getImageData(0, 0, 256, 256).data;
        const h  = new Float32Array(256 * 256);
        for (let i = 0; i < 256 * 256; i++)
          h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        // Configure SPK.
        const SPK = 200;
        for (let y = 1; y < 255; y++) for (let x = 1; x < 255; x++) {
          const i   = y * 256 + x;
          const avg = (h[i - 1] + h[i + 1] + h[i - 256] + h[i + 256]) * 0.25;
          if (Math.abs(h[i] - avg) > SPK) h[i] = avg;
        }
        URL.revokeObjectURL(src);
        if (typeof simLoadLog === 'function') simLoadLog('dem:image:done');
        res(h);
      } catch (e) {
        if (typeof simLoadError === 'function') simLoadError('dem:image:decode-failed', e);
        res(null);
      }
    };
    img.onerror = e => {
      if (typeof simLoadError === 'function') simLoadError('dem:image:error', e);
      URL.revokeObjectURL(src); res(null);
    };
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

function loadDemData(z, x, y, signal) {
  const key = `${z}_${x}_${y}`;
  if (demDataCache.has(key)) return Promise.resolve(demDataCache.get(key));
  if (demInflight.has(key))  return demInflight.get(key);
  const p = (async () => {
    if (typeof simLoadLog === 'function') simLoadLog('dem:tile:start', key);
    const src = await loadImageBlob(DEM_URL(z, x, y), signal);
    demInflight.delete(key);
    if (!src) {
      if (typeof simLoadLog === 'function') simLoadLog('dem:tile:empty', key);
      return null;
    }
    const dem = await _decodeDEM(src);
    if (dem) {
      demDataCache.set(key, dem);
      while (demDataCache.size > DEM_CACHE_MAX)
        demDataCache.delete(demDataCache.keys().next().value);
    }
    if (typeof simLoadLog === 'function') simLoadLog('dem:tile:done', `${key} ok=${!!dem}`);
    return dem;
  })();
  demInflight.set(key, p);
  return p;
}

function _sampleDem(src, lat, lon, zoom) {
  const n  = 1 << zoom;
  const lr = Math.PI / 180 * lat;
  const xf = (lon + 180) / 360 * n;
  const yf = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const tx = Math.floor(xf), ty = Math.floor(yf);
  // Configure pxf.
  const pxf = Math.max(0, Math.min(255.999, (xf - tx) * 256));
  const pyf = Math.max(0, Math.min(255.999, (yf - ty) * 256));
  return { tx, ty, px: pxf | 0, py: pyf | 0, pxf, pyf };
}

// Handle function _bilinearDem().
function _bilinearDem(dem, pxf, pyf) {
  const x0 = pxf | 0, y0 = pyf | 0;
  const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const fx = pxf - x0, fy = pyf - y0;
  const h00 = dem[y0 * 256 + x0], h10 = dem[y0 * 256 + x1];
  const h01 = dem[y1 * 256 + x0], h11 = dem[y1 * 256 + x1];
  const hx0 = h00 + (h10 - h00) * fx;
  const hx1 = h01 + (h11 - h01) * fx;
  return hx0 + (hx1 - hx0) * fy;
}

// Section: function terrainHeightM().

function terrainHeightM(lat, lon, zoom = 12) {
  const z = Math.min(zoom, 15);   // terrarium max zoom = 15
  const { tx, ty, pxf, pyf } = _sampleDem(null, lat, lon, z);
  const dem = demDataCache.get(`${z}_${tx}_${ty}`);
  if (!dem) return 0;
  return Math.max(0, _bilinearDem(dem, pxf, pyf));
}

function terrainHeightBest(lat, lon, zooms = [15, 14, 13, 12, 11, 10, 9, 8, 7]) {
  for (const z of zooms) {
    const { tx, ty, pxf, pyf } = _sampleDem(null, lat, lon, z);
    const dem = demDataCache.get(`${z}_${tx}_${ty}`);
    if (dem) return Math.max(0, _bilinearDem(dem, pxf, pyf));
  }
  return 0;
}

// Handle function terrainHeightWithZoom().
function terrainHeightWithZoom(lat, lon, zooms = [15, 14, 13, 12, 11, 10, 9, 8, 7]) {
  for (const z of zooms) {
    const { tx, ty, pxf, pyf } = _sampleDem(null, lat, lon, z);
    const dem = demDataCache.get(`${z}_${tx}_${ty}`);
    if (dem) return { h: Math.max(0, _bilinearDem(dem, pxf, pyf)), zoom: z };
  }
  return { h: 0, zoom: null };
}

async function terrainHeightMAsync(lat, lon, zoom = 12, signal = null) {
  const { tx, ty, pxf, pyf } = _sampleDem(null, lat, lon, zoom);
  const dem = await loadDemData(zoom, tx, ty, signal);
  if (!dem) return 0;
  return Math.max(0, _bilinearDem(dem, pxf, pyf));
}

function terrainHeightScene(lat, lon, zoom = 12) {
  return terrainHeightM(lat, lon, zoom) * DEM_EXAG * Y_SCALE;
}

async function prefetchDEM(lat, lon, radius = 2, zoom = 12, signal = null) {
  const z = Math.min(zoom, 15);
  const [cx, cy] = deg2tile(lat, lon, z);
  const promises = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++)
      promises.push(loadDemData(z, cx + dx, cy + dy, signal));
  await Promise.all(promises);
}

// Cache tekstur satelitarnych

const SAT_TEX_MAX        = 420;
const satTextureCache    = new Map();
const satTextureCacheKey = new WeakMap();

function getCachedSatTex(key) {
  if (!satTextureCache.has(key)) return null;
  const t = satTextureCache.get(key);
  satTextureCache.delete(key);
  satTextureCache.set(key, t);   // Configure return.
  return t;
}
function putCachedSatTex(key, t) {
  satTextureCacheKey.set(t, key);
  satTextureCache.set(key, t);
  while (satTextureCache.size > SAT_TEX_MAX)
    satTextureCache.delete(satTextureCache.keys().next().value);
}

const COLOR_PIX_MAX   = 900;
const colorPixelCache = new Map();
const colorPixelInfl  = new Map();

function latLonToTilePixel(lat, lon, z) {
  const n  = 1 << z;
  const lr = lat * Math.PI / 180;
  const xf = (lon + 180) / 360 * n;
  const yf = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
  const tx = Math.floor(xf), ty = Math.floor(yf);
  return {
    tx, ty,
    px: Math.max(0, Math.min(255, Math.floor((xf - tx) * 256))),
    py: Math.max(0, Math.min(255, Math.floor((yf - ty) * 256))),
  };
}

function samplePixelColor(pixels, px, py) {
  if (!pixels) return 0xb7b0a6;
  const i = (py * 256 + px) * 4;
  return (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
}

function loadTilePixels(z, x, y, signal) {
  const key = `${z}_${x}_${y}`;
  if (colorPixelCache.has(key)) return Promise.resolve(colorPixelCache.get(key));
  if (colorPixelInfl.has(key))  return colorPixelInfl.get(key);
  const p = (async () => {
    for (const url of [SAT_URL(z, x, y), SAT_OSM(z, x, y)]) {
      if (signal?.aborted) return null;
      const src = await loadImageBlob(url, signal);
      if (!src) continue;
      const pixels = await new Promise(res => {
        const img = new Image();
        img.onload = () => {
          try {
            const cv2 = document.createElement('canvas');
            cv2.width = cv2.height = 256;
            cv2.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, 256, 256);
            res(cv2.getContext('2d').getImageData(0, 0, 256, 256).data);
          } catch { res(null); }
          URL.revokeObjectURL(src);
        };
        img.onerror = () => { URL.revokeObjectURL(src); res(null); };
        img.crossOrigin = 'anonymous';
        img.src = src;
      });
      if (pixels) {
        colorPixelCache.set(key, pixels);
        while (colorPixelCache.size > COLOR_PIX_MAX)
          colorPixelCache.delete(colorPixelCache.keys().next().value);
        colorPixelInfl.delete(key);
        return pixels;
      }
    }
    colorPixelInfl.delete(key);
    return null;
  })();
  colorPixelInfl.set(key, p);
  return p;
}

async function loadSatTex(z, x, y, signal) {
  const key    = `${z}_${x}_${y}`;
  if (typeof simLoadLog === 'function') simLoadLog('sat:tile:start', key);
  const cached = getCachedSatTex(key);
  if (cached) return cached;
  for (const url of [SAT_URL(z, x, y), SAT_OSM(z, x, y)]) {
    const src = await loadImageBlob(url, signal);
    if (!src) continue;
    const result = await new Promise(res => {
      const img = new Image();
      img.onload = () => {
        try {
          const cv2 = document.createElement('canvas');
          cv2.width = cv2.height = 256;
          const ctx = cv2.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 256, 256);
          const pixels = ctx.getImageData(0, 0, 256, 256).data;
          if (!colorPixelCache.has(key)) {
            colorPixelCache.set(key, pixels);
            while (colorPixelCache.size > COLOR_PIX_MAX)
              colorPixelCache.delete(colorPixelCache.keys().next().value);
          }
          const tex = new THREE.CanvasTexture(cv2);
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          URL.revokeObjectURL(src);
          res(tex);
        } catch (e) {
          if (typeof simLoadError === 'function') simLoadError(`sat:image:decode-failed ${key}`, e);
          URL.revokeObjectURL(src);
          res(null);
        }
      };
      img.onerror = e => {
        if (typeof simLoadError === 'function') simLoadError(`sat:image:error ${key}`, e);
        URL.revokeObjectURL(src); res(null);
      };
      img.crossOrigin = 'anonymous';
      img.src = src;
    });
    if (result) {
      putCachedSatTex(key, result);
      if (typeof simLoadLog === 'function') simLoadLog('sat:tile:done', key);
      return result;
    }
  }
  if (typeof simLoadLog === 'function') simLoadLog('sat:tile:fallback-empty', key);
  return null;
}

// Build terrain meshes.

const TILE_LOAD_RADIUS = 4;

function gridForZoom(z) {
  if (z <= 9)  return 48;
  if (z <= 11) return 80;
  if (z <= 13) return 112;
  return 128;
}

const _MAX_G          = 128;
const _posBuf         = new Float32Array((_MAX_G + 1) * (_MAX_G + 1) * 3);
const _uvBuf          = new Float32Array((_MAX_G + 1) * (_MAX_G + 1) * 2);
const _idxCache       = new Map();
const _clipIdxCache   = new Map();
const CLIP_IDX_CACHE_MAX = 320;

function getIdxBuf(G) {
  if (_idxCache.has(G)) return _idxCache.get(G);
  const G1  = G + 1;
  const buf = new Uint32Array(G * G * 6);
  let i = 0;
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const v = r * G1 + c;
    buf[i++] = v; buf[i++] = v + G1; buf[i++] = v + G1 + 1;
    buf[i++] = v; buf[i++] = v + G1 + 1; buf[i++] = v + 1;
  }
  _idxCache.set(G, buf);
  return buf;
}

function clipSignature(boundsZ17) {
  return boundsZ17 ? `${boundsZ17.minX},${boundsZ17.maxX},${boundsZ17.minY},${boundsZ17.maxY}` : '';
}

function parseTileKey(key) {
  const [zoom, tx, ty] = key.split('_').map(Number);
  return { zoom, tx, ty };
}

function tileBoundsZ17(tx, ty, zoom) {
  const scale = 1 << (17 - zoom);
  return {
    minX: tx * scale,         maxX: (tx + 1) * scale - 1,
    minY: ty * scale,         maxY: (ty + 1) * scale - 1,
  };
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minY <= b.maxY && a.maxY >= b.minY;
}

function makeTerrainIndex(G, tx, ty, zoom, clipBoundsZ17) {
  if (!clipBoundsZ17) return getIdxBuf(G);
  const cacheKey = `${G}_${zoom}_${tx}_${ty}_${clipSignature(clipBoundsZ17)}`;
  if (_clipIdxCache.has(cacheKey)) {
    const idx = _clipIdxCache.get(cacheKey);
    _clipIdxCache.delete(cacheKey);
    _clipIdxCache.set(cacheKey, idx);
    return idx;
  }
  const G1           = G + 1;
  const shift        = 17 - zoom;
  const tileScaleZ17 = 1 << shift;
  const cellScaleZ17 = tileScaleZ17 / G;
  const tileX0       = tx * tileScaleZ17;
  const tileY0       = ty * tileScaleZ17;
  const clipMaxX     = clipBoundsZ17.maxX + 1;
  const clipMaxY     = clipBoundsZ17.maxY + 1;
  const idx          = [];
  for (let r = 0; r < G; r++) {
    const cy = tileY0 + (r + 0.5) * cellScaleZ17;
    for (let c = 0; c < G; c++) {
      const cx = tileX0 + (c + 0.5) * cellScaleZ17;
      if (cx >= clipBoundsZ17.minX && cx < clipMaxX &&
          cy >= clipBoundsZ17.minY && cy < clipMaxY) continue;
      const v = r * G1 + c;
      idx.push(v, v + G1, v + G1 + 1, v, v + G1 + 1, v + 1);
    }
  }
  const buf = new Uint32Array(idx);
  _clipIdxCache.set(cacheKey, buf);
  while (_clipIdxCache.size > CLIP_IDX_CACHE_MAX)
    _clipIdxCache.delete(_clipIdxCache.keys().next().value);
  return buf;
}

// ============================================================================
// Web Worker dla CPU-bound czesci buildMeshWithNeighbors (siatka + normalne).
// Profiling (window.simPerfReport()) pokazal ze ta praca potrafi zablokowac
// klatke na >120ms przy szybkim locie nisko nad nowym terenem - caly main
// thread (render, fizyka, input) czekal. Przeniesienie do Workera nie
// przyspiesza samych obliczen, ale przestaja one blokowac klatke - licza sie
// rownolegle. Formuly w js/sim-terrain-worker.js sa 1:1 skopiowane z kodu
// ponizej (fallback main-thread), zweryfikowane numerycznie w node (patrz
// notatka w .agents) - zero roznicy wzgledem oryginalnego computeVertexNormals.
//
// Fallback: jesli Worker sie nie da utworzyc (bardzo stara przegladarka,
// blad ladowania pliku), buildMeshWithNeighbors() cicho wraca do starej
// synchronicznej sciezki main-thread - gra dziala tak jak przed ta zmiana,
// tylko bez korzysci z odciazenia watku.
let _terrainWorker = null;
let _terrainWorkerId = 0;
const _terrainWorkerPending = new Map(); // id -> {resolve, reject}

function _initTerrainWorker() {
  try {
    const w = new Worker('js/sim-terrain-worker.js');
    w.onmessage = (e) => {
      const msg = e.data;
      const pending = _terrainWorkerPending.get(msg.id);
      if (!pending) return;
      _terrainWorkerPending.delete(msg.id);
      if (msg.ok) pending.resolve(msg);
      else pending.reject(new Error(msg.error));
    };
    w.onerror = (err) => {
      console.warn('[terrain worker] blad w trakcie dzialania, przelaczam na fallback main-thread:', err.message);
      _terrainWorker = null;
      for (const { reject } of _terrainWorkerPending.values()) reject(err);
      _terrainWorkerPending.clear();
    };
    return w;
  } catch (err) {
    console.warn('[terrain worker] niedostepny, uzywam main-thread fallback:', err);
    return null;
  }
}
_terrainWorker = _initTerrainWorker();

// Timeout obronny (patrz FETCH_TIMEOUT_MS wyzej) - w normalnych warunkach
// worker odpowiada w kilka ms, wiec to sie nigdy nie powinno uruchomic, ale
// gdyby z jakiegos powodu wiadomosc zaginela (np. blad przegladarki), lepiej
// spasc do fallbacku main-thread niz wisiec w nieskonczonosc.
const TERRAIN_WORKER_TIMEOUT_MS = 8000;

function _buildTerrainTileViaWorker(payload) {
  return new Promise((resolve, reject) => {
    const id = ++_terrainWorkerId;
    const t = setTimeout(() => {
      if (_terrainWorkerPending.delete(id)) reject(new Error('terrain worker timeout'));
    }, TERRAIN_WORKER_TIMEOUT_MS);
    _terrainWorkerPending.set(id, {
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject:  (e) => { clearTimeout(t); reject(e); },
    });
    _terrainWorker.postMessage({ id, ...payload });
  });
}

// Fallback main-thread - identyczny kod co przed refaktorem na Workera
// (dokladnie ta sama petla + THREE.js wlasny computeVertexNormals()).
function _buildTerrainTileMainThreadGeo({ GRID, px0, py0, subPx, x0, y0, dx, dy, dem, demR, demB, demC, index }) {
  const INV = 1 / GRID;
  const UV_IN = 0.5 / 256, UV_SC = 1 - 2 * UV_IN;
  let vi = 0, ui = 0;
  for (let r = 0; r <= GRID; r++) {
    for (let c = 0; c <= GRID; c++) {
      const u = c * INV, v = r * INV;
      let fpx = px0 + u * subPx;
      let fpy = py0 + v * subPx;
      let d   = dem;
      const crossR = fpx >= 256, crossB = fpy >= 256;
      if      (crossR && crossB) { d = demC; fpx -= 256; fpy -= 256; }
      else if (crossR)           { d = demR; fpx -= 256; }
      else if (crossB)           { d = demB; fpy -= 256; }
      let wz = 0;
      if (d) {
        const raw = d[Math.min(255, fpy | 0) * 256 + Math.min(255, fpx | 0)];
        if (raw > 0) wz = raw * DEM_EXAG * Y_SCALE;
      }
      _posBuf[vi++] = x0 + u * dx;
      _posBuf[vi++] = wz;
      _posBuf[vi++] = -(y0 + v * dy);
      _uvBuf[ui++]  = UV_IN + u * UV_SC;
      _uvBuf[ui++]  = UV_IN + (1 - v) * UV_SC;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(_posBuf.slice(0, vi), 3));
  g.setAttribute('uv',       new THREE.BufferAttribute(_uvBuf.slice(0, ui), 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

async function buildMeshWithNeighbors(tx, ty, satZoom, signal, clipBoundsZ17 = null) {
  const demZoom = Math.min(satZoom, 15);
  const shift   = satZoom - demZoom;
  const scale   = 1 << shift;
  const dtx     = tx >> shift;
  const dty     = ty >> shift;
  const subPx   = 256 >> shift;
  const px0     = (tx - dtx * scale) * subPx;
  const py0     = (ty - dty * scale) * subPx;

  const [dem, demR, demB, demC] = await Promise.all([
    loadDemData(demZoom, dtx,     dty,     signal),
    loadDemData(demZoom, dtx + 1, dty,     signal),
    loadDemData(demZoom, dtx,     dty + 1, signal),
    loadDemData(demZoom, dtx + 1, dty + 1, signal),
  ]);

  const GRID = gridForZoom(satZoom);
  const [lat1, lon1] = tile2deg(tx,     ty,     satZoom);
  const [lat2, lon2] = tile2deg(tx + 1, ty + 1, satZoom);
  const cosRef = Math.cos(Units.degToRad(refLat));
  const x0 = (lon1 - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const y0 = (lat1 - refLat) * Math.PI / 180 * EARTH_RADIUS;
  const dx = (lon2 - lon1)   * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const dy = (lat2 - lat1)   * Math.PI / 180 * EARTH_RADIUS;
  // makeTerrainIndex jest cache'owany (patrz _idxCache/_clipIdxCache powyzej)
  // i nie zalezy od position/uv, wiec bezpiecznie liczymy go tu, przed
  // rozgalezieniem worker/fallback - obie sciezki go potrzebuja.
  const index = makeTerrainIndex(GRID, tx, ty, satZoom, clipBoundsZ17);

  if (_terrainWorker) {
    // Sciezka Worker - main thread NIE blokuje sie na tej pracy (moze dalej
    // renderowac klatki/obslugiwac input w trakcie liczenia siatki w tle).
    const t0 = performance.now();
    try {
      const msg = await _buildTerrainTileViaWorker({
        GRID, px0, py0, subPx, x0, y0, dx, dy, dem, demR, demB, demC,
        demExag: DEM_EXAG, yScale: Y_SCALE, index,
      });
      if (typeof _perfRecord === 'function') {
        // "roundtrip" to czas oczekiwania z perspektywy wywolujacego - NIE
        // blokuje klatki (main thread jest wolny w tym czasie), w
        // przeciwienstwie do dawnej metryki 'terrainMeshBuild'. 'workerCompute'
        // to czysty czas liczenia w workerze (do analizy WASM w workerze).
        _perfRecord('terrainMeshBuild_roundtrip_nieBlokujeKlatki', performance.now() - t0);
        _perfRecord('terrainMeshBuild_workerCompute', msg.computeMs);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(msg.position, 3));
      g.setAttribute('uv',       new THREE.BufferAttribute(msg.uv, 2));
      g.setAttribute('normal',   new THREE.BufferAttribute(msg.normal, 3));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      return g;
    } catch (err) {
      console.warn('[terrain worker] blad przy budowie kafla, fallback main-thread:', err);
      // spadamy do fallbacku ponizej
    }
  }

  // Fallback: Worker niedostepny lub zwrocil blad - stara sciezka main-thread.
  const _perfWrap = (typeof _perfTime === 'function') ? _perfTime : (name, fn) => fn();
  return _perfWrap('terrainMeshBuild', () => _buildTerrainTileMainThreadGeo({
    GRID, px0, py0, subPx, x0, y0, dx, dy, dem, demR, demB, demC, index,
  }));
}

// Section: tileMeshes.

const tileMeshes   = new Map();   // "zoom_tx_ty" → Mesh
const loadingTiles = new Set();   // Configure tileAbort.
const tileAbort    = new Map();   // "zoom_tx_ty" → AbortController
const tileClipSig  = new Map();   // "zoom_tx_ty" → clip signature
let   tileEpoch    = 0;

let activeTileZoom = 13;

const DIST_DISABLE_Z17 = 4_000;
const DIST_DISABLE_Z15 = 20_000;
const DIST_DISABLE_Z13 = 150_000;
const DIST_DISABLE_Z11 = 600_000;

function getZoom(dist) {
  if (dist < DIST_DISABLE_Z17) return 17;
  if (dist < DIST_DISABLE_Z15) return 15;
  if (dist < DIST_DISABLE_Z13) return 13;
  if (dist < DIST_DISABLE_Z11) return 11;
  return 9;
}

function disposeMesh(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (mesh.material.map) {
    const ck = satTextureCacheKey.get(mesh.material.map);
    if (!ck || satTextureCache.get(ck) !== mesh.material.map)
      mesh.material.map.dispose();
  }
  mesh.material.dispose();
}

async function loadTile(tx, ty, zoom, clipBoundsZ17 = null) {
  const key = `${zoom}_${tx}_${ty}`;
  if (tileMeshes.has(key) || loadingTiles.has(key)) return;
  loadingTiles.add(key);
  tileClipSig.set(key, clipSignature(clipBoundsZ17));
  const epoch = tileEpoch;
  const ac    = new AbortController();
  tileAbort.set(key, ac);
  const sig   = ac.signal;
  try {
    const [geo, tex] = await Promise.all([
      buildMeshWithNeighbors(tx, ty, zoom, sig, clipBoundsZ17),
      loadSatTex(zoom, tx, ty, sig),
    ]);
    if (epoch !== tileEpoch || sig.aborted) return;
    const mat = new THREE.MeshPhongMaterial({
      map:      tex || null,
      color:    tex ? 0xffffff : 0x5a8a50,
      specular: 0x000000, // Implementation note.
      shininess: 0,
    });
    // Configure mat.userData.baseColor.
    mat.userData.baseColor = mat.color.clone();
    // Configure mat.polygonOffset.
    mat.polygonOffset       = true;
    mat.polygonOffsetFactor = (17 - zoom) * 1;
    mat.polygonOffsetUnits  = (17 - zoom) * 1;
    const mesh       = new THREE.Mesh(geo, mat);
    mesh.renderOrder = zoom;   // Configure mesh.receiveShadow.
    mesh.receiveShadow = true;
    mesh.castShadow = (typeof shadowTerrainCastEnabled === 'function') ? shadowTerrainCastEnabled() : false;
    scene.add(mesh);
    tileMeshes.set(key, mesh);
    if (typeof simLoadLog === 'function') simLoadLog('tile:done', key);
  } catch (e) {
    if (typeof simLoadError === 'function') simLoadError(`tile:failed ${key}`, e);
  } finally {
    loadingTiles.delete(key);
    tileAbort.delete(key);
  }
}

function abortAndRemove(key) {
  const ac = tileAbort.get(key);
  if (ac) { ac.abort(); tileAbort.delete(key); }
  loadingTiles.delete(key);
  tileClipSig.delete(key);
  const mesh = tileMeshes.get(key);
  if (mesh) { disposeMesh(mesh); tileMeshes.delete(key); }
}

// Handle function clearAllTiles().
function clearAllTiles() {
  for (const key of new Set([...tileMeshes.keys(), ...loadingTiles])) abortAndRemove(key);
}

function collectRing(zoom, cx, cy, outerR, innerBoundsZ17) {
  const n     = 1 << zoom;
  const tiles = new Map();
  const shift = 17 - zoom;
  const scale = 1 << shift;
  for (let dy = -outerR; dy <= outerR; dy++) {
    for (let dx = -outerR; dx <= outerR; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      let clip = null;
      if (innerBoundsZ17) {
        const a1 = tx * scale,       a2 = a1 + scale - 1;
        const b1 = ty * scale,       b2 = b1 + scale - 1;
        const overlaps = a1 <= innerBoundsZ17.maxX && a2 >= innerBoundsZ17.minX &&
                         b1 <= innerBoundsZ17.maxY && b2 >= innerBoundsZ17.minY;
        // Configure if.
        if (a1 >= innerBoundsZ17.minX && a2 <= innerBoundsZ17.maxX &&
            b1 >= innerBoundsZ17.minY && b2 <= innerBoundsZ17.maxY) continue;
        if (overlaps) clip = innerBoundsZ17;
      }
      tiles.set(`${zoom}_${tx}_${ty}`, clip);
    }
  }
  return tiles;
}

const RING_R17 = 1;
const RING_R15 = 2;
const RING_R13 = 3;
const RING_R11 = 4;
const RING_R9  = 5;

function updateTiles(lat, lon, camGroundDist) {
  const useZ17 = camGroundDist < DIST_DISABLE_Z17;
  const useZ15 = camGroundDist < DIST_DISABLE_Z15;
  const useZ13 = camGroundDist < DIST_DISABLE_Z13;
  const useZ11 = camGroundDist < DIST_DISABLE_Z11;

  activeTileZoom = useZ17 ? 17 : useZ15 ? 15 : useZ13 ? 13 : useZ11 ? 11 : 9;

  // Configure const.
  const [baseCx, baseCy] = deg2tile(lat, lon, 17);
  const centerOf  = (zoom) => { const s = 17 - zoom; return [baseCx >> s, baseCy >> s]; };
  const boundsZ17 = (cx, cy, zoom, r) => {
    const shift = 17 - zoom, scale = 1 << shift;
    return {
      minX: (cx - r) * scale,       maxX: (cx + r) * scale + scale - 1,
      minY: (cy - r) * scale,       maxY: (cy + r) * scale + scale - 1,
    };
  };

  const wantTiles = new Map();
  let innerB = null;

  if (useZ17) {
    const [cx, cy] = centerOf(17);
    for (const [k, c] of collectRing(17, cx, cy, RING_R17, null)) wantTiles.set(k, c);
    innerB = boundsZ17(cx, cy, 17, RING_R17);
  }
  if (useZ15) {
    const [cx, cy] = centerOf(15);
    for (const [k, c] of collectRing(15, cx, cy, RING_R15, innerB)) wantTiles.set(k, c);
    innerB = boundsZ17(cx, cy, 15, RING_R15);
  }
  if (useZ13) {
    const [cx, cy] = centerOf(13);
    for (const [k, c] of collectRing(13, cx, cy, RING_R13, innerB)) wantTiles.set(k, c);
    innerB = boundsZ17(cx, cy, 13, RING_R13);
  }
  if (useZ11) {
    const [cx, cy] = centerOf(11);
    for (const [k, c] of collectRing(11, cx, cy, RING_R11, innerB)) wantTiles.set(k, c);
    innerB = boundsZ17(cx, cy, 11, RING_R11);
  }
  // Implementation note.
  {
    const [cx, cy] = centerOf(9);
    for (const [k, c] of collectRing(9, cx, cy, RING_R9, innerB)) wantTiles.set(k, c);
  }

  const hasPendingHigherReplacement = (key) => {
    const oldTile   = parseTileKey(key);
    const oldBounds = tileBoundsZ17(oldTile.tx, oldTile.ty, oldTile.zoom);
    for (const wantKey of wantTiles.keys()) {
      const wantTile = parseTileKey(wantKey);
      if (wantTile.zoom <= oldTile.zoom || tileMeshes.has(wantKey)) continue;
      if (boundsOverlap(oldBounds, tileBoundsZ17(wantTile.tx, wantTile.ty, wantTile.zoom))) return true;
    }
    return false;
  };

  // Configure key.
  for (const key of [...tileMeshes.keys(), ...loadingTiles]) {
    const desiredClipSig = clipSignature(wantTiles.get(key));
    const shouldRemove   = !wantTiles.has(key) || tileClipSig.get(key) !== desiredClipSig;
    if (shouldRemove && !hasPendingHigherReplacement(key)) abortAndRemove(key);
  }

  // Configure missing.
  const missing = [...wantTiles.keys()].filter(k => !tileMeshes.has(k) && !loadingTiles.has(k));
  missing.sort((a, b) => parseInt(b) - parseInt(a));
  const pending = [];
  for (const key of missing) {
    const parts = key.split('_');
    pending.push(loadTile(+parts[1], +parts[2], +parts[0], wantTiles.get(key)));
  }

  // Configure return.
  return pending;
}
