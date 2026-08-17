/**
 * Szenarien: die Annahmen und ihre Anwendung auf eine bestehende Lage.
 *
 * Hier stehen ausschliesslich Kennungen und angenommene Indikator-Scores.
 * Titel, Ausloeser und Einordnung sind erzaehlender Text und liegen in
 * web/src/content/help.ts — der Server braucht sie fuer den Backtest nie.
 *
 * Gerechnet wird mit aggregateFactor() und resolveRegime() aus demselben Kern,
 * der auch die Snapshots erzeugt. Eine zweite Implementierung koennte
 * auseinanderlaufen; genau dafuer ist src/core/ frei von Datei- und
 * Netzzugriff.
 */

import { aggregateFactor, resolveRegime } from './scoring.js';
import type {
  FactorId,
  IndicatorId,
  Regime,
  RuleBook,
  Score,
  ScoredFactor,
  ScoredIndicator,
} from './types.js';

export interface ScenarioDefinition {
  readonly id: string;
  /** Angenommene Scores je Indikator. Nicht genannte bleiben, wie sie sind. */
  readonly overrides: Readonly<Partial<Record<IndicatorId, Score>>>;
}

export const SCENARIOS = [
  { id: 'liquidity_turns', overrides: { gli: -1, move: 0 } },
  { id: 'greed_extreme', overrides: { fear_greed: -1, aaii: -1 } },
  { id: 'cycle_breaks', overrides: { ism_mfg_pmi: -1, nfci: -1 } },
  { id: 'funding_stress', overrides: { sofr_iorb: -1, move: -1 } },
] as const satisfies readonly ScenarioDefinition[];

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Ausgangslage einer Szenariorechnung.
 *
 * Bewusst nur die vier Felder, die gebraucht werden: sowohl ein ScoringResult
 * als auch ein Snapshot erfuellen sie, ohne dass der Kern den Snapshot-Typ
 * kennen muesste (der gehoert in die Pipeline, nicht hierher).
 */
export interface ScenarioBase {
  indicators: Record<IndicatorId, ScoredIndicator>;
  factors: Record<FactorId, ScoredFactor>;
  total: number;
  regime: Regime;
}

export interface ScenarioMove {
  id: IndicatorId;
  label: string;
  before: Score;
  after: Score;
}

export interface ScenarioFactorChange {
  id: FactorId;
  label: string;
  before: Score;
  after: Score;
  determinableAfter: boolean;
}

export interface ScenarioOutcome {
  scenarioId: string;
  /** Nur Indikatoren, die sich tatsaechlich bewegen. */
  moves: ScenarioMove[];
  factors: ScenarioFactorChange[];
  totalBefore: number;
  totalAfter: number;
  regimeBefore: Regime;
  regimeAfter: Regime;
  changed: boolean;
  /** Die angenommenen Werte liegen bereits vor — das Szenario ist eingetreten. */
  alreadyTrue: boolean;
  /**
   * Overrides auf Indikatoren ohne Wert. Das Szenario SETZT hier einen Stand
   * an, statt einen vorhandenen zu bewegen — die Anzeige muss das ausweisen,
   * sonst liest sich eine Datenluecke wie ein Befund.
   */
  assumedWithoutValue: IndicatorId[];
}

/**
 * Ein Szenario auf eine bestehende Lage anwenden.
 *
 * Die Faktormitglieder kommen aus base.factors[...].indicators, nicht aus
 * einer eigenen Zuordnungstabelle: das Regelwerk bestimmt, welcher Indikator
 * zu welchem Faktor gehoert, und eine Kopie dieser Zuordnung waere die
 * naechste Stelle, die auseinanderlaufen kann.
 */
export function applyScenario(
  rules: RuleBook,
  base: ScenarioBase,
  scenario: ScenarioDefinition,
): ScenarioOutcome {
  const moves: ScenarioMove[] = [];
  const assumedWithoutValue: IndicatorId[] = [];
  const factors: ScenarioFactorChange[] = [];
  let totalAfter = 0;

  for (const f of [...rules.factors].sort((a, b) => a.ordinal - b.ordinal)) {
    const before = base.factors[f.id];
    const members = before.indicators.map((id) => {
      const ind = base.indicators[id];
      const override = scenario.overrides[id];
      if (override === undefined) return ind;

      /*
       * Die Qualitaet muss mitgesetzt werden. aggregateFactor() filtert
       * Mitglieder mit quality "missing" heraus — ein Override auf einen
       * fehlenden Indikator bliebe sonst wirkungslos, waehrend die Anzeige
       * eine Bewegung behauptet.
       */
      if (ind.quality === 'missing') {
        assumedWithoutValue.push(id);
        return { ...ind, score: override, quality: 'manual' as const };
      }

      if (ind.score !== override) {
        moves.push({ id, label: ind.label, before: ind.score, after: override });
      }
      return { ...ind, score: override };
    });

    const after = aggregateFactor(f.id, f.label, members, rules.factorAggregation.minCount);
    factors.push({
      id: f.id,
      label: f.label,
      before: before.score,
      after: after.score,
      determinableAfter: after.determinable,
    });
    totalAfter += after.score;
  }

  const regimeAfter = resolveRegime(rules, totalAfter);

  return {
    scenarioId: scenario.id,
    moves,
    factors,
    totalBefore: base.total,
    totalAfter,
    regimeBefore: base.regime,
    regimeAfter,
    changed: regimeAfter.label !== base.regime.label,
    alreadyTrue: moves.length === 0 && assumedWithoutValue.length === 0,
    assumedWithoutValue,
  };
}
