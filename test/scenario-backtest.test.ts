/**
 * Historische Auswertung der Szenarien.
 *
 * Geprueft wird gegen synthetische Snapshots, nicht gegen den echten Bestand:
 * jeder Wochenlauf wuerde sonst die Erwartungen verschieben. Der echte
 * Bestand kommt am Ende trotzdem vor — dort aber nur mit Invarianten, damit
 * der Datenpfad abgedeckt ist, ohne dass der Test an Zahlen klebt.
 *
 * Die drei Fallen, die diese Tests festnageln:
 *  1. ein fehlender Indikator darf keine Annahme erfuellen,
 *  2. nicht belastbare Wochen gehoeren nicht in die Grundgesamtheit,
 *  3. am Reihenende fehlt der Ausblick — das ist "truncated", nicht "unveraendert".
 */

import { describe, expect, it } from 'vitest';
import { computeScoring } from '../src/core/scoring.js';
import { addIsoWeeks, isoWeekKey, isoWeekRange, parseIsoWeekKey } from '../src/core/isoweek.js';
import { SCENARIOS } from '../src/core/scenario.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { backtestScenarios } from '../src/pipeline/scenario-backtest.js';
import { loadAllSnapshots } from '../src/pipeline/store.js';
import type { Snapshot } from '../src/pipeline/snapshot.js';
import type { IndicatorId, IndicatorInput } from '../src/core/types.js';

const rules = loadRules('v1');

/**
 * Ausgangslage, in der KEIN Szenario trifft: gli auf 0 statt -1, move und
 * sofr_iorb neutral. So bleibt jeder Treffer in den Tests absichtlich gesetzt.
 */
const NEUTRAL: Record<IndicatorId, IndicatorInput> = {
  ism_mfg_pmi: { measureValue: 0 },
  nfci: { measureValue: 0 },
  t10y2y: { measureValue: 0 },
  gli: { measureValue: 0 },
  move: { measureValue: 90 },
  sofr_iorb: { measureValue: 5 },
  vix: { measureValue: 20 },
  aaii: { measureValue: 0 },
  fear_greed: { measureValue: 50 },
};

function snapshotOf(weekKey: string, inputs: Partial<Record<IndicatorId, IndicatorInput>>): Snapshot {
  const week = parseIsoWeekKey(weekKey);
  const scoring = computeScoring(rules, { ...NEUTRAL, ...inputs });
  return {
    schemaVersion: 1,
    rulesVersion: rules.version,
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    weekKey,
    weekStart: '2026-01-01',
    weekEnd: '2026-01-07',
    dataAsOf: '2026-01-07',
    builtAt: '2026-01-07T00:00:00Z',
    completeness: scoring.meaningful ? 'full' : 'sparse',
    meaningful: scoring.meaningful,
    missing: scoring.missing,
    stale: [],
    undeterminableFactors: scoring.undeterminableFactors,
    indicators: scoring.indicators,
    factors: scoring.factors,
    total: scoring.total,
    regime: scoring.regime,
    notes: [],
  };
}

/** Die Annahmen von "funding_stress": sofr_iorb -1 und move -1. */
const STRESS = { sofr_iorb: { measureValue: 30 }, move: { measureValue: 150 } };

function of(report: ReturnType<typeof backtestScenarios>, id: string) {
  return report.scenarios.find((s) => s.scenarioId === id)!;
}

describe('Grundgesamtheit', () => {
  it('zaehlt nur belastbare Wochen', () => {
    // Eine Woche ohne Sentiment-Werte ist nicht bestimmbar und faellt raus,
    // obwohl die Annahme dort erfuellt waere.
    const luecke = snapshotOf('2024-W02', {
      ...STRESS,
      vix: { measureValue: null },
      aaii: { measureValue: null },
      fear_greed: { measureValue: null },
    });
    expect(luecke.meaningful).toBe(false);

    const report = backtestScenarios([snapshotOf('2024-W01', STRESS), luecke]);
    expect(report.basisWeeks).toBe(1);
    expect(of(report, 'funding_stress').occurrences).toBe(1);
    expect(of(report, 'funding_stress').weeks).toEqual(['2024-W01']);
  });

  it('meldet Zeitraum und Regelwerksstaende', () => {
    const report = backtestScenarios([
      snapshotOf('2024-W01', {}),
      snapshotOf('2024-W02', {}),
      snapshotOf('2024-W03', {}),
    ]);
    expect(report.from).toBe('2024-W01');
    expect(report.to).toBe('2024-W03');
    expect(report.rulesVersions).toEqual(['v1']);
  });
});

describe('Ein fehlender Wert erfuellt keine Annahme', () => {
  it('zaehlt eine Datenluecke nicht als Score 0', () => {
    /*
     * Fehlende Indikatoren stehen im Snapshot mit score 0. Ohne die
     * Qualitaetspruefung erfuellte jede Luecke einen Override auf 0 — und der
     * Backtest meldete Treffer, die nie stattgefunden haben.
     */
    const ohneMove = snapshotOf('2024-W01', { gli: { measureValue: -20 }, move: { measureValue: null } });
    expect(ohneMove.indicators.move.score).toBe(0);
    expect(ohneMove.indicators.move.quality).toBe('missing');

    // "liquidity_turns" verlangt gli -1 und move 0.
    const report = backtestScenarios([ohneMove]);
    expect(of(report, 'liquidity_turns').occurrences).toBe(0);
  });

  it('weist in der Abdeckung aus, woran es liegt', () => {
    const report = backtestScenarios([
      snapshotOf('2024-W01', { move: { measureValue: null } }),
      snapshotOf('2024-W02', { move: { measureValue: null } }),
      snapshotOf('2024-W03', {}),
    ]);

    const cov = of(report, 'liquidity_turns').coverage;
    expect(cov.find((c) => c.id === 'move')!.weeksWithValue).toBe(1);
    expect(cov.find((c) => c.id === 'move')!.firstWeekWithValue).toBe('2024-W03');
    expect(cov.find((c) => c.id === 'gli')!.weeksWithValue).toBe(3);
  });
});

describe('Der bindende Engpass', () => {
  /*
   * limitedBy geht nach weeksMatching, nicht nach weeksWithValue. Sonst
   * benennt die Anzeige den falschen Grund: ein Indikator kann durchgehend
   * Werte tragen und die Annahme trotzdem fast nie erfuellen — genau so liegt
   * es beim SOFR-Spread im echten Bestand.
   */
  it('nennt die seltenste Annahme, nicht den lueckenhaftesten Indikator', () => {
    // move traegt nur in 2 von 3 Wochen einen Wert, erfuellt die Annahme (-1)
    // dort aber immer. sofr_iorb traegt ueberall Werte, erfuellt -1 aber nie.
    const report = backtestScenarios([
      snapshotOf('2024-W01', { move: { measureValue: 150 } }),
      snapshotOf('2024-W02', { move: { measureValue: 150 } }),
      snapshotOf('2024-W03', { move: { measureValue: null } }),
    ]);

    const r = of(report, 'funding_stress');
    expect(r.occurrences).toBe(0);
    expect(r.coverage.find((c) => c.id === 'move')).toMatchObject({
      weeksWithValue: 2,
      weeksMatching: 2,
    });
    expect(r.coverage.find((c) => c.id === 'sofr_iorb')).toMatchObject({
      weeksWithValue: 3,
      weeksMatching: 0,
    });
    expect(r.limitedBy).toBe('sofr_iorb');
  });
});

describe('Episoden', () => {
  it('fasst aufeinander folgende Wochen zu einer Episode zusammen', () => {
    const weeks = ['2024-W01', '2024-W02', '2024-W03', '2024-W04', '2024-W05'];
    const report = backtestScenarios(weeks.map((w) => snapshotOf(w, STRESS)));

    const r = of(report, 'funding_stress');
    expect(r.occurrences).toBe(5);
    expect(r.episodes).toBe(1);
    expect(r.largestEpisodeShare).toBe(1);
    expect(r.concentrated).toBe(true);
    // Fuenf Wochen liegen unter MIN_WEEKS.
    expect(r.confidence).toBe('insufficient');
  });

  it('trennt Episoden ueber eine Luecke hinweg', () => {
    const report = backtestScenarios([
      snapshotOf('2024-W01', STRESS),
      snapshotOf('2024-W02', STRESS),
      snapshotOf('2024-W03', {}),
      snapshotOf('2024-W04', STRESS),
    ]);
    expect(of(report, 'funding_stress').episodes).toBe(2);
  });
});

describe('Vorwaertsblick', () => {
  /**
   * Fortlaufende Wochen bauen. `inputsAt` liefert die Eingaben je Position,
   * damit Treffer und Zielwochen gezielt gesetzt werden koennen.
   */
  function bestand(
    from: string,
    count: number,
    inputsAt: (i: number) => Partial<Record<IndicatorId, IndicatorInput>>,
  ): Snapshot[] {
    return isoWeekRange(parseIsoWeekKey(from), addIsoWeeks(parseIsoWeekKey(from), count - 1)).map(
      (w, i) => snapshotOf(isoWeekKey(w), inputsAt(i)),
    );
  }

  it('springt kalendergenau ueber ein 53-Wochen-Jahr', () => {
    /*
     * Treffer in KW 50/2020. 2020 hat 53 Wochen, also liegt +4 auf KW 01/2021.
     * Wer stattdessen 4 * 7 Tage rechnet oder die 53. Woche unterschlaegt,
     * landet auf KW 02/2021 — und traefe hier eine Woche mit anderem Regime.
     */
    const snaps = bestand('2020-W48', 10, (i) =>
      i === 2 ? STRESS : i === 6 ? { vix: { measureValue: 30 }, fear_greed: { measureValue: 20 } } : {},
    );
    expect(snaps[2]!.weekKey).toBe('2020-W50');
    expect(snaps[6]!.weekKey).toBe('2021-W01');

    const h4 = of(backtestScenarios(snaps), 'funding_stress').horizons.find((h) => h.weeks === 4)!;
    expect(h4.evaluated).toBe(1);
    expect(h4.truncated).toBe(0);
    expect(h4.byRegime).toEqual({ [snaps[6]!.regime.label]: 1 });
  });

  it('meldet fehlende Zielwochen als truncated, nicht als unveraendert', () => {
    // Treffer in der vorletzten Woche: kein 4-, 13- oder 26-Wochen-Ausblick.
    const report = backtestScenarios([snapshotOf('2024-W01', STRESS), snapshotOf('2024-W02', {})]);

    for (const h of of(report, 'funding_stress').horizons) {
      expect(h.evaluated, `${h.weeks} Wochen`).toBe(0);
      expect(h.truncated, `${h.weeks} Wochen`).toBe(1);
      expect(h.changed, `${h.weeks} Wochen`).toBe(0);
      expect(h.byRegime, `${h.weeks} Wochen`).toEqual({});
    }
  });

  it('zaehlt einen Regimewechsel im Ausblick', () => {
    // Ausloesewoche negativ, vier Wochen spaeter durchweg positiv.
    const snaps = bestand('2024-W01', 6, (i) =>
      i === 0
        ? { ...STRESS, nfci: { measureValue: 0.5 }, ism_mfg_pmi: { measureValue: -3 } }
        : i === 4
          ? {
              ism_mfg_pmi: { measureValue: 3 },
              nfci: { measureValue: -0.5 },
              gli: { measureValue: 20 },
              move: { measureValue: 60 },
              vix: { measureValue: 30 },
              fear_greed: { measureValue: 20 },
            }
          : {},
    );

    const r = of(backtestScenarios(snaps), 'funding_stress');
    expect(r.occurrences).toBe(1);
    expect(r.byRegime).toEqual({ [snaps[0]!.regime.label]: 1 });

    const h4 = r.horizons.find((h) => h.weeks === 4)!;
    expect(h4.evaluated).toBe(1);
    expect(h4.changed).toBe(1);
    expect(h4.byRegime).toEqual({ [snaps[4]!.regime.label]: 1 });
    expect(snaps[4]!.regime.label).not.toBe(snaps[0]!.regime.label);
  });
});

describe('Invarianten am echten Bestand', () => {
  /*
   * Bewusst ohne feste Zahlen: der naechste Wochenlauf aendert den Bestand,
   * die Invarianten aber nicht.
   */
  const report = backtestScenarios(loadAllSnapshots());

  it('deckt alle Szenarien ab', () => {
    expect(report.scenarios).toHaveLength(SCENARIOS.length);
    expect(report.scenarios.map((s) => s.scenarioId).sort()).toEqual(
      SCENARIOS.map((s) => s.id).sort(),
    );
  });

  it('haelt Zaehlungen und Grundgesamtheit konsistent', () => {
    for (const s of report.scenarios) {
      expect(s.occurrences, s.scenarioId).toBeLessThanOrEqual(report.basisWeeks);
      expect(s.weeks, s.scenarioId).toHaveLength(s.occurrences);
      expect(
        Object.values(s.byRegime).reduce((a, b) => a + b, 0),
        s.scenarioId,
      ).toBe(s.occurrences);

      for (const h of s.horizons) {
        expect(h.evaluated + h.truncated, `${s.scenarioId} / ${h.weeks}`).toBe(s.occurrences);
        expect(
          Object.values(h.byRegime).reduce((a, b) => a + b, 0),
          `${s.scenarioId} / ${h.weeks}`,
        ).toBe(h.evaluated);
        expect(h.changed, `${s.scenarioId} / ${h.weeks}`).toBeLessThanOrEqual(h.evaluated);
      }

      // Kein Override kann oefter zutreffen, als er ueberhaupt einen Wert hat.
      for (const c of s.coverage) {
        expect(c.weeksMatching, `${s.scenarioId} / ${c.id}`).toBeLessThanOrEqual(c.weeksWithValue);
        expect(s.occurrences, `${s.scenarioId} / ${c.id}`).toBeLessThanOrEqual(c.weeksMatching);
      }
    }
  });

  it('sortiert die Vorkommen aufsteigend', () => {
    for (const s of report.scenarios) {
      expect(s.weeks, s.scenarioId).toEqual([...s.weeks].sort());
      expect(s.firstWeek, s.scenarioId).toBe(s.weeks[0] ?? null);
      expect(s.lastWeek, s.scenarioId).toBe(s.weeks[s.weeks.length - 1] ?? null);
    }
  });
});
