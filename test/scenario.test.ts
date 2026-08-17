/**
 * Szenariorechnung.
 *
 * Szenarien werden mit demselben Scoring-Kern gerechnet, der auch die
 * Snapshots erzeugt — applyScenario() setzt einzelne Indikator-Scores und
 * aggregiert neu. Diese Tests halten fest, dass diese Rechnung stimmt, damit
 * die Hilfe keine Ergebnisse behauptet, die das Modell so nicht liefern wuerde.
 *
 * Frueher stand hier ein Nachbau der Frontend-Rechnung. Genau das hatte einen
 * Fehler verdeckt: der Nachbau setzte beim Override nur den Score, nicht die
 * Qualitaet — und aggregateFactor() ignoriert Mitglieder ohne Wert. Getestet
 * wird deshalb jetzt die echte Implementierung.
 *
 * Geprueft wird ausserdem die Uebersetzung der Bewertungsbaender in
 * Skalen-Abschnitte: die Baender sind eine Trefferliste, die Leiste braucht
 * eine lueckenlose Folge.
 */

import { describe, expect, it } from 'vitest';
import { computeScoring } from '../src/core/scoring.js';
import { SCENARIOS, applyScenario, scenarioById } from '../src/core/scenario.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { INDICATOR_IDS, type IndicatorId, type IndicatorInput, type Score } from '../src/core/types.js';
import { bandsToSegments } from '../web/src/components/BandScale.js';
import { SCENARIO_TEXTS } from '../web/src/content/help.js';

const rules = loadRules('v1');

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

/** Ein Szenario aus dem Bestand auf die Ausgangslage anwenden. */
function run(scenarioId: string, inputs = KW32) {
  const base = computeScoring(rules, inputs);
  const out = applyScenario(rules, base, scenarioById(scenarioId)!);
  const factors = Object.fromEntries(out.factors.map((f) => [f.id, f.after])) as Record<
    string,
    Score
  >;
  return { ...out, factors, total: out.totalAfter, regime: out.regimeAfter };
}

/** Freie Annahmen, fuer Faelle ohne passendes Szenario im Bestand. */
function runOverrides(overrides: Partial<Record<IndicatorId, Score>>, inputs = KW32) {
  const base = computeScoring(rules, inputs);
  const out = applyScenario(rules, base, { id: 'adhoc', overrides });
  const factors = Object.fromEntries(out.factors.map((f) => [f.id, f.after])) as Record<
    string,
    Score
  >;
  return { ...out, factors, total: out.totalAfter, regime: out.regimeAfter };
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
    const r = run('liquidity_turns');
    expect(r.factors.liquidity).toBe(0);
    expect(r.factors.business_cycle).toBe(1);
    expect(r.total).toBe(1);
    expect(r.regime.label).toBe('Neutral');
    expect(r.regime.cashBand).toEqual([20, 35]);
    expect(r.changed).toBe(true);
  });
});

describe('Szenario: Sentiment kippt in Extreme Greed', () => {
  it('macht den Sentiment-Faktor negativ und zieht den Gesamtscore auf +1', () => {
    // Zwei von drei Sentiment-Indikatoren negativ -> Mehrheit -> Faktor -1.
    const r = run('greed_extreme');
    expect(r.factors.sentiment).toBe(-1);
    expect(r.total).toBe(1);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Szenario: Konjunktur bricht ein', () => {
  it('dreht den Business-Cycle-Faktor vollstaendig durch', () => {
    // Von +1 auf -1 ist ein Sprung von zwei Punkten im Gesamtscore.
    const r = run('cycle_breaks');
    expect(r.factors.business_cycle).toBe(-1);
    expect(r.total).toBe(0);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Szenario: Funding-Stress', () => {
  it('dreht den Liquiditaetsfaktor auf -1 und fuehrt zu Neutral', () => {
    // gli steht in der Ausgangslage bereits auf -1; kommen sofr_iorb und
    // move dazu, sind alle drei negativ.
    const r = run('funding_stress');
    expect(r.factors.liquidity).toBe(-1);
    expect(r.total).toBe(0);
    expect(r.regime.label).toBe('Neutral');
  });
});

describe('Ein einzelner Indikator reicht nie fuer einen Faktorwechsel', () => {
  it('laesst den Faktor stehen, wenn nur ein Indikator kippt', () => {
    // Die Mehrheitsregel braucht zwei. Faktor 1 hat +1/+1/0; kippt der ISM
    // auf 0, bleibt mit dem NFCI nur noch ein positiver -> Faktor faellt auf 0.
    const r = runOverrides({ ism_mfg_pmi: 0 });
    expect(r.factors.business_cycle).toBe(0);

    // Umgekehrt: kippt der ohnehin neutrale t10y2y, aendert sich nichts.
    const r2 = runOverrides({ t10y2y: -1 });
    expect(r2.factors.business_cycle).toBe(1);
    expect(r2.total).toBe(2);
    expect(r2.regime.label).toBe('Risk On');
  });
});

describe('Was sich bewegt und was nicht', () => {
  it('meldet nur Indikatoren, die ihren Score tatsaechlich wechseln', () => {
    // gli steht bereits auf -1, move auf +1. Nur move bewegt sich.
    const r = run('funding_stress');
    expect(r.moves.map((m) => m.id).sort()).toEqual(['move', 'sofr_iorb']);

    // t10y2y steht in der Ausgangslage auf 0 — ein Override auf 0 bewegt nichts.
    expect(runOverrides({ t10y2y: 0 }).moves).toEqual([]);
  });

  it('erkennt ein bereits eingetretenes Szenario', () => {
    const base = computeScoring(rules, KW32);
    const overrides = Object.fromEntries(
      INDICATOR_IDS.map((id) => [id, base.indicators[id].score]),
    ) as Partial<Record<IndicatorId, Score>>;

    const r = runOverrides(overrides);
    expect(r.alreadyTrue).toBe(true);
    expect(r.moves).toEqual([]);
    expect(r.totalAfter).toBe(r.totalBefore);
  });
});

describe('Override auf einen Indikator ohne Wert', () => {
  /*
   * Der Fehler, den die frueher hier stehende Zweitimplementierung verdeckt
   * hat: aggregateFactor() filtert Mitglieder mit quality "missing" heraus.
   * Wird beim Override nur der Score gesetzt, bleibt er wirkungslos —
   * waehrend die Anzeige eine Bewegung behauptet.
   */
  const ohneAaii = { ...KW32, aaii: { measureValue: null } };

  it('wirkt trotzdem und weist die Annahme aus', () => {
    const r = run('greed_extreme', ohneAaii);

    expect(r.assumedWithoutValue).toEqual(['aaii']);
    // AAII wird angesetzt, nicht bewegt — es taucht deshalb nicht in moves auf.
    expect(r.moves.map((m) => m.id)).toEqual(['fear_greed']);
    // Zwei negative Sentiment-Werte: der Faktor kippt, obwohl AAII fehlte.
    expect(r.factors.sentiment).toBe(-1);
  });

  it('ist nicht "bereits eingetreten", nur weil sich nichts bewegt', () => {
    // Ohne die assumedWithoutValue-Pruefung waere moves leer und die Kachel
    // meldete faelschlich "dieses Szenario ist eingetreten".
    const r = runOverrides({ aaii: 0 }, ohneAaii);
    expect(r.moves).toEqual([]);
    expect(r.alreadyTrue).toBe(false);
  });
});

describe('Szenariotexte', () => {
  it('hat zu jedem Szenario einen Text', () => {
    // Die Typisierung erzwingt das bereits; ueber die API laeuft die Kennung
    // aber als blosser String, deshalb hier noch einmal zur Laufzeit.
    for (const s of SCENARIOS) {
      expect(SCENARIO_TEXTS[s.id]?.title, s.id).toBeTruthy();
      expect(SCENARIO_TEXTS[s.id]?.trigger, s.id).toBeTruthy();
      expect(SCENARIO_TEXTS[s.id]?.narrative, s.id).toBeTruthy();
    }
    expect(Object.keys(SCENARIO_TEXTS)).toHaveLength(SCENARIOS.length);
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
