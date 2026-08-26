'use strict';

// sim-replay-ui.js
// ============================================================================
// UI dla systemu oceny ladowania: scorecard (pojawia sie automatycznie po
// dotknieciu pasa) + pasek kontrolny odtwarzania replay (scrub/predkosc/
// zamknij). Podlacza sie do LandingScore/ReplaySystem (sim-landing-score.js,
// sim-replay.js) przez globalny hook onLandingScored() i zwykle DOM eventy.

const _lsEl = {
  card:       document.getElementById('landing-scorecard'),
  grade:      document.getElementById('ls-grade'),
  score:      document.getElementById('ls-score'),
  close:      document.getElementById('ls-close'),
  vs:         document.getElementById('ls-vs'),
  centerline: document.getElementById('ls-centerline'),
  centerlineRow: document.getElementById('ls-centerline-row'),
  zone:       document.getElementById('ls-zone'),
  zoneRow:    document.getElementById('ls-zone-row'),
  speed:      document.getElementById('ls-speed'),
  bank:       document.getElementById('ls-bank'),
  replayBtn:  document.getElementById('ls-replay-btn'),
};

const _rbEl = {
  bar:    document.getElementById('replay-bar'),
  scrub:  document.getElementById('rb-scrub'),
  play:   document.getElementById('rb-play'),
  td:     document.getElementById('rb-td'),
  close:  document.getElementById('rb-close'),
  speeds: document.querySelectorAll('.rb-speed'),
};

const RB_SCRUB_STEPS = 1000; // rozdzielczosc suwaka (0..1000 mapowane na 0..1 progress)
let _scrubDragging = false;

function _fmtSigned(v, digits = 0) {
  const s = v.toFixed(digits);
  return v >= 0 ? `+${s}` : s;
}

function _classifyVal(el, warnAt, badAt, value) {
  el.classList.remove('val-warn', 'val-bad');
  const a = Math.abs(value);
  if (a >= badAt) el.classList.add('val-bad');
  else if (a >= warnAt) el.classList.add('val-warn');
}

// Wolane przez LandingScore.onTouchdown() (sim-landing-score.js) po
// policzeniu wyniku - pokazuje scorecard z liczbami.
function onLandingScored(result) {
  if (!_lsEl.card) return;

  _lsEl.grade.textContent = result.grade;
  _lsEl.grade.classList.remove('grade-warn', 'grade-bad');
  if (result.score < 40) _lsEl.grade.classList.add('grade-bad');
  else if (result.score < 70) _lsEl.grade.classList.add('grade-warn');
  _lsEl.score.textContent = `${result.score}/100`;

  _lsEl.vs.textContent = `${Math.round(-result.vsFpm)} fpm`;
  _classifyVal(_lsEl.vs, 250, 400, result.vsFpm);

  if (result.centerlineOffsetM !== null) {
    _lsEl.centerlineRow.classList.remove('hidden');
    const side = result.centerlineOffsetM >= 0 ? 'P' : 'L';
    _lsEl.centerline.textContent = `${Math.abs(result.centerlineOffsetM).toFixed(0)}m ${side}`;
    _classifyVal(_lsEl.centerline, 8, 20, result.centerlineOffsetM);
  } else {
    _lsEl.centerlineRow.classList.add('hidden');
  }

  if (result.touchdownDistanceM !== null) {
    _lsEl.zoneRow.classList.remove('hidden');
    _lsEl.zone.textContent = `${result.touchdownDistanceM.toFixed(0)}m od progu`;
    const outOfZone = result.touchdownDistanceM < 150 || result.touchdownDistanceM > 500;
    _lsEl.zone.classList.toggle('val-warn', outOfZone);
    _lsEl.zone.classList.remove('val-bad');
  } else {
    _lsEl.zoneRow.classList.add('hidden');
  }

  const speedDelta = result.speedKt - result.vref;
  _lsEl.speed.textContent = `${result.speedKt.toFixed(0)}kt (${_fmtSigned(speedDelta)}kt vs Vref)`;
  _classifyVal(_lsEl.speed, 8, 15, speedDelta < 0 ? speedDelta : Math.max(0, speedDelta - 5));

  _lsEl.bank.textContent = `${Math.abs(result.bankDeg).toFixed(1)}°`;
  _classifyVal(_lsEl.bank, 5, 15, result.bankDeg);

  if (_lsEl.replayBtn) _lsEl.replayBtn.disabled = !(typeof ReplaySystem !== 'undefined' && ReplaySystem.canPlay());

  _lsEl.card.classList.remove('hidden');
  requestAnimationFrame(() => _lsEl.card.classList.add('show'));
}

function _hideScorecard() {
  if (!_lsEl.card) return;
  _lsEl.card.classList.remove('show');
  setTimeout(() => _lsEl.card.classList.add('hidden'), 320);
}

if (_lsEl.close) _lsEl.close.addEventListener('click', _hideScorecard);

if (_lsEl.replayBtn) {
  _lsEl.replayBtn.addEventListener('click', () => {
    if (typeof ReplaySystem === 'undefined' || !ReplaySystem.enter()) return;
    _hideScorecard();
    _showReplayBar();
  });
}

// ============================================================================
// Pasek kontrolny replay
// ============================================================================
function _showReplayBar() {
  if (!_rbEl.bar) return;
  document.getElementById('action-rail')?.classList.add('hidden');
  _syncSpeedButtons();
  _syncPlayButton();
  _rbEl.bar.classList.remove('hidden');
  requestAnimationFrame(() => _rbEl.bar.classList.add('show'));
}

function _hideReplayBar() {
  if (!_rbEl.bar) return;
  document.getElementById('action-rail')?.classList.remove('hidden');
  _rbEl.bar.classList.remove('show');
  setTimeout(() => _rbEl.bar.classList.add('hidden'), 280);
}

function _syncPlayButton() {
  if (_rbEl.play) _rbEl.play.textContent = ReplaySystem.paused ? '▶' : '⏸';
}

function _syncSpeedButtons() {
  _rbEl.speeds.forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.speed === ReplaySystem.playSpeed);
  });
}

if (_rbEl.play) _rbEl.play.addEventListener('click', () => {
  if (typeof ReplaySystem === 'undefined' || !ReplaySystem.active) return;
  ReplaySystem.togglePause();
  _syncPlayButton();
});

if (_rbEl.td) _rbEl.td.addEventListener('click', () => {
  if (typeof ReplaySystem === 'undefined' || !ReplaySystem.active) return;
  ReplaySystem.seekToTouchdown();
  ReplaySystem.paused = true;
  _syncPlayButton();
});

if (_rbEl.close) _rbEl.close.addEventListener('click', () => {
  if (typeof ReplaySystem !== 'undefined') ReplaySystem.exit();
  _hideReplayBar();
});

_rbEl.speeds.forEach(btn => {
  btn.addEventListener('click', () => {
    if (typeof ReplaySystem === 'undefined' || !ReplaySystem.active) return;
    ReplaySystem.setSpeed(+btn.dataset.speed);
    ReplaySystem.paused = false;
    _syncPlayButton();
    _syncSpeedButtons();
  });
});

if (_rbEl.scrub) {
  _rbEl.scrub.addEventListener('input', () => {
    if (typeof ReplaySystem === 'undefined' || !ReplaySystem.active) return;
    _scrubDragging = true;
    const frac = (+_rbEl.scrub.value) / RB_SCRUB_STEPS;
    ReplaySystem.seekTo(ReplaySystem.rangeStartS + frac * (ReplaySystem.rangeEndS - ReplaySystem.rangeStartS));
    ReplaySystem.paused = true;
    _syncPlayButton();
  });
  _rbEl.scrub.addEventListener('change', () => { _scrubDragging = false; });
}

// Wolane co klatke z sim-main.js (animate()) gdy ReplaySystem.active - trzyma
// scrub bar zsynchronizowany z postepem odtwarzania (o ile user go akurat
// nie przeciaga recznie).
function updateReplayUI() {
  if (typeof ReplaySystem === 'undefined' || !ReplaySystem.active) return;
  if (!_scrubDragging && _rbEl.scrub) {
    _rbEl.scrub.value = Math.round(ReplaySystem.progress01 * RB_SCRUB_STEPS);
  }
  if (ReplaySystem.paused) _syncPlayButton();
}
