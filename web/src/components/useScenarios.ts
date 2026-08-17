/**
 * Szenarien fuer die Anzeige: Rechnung, Text und Backtest in einem Objekt.
 *
 * Dashboard und Hilfe zeigen dieselben vier Szenarien in unterschiedlicher
 * Tiefe. Dieser Hook ist die eine Stelle, an der die drei Quellen
 * zusammenkommen — und die eine Stelle, an der die Typen der Frontend-Sicht
 * auf die des Kerns umgesetzt werden.
 */

import { useMemo } from 'react';
import { SCENARIOS, applyScenario, type ScenarioOutcome } from '../../../src/core/scenario.js';
import type { RuleBook as CoreRuleBook } from '../../../src/core/types.js';
import { SCENARIO_TEXTS } from '../content/help';
import type { RulesResponse, ScenarioBacktest, ScenarioBacktestReport, Snapshot } from '../types';

export interface ScenarioView extends ScenarioOutcome {
  title: string;
  trigger: string;
  narrative: string;
  /** null, solange /api/scenarios nicht geladen ist oder ausgefallen war. */
  backtest: ScenarioBacktest | null;
}

/**
 * Warum hier gecastet wird: web/src/types.ts spiegelt die Kern-Typen bewusst
 * lose (id: string statt IndicatorId), damit das Frontend nicht an jeder
 * JSON-Grenze umtypisieren muss. Die Umsetzung gehoert deshalb an genau eine
 * Stelle und nicht verstreut in die Komponenten.
 */
export function useScenarios(
  snapshot: Snapshot,
  rules: RulesResponse | null,
  backtest: ScenarioBacktestReport | null,
): ScenarioView[] {
  return useMemo(() => {
    if (!rules) return [];
    const core = rules.rules as unknown as CoreRuleBook;
    const base = snapshot as unknown as Parameters<typeof applyScenario>[1];

    return SCENARIOS.map((scenario) => ({
      ...applyScenario(core, base, scenario),
      ...SCENARIO_TEXTS[scenario.id],
      backtest: backtest?.scenarios.find((s) => s.scenarioId === scenario.id) ?? null,
    }));
  }, [snapshot, rules, backtest]);
}
