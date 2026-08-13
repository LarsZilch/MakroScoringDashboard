/**
 * Snapshot-Typ und -Bau: aus Rohreihen wird das Wochenbild.
 *
 * Ein Snapshot ist unveraenderlich und enthaelt bewusst KEINE Deltas.
 * Wochen- und Jahresvergleiche werden beim Lesen aus dem Bestand gerechnet
 * (siehe store.ts). Waeren sie eingebacken, muesste jeder Nachtrag saemtliche
 * Folgewochen umschreiben — und der Git-Verlauf, der hier das Gedaechtnis
 * bildet, waere wertlos.
 */

import { computeScoring } from '../core/scoring.js';
import {
  isoWeekEnd,
  isoWeekKey,
  isoWeekStart,
  isoDate,
  type IsoWeek,
} from '../core/isoweek.js';
import type {
  IndicatorId,
  IndicatorInput,
  RuleBook,
  ScoredFactor,
  ScoredIndicator,
  Regime,
} from '../core/types.js';
import { INDICATOR_IDS } from '../core/types.js';
import { INDICATOR_SPECS, ageInDays, type SeriesBundle } from './indicators.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Wie belastbar ist dieser Snapshot?
 *
 * - full:   alle neun Indikatoren vorhanden und aktuell
 * - partial: einzelne Werte fehlen oder sind veraltet, alle drei Faktoren
 *            bleiben aber bestimmbar
 * - sparse: mindestens ein Faktor ist mangels Daten nicht bestimmbar. Der
 *           Gesamtscore existiert dann zwar als Zahl, traegt aber keine
 *           Aussage und darf nicht wie ein regulaerer Stand gelesen werden.
 */
export type Completeness = 'full' | 'partial' | 'sparse';

export interface Snapshot {
  schemaVersion: number;
  rulesVersion: string;
  isoYear: number;
  isoWeek: number;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  /** Stichtag der Auswertung: bis zu diesem Datum werden Beobachtungen beruecksichtigt. */
  dataAsOf: string;
  builtAt: string;
  completeness: Completeness;
  /** Traegt der Gesamtscore eine Aussage, oder ist er ein Datenloch? */
  meaningful: boolean;
  /** Indikatoren ohne Wert — bei Backfill-Wochen der Normalfall. */
  missing: IndicatorId[];
  /** Indikatoren mit veraltetem Stand. */
  stale: IndicatorId[];
  /** Faktoren, die mangels Daten nicht bestimmbar sind. */
  undeterminableFactors: string[];
  indicators: Record<IndicatorId, ScoredIndicator>;
  factors: Record<string, ScoredFactor>;
  total: number;
  regime: Regime;
  /** Betriebshinweise dieses Laufs. */
  notes: string[];
}

export interface BuildOptions {
  /** Stichtag; ohne Angabe der Sonntag der Woche. */
  asOf?: string;
  /** true, wenn dies eine nachtraeglich gefuellte Woche ist. */
  backfill?: boolean;
  /** Volatilitaet je Indikator fuer die Grenzfall-Analyse. */
  volatility?: Partial<Record<IndicatorId, number | null>>;
}

/**
 * Alle Eingaben fuer eine Woche berechnen.
 *
 * Zentral ist hier die Altersfrage: ein Wert, dessen Beobachtung deutlich
 * aelter ist als der Veroeffentlichungsrhythmus des Indikators, wird als
 * "stale" gekennzeichnet. Ohne diese Pruefung wuerde "letzter Wert am
 * Stichtag oder davor" eine tote Quelle monatelang stillschweigend
 * weiterschleppen.
 */
export function buildInputs(
  bundle: SeriesBundle,
  asOf: string,
  volatility: BuildOptions['volatility'] = {},
  rules?: RuleBook,
): { inputs: Record<IndicatorId, IndicatorInput>; notes: string[] } {
  const inputs = {} as Record<IndicatorId, IndicatorInput>;
  const notes: string[] = [];

  for (const id of INDICATOR_IDS) {
    const spec = INDICATOR_SPECS[id];
    // Die Regel wird mitgegeben, damit Korridore in den Anzeigezeilen aus
    // dem Regelwerk stammen und nicht als Text doppelt gepflegt werden.
    const input = spec.compute(bundle, asOf, rules?.indicators[id]);

    if (input.measureValue !== null && input.obsDate) {
      const age = ageInDays(input.obsDate, asOf);
      if (age > spec.maxAgeDays) {
        input.quality = 'stale';
        notes.push(
          `${id}: Stand ${input.obsDate} ist am Stichtag ${asOf} bereits ${age} Tage alt ` +
            `(erwartet hoechstens ${spec.maxAgeDays}) — Wert wird als veraltet gefuehrt`,
        );
      }
    }

    const vol = volatility[id];
    if (vol !== undefined) input.volatility = vol;

    inputs[id] = input;
  }

  return { inputs, notes };
}

export function buildSnapshot(
  rules: RuleBook,
  bundle: SeriesBundle,
  week: IsoWeek,
  opts: BuildOptions = {},
): Snapshot {
  const weekStart = isoDate(isoWeekStart(week));
  const weekEnd = isoDate(isoWeekEnd(week));

  /*
   * Stichtag ist das Wochenende — aber nie ein Datum in der Zukunft. Fuer die
   * laufende Woche laege der Sonntag sonst noch vor uns, und das Dashboard
   * wiese einen Datenstand aus, den es gar nicht geben kann.
   */
  const today = isoDate(new Date());
  const asOf = opts.asOf ?? (weekEnd > today ? today : weekEnd);

  const { inputs, notes } = buildInputs(bundle, asOf, opts.volatility, rules);
  const scoring = computeScoring(rules, inputs);

  const stale = INDICATOR_IDS.filter((id) => scoring.indicators[id].quality === 'stale');

  const completeness: Completeness = !scoring.meaningful
    ? 'sparse'
    : scoring.missing.length === 0 && stale.length === 0
      ? 'full'
      : 'partial';

  if (opts.backfill) {
    notes.unshift(
      'Nachtraeglich gefuellte Woche (Backfill) — kein veroeffentlichter Stand',
    );
  }
  if (scoring.missing.length > 0) {
    notes.push(
      `${scoring.missing.length} von 9 Indikatoren ohne Wert: ${scoring.missing.join(', ')}`,
    );
  }
  if (!scoring.meaningful) {
    notes.push(
      `Nicht bestimmbare Faktoren: ${scoring.undeterminableFactors.join(', ')} — ` +
        `sie gehen als 0 in die Summe ein. Der Gesamtscore ${scoring.total} und das ` +
        `Regime "${scoring.regime.label}" sind daher KEINE Marktaussage, sondern Ausdruck ` +
        `einer Datenluecke und duerfen nicht als Stand gelesen werden.`,
    );
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    rulesVersion: rules.version,
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    weekKey: isoWeekKey(week),
    weekStart,
    weekEnd,
    dataAsOf: asOf,
    builtAt: new Date().toISOString(),
    completeness,
    meaningful: scoring.meaningful,
    missing: scoring.missing,
    stale,
    undeterminableFactors: scoring.undeterminableFactors,
    indicators: scoring.indicators,
    factors: scoring.factors,
    total: scoring.total,
    regime: scoring.regime,
    notes,
  };
}

/**
 * Volatilitaet je Indikator: Standardabweichung der Wochenveraenderung.
 *
 * Wird aus dem vorhandenen Snapshot-Bestand berechnet und in die
 * Grenzfall-Analyse gegeben, damit "wie leicht kippt das" ueber alle neun
 * Indikatoren hinweg vergleichbar wird.
 */
export function volatilityFromHistory(
  snapshots: Snapshot[],
): Partial<Record<IndicatorId, number | null>> {
  const out: Partial<Record<IndicatorId, number | null>> = {};
  const sorted = [...snapshots].sort((a, b) => a.weekKey.localeCompare(b.weekKey));

  for (const id of INDICATOR_IDS) {
    const values = sorted
      .map((s) => s.indicators[id]?.measureValue)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (values.length < 8) {
      out[id] = null; // zu wenig Historie fuer eine belastbare Streuung
      continue;
    }

    const diffs: number[] = [];
    for (let i = 1; i < values.length; i++) diffs.push(values[i]! - values[i - 1]!);
    const mean = diffs.reduce((a, d) => a + d, 0) / diffs.length;
    const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / diffs.length;
    const sd = Math.sqrt(variance);
    out[id] = sd > 0 ? sd : null;
  }

  return out;
}
