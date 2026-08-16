'use strict';

// sim-terrain-worker.js
// ============================================================================
// Odciazenie CPU-bound czesci buildMeshWithNeighbors() (sim-terrain.js) z main
// threadu. Profiling (window.simPerfReport()) pokazal ze ta praca potrafi
// zablokowac klatke na >120ms przy szybkim locie nisko nad nowym terenem -
// caly rendering/input czekal na te przeliczenia. Tutaj ta sama matematyka
// dziala rownolegle, wiec main thread (rendering, fizyka, input) nie stoi.
//
// WAZNE: kazda formula ponizej jest 1:1 skopiowana z oryginalnego kodu w
// sim-terrain.js (grid-fill loop) i z algorytmu THREE.js r128
// BufferGeometry.computeVertexNormals() - zweryfikowane numerycznie w node
// (zero roznicy na siatkach 48/80/112/128 pelnych i przycietych/dziurawych,
// wlacznie z przypadkiem brzegowym izolowanych wierzcholkow). Worker NIE
// laduje samego THREE.js (nie jest potrzebny - to czysta tablicowa
// matematyka), co utrzymuje go lekkim.

self.onmessage = function (e) {
  const msg = e.data;
  try {
    const result = buildTerrainTile(msg);
    self.postMessage(
      { id: msg.id, ok: true, position: result.position, uv: result.uv, normal: result.normal,
        vertexCount: result.vertexCount, computeMs: result.computeMs },
      [result.position.buffer, result.uv.buffer, result.normal.buffer]
    );
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
};

function buildTerrainTile(msg) {
  const t0 = performance.now();
  const {
    GRID, px0, py0, subPx, x0, y0, dx, dy,
    dem, demR, demB, demC, demExag, yScale, index,
  } = msg;

  const G1 = GRID + 1;
  const INV = 1 / GRID;
  const UV_IN = 0.5 / 256, UV_SC = 1 - 2 * UV_IN;
  const vertexCount = G1 * G1;

  const position = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);

  // --- Ta sama petla co wczesniej w sim-terrain.js buildMeshWithNeighbors ---
  let vi = 0, ui = 0;
  for (let r = 0; r <= GRID; r++) {
    for (let c = 0; c <= GRID; c++) {
      const u = c * INV, v = r * INV;
      let fpx = px0 + u * subPx;
      let fpy = py0 + v * subPx;
      let d = dem;
      const crossR = fpx >= 256, crossB = fpy >= 256;
      if (crossR && crossB) { d = demC; fpx -= 256; fpy -= 256; }
      else if (crossR) { d = demR; fpx -= 256; }
      else if (crossB) { d = demB; fpy -= 256; }
      let wz = 0;
      if (d) {
        const raw = d[Math.min(255, fpy | 0) * 256 + Math.min(255, fpx | 0)];
        if (raw > 0) wz = raw * demExag * yScale;
      }
      position[vi++] = x0 + u * dx;
      position[vi++] = wz;
      position[vi++] = -(y0 + v * dy);
      uv[ui++] = UV_IN + u * UV_SC;
      uv[ui++] = UV_IN + (1 - v) * UV_SC;
    }
  }

  // --- computeVertexNormals(), algorytm identyczny z THREE.js r128 ---------
  const normal = computeVertexNormalsRaw(position, index, vertexCount);

  return { position, uv, normal, vertexCount, computeMs: performance.now() - t0 };
}

// Reimplementacja THREE.BufferGeometry.prototype.computeVertexNormals() (r128)
// jako czysta tablicowa matematyka, bez zaleznosci od THREE.js. Zweryfikowana
// numerycznie 1:1 przeciwko prawdziwemu THREE.js (patrz opis modulu wyzej).
function computeVertexNormalsRaw(position, index, vertexCount) {
  const normal = new Float32Array(vertexCount * 3); // zero-initialized
  for (let i = 0, il = index.length; i < il; i += 3) {
    const vA = index[i], vB = index[i + 1], vC = index[i + 2];
    const pAx = position[vA * 3], pAy = position[vA * 3 + 1], pAz = position[vA * 3 + 2];
    const pBx = position[vB * 3], pBy = position[vB * 3 + 1], pBz = position[vB * 3 + 2];
    const pCx = position[vC * 3], pCy = position[vC * 3 + 1], pCz = position[vC * 3 + 2];
    const cbx = pCx - pBx, cby = pCy - pBy, cbz = pCz - pBz;
    const abx = pAx - pBx, aby = pAy - pBy, abz = pAz - pBz;
    // cb.cross(ab): cb = cb x ab (konwencja THREE.Vector3.crossVectors)
    const cx = cby * abz - cbz * aby;
    const cy = cbz * abx - cbx * abz;
    const cz = cbx * aby - cby * abx;
    normal[vA * 3] += cx; normal[vA * 3 + 1] += cy; normal[vA * 3 + 2] += cz;
    normal[vB * 3] += cx; normal[vB * 3 + 1] += cy; normal[vB * 3 + 2] += cz;
    normal[vC * 3] += cx; normal[vC * 3 + 1] += cy; normal[vC * 3 + 2] += cz;
  }
  for (let i = 0; i < vertexCount; i++) {
    const x = normal[i * 3], y = normal[i * 3 + 1], z = normal[i * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z) || 1; // normalize(0||1), jak w THREE
    normal[i * 3] = x / len;
    normal[i * 3 + 1] = y / len;
    normal[i * 3 + 2] = z / len;
  }
  return normal;
}
