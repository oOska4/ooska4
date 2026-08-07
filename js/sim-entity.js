'use strict';

// Entity system (world objects)

class Entity {
  constructor(opts = {}) {
    this.id      = opts.id      ?? `entity_${Date.now()}`;
    this.type    = opts.type    ?? 'generic';
    this.lat     = opts.lat     ?? refLat;
    this.lon     = opts.lon     ?? refLon;
    this.altM    = opts.altM    ?? 1000;
    this.heading = opts.heading ?? 0;
    this.pitch   = opts.pitch   ?? 0;
    this.roll    = opts.roll    ?? 0;
    this.velNED  = opts.velNED  ?? { n: 0, e: 0, d: 0 };
    this.terrainM = 0;
    this.agl      = 0;
    this.mesh    = opts.mesh ?? null;
    this.active  = true;
  }
  get speedMsH() { return Math.hypot(this.velNED.n, this.velNED.e); }
  get speedMs()  { return Math.hypot(this.velNED.n, this.velNED.e, this.velNED.d); }
  get speedKt()  { return Units.msToKt(this.speedMs); }
  get climbMs()  { return -this.velNED.d; }
  get climbFpm() { return Units.msToFpm(this.climbMs); }
  get worldPos() { return geoToWorld(this.lat, this.lon, this.altM); }

  updateTerrain(zoom = 12) {
    this.terrainM = terrainHeightM(this.lat, this.lon, zoom);
    this.agl = Math.max(0, this.altM - this.terrainM);
  }

  integrate(dt) {
    if (!this.active) return;
    const R = EARTH_RADIUS;
    const cosLat = Math.cos(Units.degToRad(this.lat));
    this.lat  += (this.velNED.n / R) * (180 / Math.PI) * dt;
    this.lon  += (this.velNED.e / (R * cosLat)) * (180 / Math.PI) * dt;
    this.altM -= this.velNED.d * dt;
  }

  syncMesh() {
    if (!this.mesh) return;
    const p = this.worldPos;
    this.mesh.position.copy(p);
    this.mesh.rotation.set(
      -Units.degToRad(this.pitch),
       Units.degToRad(this.heading),
       Units.degToRad(this.roll),
      'YXZ'
    );
  }

  physicsUpdate(dt, input) {}
  renderUpdate(dt) {}
}

const entities   = new Map();
let activeEntity = null;

function addEntity(e) { entities.set(e.id, e); return e; }

function removeEntity(id) {
  const e = entities.get(id);
  if (!e) return;
  if (e.mesh) scene.remove(e.mesh);
  entities.delete(id);
  if (activeEntity === e) activeEntity = null;
}

// Section: physLastTime.

let physLastTime = performance.now();

function physicsTick(now) {
  const dt = Math.min(0.1, (now - physLastTime) / 1000);
  physLastTime = now;
  for (const entity of entities.values()) {
    if (!entity.active) continue;
    entity.physicsUpdate(dt, planeInput);
    entity.integrate(dt);
  }
}
