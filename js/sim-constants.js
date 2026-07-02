'use strict';

// ── Stałe świata ─────────────────────────────────────────────────────────────
const EARTH_RADIUS     = 6_371_000;
const DEM_EXAG         = 3.0;
const Y_SCALE          = 0.4;
const BUILDING_H_SCALE = 2.0;

// ── Lotniska ──────────────────────────────────────────────────────────────────
const AIRPORTS = {
  EPWR: { name: 'Wrocław',    refLat: 51.10219, refLon: 16.88560,
          spawnLat: 51.09919149901774,  spawnLon: 16.897240753263095,  heading: 296 },
  LOWI: { name: 'Innsbruck',  refLat: 47.26116, refLon: 11.34567,
          spawnLat: 47.25896522075547,  spawnLon: 11.332409847516226,  heading: 81  },
  EDDF: { name: 'Fankfurt',  refLat: 50.03979, refLon: 8.58550,
          spawnLat: 50.03979708121752,  spawnLon: 8.585507077468781,  heading: 249  },  
};

let currentAirport  = 'EPWR';
let refLat          = AIRPORTS.EPWR.refLat;
let refLon          = AIRPORTS.EPWR.refLon;

const SPAWN_LAT         = AIRPORTS.EPWR.spawnLat;
const SPAWN_LON         = AIRPORTS.EPWR.spawnLon;
const SPAWN_HEADING_DEG = AIRPORTS.EPWR.heading;

// ── Konwersje jednostek ───────────────────────────────────────────────────────
const Units = {
  mToFt:    m   => m   * 3.28084,
  ftToM:    ft  => ft  * 0.3048,
  msToKt:   ms  => ms  * 1.94384,
  ktToMs:   kt  => kt  * 0.514444,
  msToFpm:  ms  => ms  * 196.85,
  fpmToMs:  fpm => fpm * 0.00508,
  radToDeg: r   => r   * 180 / Math.PI,
  degToRad: d   => d   * Math.PI / 180,
};

// ── Projekcja geo ↔ world ─────────────────────────────────────────────────────

function geoToWorld(lat, lon, altM = 0) {
  const cosRef = Math.cos(Units.degToRad(refLat));
  const x = (lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef;
  const z = (lat - refLat) * Math.PI / 180 * EARTH_RADIUS;
  return new THREE.Vector3(x, altM * Y_SCALE, -z);
}

function worldToGeo(p) {
  const cosRef = Math.cos(Units.degToRad(refLat));
  const lon    = refLon + (p.x / (EARTH_RADIUS * cosRef)) * 180 / Math.PI;
  const lat    = refLat - (p.z / EARTH_RADIUS)            * 180 / Math.PI;
  const altM   = p.y / Y_SCALE;
  return { lat, lon, altM };
}

// Uwaga: domyślny argument `orb.dist` jest ewaluowany w momencie wywołania,
// więc `orb` musi istnieć do czasu pierwszego wywołania (nie w chwili definicji).
function cameraGroundDistanceM(fallback) {
  if (fallback === undefined) fallback = orb.dist;
  const { lat, lon, altM } = worldToGeo(camera.position);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altM)) return fallback;
  const terrainM = terrainHeightBest(lat, lon);
  return Math.max(0, altM - terrainM);
}

function geoDistM(lat1, lon1, lat2, lon2) {
  const R    = EARTH_RADIUS;
  const dLat = Units.degToRad(lat2 - lat1);
  const dLon = Units.degToRad(lon2 - lon1);
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(Units.degToRad(lat1)) * Math.cos(Units.degToRad(lat2))
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geoBearing(lat1, lon1, lat2, lon2) {
  const dLon = Units.degToRad(lon2 - lon1);
  const y    = Math.sin(dLon) * Math.cos(Units.degToRad(lat2));
  const x    = Math.cos(Units.degToRad(lat1)) * Math.sin(Units.degToRad(lat2))
             - Math.sin(Units.degToRad(lat1)) * Math.cos(Units.degToRad(lat2)) * Math.cos(dLon);
  return (Units.radToDeg(Math.atan2(y, x)) + 360) % 360;
}

function latLonToWorld(lat, lon) {
  const cosRef = Math.cos(Units.degToRad(refLat));
  return [
    (lon - refLon) * Math.PI / 180 * EARTH_RADIUS * cosRef,
    (lat - refLat) * Math.PI / 180 * EARTH_RADIUS,
  ];
}

function offsetGeo(lat, lon, dEastM, dNorthM) {
  const cosLat = Math.cos(Units.degToRad(lat));
  return {
    lat: lat + (dNorthM / EARTH_RADIUS)            * 180 / Math.PI,
    lon: lon + (dEastM  / (EARTH_RADIUS * cosLat)) * 180 / Math.PI,
  };
}

function deg2tile(lat, lon, z) {
  const n  = 1 << z;
  const lr = lat * Math.PI / 180;
  return [
    Math.floor((lon + 180) / 360 * n),
    Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n),
  ];
}

function tile2deg(tx, ty, z) {
  const n = 1 << z;
  return [
    Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI,
    tx / n * 360 - 180,
  ];
}

function polygonCenter(points) {
  let lat = 0, lon = 0;
  for (const p of points) { lat += p[0]; lon += p[1]; }
  return [lat / points.length, lon / points.length];
}
