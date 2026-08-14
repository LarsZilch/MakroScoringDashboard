/**
 * Die verallgemeinerte Mehrheitsregel.
 *
 * Der Modus `available` existiert allein fuer das Vergleichsmodell 2018, das
 * mit sechs statt neun Indikatoren rechnet. Die wichtigste Eigenschaft ist
 * nicht, was er im reduzierten Fall tut — sondern dass er im vollstaendigen
 * Fall NICHTS aendert. Sonst haette die Erweiterung das echte Modell
 * verschoben, und der Golden Test waere nur zufaellig noch gruen.
 */

import { describe, expect, it } from 'vitest';
import { aggregateFactor, computeScoring } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import type { Quality, Score, ScoredIndicator } from '../src/core/types.js';
import { INDICATOR_IDS, type IndicatorId, type IndicatorInput } from '../src/core/types.js';

const rules = loadRules('v1');

/** Minimaler Indikator, nur mit dem, was die Aggregation liest. */
function ind(id: string, score: Score, quality: Quality = 'ok'): ScoredIndicator {
  return {
    id: id as IndicatorId,
    factor: 'sentiment',
    label: id,
    measure: 'level',
    unit: '',
    measureValue: quality === 'missing' ? null : score,
    value: null,
    score: quality === 'missing' ? 0 : score,
    quality,
    nearestFlip: null,
    flips: [],
  };
}

const MISSING = (id: string) => ind(id, 0, 'missing');

function agg(members: ScoredIndicator[], mode: 'strict' | 'available') {
  return aggregateFactor('sentiment', 'Sentiment', members, 2, mode);
}

describe('Bei drei vorhandenen Werten sind beide Modi deckungsgleich', () => {
  /*
   * Alle 27 Kombinationen aus drei Scores durchspielen. Waere hier auch nur
   * ein Fall verschieden, veraenderte der neue Modus das echte Modell.
   */
  const scores: Score[] = [-1, 0, 1];

  it('liefert fuer alle 27 Kombinationen dasselbe Ergebnis', () => {
    let checked = 0;
    for (const a of scores) {
      for (const b of scores) {
        for (const c of scores) {
          const members = [ind('a', a), ind('b', b), ind('c', c)];
          const strict = agg(members, 'strict');
          const available = agg(members, 'available');
          expect(available.score, `${a}/${b}/${c}`).toBe(strict.score);
          expect(available.determinable, `${a}/${b}/${c}`).toBe(strict.determinable);
          expect(available.rationale, `${a}/${b}/${c}`).toBe(strict.rationale);
          checked++;
        }
      }
    }
    expect(checked).toBe(27);
  });

  it('reproduziert die Vorlage auch im reduzierten Modus unveraendert', () => {
    // Die neun Werte aus doc/MakroScoringInfoScreen.jpg, KW 32/2026.
    const kw32: Record<IndicatorId, IndicatorInput> = {
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
    const strict = computeScoring(rules, kw32, 'strict');
    const available = computeScoring(rules, kw32, 'available');
    expect(available.total).toBe(strict.total);
    expect(available.total).toBe(2);
    expect(available.regime.label).toBe(strict.regime.label);
    for (const id of INDICATOR_IDS) {
      expect(available.indicators[id].score).toBe(strict.indicators[id].score);
    }
  });
});

describe('Zwei vorhandene Werte', () => {
  it('bleibt im echten Modell bestimmbar und verlangt beide fuer eine Mehrheit', () => {
    const both = agg([ind('a', 1), ind('b', 1), MISSING('c')], 'strict');
    expect(both.determinable).toBe(true);
    expect(both.score).toBe(1);

    const split = agg([ind('a', 1), ind('b', 0), MISSING('c')], 'strict');
    expect(split.score).toBe(0);
  });

  it('verlangt im reduzierten Modus Einstimmigkeit', () => {
    expect(agg([ind('a', 1), ind('b', 1), MISSING('c')], 'available').score).toBe(1);
    expect(agg([ind('a', -1), ind('b', -1), MISSING('c')], 'available').score).toBe(-1);
    // Ein positiver und ein neutraler Wert reichen nicht.
    expect(agg([ind('a', 1), ind('b', 0), MISSING('c')], 'available').score).toBe(0);
    // Gegenlaeufig erst recht nicht.
    expect(agg([ind('a', 1), ind('b', -1), MISSING('c')], 'available').score).toBe(0);
  });
});

describe('Ein einziger vorhandener Wert', () => {
  const single = (s: Score, mode: 'strict' | 'available') =>
    agg([ind('a', s), MISSING('b'), MISSING('c')], mode);

  it('ist im echten Modell nicht bestimmbar', () => {
    // Genau der Fall des Sentiment-Faktors im Backfill: nur der VIX liegt vor.
    const r = single(-1, 'strict');
    expect(r.determinable).toBe(false);
    expect(r.score).toBe(0);
    expect(r.rationale).toMatch(/nicht bestimmbar/);
  });

  it('entscheidet im reduzierten Modus allein', () => {
    expect(single(1, 'available').score).toBe(1);
    expect(single(-1, 'available').score).toBe(-1);
    expect(single(0, 'available').score).toBe(0);
    expect(single(-1, 'available').determinable).toBe(true);
    expect(single(-1, 'available').rationale).toBe('1 von 1 negativ');
  });
});

describe('Gar kein vorhandener Wert', () => {
  it('bleibt in beiden Modi unbestimmbar', () => {
    const members = [MISSING('a'), MISSING('b'), MISSING('c')];
    for (const mode of ['strict', 'available'] as const) {
      const r = agg(members, mode);
      expect(r.determinable, mode).toBe(false);
      expect(r.score, mode).toBe(0);
      expect(r.rationale, mode).toBe('kein Wert verfuegbar — nicht bestimmbar');
    }
  });
});

describe('Der Standard bleibt streng', () => {
  it('verhaelt sich ohne Modusangabe wie strict', () => {
    const members = [ind('a', 1), MISSING('b'), MISSING('c')];
    const ohne = aggregateFactor('sentiment', 'Sentiment', members, 2);
    const streng = aggregateFactor('sentiment', 'Sentiment', members, 2, 'strict');
    expect(ohne).toEqual(streng);
    expect(ohne.determinable).toBe(false);
  });
});
