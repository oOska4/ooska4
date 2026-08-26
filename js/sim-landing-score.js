'use strict';

// sim-landing-score.js
// ============================================================================
// Wykrywanie prawdziwego ladowania (odroznienie od kolowania/podskoku na
// plycie) + liczenie oceny 0-100 na podstawie predkosci pionowej, odchylenia
// od osi pasa, punktu dotkniecia, kontroli predkosci i przechylu/znosu.
//
// Podlaczone z sim-physics.js: A321Entity.physicsUpdate() wola
// LandingScore.onTouchdown(entity, data) DOKLADNIE raz na przejsciu
// w-powietrzu -> na-ziemi (nie przy odbiciu). Sledzenie "czy realnie
// lecielismy" (trackAirborne) jest wolane co klatke z sim-main.js animate().
//
// Plan projektowy: .agents/simworld-dev/landing-replay-plan.md

// Powyzej tego AGL (m) uznajemy samolot za "realnie w locie" do celow
// odroznienia ladowania od kolowania/male go podskoku.
const LANDING_AIRBORNE_AGL_M = 15;
// Musial byc "w locie" (patrz wyzej) w ciagu ostatnich tylu sekund zeby
// nastepny kontakt z ziemia liczyl sie jako "ladowanie" a nie kolowanie.
const LANDING_AIRBORNE_WINDOW_S = 12;

// Progi oceny predkosci pionowej (fpm, wartosc bezwzgledna) - dopasowane do
// istniejacego progu "twardego ladowania" w sim-physics.js
// (BOUNCE_TRIGGER_VSPEED=7.2 m/s = ok. 1417 fpm to already-bounce; tutaj
// pelne 0 punktow zaczyna sie wczesniej, przy 600fpm, zeby ocena byla
// bardziej wymagajaca niz sam prog fizycznego odbicia).
const VS_PERFECT_FPM = 100;   // do tylu = pelne punkty
const VS_ZERO_FPM     = 600;  // od tylu = zero punktow

const CENTERLINE_PERFECT_M = 3;
const CENTERLINE_ZERO_M    = 20;

const TOUCHDOWN_ZONE_MIN_M = 150;
const TOUCHDOWN_ZONE_MAX_M = 500;
const TOUCHDOWN_ZONE_ZERO_MARGIN_M = 350; // poza [MIN,MAX] o tyle wiecej = zero pkt

const SPEED_PERFECT_OVER_KT = 5;  // Vref..Vref+5 = pelne punkty
const SPEED_ZERO_MARGIN_KT  = 15; // +-15kt od tego zakresu = zero pkt

const BANK_PERFECT_DEG = 3;
const BANK_ZERO_DEG    = 15;

const BOUNCE_PENALTY = 15;

// Waga poszczegolnych skladowych (sumuja sie do 100 gdy wszystkie dostepne;
// gdy brak danych o pasie (WorldAirport==null), centerline/touchdown-zone sa
// pomijane i pozostale wagi sa renormalizowane tak, by nadal sumowac do 100).
const WEIGHTS = { vs: 40, centerline: 20, zone: 15, speed: 15, bank: 10 };

// Handle function _lerpScore(). Liniowa ocena 0..1: 1 przy value<=perfect,
// 0 przy value>=zero, liniowo pomiedzy (value jest juz |odleglosc od idealu|).
function _linScore(value, perfect, zero) {
  if (value <= perfect) return 1;
  if (value >= zero) return 0;
  return 1 - (value - perfect) / (zero - perfect);
}

function _letterGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

const LandingScore = {
  _clockS: 0,
  _lastAirborneT: -Infinity,
  _bounceCount: 0,
  lastResult: null,

  // Wolane co klatke z animate() (sim-main.js), niezaleznie od physicsTick
  // throttlingu - potrzebujemy ciaglego zegara + sledzenia AGL.
  trackAirborne(entity, dt) {
    this._clockS += dt;
    if (entity && entity.agl > LANDING_AIRBORNE_AGL_M) this._lastAirborneT = this._clockS;
  },

  // Wolane z sim-physics.js applyBounce() posrednio - a wlasciwie kazde
  // odbicie miedzy dwoma "prawdziwymi" touchdownami traktujemy jako kare.
  // Prostsze rozwiazanie: liczymy odbicia w oknie kilku sekund PRZED
  // finalnym touchdown (patrz onTouchdown ponizej, uzywa _bounceCount
  // zliczanego tutaj).
  notifyBounce() {
    this._bounceCount++;
  },

  // Wolane z sim-physics.js przy przejsciu !onGround -> onGround.
  onTouchdown(entity, data) {
    const wasRecentlyAirborne = (this._clockS - this._lastAirborneT) <= LANDING_AIRBORNE_WINDOW_S;
    if (!wasRecentlyAirborne) { this._bounceCount = 0; return; } // kolowanie/podskok na plycie - ignorujemy

    const result = this._score(entity, data);
    this._bounceCount = 0;
    this.lastResult = result;

    if (typeof ReplaySystem !== 'undefined') ReplaySystem.prepareForLanding(this._clockS);
    if (typeof onLandingScored === 'function') onLandingScored(result);
  },

  _score(entity, data) {
    const vsFpm = data.impactVy * 196.85; // Units.msToFpm bez zaleznosci od kolejnosci ladowania skryptow
    const vsScore = _linScore(Math.abs(vsFpm), VS_PERFECT_FPM, VS_ZERO_FPM);

    let centerlineOffsetM = null, touchdownDistanceM = null, runwayHeadingDeg = null;
    let centerlineScore = null, zoneScore = null;

    const rwy = _activeRunwayThreshold(data.lat, data.lon);
    if (rwy) {
      const distM = geoDistM(rwy.lat, rwy.lon, data.lat, data.lon);
      if (distM > 0.01) {
        const bearingToTd = geoBearing(rwy.lat, rwy.lon, data.lat, data.lon);
        const diffRad = Units.degToRad(bearingToTd - rwy.bearingDeg);
        touchdownDistanceM = distM * Math.cos(diffRad);
        centerlineOffsetM  = distM * Math.sin(diffRad);
      } else {
        touchdownDistanceM = 0; centerlineOffsetM = 0;
      }
      runwayHeadingDeg = rwy.bearingDeg;
      centerlineScore = _linScore(Math.abs(centerlineOffsetM), CENTERLINE_PERFECT_M, CENTERLINE_ZERO_M);

      // Punkt dotkniecia: pelne punkty w [MIN,MAX], liniowy spadek poza tym
      // zakresem (osobno dla undershoot i dla long-landing).
      if (touchdownDistanceM >= TOUCHDOWN_ZONE_MIN_M && touchdownDistanceM <= TOUCHDOWN_ZONE_MAX_M) {
        zoneScore = 1;
      } else if (touchdownDistanceM < TOUCHDOWN_ZONE_MIN_M) {
        zoneScore = _linScore(TOUCHDOWN_ZONE_MIN_M - touchdownDistanceM, 0, TOUCHDOWN_ZONE_ZERO_MARGIN_M);
      } else {
        zoneScore = _linScore(touchdownDistanceM - TOUCHDOWN_ZONE_MAX_M, 0, TOUCHDOWN_ZONE_ZERO_MARGIN_M);
      }
    }

    // Kontrola predkosci vs Vref (1.3*Vstall - standardowe przyblizenie gdy
    // brak jawnej wartosci Vref w A321_PARAMS).
    const vref = A321_PARAMS.Vstall * 1.3;
    const overUnder = data.speedKt - vref;
    let speedScore;
    if (overUnder >= 0 && overUnder <= SPEED_PERFECT_OVER_KT) speedScore = 1;
    else if (overUnder < 0) speedScore = _linScore(-overUnder, 0, SPEED_ZERO_MARGIN_KT);
    else speedScore = _linScore(overUnder - SPEED_PERFECT_OVER_KT, 0, SPEED_ZERO_MARGIN_KT);

    const bankScore = _linScore(Math.abs(data.bankDeg), BANK_PERFECT_DEG, BANK_ZERO_DEG);

    // Renormalizacja wag gdy brak danych o pasie (centerline/zone==null).
    let weightSum = WEIGHTS.vs + WEIGHTS.speed + WEIGHTS.bank;
    let weighted  = WEIGHTS.vs * vsScore + WEIGHTS.speed * speedScore + WEIGHTS.bank * bankScore;
    if (centerlineScore !== null) { weightSum += WEIGHTS.centerline; weighted += WEIGHTS.centerline * centerlineScore; }
    if (zoneScore !== null)       { weightSum += WEIGHTS.zone;       weighted += WEIGHTS.zone * zoneScore; }

    let score = (weighted / weightSum) * 100;
    const bounced = this._bounceCount > 0;
    if (bounced) score -= BOUNCE_PENALTY;
    score = Math.max(0, Math.min(100, score));

    return {
      score: Math.round(score),
      grade: _letterGrade(score),
      vsFpm, centerlineOffsetM, touchdownDistanceM, runwayHeadingDeg,
      speedKt: data.speedKt, vref, bankDeg: data.bankDeg, bounced,
      clockS: this._clockS,
    };
  },
};

// Zwraca prog aktywnego pasa jako {lat, lon, bearingDeg} albo null gdy brak
// danych o lotnisku (WorldAirport==null lub brak runwayEnds). Wybieramy prog
// NAJBLIZSZY punktowi dotkniecia sposrod WSZYSTKICH koncow WSZYSTKICH pasow -
// bardziej niezawodne niz poleganie na selectedRunwayEndIdx (ktory jest
// stanem UI do wyboru gdzie zespawnowac, niekoniecznie zsynchronizowanym z
// tym, z ktorego kierunku user faktycznie podszedl do ladowania).
function _activeRunwayThreshold(tdLat, tdLon) {
  if (typeof WorldAirport === 'undefined' || !WorldAirport || !WorldAirport.runwayEnds || !WorldAirport.runwayEnds.length) return null;
  let best = null, bestDist = Infinity;
  for (const end of WorldAirport.runwayEnds) {
    const d = geoDistM(end.lat, end.lon, tdLat, tdLon);
    if (d < bestDist) { bestDist = d; best = end; }
  }
  return best;
}
