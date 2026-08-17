/**
 * Regime-Reihen fuer die Auswertung gegen Anlageklassen.
 *
 * Zwei Quellen, streng getrennt:
 *
 * - `live`: die tatsaechlichen Snapshots aus data/snapshots/. Das ist das
 *   veroeffentlichte Gedaechtnis — nur die belastbaren Wochen zaehlen, derzeit
 *   817 ab KW 51/2010.
 *
 * - `reduced`: das VERGLEICHSMODELL 2018. Es rechnet mit denselben Schwellen,
 *   aber nur mit den sechs Indikatoren, die historisch verfuegbar sind, und
 *   mit der verallgemeinerten Mehrheitsregel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Das Vergleichsmodell ist NICHT die Verlaengerung des echten Modells.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sein Sentiment-Faktor besteht allein aus dem VIX, sein Business-Cycle-Faktor
 * nur aus NFCI und Zinskurve — ISM, AAII und Fear & Greed sind historisch
 * ueberhaupt nicht zu bekommen. Das ist eine andere Methodik.
 *
 * Deshalb wird es NIE in den Snapshot-Bestand geschrieben, sondern bei Bedarf
 * aus dem Rohdaten-Cache gerechnet. Das kostet Millisekunden und haelt das
 * Gedaechtnis der App sauber.
 */

import { computeScoring } from '../core/scoring.js';
import {
  isoWeekEnd,
  isoWeekKey,
  isoWeekOf,
  isoWeekRange,
  isoDate,
  type IsoWeek,
} from '../core/isoweek.js';
import { INDICATOR_IDS, type IndicatorId, type RuleBook } from '../core/types.js';
import { INDICATOR_SPECS, type SeriesBundle } from './indicators.js';
import { loadAllSnapshots } from './store.js';

export type RegimeMode = 'live' | 'reduced';

/** Indikatoren, die im Vergleichsmodell mitgerechnet werden. */
export const REDUCED_INDICATORS: IndicatorId[] = [
  'nfci',
  't10y2y',
  'gli',
  'move',
  'sofr_iorb',
  'vix',
];

/** Historisch frei nicht verfuegbar und daher im Vergleichsmodell ausgelassen. */
export const REDUCED_OMITTED: IndicatorId[] = INDICATOR_IDS.filter(
  (id) => !REDUCED_INDICATORS.includes(id),
);

export interface RegimeWeek {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  total: number;
  regime: string;
  /** Faktorscores, fuer die Anzeige. */
  factors: Record<string, number>;
}

export interface RegimeSeries {
  mode: RegimeMode;
  label: string;
  weeks: RegimeWeek[];
  /** Warum diese Reihe ist, wie sie ist — geht unveraendert in die Oberflaeche. */
  caveat: string;
  omitted: IndicatorId[];
  from: string | null;
  to: string | null;
}

/** Die tatsaechlichen, belastbaren Wochen aus dem Snapshot-Bestand. */
export function liveRegimeSeries(): RegimeSeries {
  const weeks = loadAllSnapshots()
    .filter((s) => s.meaningful)
    .map((s) => ({
      weekKey: s.weekKey,
      isoYear: s.isoYear,
      isoWeek: s.isoWeek,
      total: s.total,
      regime: s.regime.label,
      factors: Object.fromEntries(Object.entries(s.factors).map(([k, f]) => [k, f.score])),
    }));

  return {
    mode: 'live',
    label: 'Echtes Modell',
    weeks,
    caveat:
      `Alle neun Indikatoren, wie veroeffentlicht. Belastbar sind derzeit nur ${weeks.length} Wochen, ` +
      `weil ISM, AAII und Fear & Greed oeffentlich nicht weiter zurueckreichen.`,
    omitted: [],
    from: weeks[0]?.weekKey ?? null,
    to: weeks[weeks.length - 1]?.weekKey ?? null,
  };
}

/**
 * Frueheste Woche, ab der alle sechs reduzierten Indikatoren rechenbar sind.
 *
 * Bindend ist in der Praxis der SOFR (ab April 2018). Ermittelt wird das aber
 * aus den Daten selbst, damit die Grenze mitwandert, wenn sich der Cache
 * aendert — statt als Jahreszahl im Code zu stehen.
 */
export function reducedStartWeek(bundle: SeriesBundle): IsoWeek | null {
  let latestStart = '';
  for (const id of REDUCED_INDICATORS) {
    for (const seriesId of INDICATOR_SPECS[id].requires) {
      const first = bundle[seriesId]?.[0]?.date;
      if (!first) return null;
      if (first > latestStart) latestStart = first;
    }
  }
  if (!latestStart) return null;

  // Vier Monate Vorlauf, damit die 3-Monats-Ableitungen ab der ersten Woche
  // tatsaechlich rechnen und nicht als "fehlend" durchfallen.
  const start = new Date(`${latestStart}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 4);
  return isoWeekOf(start);
}

/**
 * Das Vergleichsmodell durchrechnen.
 *
 * Die ausgelassenen Indikatoren werden ausdruecklich auf "kein Wert" gesetzt,
 * statt sie wegzulassen — so laeuft alles durch dieselbe Aggregation wie sonst
 * auch, nur eben im Modus `available`.
 */
export function reducedRegimeSeries(rules: RuleBook, bundle: SeriesBundle): RegimeSeries {
  const start = reducedStartWeek(bundle);
  const end = isoWeekOf(new Date());

  const weeks: RegimeWeek[] = [];
  if (start) {
    for (const week of isoWeekRange(start, end)) {
      const asOf = isoDate(isoWeekEnd(week));
      const today = isoDate(new Date());
      const effective = asOf > today ? today : asOf;

      const inputs = {} as Record<IndicatorId, ReturnType<(typeof INDICATOR_SPECS)[IndicatorId]['compute']>>;
      for (const id of INDICATOR_IDS) {
        inputs[id] = REDUCED_INDICATORS.includes(id)
          ? INDICATOR_SPECS[id].compute(bundle, effective, rules.indicators[id])
          : { measureValue: null, quality: 'missing' };
      }

      const scoring = computeScoring(rules, inputs, 'available');
      // Wochen, in denen selbst die reduzierten Indikatoren fehlen, fallen raus.
      if (!scoring.meaningful) continue;

      weeks.push({
        weekKey: isoWeekKey(week),
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        total: scoring.total,
        regime: scoring.regime.label,
        factors: Object.fromEntries(
          Object.entries(scoring.factors).map(([k, f]) => [k, f.score]),
        ),
      });
    }
  }

  return {
    mode: 'reduced',
    label: 'Vergleichsmodell 2018',
    weeks,
    caveat:
      'ANDERE METHODIK, nicht die Verlaengerung des echten Modells: gerechnet wird nur mit ' +
      `${REDUCED_INDICATORS.length} der neun Indikatoren, weil ${REDUCED_OMITTED.length} historisch ` +
      'nicht zu bekommen sind. Der Sentiment-Faktor besteht dadurch allein aus dem VIX, der ' +
      'Business-Cycle-Faktor nur aus NFCI und Zinskurve. Die Mehrheit bezieht sich auf die ' +
      'vorhandenen Werte. Diese Reihe dient dem Vergleich mit Anlageklassen — sie ist kein ' +
      'veroeffentlichter Stand und wird nicht gespeichert.',
    omitted: REDUCED_OMITTED,
    from: weeks[0]?.weekKey ?? null,
    to: weeks[weeks.length - 1]?.weekKey ?? null,
  };
}

/** Regime je Woche, als Nachschlagewerk fuer die Renditezuordnung. */
export function regimeMap(series: RegimeSeries): Map<string, string> {
  return new Map(series.weeks.map((w) => [w.weekKey, w.regime]));
}
