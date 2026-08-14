/**
 * Historische CNN-Fear-&-Greed-Rekonstruktion.
 *
 * Drei Dinge muessen stimmen, sonst ist der Import schlimmer als nichts zu
 * tun: der Parser liest das echte CSV-Format korrekt, die echte CNN-Quelle
 * hat IMMER Vorrang vor der Rekonstruktion, und die Genauigkeitsgrenze vom
 * 01.02.2021 (Aussage des Quellen-Autors selbst: davor "weniger genau",
 * danach "precise") schlaegt sich sichtbar in der Anzeige nieder.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCURATE_FROM,
  HISTORICAL_SERIES_ID,
  parseFearGreedHistoryCsv,
} from '../src/sources/cnn-historical.js';
import { computeScoring } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { INDICATOR_SPECS } from '../src/pipeline/indicators.js';
import type { IndicatorId, IndicatorInput } from '../src/core/types.js';

const rules = loadRules('v1');
const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'feargreed-history.csv'), 'utf8');

describe('parseFearGreedHistoryCsv', () => {
  const series = parseFearGreedHistoryCsv(fixture);

  it('liest Datum und Wert, verwirft die Rating-Spalte', () => {
    expect(series.length).toBeGreaterThan(5);
    const point = series.find((o) => o.date === '2021-02-01');
    expect(point?.value).toBeCloseTo(43.4, 1);
  });

  it('sortiert aufsteigend, ueber die Datenluecke im Fixture hinweg', () => {
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.date > series[i - 1]!.date).toBe(true);
    }
  });

  it('haelt sich an den Wertebereich 0..100', () => {
    for (const o of series) {
      expect(o.value).toBeGreaterThanOrEqual(0);
      expect(o.value).toBeLessThanOrEqual(100);
    }
  });

  it('meldet ein veraendertes Spaltenformat statt still falsch zu lesen', () => {
    expect(() => parseFearGreedHistoryCsv('Datum,Wert\n2021-01-01,50\n')).toThrow(
      /unerwarteter CSV-Kopf/,
    );
  });

  it('meldet eine leere Antwort', () => {
    expect(() => parseFearGreedHistoryCsv('Date,Fear Greed,Rating\n')).toThrow(
      /keine Beobachtungen/,
    );
  });
});

describe('fear_greed.compute — Live hat immer Vorrang vor der Rekonstruktion', () => {
  const compute = INDICATOR_SPECS.fear_greed.compute;
  const rule = rules.indicators.fear_greed;

  it('nutzt die Live-Reihe, wenn sie einen Wert hat, auch wenn die historische denselben Tag abdeckt', () => {
    const bundle = {
      CNN_FEAR_GREED: [{ date: '2026-08-10', value: 70 }],
      [HISTORICAL_SERIES_ID]: [{ date: '2026-08-10', value: 10 }],
    };
    const input = compute(bundle, '2026-08-10', rule);
    expect(input.measureValue).toBe(70);
    expect(input.quality).toBeUndefined(); // kein Override -> bleibt "ok" ueber die Regelwerk-Standardqualitaet
  });

  it('faellt auf die historische Reihe zurueck, wenn die Live-Reihe diese Woche nicht abdeckt', () => {
    const bundle = {
      CNN_FEAR_GREED: [{ date: '2025-09-01', value: 55 }], // beginnt erst spaeter
      [HISTORICAL_SERIES_ID]: [{ date: '2015-06-01', value: 30 }],
    };
    const input = compute(bundle, '2015-06-07', rule);
    expect(input.measureValue).toBe(30);
    expect(input.quality).toBe('proxy');
    expect(input.display?.secondary).toContain('Rekonstruktion, nicht CNN selbst');
  });

  it('kennzeichnet Werte vor der 2021er-Genauigkeitsgrenze zusaetzlich', () => {
    const bundle = {
      CNN_FEAR_GREED: [],
      [HISTORICAL_SERIES_ID]: [{ date: '2018-01-02', value: 40 }],
    };
    const input = compute(bundle, '2018-01-08', rule);
    expect(input.quality).toBe('proxy');
    expect(input.display?.secondary).toContain(ACCURATE_FROM);
    expect(input.display?.secondary).toContain('weniger genau');
  });

  it('kennzeichnet Werte ab der Genauigkeitsgrenze NICHT mit dem Zusatzhinweis', () => {
    const bundle = {
      CNN_FEAR_GREED: [],
      [HISTORICAL_SERIES_ID]: [{ date: '2022-06-01', value: 40 }],
    };
    const input = compute(bundle, '2022-06-07', rule);
    expect(input.quality).toBe('proxy');
    expect(input.display?.secondary).not.toContain('weniger genau');
  });

  it('bleibt "kein Wert", wenn weder Live noch Historie etwas fuer die Woche haben', () => {
    const bundle = { CNN_FEAR_GREED: [], [HISTORICAL_SERIES_ID]: [] };
    expect(compute(bundle, '2015-06-07', rule).measureValue).toBeNull();
  });

  it('funktioniert auch ganz ohne importierte Historie im Bundle', () => {
    // Der Zustand vor dem ersten "npm run import:feargreed".
    const bundle = { CNN_FEAR_GREED: [{ date: '2026-08-10', value: 70 }] };
    const input = compute(bundle, '2026-08-10', rule);
    expect(input.measureValue).toBe(70);
    const older = compute(bundle, '2015-06-07', rule);
    expect(older.measureValue).toBeNull();
  });
});

describe('Auswirkung auf die Bestimmbarkeit des Sentiment-Faktors', () => {
  /*
   * Das ist der eigentliche Zweck des Imports: VIX ist immer da, AAII fehlt
   * historisch komplett. Ohne Fear & Greed ist Sentiment damit in alten
   * Wochen nicht bestimmbar (nur 1 von 3 Werten). Mit der importierten
   * Rekonstruktion springt das auf 2 von 3 — und der Faktor wird bestimmbar,
   * wenn auch als Ersatzreihe gekennzeichnet.
   */
  function inputsFor(fearGreedValue: number | null): Record<IndicatorId, IndicatorInput> {
    return {
      ism_mfg_pmi: { measureValue: null },
      nfci: { measureValue: 0 },
      t10y2y: { measureValue: 0 },
      gli: { measureValue: 0 },
      move: { measureValue: 90 },
      sofr_iorb: { measureValue: 5 },
      vix: { measureValue: 20 },
      aaii: { measureValue: null },
      fear_greed:
        fearGreedValue === null
          ? { measureValue: null }
          : { measureValue: fearGreedValue, quality: 'proxy' },
    };
  }

  it('ist ohne Fear & Greed nicht bestimmbar (die heutige Lage vor 2025)', () => {
    const r = computeScoring(rules, inputsFor(null));
    expect(r.factors.sentiment.determinable).toBe(false);
    expect(r.meaningful).toBe(false);
  });

  it('wird mit der importierten Rekonstruktion bestimmbar', () => {
    const r = computeScoring(rules, inputsFor(50));
    expect(r.factors.sentiment.determinable).toBe(true);
    expect(r.indicators.fear_greed.quality).toBe('proxy');
    expect(r.meaningful).toBe(true);
  });
});
