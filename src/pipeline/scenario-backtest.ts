/**
 * Wie oft lag die von einem Szenario angenommene Indikator-Lage historisch
 * tatsaechlich vor, und was folgte darauf?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS IST EINE ANDERE FRAGE ALS DIE DES HILFE-TABS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dort wird ein Szenario kontrafaktisch auf die gewaehlte Woche gelegt: "was
 * waere, wenn". Hier wird gezaehlt, wann genau diese Lage schon einmal galt:
 * "wann war es so". Beides zu vermischen waere die Behauptung einer
 * Eintrittswahrscheinlichkeit — die hat ein Szenario nicht, und die Daten
 * geben sie auch nicht her.
 *
 * Reine Funktion ueber eine uebergebene Snapshot-Liste: der Server laedt,
 * dieses Modul rechnet.
 */

import { addIsoWeeks, isoWeekKey, parseIsoWeekKey } from '../core/isoweek.js';
import { SCENARIOS, type ScenarioDefinition } from '../core/scenario.js';
import type { IndicatorId, Score } from '../core/types.js';
import {
  CONCENTRATION_LIMIT,
  confidenceOf,
  countEpisodes,
  type Confidence,
} from './asset-returns.js';
import type { Snapshot } from './snapshot.js';

/** Wie weit nach vorn geschaut wird. */
export const HORIZONS = [4, 13, 26] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface HorizonOutcome {
  weeks: Horizon;
  /** Vorkommen, deren Zielwoche belastbar im Bestand liegt. */
  evaluated: number;
  /**
   * Vorkommen, deren Zielwoche jenseits des Bestandsendes liegt.
   *
   * Wird ausgewiesen statt stillschweigend aus dem Nenner genommen: die
   * juengsten 26 belastbaren Wochen koennen keinen 26-Wochen-Ausblick haben,
   * und wer das verschweigt, schoent das Ergebnis.
   */
  truncated: number;
  /** Von den ausgewerteten: Regime anders als in der Ausloesewoche. */
  changed: number;
  /** Regime in der Zielwoche, ueber alle ausgewerteten Vorkommen. */
  byRegime: Record<string, number>;
}

/**
 * Abdeckung eines einzelnen Overrides.
 *
 * Ohne diese Angabe liest sich "0 Vorkommen" wie ein Befund ueber den Markt,
 * obwohl es oft einer ueber die Datenlage ist: der ISM traegt in 42 von 817
 * belastbaren Wochen ueberhaupt einen Wert. Das ist die Projektregel "ein
 * fehlender Wert darf nie wie eine 0 aussehen", eine Ebene hoeher.
 *
 * Der Fall stand hier lange mit AAII als Beispiel — bis dessen Historie
 * nachgeladen wurde (npm run import:aaii) und aus der Null 29 Vorkommen
 * wurden. Genau dafuer ist die Angabe da.
 */
export interface OverrideCoverage {
  id: IndicatorId;
  label: string;
  assumed: Score;
  /** Belastbare Wochen mit echtem Wert fuer diesen Indikator. */
  weeksWithValue: number;
  /** Davon Wochen, in denen genau der angenommene Score vorlag. */
  weeksMatching: number;
  firstWeekWithValue: string | null;
}

export interface ScenarioBacktest {
  scenarioId: string;
  /** Wochen, in denen ALLE Annahmen gleichzeitig galten. */
  occurrences: number;
  /** Zusammenhaengende Phasen — das ehrlichere Mass fuer die Stichprobe. */
  episodes: number;
  largestEpisodeShare: number;
  concentrated: boolean;
  confidence: Confidence;
  /** Regime in den Ausloesewochen selbst. */
  byRegime: Record<string, number>;
  firstWeek: string | null;
  lastWeek: string | null;
  horizons: HorizonOutcome[];
  coverage: OverrideCoverage[];
  /**
   * Der bindende Engpass: der Override, der am seltensten allein zutraf.
   *
   * Bewusst nach weeksMatching und nicht nach weeksWithValue. Ein gemeinsames
   * Vorkommen kann nie haeufiger sein als die seltenste Einzelannahme — die
   * blosse Abdeckung eines Indikators sagt darueber nichts: der SOFR-Spread
   * hat 437 Wochen mit Wert, stand darin aber nur 13-mal auf -1.
   */
  limitedBy: IndicatorId | null;
  /** Die Vorkommen selbst, aufsteigend. */
  weeks: string[];
}

export interface ScenarioBacktestReport {
  /** Grundgesamtheit: belastbare Wochen im Bestand. */
  basisWeeks: number;
  from: string | null;
  to: string | null;
  /**
   * Regelwerksstaende der Grundgesamtheit. Bei mehr als einem Eintrag mischt
   * die Auswertung Methodiken und das UI muss warnen.
   */
  rulesVersions: string[];
  scenarios: ScenarioBacktest[];
}

/**
 * Erfuellt der Indikator die Annahme?
 *
 * Die Qualitaetspruefung ist nicht optional: ohne sie erfuellte jede
 * Datenluecke einen Override auf 0, weil fehlende Indikatoren im Snapshot mit
 * score 0 stehen. Dieselbe Falle wie beim Wochenvergleich in store.ts.
 */
function matches(snapshot: Snapshot, id: IndicatorId, assumed: Score): boolean {
  const ind = snapshot.indicators[id];
  return Boolean(ind) && ind.quality !== 'missing' && ind.score === assumed;
}

function hasValue(snapshot: Snapshot, id: IndicatorId): boolean {
  const ind = snapshot.indicators[id];
  return Boolean(ind) && ind.quality !== 'missing';
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function coverageOf(
  basis: Snapshot[],
  id: IndicatorId,
  assumed: Score,
  label: string,
): OverrideCoverage {
  const withValue = basis.filter((s) => hasValue(s, id));
  return {
    id,
    label,
    assumed,
    weeksWithValue: withValue.length,
    weeksMatching: withValue.filter((s) => s.indicators[id].score === assumed).length,
    firstWeekWithValue: withValue[0]?.weekKey ?? null,
  };
}

function backtestOne(
  scenario: ScenarioDefinition,
  basis: Snapshot[],
  byWeek: Map<string, Snapshot>,
  labels: Record<string, string>,
): ScenarioBacktest {
  const overrides = Object.entries(scenario.overrides) as [IndicatorId, Score][];

  const hits = basis.filter((s) => overrides.every(([id, assumed]) => matches(s, id, assumed)));
  const weeks = hits.map((s) => s.weekKey);

  const episodeLengths = countEpisodes(weeks);
  const largest = episodeLengths.length > 0 ? Math.max(...episodeLengths) : 0;
  const largestEpisodeShare = weeks.length > 0 ? largest / weeks.length : 0;

  /*
   * Der Vorwaertsblick geht ueber den Kalender, nicht ueber den Array-Index.
   * Der Bestand ist heute zwar lueckenlos, aber ein einziger ausgefallener
   * Wochenlauf wuerde einen Indexsprung still verrutschen lassen — und der
   * Fehler waere von aussen nicht zu sehen.
   */
  const horizons = HORIZONS.map((n): HorizonOutcome => {
    const later: string[] = [];
    let truncated = 0;
    let changed = 0;

    for (const hit of hits) {
      const target = byWeek.get(isoWeekKey(addIsoWeeks(parseIsoWeekKey(hit.weekKey), n)));
      if (!target) {
        truncated++;
        continue;
      }
      later.push(target.regime.label);
      if (target.regime.label !== hit.regime.label) changed++;
    }

    return { weeks: n, evaluated: later.length, truncated, changed, byRegime: tally(later) };
  });

  const coverage = overrides.map(([id, assumed]) =>
    coverageOf(basis, id, assumed, labels[id] ?? id),
  );
  const scarcest = coverage.reduce<OverrideCoverage | null>(
    (min, c) => (min === null || c.weeksMatching < min.weeksMatching ? c : min),
    null,
  );

  return {
    scenarioId: scenario.id,
    occurrences: weeks.length,
    episodes: episodeLengths.length,
    largestEpisodeShare,
    concentrated: episodeLengths.length > 0 && largestEpisodeShare >= CONCENTRATION_LIMIT,
    confidence: confidenceOf(weeks.length),
    byRegime: tally(hits.map((s) => s.regime.label)),
    firstWeek: weeks[0] ?? null,
    lastWeek: weeks[weeks.length - 1] ?? null,
    horizons,
    coverage,
    limitedBy: scarcest?.id ?? null,
    weeks,
  };
}

export function backtestScenarios(snapshots: Snapshot[]): ScenarioBacktestReport {
  /*
   * Grundgesamtheit sind ausschliesslich belastbare Wochen. Eine Woche, in der
   * ein Faktor mangels Daten unbestimmt ist, traegt kein Regime, das man
   * zaehlen duerfte — weder als Ausloese- noch als Zielwoche.
   */
  const basis = snapshots.filter((s) => s.meaningful).sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  const byWeek = new Map(basis.map((s) => [s.weekKey, s]));

  // Beschriftungen aus dem juengsten Stand: sie stehen im Snapshot auch dann,
  // wenn der Indikator selbst keinen Wert hat.
  const labels: Record<string, string> = {};
  const newest = basis[basis.length - 1];
  if (newest) {
    for (const [id, ind] of Object.entries(newest.indicators)) labels[id] = ind.label;
  }

  return {
    basisWeeks: basis.length,
    from: basis[0]?.weekKey ?? null,
    to: newest?.weekKey ?? null,
    rulesVersions: [...new Set(basis.map((s) => s.rulesVersion))].sort(),
    scenarios: SCENARIOS.map((s) => backtestOne(s, basis, byWeek, labels)),
  };
}
