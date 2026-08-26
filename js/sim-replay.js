'use strict';

// sim-replay.js
// ============================================================================
// Nagrywanie stanu lotu (ring buffer) + odtwarzanie ladowania. Kluczowa
// decyzja projektowa: NIE tworzymy drugiej instancji A321Entity ("widma") -
// to wymagaloby zaladowania/sklonowania drugiego modelu 3D (kosztowne,
// zbedne). Zamiast tego, podczas replay TYMCZASOWO przejmujemy kontrole nad
// prawdziwym activeEntity (zapisujac pelny stan przed wejsciem, przywracajac
// po wyjsciu) i sterujemy nim przez A321Entity.applyReplayPose() (patrz
// sim-physics.js) zamiast physicsUpdate(). Dzieki temu kamera/HUD/dzwiek/
// smugi kondensacyjne dzialaja DOKLADNIE tak samo jak dla zywego lotu, zero
// dodatkowego kodu renderowania.
//
// Plan projektowy: .agents/simworld-dev/landing-replay-plan.md

const REPLAY_SAMPLE_HZ      = 15;
const REPLAY_SAMPLE_DT      = 1 / REPLAY_SAMPLE_HZ;
const REPLAY_BUFFER_SECONDS = 90;
const REPLAY_CAPACITY       = Math.ceil(REPLAY_BUFFER_SECONDS * REPLAY_SAMPLE_HZ);

// Ile floatow na probke - musi sie zgadzac z F_* indeksami ponizej.
const REPLAY_FIELDS = 17;
const F_T=0, F_LAT=1, F_LON=2, F_ALT=3, F_PITCH=4, F_YAW=5, F_ROLL=6,
      F_VX=7, F_VY=8, F_VZ=9, F_THR=10, F_FLAP=11, F_GEAR=12, F_SPLR=13,
      F_ELEV=14, F_RUD=15, F_ONGND=16;

// Zakres odtwarzania wzgledem momentu touchdown (sekundy) - patrz
// prepareForLanding() nizej.
const REPLAY_PRE_TOUCHDOWN_S  = 12;
const REPLAY_POST_TOUCHDOWN_S = 5;

// ============================================================================
// Ring buffer - plaski Float32Array, zero alokacji per-probke (pattern
// spojny z reszta projektu, patrz optymalizacje w sim-physics.js/sim-sky.js).
// ============================================================================
const ReplayRecorder = {
  _buf: new Float32Array(REPLAY_CAPACITY * REPLAY_FIELDS),
  _writeIdx: 0,
  _count: 0,
  _clockS: 0,
  _accum: 0,

  reset() { this._writeIdx = 0; this._count = 0; },

  // Wolane co klatke fizyki (physicsTick) z sim-main.js - wlasny akumulator
  // niezalezny od throttlingu innych systemow, probkuje z REPLAY_SAMPLE_HZ.
  update(entity, dt) {
    this._clockS += dt;
    this._accum += dt;
    if (this._accum < REPLAY_SAMPLE_DT) return;
    this._accum -= REPLAY_SAMPLE_DT;
    if (entity) this._record(entity);
  },

  _record(e) {
    const i = this._writeIdx * REPLAY_FIELDS;
    const b = this._buf;
    b[i+F_T]=this._clockS; b[i+F_LAT]=e.lat; b[i+F_LON]=e.lon; b[i+F_ALT]=e.altM;
    b[i+F_PITCH]=e.pitchRad; b[i+F_YAW]=e.yawRad; b[i+F_ROLL]=e.rollRad;
    b[i+F_VX]=e.vel.x; b[i+F_VY]=e.vel.y; b[i+F_VZ]=e.vel.z;
    b[i+F_THR]=e.throttle; b[i+F_FLAP]=e.prevFlapPos; b[i+F_GEAR]=e.gearDown?1:0;
    b[i+F_SPLR]=e.spoilers?1:0; b[i+F_ELEV]=e.elevPos; b[i+F_RUD]=e.rudderPos;
    b[i+F_ONGND]=e.onGround?1:0;
    this._writeIdx = (this._writeIdx + 1) % REPLAY_CAPACITY;
    if (this._count < REPLAY_CAPACITY) this._count++;
  },

  get startS() {
    if (this._count === 0) return 0;
    const oldest = this._count < REPLAY_CAPACITY ? 0 : this._writeIdx;
    return this._buf[oldest * REPLAY_FIELDS + F_T];
  },
  get endS() {
    if (this._count === 0) return 0;
    const last = (this._writeIdx - 1 + REPLAY_CAPACITY) % REPLAY_CAPACITY;
    return this._buf[last * REPLAY_FIELDS + F_T];
  },

  // Binary search po chronologicznym indeksie [0,count-1] (mapowanym na
  // fizyczny slot bufora) - zwraca sasiadujace probki + wspolczynnik
  // interpolacji dla czasu t.
  _findBracket(t) {
    if (this._count < 2) return null;
    const oldest = this._count < REPLAY_CAPACITY ? 0 : this._writeIdx;
    const timeAt = (k) => this._buf[((oldest + k) % REPLAY_CAPACITY) * REPLAY_FIELDS + F_T];
    let lo = 0, hi = this._count - 1;
    if (t <= timeAt(0))  return { k0: 0,  k1: 0,  frac: 0, oldest };
    if (t >= timeAt(hi)) return { k0: hi, k1: hi, frac: 0, oldest };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (timeAt(mid) <= t) lo = mid; else hi = mid;
    }
    const t0 = timeAt(lo), t1 = timeAt(hi);
    return { k0: lo, k1: hi, frac: t1 > t0 ? (t - t0) / (t1 - t0) : 0, oldest };
  },

  // Interpoluje probke dla czasu t (sekundy, ten sam zegar co _clockS).
  // Zapisuje do `out` (obiekt podany przez wywolujacego) - zero alokacji.
  sampleAt(t, out) {
    const br = this._findBracket(t);
    if (!br) return false;
    const i0 = ((br.oldest + br.k0) % REPLAY_CAPACITY) * REPLAY_FIELDS;
    const i1 = ((br.oldest + br.k1) % REPLAY_CAPACITY) * REPLAY_FIELDS;
    const b = this._buf, f = br.frac;
    const lerp = (a, c) => a + (c - a) * f;
    out.lat = lerp(b[i0+F_LAT], b[i1+F_LAT]);
    out.lon = lerp(b[i0+F_LON], b[i1+F_LON]);
    out.altM = lerp(b[i0+F_ALT], b[i1+F_ALT]);
    out.pitchRad = lerp(b[i0+F_PITCH], b[i1+F_PITCH]);
    out.yawRad = lerp(b[i0+F_YAW], b[i1+F_YAW]);
    out.rollRad = lerp(b[i0+F_ROLL], b[i1+F_ROLL]);
    out.velX = lerp(b[i0+F_VX], b[i1+F_VX]);
    out.velY = lerp(b[i0+F_VY], b[i1+F_VY]);
    out.velZ = lerp(b[i0+F_VZ], b[i1+F_VZ]);
    out.throttle = lerp(b[i0+F_THR], b[i1+F_THR]);
    out.flapPos = lerp(b[i0+F_FLAP], b[i1+F_FLAP]);
    out.elevPos = lerp(b[i0+F_ELEV], b[i1+F_ELEV]);
    out.rudderPos = lerp(b[i0+F_RUD], b[i1+F_RUD]);
    out.gearDown = b[i1+F_GEAR] > 0.5;
    out.spoilers = b[i1+F_SPLR] > 0.5;
    out.onGround = b[i1+F_ONGND] > 0.5;
    return true;
  },
};

// ============================================================================
// Playback state machine
// ============================================================================
const ReplaySystem = {
  active: false,
  paused: false,
  playT: 0,
  playSpeed: 1,
  rangeStartS: 0,
  rangeEndS: 0,
  touchdownS: 0,

  _sample: {}, // reuzywany obiekt wyniku interpolacji
  _saved: null, // pelny stan activeEntity zapisany przed wejsciem w replay

  // Wolane z sim-landing-score.js po udanym touchdown - przygotowuje zakres
  // odtwarzania, ale NIE uruchamia automatycznie (user klika "Odtworz" na
  // scorecard).
  prepareForLanding(touchdownClockS) {
    this.touchdownS  = touchdownClockS;
    this.rangeStartS = Math.max(ReplayRecorder.startS, touchdownClockS - REPLAY_PRE_TOUCHDOWN_S);
    this.rangeEndS   = Math.min(ReplayRecorder.endS,   touchdownClockS + REPLAY_POST_TOUCHDOWN_S);
  },

  canPlay() {
    return this.rangeEndS > this.rangeStartS && ReplayRecorder._count >= 2;
  },

  enter() {
    if (this.active || !activeEntity || !this.canPlay()) return false;

    this._saved = {
      lat: activeEntity.lat, lon: activeEntity.lon, altM: activeEntity.altM,
      pitchRad: activeEntity.pitchRad, yawRad: activeEntity.yawRad, rollRad: activeEntity.rollRad,
      throttle: activeEntity.throttle, flaps: activeEntity.flaps, prevFlapPos: activeEntity.prevFlapPos,
      gearDown: activeEntity.gearDown, spoilers: activeEntity.spoilers, onGround: activeEntity.onGround,
      elevPos: activeEntity.elevPos, rudderPos: activeEntity.rudderPos,
      vel: activeEntity.vel.clone(),
      fanAngle: activeEntity.fanAngle, gearAngle: activeEntity.gearAngle, beaconTimer: activeEntity.beaconTimer,
    };

    this.active = true;
    this.paused = false;
    this.playSpeed = 1;
    this.playT = this.rangeStartS;
    return true;
  },

  exit() {
    if (!this.active) return;
    const s = this._saved;
    if (s && activeEntity) {
      activeEntity.lat = s.lat; activeEntity.lon = s.lon; activeEntity.altM = s.altM;
      activeEntity.pitchRad = s.pitchRad; activeEntity.yawRad = s.yawRad; activeEntity.rollRad = s.rollRad;
      activeEntity.throttle = s.throttle; activeEntity.flaps = s.flaps; activeEntity.prevFlapPos = s.prevFlapPos;
      activeEntity.gearDown = s.gearDown; activeEntity.spoilers = s.spoilers; activeEntity.onGround = s.onGround;
      activeEntity.elevPos = s.elevPos; activeEntity.rudderPos = s.rudderPos;
      activeEntity.vel.copy(s.vel);
      activeEntity.fanAngle = s.fanAngle; activeEntity.gearAngle = s.gearAngle; activeEntity.beaconTimer = s.beaconTimer;
      activeEntity._applyPoseToMesh();
      activeEntity.syncMesh();
    }
    this._saved = null;
    this.active = false;
    this.paused = false;
  },

  togglePause() { this.paused = !this.paused; },

  seekTo(t) {
    this.playT = Math.max(this.rangeStartS, Math.min(this.rangeEndS, t));
  },

  seekToTouchdown() {
    this.seekTo(this.touchdownS);
  },

  setSpeed(mult) { this.playSpeed = mult; },

  // Wolane co klatke z animate() ZAMIAST physicsTick, gdy active===true.
  update(dt) {
    if (!this.active) return;
    if (!this.paused) {
      this.playT += dt * this.playSpeed;
      if (this.playT >= this.rangeEndS) {
        this.playT = this.rangeEndS;
        this.paused = true; // zatrzymaj na koncu zamiast petli - user decyduje co dalej
      }
    }
    if (!activeEntity) return;
    if (ReplayRecorder.sampleAt(this.playT, this._sample)) {
      activeEntity.applyReplayPose(this._sample, this.paused ? 0 : dt * this.playSpeed);
    }
  },

  // Postep 0..1 w obrebie zakresu odtwarzania - do UI (scrub bar).
  get progress01() {
    const span = this.rangeEndS - this.rangeStartS;
    return span > 0 ? (this.playT - this.rangeStartS) / span : 0;
  },
};
