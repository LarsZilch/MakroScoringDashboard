/**
 * Renditeberechnung und Regime-Zuordnung.
 *
 * Der wichtigste Test hier ist der gegen Look-ahead: das Regime der Woche W
 * steht erst am Ende von W fest, gemessen werden darf deshalb nur die Rendite
 * von W+1. Faellt dieser Test, misst die App die Zukunft und jede Kennzahl
 * sieht besser aus, als sie ist.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_WEEKS,
  countEpisodes,
  SOLID_WEEKS,
  confidenceOf,
  indexTo100,
  joinForwardReturns,
  performanceByRegime,
  statsFor,
  weeklyReturns,
} from '../src/pipeline/asset-returns.js';
import { parseAssetChart } from '../src/sources/assets.js';
import { isoWeekKey, isoWeekOf } from '../src/core/isoweek.js';

/** Fortlaufende Wochenschluessel 2026-W01 … 2026-Wnn. */
function weekRange(from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`2026-W${String(i).padStart(2, '0')}`);
  return out;
}

/** Eintraege fuer statsFor aus Wochenschluesseln und Renditen bauen. */
function entries(weeks: string[], rets: number[]) {
  return weeks.map((signalWeek, i) => ({ signalWeek, ret: rets[i]! }));
}

describe('weeklyReturns', () => {
  it('rechnet aufeinanderfolgende Kurse in Renditen um', () => {
    const series = [
      { date: '2026-01-02', value: 100 },
      { date: '2026-01-09', value: 110 },
      { date: '2026-01-16', value: 99 },
    ];
    const r = weeklyReturns(series);
    expect(r).toHaveLength(2);
    expect(r[0]!.ret).toBeCloseTo(0.1, 10);
    expect(r[1]!.ret).toBeCloseTo(-0.1, 10);
  });

  it('schluesselt jede Rendite nach der ISO-Woche ihres Endpunkts', () => {
    const series = [
      { date: '2026-08-07', value: 100 },
      { date: '2026-08-14', value: 105 },
    ];
    const r = weeklyReturns(series);
    expect(r[0]!.weekKey).toBe(isoWeekKey(isoWeekOf('2026-08-14')));
    expect(r[0]!.weekKey).toBe('2026-W33');
  });

  it('liefert bei einem einzelnen Kurs keine Rendite', () => {
    expect(weeklyReturns([{ date: '2026-01-02', value: 100 }])).toEqual([]);
  });
});

describe('joinForwardReturns — kein Blick in die Zukunft', () => {
  it('ordnet dem Regime der Woche W die Rendite von W+1 zu', () => {
    /*
     * Aufbau: nur EINE Woche steigt stark, naemlich KW 11. Das Regime der
     * KW 10 ist "Risk On", das der KW 11 "Risk Off". Der Ertrag der KW 11
     * gehoert damit zu Risk On — denn wer am Ende von KW 10 das Signal sah,
     * war in KW 11 investiert.
     *
     * Wuerde die App die Rendite derselben Woche zuordnen, landete der Gewinn
     * faelschlich bei Risk Off.
     */
    const regimes = new Map([
      ['2026-W10', 'Risk On'],
      ['2026-W11', 'Risk Off'],
      ['2026-W12', 'Risk Off'],
    ]);
    const returns = [
      { weekKey: '2026-W11', ret: 0.2, from: '', to: '' },
      { weekKey: '2026-W12', ret: 0.0, from: '', to: '' },
      { weekKey: '2026-W13', ret: -0.05, from: '', to: '' },
    ];

    const joined = joinForwardReturns(regimes, returns);

    const riskOn = joined.filter((j) => j.regime === 'Risk On');
    expect(riskOn).toHaveLength(1);
    expect(riskOn[0]!.signalWeek).toBe('2026-W10');
    expect(riskOn[0]!.returnWeek).toBe('2026-W11');
    expect(riskOn[0]!.ret).toBeCloseTo(0.2, 10);

    // Der Gewinn darf NICHT bei Risk Off auftauchen.
    const riskOff = joined.filter((j) => j.regime === 'Risk Off');
    expect(riskOff.map((j) => j.ret)).toEqual([0.0, -0.05]);
    expect(riskOff.some((j) => j.ret === 0.2)).toBe(false);
  });

  it('laesst Wochen ohne Folgewoche aus, statt zu schaetzen', () => {
    const regimes = new Map([['2026-W33', 'Risk On']]);
    // Keine Rendite fuer 2026-W34 vorhanden.
    const joined = joinForwardReturns(regimes, [{ weekKey: '2026-W33', ret: 0.1, from: '', to: '' }]);
    expect(joined).toEqual([]);
  });

  it('springt korrekt ueber den Jahreswechsel', () => {
    // 2026 hat 53 Wochen: auf 2026-W53 folgt 2027-W01.
    const regimes = new Map([['2026-W53', 'Neutral']]);
    const joined = joinForwardReturns(regimes, [{ weekKey: '2027-W01', ret: 0.03, from: '', to: '' }]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.returnWeek).toBe('2027-W01');
  });
});

describe('Stichprobenregel', () => {
  it('stuft nach Wochenzahl ein', () => {
    expect(confidenceOf(2)).toBe('insufficient');
    expect(confidenceOf(MIN_WEEKS - 1)).toBe('insufficient');
    expect(confidenceOf(MIN_WEEKS)).toBe('weak');
    expect(confidenceOf(SOLID_WEEKS - 1)).toBe('weak');
    expect(confidenceOf(SOLID_WEEKS)).toBe('solid');
  });

  it('liefert bei zu kleiner Stichprobe KEINE Zahl, aber die Wochenzahl', () => {
    // Genau die Lage im echten Modell: Risk Off hat zwei Wochen.
    const s = statsFor('Risk Off', entries(['2026-W10', '2026-W20'], [0.03, -0.01]));
    expect(s.weeks).toBe(2);
    expect(s.confidence).toBe('insufficient');
    expect(s.annualized).toBeNull();
    expect(s.hitRate).toBeNull();
    expect(s.cumulative).toBeNull();
  });

  it('rechnet ab ausreichender Stichprobe geometrisch', () => {
    // Zehn Wochen mit je +1 % -> Gesamtertrag 1,01^10 - 1
    const s = statsFor('Risk On', entries(weekRange(1, 10), Array(10).fill(0.01)));
    expect(s.confidence).toBe('weak');
    expect(s.cumulative).toBeCloseTo(Math.pow(1.01, 10) - 1, 10);
    expect(s.annualized).toBeCloseTo(Math.pow(1.01, 52) - 1, 8);
    expect(s.hitRate).toBe(1);
  });

  it('zaehlt die Trefferquote ueber positive Wochen', () => {
    const s = statsFor(
      'Neutral',
      entries(weekRange(1, 8), [0.01, -0.02, 0.03, 0, 0.01, -0.01, 0.02, 0.04]),
    );
    expect(s.weeks).toBe(8);
    // 5 von 8 echt positiv (die 0 zaehlt nicht als Treffer).
    expect(s.hitRate).toBeCloseTo(5 / 8, 10);
  });

  it('bricht bei einem Totalverlust nicht', () => {
    const s = statsFor('Defensiv', entries(weekRange(1, 10), Array(10).fill(-1)));
    expect(s.cumulative).toBeCloseTo(-1, 10);
    expect(s.annualized).toBeCloseTo(-1, 10);
  });
});

describe('Episoden — das ehrlichere Mass fuer die Stichprobe', () => {
  it('zaehlt aufeinanderfolgende Wochen als eine Episode', () => {
    expect(countEpisodes(weekRange(1, 5))).toEqual([5]);
  });

  it('trennt bei einer Luecke', () => {
    expect(countEpisodes(['2026-W01', '2026-W02', '2026-W10', '2026-W11', '2026-W20'])).toEqual([
      2, 2, 1,
    ]);
  });

  it('erkennt Zusammenhang ueber den Jahreswechsel', () => {
    // 2026 hat 53 Wochen: auf 2026-W53 folgt 2027-W01 unmittelbar.
    expect(countEpisodes(['2026-W52', '2026-W53', '2027-W01'])).toEqual([3]);
  });

  it('meldet ein von einer einzigen Episode getragenes Ergebnis', () => {
    /*
     * Genau die Lage im Vergleichsmodell 2018: die Risk-On-Wochen stammen
     * ueberwiegend aus zwei langen Episoden 2020/21. "n = 73" sieht robust
     * aus, sind aber faktisch zwei Beobachtungen desselben Ereignisses.
     */
    const lang = entries(weekRange(1, 30), Array(30).fill(0.01));
    const streu = entries(['2026-W40', '2026-W45'], [0.01, 0.01]);
    const s = statsFor('Risk On', [...lang, ...streu]);

    expect(s.weeks).toBe(32);
    expect(s.episodes).toBe(3);
    expect(s.largestEpisodeShare).toBeCloseTo(30 / 32, 10);
    expect(s.concentrated).toBe(true);
  });

  it('meldet ein breit gestreutes Ergebnis als unkonzentriert', () => {
    // Zehn verstreute Einzelwochen: keine dominiert.
    const streu = entries(
      weekRange(1, 20).filter((_, i) => i % 2 === 0),
      Array(10).fill(0.01),
    );
    const s = statsFor('Neutral', streu);
    expect(s.episodes).toBe(10);
    expect(s.largestEpisodeShare).toBeCloseTo(0.1, 10);
    expect(s.concentrated).toBe(false);
  });
});

describe('performanceByRegime', () => {
  it('haelt die Regime-Reihenfolge ein und rechnet den Gesamtvergleich mit', () => {
    const joined = [
      ...Array(10).fill(0).map((_, i) => ({ signalWeek: `2026-W${String(i + 1).padStart(2, '0')}`, returnWeek: '', regime: 'Risk On', ret: 0.01 })),
      ...Array(3).fill(0).map((_, i) => ({ signalWeek: `2026-W${String(i + 20).padStart(2, '0')}`, returnWeek: '', regime: 'Risk Off', ret: -0.02 })),
    ];
    const p = performanceByRegime('SPX', 'S&P 500', joined, ['Risk On', 'Neutral', 'Risk Off', 'Defensiv']);

    expect(p.byRegime.map((r) => r.regime)).toEqual(['Risk On', 'Neutral', 'Risk Off', 'Defensiv']);
    expect(p.byRegime[0]!.weeks).toBe(10);
    expect(p.byRegime[0]!.annualized).not.toBeNull();
    // Neutral kam nicht vor -> 0 Wochen, keine Zahl.
    expect(p.byRegime[1]!.weeks).toBe(0);
    expect(p.byRegime[1]!.annualized).toBeNull();
    // Risk Off: 3 Wochen, unter der Grenze.
    expect(p.byRegime[2]!.weeks).toBe(3);
    expect(p.byRegime[2]!.annualized).toBeNull();
    expect(p.overall.weeks).toBe(13);
  });

  it('kennzeichnet die Gesamtspalte nie als konzentriert', () => {
    /*
     * Der Gesamtwert umfasst den Zeitraum am Stueck — die Episoden-Pruefung
     * waere dort immer erfuellt und die Kennzeichnung damit irrefuehrend. Sie
     * wuerde suggerieren, auch dieser Wert haenge an einem einzelnen Ereignis.
     */
    const joined = weekRange(1, 40).map((signalWeek) => ({
      signalWeek,
      returnWeek: '',
      regime: 'Risk On',
      ret: 0.01,
    }));
    const p = performanceByRegime('SPX', 'S&P 500', joined, ['Risk On']);

    // Das Regime selbst ist zu Recht als konzentriert markiert …
    expect(p.byRegime[0]!.concentrated).toBe(true);
    // … der Gesamtwert nicht.
    expect(p.overall.concentrated).toBe(false);
    expect(p.overall.weeks).toBe(40);
  });
});

describe('indexTo100', () => {
  it('setzt den ersten Punkt des Fensters auf 100', () => {
    const s = indexTo100([
      { date: '2026-01-02', value: 250 },
      { date: '2026-01-09', value: 275 },
      { date: '2026-01-16', value: 225 },
    ]);
    expect(s[0]!.value).toBe(100);
    expect(s[1]!.value).toBeCloseTo(110, 10);
    expect(s[2]!.value).toBeCloseTo(90, 10);
  });

  it('indexiert ab dem Fensterbeginn neu, nicht ab Reihenbeginn', () => {
    const series = [
      { date: '2025-01-02', value: 50 },
      { date: '2026-01-02', value: 200 },
      { date: '2026-01-09', value: 220 },
    ];
    const s = indexTo100(series, '2026-01-01');
    expect(s).toHaveLength(2);
    expect(s[0]!.value).toBe(100);
    expect(s[1]!.value).toBeCloseTo(110, 10);
  });
});

describe('Kursreihen-Parser', () => {
  it('bevorzugt adjclose, damit Ausschuettungen mitzaehlen', () => {
    // Ohne Bereinigung waere die Rendite hier 0 %, mit Bereinigung +5 %.
    const raw = JSON.stringify({
      chart: {
        result: [
          {
            meta: { symbol: 'TLT', gmtoffset: 0 },
            timestamp: [1767225600, 1767830400],
            indicators: {
              quote: [{ close: [100, 100] }],
              adjclose: [{ adjclose: [100, 105] }],
            },
          },
        ],
      },
    });
    const parsed = parseAssetChart(raw, 'TLT');
    expect(parsed.totalReturn).toBe(true);
    expect(parsed.series.map((o) => o.value)).toEqual([100, 105]);
  });

  it('faellt auf Schlusskurse zurueck und meldet es', () => {
    const raw = JSON.stringify({
      chart: {
        result: [
          {
            meta: { symbol: 'X', gmtoffset: 0 },
            timestamp: [1767225600, 1767830400],
            indicators: { quote: [{ close: [100, 110] }] },
          },
        ],
      },
    });
    const parsed = parseAssetChart(raw, 'X');
    expect(parsed.totalReturn).toBe(false);
    expect(parsed.series).toHaveLength(2);
  });

  it('weist unmoegliche Kurse ab, statt sie als -100 % durchzureichen', () => {
    const raw = JSON.stringify({
      chart: {
        result: [
          {
            meta: { symbol: 'X', gmtoffset: 0 },
            timestamp: [1767225600, 1767830400],
            indicators: { adjclose: [{ adjclose: [100, 0] }] },
          },
        ],
      },
    });
    expect(() => parseAssetChart(raw, 'X')).toThrow(/unmoeglicher Kurs/);
  });

  it('meldet ein veraendertes Antwortformat', () => {
    const raw = JSON.stringify({ chart: { result: [{ meta: {}, timestamp: [1] , indicators: {} }] } });
    expect(() => parseAssetChart(raw, 'X')).toThrow(/weder adjclose noch close/);
  });
});
