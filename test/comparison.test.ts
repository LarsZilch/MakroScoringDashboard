/**
 * Wochen- und Jahresvergleich.
 *
 * Der Kern der Monitoring-Anforderung — und die Stelle, an der die
 * Verwechslung von "neutral" und "unbekannt" ein zweites Mal auftaucht: ein
 * fehlender Indikator traegt rechnerisch den Score 0, darf aber nicht als
 * Vergleichswert 0 erscheinen. Sonst behauptet die Delta-Tabelle einen
 * Wechsel, den es nie gab. Beim ISM und bei AAII ist das der Regelfall, weil
 * ihre Historie nur wenige Monate zurueckreicht.
 */

import { describe, expect, it } from 'vitest';
import { computeScoring } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { buildSnapshot } from '../src/pipeline/snapshot.js';
import {
  compareWeekOverWeek,
  compareYearOverYear,
  findRegimeChanges,
  resolveWeek,
} from '../src/pipeline/store.js';
import type { Snapshot } from '../src/pipeline/snapshot.js';
import type { IndicatorId, IndicatorInput } from '../src/core/types.js';
import type { Series } from '../src/core/derive.js';

const rules = loadRules('v1');

/** Snapshot direkt aus Indikator-Eingaben bauen, ohne Umweg ueber Rohreihen. */
function snapshotOf(
  isoYear: number,
  isoWeek: number,
  inputs: Partial<Record<IndicatorId, IndicatorInput>>,
): Snapshot {
  const full: Record<IndicatorId, IndicatorInput> = {
    ism_mfg_pmi: { measureValue: 0 },
    nfci: { measureValue: 0 },
    t10y2y: { measureValue: 0 },
    gli: { measureValue: 0 },
    move: { measureValue: 90 },
    sofr_iorb: { measureValue: 5 },
    vix: { measureValue: 20 },
    aaii: { measureValue: 0 },
    fear_greed: { measureValue: 50 },
    ...inputs,
  };
  const scoring = computeScoring(rules, full);
  return {
    schemaVersion: 1,
    rulesVersion: rules.version,
    isoYear,
    isoWeek,
    weekKey: `${isoYear}-W${String(isoWeek).padStart(2, '0')}`,
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

describe('Vergleich gegen die Vorwoche', () => {
  const prev = snapshotOf(2026, 32, { vix: { measureValue: 20 } });
  const cur = snapshotOf(2026, 33, { vix: { measureValue: 12 } }); // unter 15 -> -1
  const all = [prev, cur];

  it('findet die Vorwoche und meldet den Score-Wechsel', () => {
    const c = compareWeekOverWeek(cur, all);
    expect(c.resolved).toEqual({ isoYear: 2026, isoWeek: 32 });
    expect(c.substituted).toBe(false);
    const vix = c.indicators.find((i) => i.id === 'vix')!;
    expect(vix.previousScore).toBe(0);
    expect(vix.currentScore).toBe(-1);
    expect(vix.scoreChanged).toBe(true);
    expect(vix.valueDelta).toBe(-8);
  });

  it('behandelt einen fehlenden Vorwochenwert als unbekannt, nicht als 0', () => {
    const prevMissing = snapshotOf(2026, 32, { ism_mfg_pmi: { measureValue: null } });
    const curPresent = snapshotOf(2026, 33, { ism_mfg_pmi: { measureValue: 3 } }); // +1
    const c = compareWeekOverWeek(curPresent, [prevMissing, curPresent]);
    const ism = c.indicators.find((i) => i.id === 'ism_mfg_pmi')!;

    expect(ism.currentScore).toBe(1);
    // Entscheidend: NICHT 0, sonst laese sich die Tabelle als "0 -> +1".
    expect(ism.previousScore).toBeNull();
    expect(ism.scoreDelta).toBeNull();
    expect(ism.scoreChanged).toBe(false);
    expect(ism.previousValue).toBeNull();
    expect(ism.valueDelta).toBeNull();
  });

  it('meldet keine Vorwoche, wenn sie im Bestand fehlt', () => {
    const lonely = snapshotOf(2026, 33, {});
    const c = compareWeekOverWeek(lonely, [lonely]);
    expect(c.resolved).toBeNull();
    expect(c.totalDelta).toBeNull();
  });
});

describe('Vergleich gegen die Vorjahres-Kalenderwoche', () => {
  it('trifft dieselbe KW im Vorjahr', () => {
    const lastYear = snapshotOf(2025, 33, { vix: { measureValue: 30 } }); // ueber 25 -> +1
    const now = snapshotOf(2026, 33, { vix: { measureValue: 20 } });
    const c = compareYearOverYear(now, [lastYear, now]);
    expect(c.resolved).toEqual({ isoYear: 2025, isoWeek: 33 });
    expect(c.substituted).toBe(false);
  });

  it('kappt KW 53 auf die letzte Woche eines 52-Wochen-Jahres', () => {
    // 2026 hat 53 Wochen, 2025 nur 52.
    const lastYear = snapshotOf(2025, 52, {});
    const now = snapshotOf(2026, 53, {});
    const c = compareYearOverYear(now, [lastYear, now]);
    expect(c.reference).toEqual({ isoYear: 2025, isoWeek: 52 });
    expect(c.resolved).toEqual({ isoYear: 2025, isoWeek: 52 });
  });

  it('weicht auf die naechstgelegene Woche davor aus und sagt es', () => {
    const near = snapshotOf(2025, 31, {}); // gesucht waere 2025-W33
    const now = snapshotOf(2026, 33, {});
    const c = compareYearOverYear(now, [near, now]);
    expect(c.resolved).toEqual({ isoYear: 2025, isoWeek: 31 });
    expect(c.substituted).toBe(true);
  });

  it('weicht NICHT auf eine zu weit entfernte Woche aus', () => {
    const tooFar = snapshotOf(2024, 10, {});
    const now = snapshotOf(2026, 33, {});
    const c = compareYearOverYear(now, [tooFar, now]);
    expect(c.resolved).toBeNull();
  });
});

describe('resolveWeek', () => {
  const snapshots = [snapshotOf(2026, 10, {}), snapshotOf(2026, 12, {})];

  it('bevorzugt den exakten Treffer', () => {
    const r = resolveWeek(snapshots, { isoYear: 2026, isoWeek: 12 });
    expect(r?.snapshot.weekKey).toBe('2026-W12');
    expect(r?.substituted).toBe(false);
  });

  it('nimmt die naechste Woche davor, nie eine danach', () => {
    const r = resolveWeek(snapshots, { isoYear: 2026, isoWeek: 11 });
    expect(r?.snapshot.weekKey).toBe('2026-W10');
    expect(r?.substituted).toBe(true);
  });
});

describe('Regimewechsel', () => {
  it('findet die Uebergaenge in der richtigen Reihenfolge', () => {
    // vix < 15 und aaii/fear_greed neutral -> Sentiment bleibt 0;
    // stattdessen ueber den Business Cycle steuern.
    const neutral = snapshotOf(2026, 10, {});
    const riskOn = snapshotOf(2026, 11, {
      ism_mfg_pmi: { measureValue: 3 },
      nfci: { measureValue: -0.1 },
      gli: { measureValue: 10 },
      move: { measureValue: 70 },
    });
    const back = snapshotOf(2026, 12, {});

    const changes = findRegimeChanges([neutral, riskOn, back]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ weekKey: '2026-W11', from: 'Neutral', to: 'Risk On' });
    expect(changes[1]).toMatchObject({ weekKey: '2026-W12', from: 'Risk On', to: 'Neutral' });
  });
});

describe('Snapshot-Bau', () => {
  it('setzt den Stichtag nie in die Zukunft', () => {
    // Eine Woche weit in der Zukunft: der Stichtag muss auf heute gedeckelt
    // werden, sonst weist das Dashboard einen Datenstand aus, den es nicht gibt.
    const bundle: Record<string, Series> = {};
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const snap = buildSnapshot(rules, bundle, {
      isoYear: future.getUTCFullYear(),
      isoWeek: 20,
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(snap.dataAsOf <= today).toBe(true);
  });
});
