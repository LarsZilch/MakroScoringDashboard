/**
 * Szenariorechnung des Hilfe-Tabs.
 *
 * Der Tab rechnet Szenarien mit demselben Scoring-Kern, der auch die
 * Snapshots erzeugt — er setzt einzelne Indikator-Scores und aggregiert neu.
 * Diese Tests halten fest, dass diese Rechnung stimmt, damit die Hilfe keine
 * Ergebnisse behauptet, die das Modell so nicht liefern wuerde.
 *
 * Geprueft wird ausserdem die Uebersetzung der Bewertungsbaender in
 * Skalen-Abschnitte: die Baender sind eine Trefferliste, die Leiste braucht
 * eine lueckenlose Folge.
 */

import { describe, expect, it } from 'vitest';
import { aggregateFactor, computeScoring, resolveRegime } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { INDICATOR_IDS, type IndicatorId, type IndicatorInput, type Score } from '../src/core/types.js';
import { bandsToSegments } from '../web/src/components/BandScale.js';

const rules = loadRules('v1');

const FACTOR_ORDER = ['business_cycle', 'liquidity', 'sentiment'] as const;

/** Ausgangslage: die Werte aus der Vorlage, KW 32/2026 -> Gesamtscore +2. */
const KW32: Record<IndicatorId, IndicatorInput> = {
  ism_mfg_pmi: { measureValue: 2.9 },
  nfci: { measureValue: -0.03 },
  t10y2y: { measureValue: -3 },
  gli: { measureValue: -8.0 },
  move: { measureValue: 76 },
  sofr_iorb: { measureValue: -1 },
  vix: { measureValue: 15.15 },
  aaii: { measureValue: -3.2 },
  fear_greed: { measureValue: 60 },
};

/**
 * Dieselbe Rechnung wie in web/src/components/Help.tsx: einzelne Scores
 * ueberschreiben, Faktoren neu aggregieren, Regime aufloesen.
 */
function runScenario(overrides: Partial<Record<IndicatorId, Score>>) {
  const base = computeScoring(rules, KW32);
  let total = 0;
  const factors: Record<string, Score> = {};

  for (const factorId of FACTOR_ORDER) {
    const members = INDICATOR_IDS.filter((id) => rules.indicators[id].factor === factorId).map(
      (id) => {
        const ind = base.indicators[id];
        const override = overrides[id];
        return override === undefined ? ind : { ...ind, score: override };
      },
    );
    const agg = aggregateFactor(
      factorId,
      base.factors[factorId].label,
      members,
      rules.factorAggregation.minCount,
    );
    factors[factorId] = agg.score;
    total += agg.score;
  }

  return { total, factors, regime: resolveRegime(rules, total) };
}

describe('Ausgangslage', () => {
  it('startet bei Gesamtscore +2 und Risk On', () => {
    const base = computeScoring(rules, KW32);
    expect(base.total).toBe(2);
    expect(base.regime.label).toBe('Risk On');
  });
});

describe('Szenario: Liquiditaetsimpuls dreht ab', () => {
  it('nimmt dem Liquiditaetsfaktor die Mehrheit und zieht das Regime auf Neutral', () => {
    // gli faellt auf -1, MOVE verliert seinen positiven Beitrag.
    // Faktor 2 steht dann bei -1 / 0 / +1 -> keine Mehrheit -> 0.
    const r = runScenario({ gli: -1, move: 0 });
    expect(r.factors.liquidity).toBe(0);
    expect(r.factors.business_cycle).toBe(1);
    expect(r.total).toBe(1);
    expect(r.regime.label).toBe('Neutral');
    expect(r.regime.cashBand).toEqual([20, 35]);
  });
});

describe('Szenario: Sentiment kippt in Extreme Greed', () => {
  it('macht den Sentiment-Faktor negativ und zieht den Gesamtscore auf +1', () => {
    // Zwei von drei Sentiment-Indikatoren negativ -> Mehrheit -> Faktor -1.
    const r = runScenario({ fear_greed: -1, aaii: -1 });
    expect(r.factors.sentiment).toBe(-1);
    expect(r.total).toBe(1);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Szenario: Konjunktur bricht ein', () => {
  it('dreht den Business-Cycle-Faktor vollstaendig durch', () => {
    // Von +1 auf -1 ist ein Sprung von zwei Punkten im Gesamtscore.
    const r = runScenario({ ism_mfg_pmi: -1, nfci: -1 });
    expect(r.factors.business_cycle).toBe(-1);
    expect(r.total).toBe(0);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Szenario: Funding-Stress', () => {
  it('dreht den Liquiditaetsfaktor auf -1 und fuehrt zu Neutral', () => {
    // gli steht in der Ausgangslage bereits auf -1; kommen sofr_iorb und
    // move dazu, sind alle drei negativ.
    const r = runScenario({ sofr_iorb: -1, move: -1 });
    expect(r.factors.liquidity).toBe(-1);
    expect(r.total).toBe(0);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Ein einzelner Indikator reicht nie fuer einen Faktorwechsel', () => {
  it('laesst den Faktor stehen, wenn nur ein Indikator kippt', () => {
    // Die Mehrheitsregel braucht zwei. Faktor 1 hat +1/+1/0; kippt der ISM
    // auf 0, bleibt mit dem NFCI nur noch ein positiver -> Faktor faellt auf 0.
    const r = runScenario({ ism_mfg_pmi: 0 });
    expect(r.factors.business_cycle).toBe(0);

    // Umgekehrt: kippt der ohnehin neutrale t10y2y, aendert sich nichts.
    const r2 = runScenario({ t10y2y: -1 });
    expect(r2.factors.business_cycle).toBe(1);
    expect(r2.total).toBe(2);
    expect(r2.regime.label).toBe('Risk On');
  });
});

describe('bandsToSegments — Baender als lueckenlose Skala', () => {
  it('uebersetzt den VIX-Korridor in drei Abschnitte in der richtigen Reihenfolge', () => {
    const segments = bandsToSegments(rules.indicators.vix.bands);
    expect(segments).toHaveLength(3);

    // unter 15: Complacency, negativ
    expect(segments[0]!.from).toBeNull();
    expect(segments[0]!.to).toBe(15);
    expect(segments[0]!.score).toBe(-1);

    // Korridor 15 bis 25: neutral
    expect(segments[1]!.from).toBe(15);
    expect(segments[1]!.to).toBe(25);
    expect(segments[1]!.score).toBe(0);

    // ueber 25: kontrarisch positiv
    expect(segments[2]!.from).toBe(25);
    expect(segments[2]!.to).toBeNull();
    expect(segments[2]!.score).toBe(1);
  });

  it('ordnet die Abschnitte aufsteigend, auch wenn die Baender es nicht sind', () => {
    // Im Regelwerk steht beim MOVE das positive Band zuerst, obwohl es links
    // liegt; bei anderen ist es umgekehrt. Die Leiste muss immer aufsteigen.
    for (const id of INDICATOR_IDS) {
      const segments = bandsToSegments(rules.indicators[id].bands);
      for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1]!;
        const cur = segments[i]!;
        expect(prev.to, `${id}: Luecke zwischen Abschnitt ${i - 1} und ${i}`).toBe(cur.from);
      }
      expect(segments[0]!.from, `${id}: erster Abschnitt muss offen sein`).toBeNull();
      expect(
        segments[segments.length - 1]!.to,
        `${id}: letzter Abschnitt muss offen sein`,
      ).toBeNull();
    }
  });

  it('gibt fuer jeden Indikator mindestens zwei Abschnitte', () => {
    for (const id of INDICATOR_IDS) {
      expect(bandsToSegments(rules.indicators[id].bands).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('trifft mit den Abschnitten dieselbe Bewertung wie der Scoring-Kern', () => {
    // Gegenprobe: der Abschnitt, in dem der aktuelle Wert liegt, muss
    // denselben Score tragen, den das Scoring vergibt.
    const scoring = computeScoring(rules, KW32);
    for (const id of INDICATOR_IDS) {
      const value = KW32[id].measureValue!;
      const segments = bandsToSegments(rules.indicators[id].bands);
      const hit = segments.find(
        (s) => (s.from === null || value >= s.from) && (s.to === null || value < s.to),
      );
      expect(hit, `${id}: kein Abschnitt fuer ${value}`).toBeDefined();
      expect(hit!.score, `${id} bei ${value}`).toBe(scoring.indicators[id].score);
    }
  });
});
