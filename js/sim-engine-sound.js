'use strict';

// Section: SimEngineSound.
//
// Ciągły dźwięk silnika sterowany throttle'm aktywnego samolotu (activeEntity.throttle),
// z płynnym przejściem idle/taxi -> spool-up -> cruise (bez re-triggerowania środka
// przejścia przy drobnych wahaniach throttle'a), wyciszaniem/przytłumianiem w zależności
// od odległości kamery od samolotu (spoza kokpitu), oraz jednorazowym odgłosem przelotu
// (buzzsaw_flyover) gdy kamera zewnętrzna "łapie" szybko przelatujący samolot z bliska.
//
// Wzorowane na strukturze SimSound (js/sim-sound.js): IIFE + fetch/decodeAudioData,
// odblokowanie AudioContext na pierwszym geście użytkownika, update(dt) wołane co klatkę.

const SimEngineSound = (() => {

  // Konfiguracja plików

  const LOOP_FILES = {
    idle:   'sounds/engines/idle_taxi_loop.mp3',
    cruise: 'sounds/engines/cruise_loop.mp3',
  };
  const SPOOL_FILE   = 'sounds/engines/spool_transition.mp3';
  const FLYOVER_FILE = 'sounds/engines/buzzsaw_flyover.mp3';

  // Progi throttle (z histerezą - bez tego silnik "migałby" między idle a spool-up
  // przy locie z throttle balansującym akurat na granicy).
  const THROTTLE_HIGH = 0.20;  // powyżej -> start spool-up w kierunku cruise
  const THROTTLE_LOW  = 0.10;  // poniżej -> powrót do idle/taxi
  const SPOOL_RETRIGGER_COOLDOWN = 1.5; // s, zabezpieczenie przed nakładającymi się spoolami

  // Wyciszanie/przytłumianie z dystansem kamera <-> samolot (poza kokpitem/HUD).
  const DIST_NEAR     = 40;    // [m] pełna głośność, pełne pasmo
  const DIST_FAR      = 1200;  // [m] minimalna głośność, mocno stłumione
  const MIN_GAIN_FAR  = 0.12;
  const MIN_LOWPASS_FAR = 500; // Hz
  const DIST_SMOOTH_TC  = 0.15; // stała czasowa wygładzania (setTargetAtTime)

  // Wyzwalanie przelotu (flyover) - tylko z kamery zewnętrznej, przy realnym "przejściu"
  // z daleka na blisko, żeby nie odpalało się non-stop w widoku kokpitu (tam dystans
  // jest cały czas mały, więc próg "far->near" nigdy nie zostanie przekroczony).
  const FLYOVER_TRIGGER_M = 180;  // próg zbliżenia
  const FLYOVER_ARM_M     = 500;  // dystans powyżej którego "uzbrajamy" wykrywanie
  const FLYOVER_MIN_SPEED = 28;   // m/s - poniżej tego to nie przelot, tylko dryf kamery
  const FLYOVER_COOLDOWN  = 8;    // s między kolejnymi przelotami

  // Stan modułu

  let ctx = null, master = null, distFilter = null, distGain = null;
  const buffers = {};
  let buffersReady = false;
  let loadingStarted = false;

  let idleVoice = null, cruiseVoice = null;
  let spoolSource = null, spoolGain = null, spoolFilter = null;

  let state = 'IDLE'; // IDLE | SPOOLUP | CRUISE
  let spoolEndTime = 0;
  let lastSpoolTriggerT = -999;

  let distArmed = false;      // true gdy byliśmy daleko - wtedy zbliżenie liczy się jako przelot
  let lastFlyoverT = -999;

  // Pomocnicze

  function now() { return performance.now() / 1000; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 1;
      distFilter = ctx.createBiquadFilter();
      distFilter.type = 'lowpass';
      distFilter.frequency.value = 20000;
      distGain = ctx.createGain();
      distGain.gain.value = 1;
      distFilter.connect(distGain);
      distGain.connect(master);
      master.connect(ctx.destination);
    }
    return ctx;
  }

  async function loadBuffer(url, ms = 15000) {
    // Timeout - bez tego, zawieszony fetch (niestabilny internet) oznaczalby
    // ze dzwiek silnika NIGDY sie nie zaladuje przez cala sesje, po cichu
    // (preload() jest wolane bez await, wiec nie blokuje reszty gry, ale
    // buffersReady tez nigdy by sie nie ustawilo).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`[EngineSound] Brak pliku "${url}" (status ${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    return ensureCtx().decodeAudioData(arrayBuffer);
  }

  async function preload() {
    if (loadingStarted) return;
    loadingStarted = true;
    try {
      const [idle, cruise, spool, buzzsaw] = await Promise.all([
        loadBuffer(LOOP_FILES.idle),
        loadBuffer(LOOP_FILES.cruise),
        loadBuffer(SPOOL_FILE),
        loadBuffer(FLYOVER_FILE),
      ]);
      buffers.idle = idle; buffers.cruise = cruise;
      buffers.spool = spool; buffers.buzzsaw = buzzsaw;
      buildGraph();
      buffersReady = true;
      console.log('[EngineSound] Wczytano dźwięki silnika:', Object.keys(buffers).map(
        k => `${k} (${buffers[k].duration.toFixed(1)}s)`).join(', '));
    } catch (err) {
      console.warn('[EngineSound] Nie udało się wczytać dźwięków silnika:', err);
    }
  }

  // Section: LoopVoice - pętla z własnym gainem, do płynnego crossfade.

  class LoopVoice {
    constructor(buffer, destination) {
      this.buffer = buffer;
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = 0;
      this.gainNode.connect(destination);
      this.source = null;
    }
    start(when, fadeInDur, target = 1) {
      this.hardStop();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.connect(this.gainNode);
      src.start(when);
      this.source = src;
      const g = this.gainNode.gain;
      g.cancelScheduledValues(when);
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(target, when + fadeInDur);
    }
    fadeTo(target, dur) {
      const t = ctx.currentTime;
      const g = this.gainNode.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target, t + dur);
    }
    stopAfter(dur) {
      if (!this.source) return;
      const src = this.source;
      this.source = null;
      try { src.stop(ctx.currentTime + dur + 0.08); } catch (e) { /* już zatrzymany */ }
    }
    hardStop() {
      if (this.source) {
        try { this.source.stop(); } catch (e) { /* już zatrzymany */ }
        try { this.source.disconnect(); } catch (e) { /* nic */ }
        this.source = null;
      }
    }
    get playing() { return !!this.source; }
  }

  function buildGraph() {
    idleVoice   = new LoopVoice(buffers.idle, distFilter);
    cruiseVoice = new LoopVoice(buffers.cruise, distFilter);

    spoolFilter = ctx.createBiquadFilter();
    spoolFilter.type = 'lowpass';
    spoolFilter.frequency.value = 20000;
    spoolGain = ctx.createGain();
    spoolGain.gain.value = 0;
    spoolFilter.connect(spoolGain);
    spoolGain.connect(distFilter);
  }

  // Section: przejścia stanów.

  function goIdle(fade = 2.0) {
    const t = ctx.currentTime;
    if (cruiseVoice.playing) { cruiseVoice.fadeTo(0, fade); cruiseVoice.stopAfter(fade); }
    spoolGain.gain.cancelScheduledValues(t);
    spoolGain.gain.setValueAtTime(spoolGain.gain.value, t);
    spoolGain.gain.linearRampToValueAtTime(0, t + fade);

    if (idleVoice.playing) idleVoice.fadeTo(1, fade);
    else idleVoice.start(t, fade, 1);
    state = 'IDLE';
  }

  function spoolUpToCruise() {
    const t = ctx.currentTime;
    const spoolDur = buffers.spool.duration;
    const crossfadeDur = 0.6; // krótkie zazębienie fali - barwa już wygładzona w pliku (multiband bridge)

    if (idleVoice.playing) { idleVoice.fadeTo(0, 1.2); idleVoice.stopAfter(1.2); }

    if (spoolSource) { try { spoolSource.stop(); } catch (e) {} try { spoolSource.disconnect(); } catch (e) {} spoolSource = null; }

    const src = ctx.createBufferSource();
    src.buffer = buffers.spool;
    src.connect(spoolFilter);

    spoolFilter.frequency.cancelScheduledValues(t);
    spoolFilter.frequency.setValueAtTime(20000, t);
    const smoothStart = t + spoolDur - crossfadeDur;
    spoolFilter.frequency.setValueAtTime(20000, smoothStart);
    spoolFilter.frequency.exponentialRampToValueAtTime(7000, t + spoolDur);

    spoolGain.gain.cancelScheduledValues(t);
    spoolGain.gain.setValueAtTime(0, t);
    spoolGain.gain.linearRampToValueAtTime(1, t + 1.2);

    src.start(t);
    spoolSource = src;

    cruiseVoice.start(t + spoolDur - crossfadeDur, crossfadeDur, 1);

    state = 'SPOOLUP';
    spoolEndTime = now() + spoolDur;
    lastSpoolTriggerT = now();
  }

  // Section: dystans kamera <-> samolot -> głośność / barwa.

  function updateDistanceMix(plane) {
    let dist = DIST_NEAR;
    try {
      if (camMode === CameraMode.COCKPIT || camMode === CameraMode.HUD) {
        dist = DIST_NEAR;
      } else {
        dist = camera.position.distanceTo(plane.worldPos);
      }
    } catch (e) { dist = DIST_NEAR; }

    const tt = clamp((dist - DIST_NEAR) / (DIST_FAR - DIST_NEAR), 0, 1);
    const muted = (typeof SimSound !== 'undefined' && SimSound.muted);
    const targetGain = muted ? 0 : lerp(1, MIN_GAIN_FAR, tt);
    const targetFreq = lerp(20000, MIN_LOWPASS_FAR, tt);

    const t = ctx.currentTime;
    distGain.gain.setTargetAtTime(targetGain, t, DIST_SMOOTH_TC);
    distFilter.frequency.setTargetAtTime(targetFreq, t, DIST_SMOOTH_TC);

    return dist;
  }

  // Section: wyzwalanie przelotu (flyover).

  function maybeTriggerFlyover(dist, speedMs) {
    if (camMode === CameraMode.COCKPIT || camMode === CameraMode.HUD) { distArmed = false; return; }

    if (dist > FLYOVER_ARM_M) distArmed = true;

    if (distArmed && dist < FLYOVER_TRIGGER_M && speedMs > FLYOVER_MIN_SPEED
        && (now() - lastFlyoverT) > FLYOVER_COOLDOWN) {
      triggerFlyover();
      distArmed = false;
      lastFlyoverT = now();
    }
  }

  function triggerFlyover() {
    const t = ctx.currentTime;
    const buf = buffers.buzzsaw;
    const dur = buf.duration;
    const tailDur = 1.6;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.max(0, dur - 1.0);
    src.loopEnd = dur;

    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 20000;

    src.connect(gain); gain.connect(pan); pan.connect(lp); lp.connect(master);

    // Kierunek przelotu losowy (nie mamy taniej metody 3D panningu 1:1 z realną
    // geometrią kamera<->samolot bez płynnej automatyzacji co klatkę) - efekt
    // "przelotu z boku" i tak dobrze sprzedaje wydarzenie.
    const dir = Math.random() < 0.5 ? 1 : -1;
    pan.pan.setValueAtTime(-1 * dir, t);
    pan.pan.linearRampToValueAtTime(0.15 * dir, t + dur);
    pan.pan.linearRampToValueAtTime(1 * dir, t + dur + tailDur);

    gain.gain.setValueAtTime(1, t);
    gain.gain.setValueAtTime(1, t + dur);
    gain.gain.linearRampToValueAtTime(0, t + dur + tailDur);

    lp.frequency.setValueAtTime(20000, t + dur);
    lp.frequency.linearRampToValueAtTime(900, t + dur + tailDur);

    src.playbackRate.setValueAtTime(1, t);
    src.playbackRate.setValueAtTime(1, t + dur);
    src.playbackRate.linearRampToValueAtTime(0.82, t + dur + tailDur);

    src.start(t);
    src.stop(t + dur + tailDur + 0.1);
  }

  // Section: update() - wołane co klatkę z animate() w sim-main.js.

  function update(dt) {
    if (!activeEntity) return;
    if (!buffersReady) { if (!loadingStarted) preload(); return; }

    const plane = activeEntity;
    const throttleAbs = Math.abs(plane.throttle);

    if (state === 'SPOOLUP' && now() >= spoolEndTime) state = 'CRUISE';

    if (state === 'IDLE' && throttleAbs > THROTTLE_HIGH
        && (now() - lastSpoolTriggerT) > SPOOL_RETRIGGER_COOLDOWN) {
      spoolUpToCruise();
    } else if ((state === 'SPOOLUP' || state === 'CRUISE') && throttleAbs < THROTTLE_LOW) {
      goIdle(3.0);
    }

    const dist = updateDistanceMix(plane);
    maybeTriggerFlyover(dist, plane.airspeed || 0);
  }

  // Section: reset - przy teleportacji samolotu (spawn/reset) silnik ma się ustawić
  // od razu w poprawnym stanie zamiast odgrywać spool-up "znikąd".

  function resetSound() {
    if (!buffersReady || !ctx) { state = 'IDLE'; return; }
    const plane = activeEntity;
    const throttleAbs = plane ? Math.abs(plane.throttle) : 0;

    idleVoice.hardStop();
    cruiseVoice.hardStop();
    if (spoolSource) { try { spoolSource.stop(); } catch (e) {} try { spoolSource.disconnect(); } catch (e) {} spoolSource = null; }
    spoolGain.gain.cancelScheduledValues(ctx.currentTime);
    spoolGain.gain.setValueAtTime(0, ctx.currentTime);

    if (throttleAbs > THROTTLE_HIGH) {
      cruiseVoice.start(ctx.currentTime, 0.8, 1);
      state = 'CRUISE';
    } else {
      idleVoice.start(ctx.currentTime, 0.8, 1);
      state = 'IDLE';
    }
    distArmed = false;
    lastFlyoverT = -999;
  }

  // Section: odblokowanie AudioContext na pierwszym geście użytkownika.

  function unlockAudio() {
    try {
      const c = ensureCtx();
      if (c.state === 'suspended') c.resume();
    } catch (e) { /* nic */ }
  }

  return { preload, unlockAudio, update, resetSound };

})();

SimEngineSound.preload();

['click', 'touchstart', 'keydown'].forEach(ev => {
  document.addEventListener(ev, function _unlock() {
    SimEngineSound.unlockAudio();
    document.removeEventListener(ev, _unlock);
  }, { once: true });
});
