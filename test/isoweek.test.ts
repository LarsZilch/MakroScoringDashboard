/**
 * ISO-Wochen sind die Achse der gesamten App. Die Fallen liegen am
 * Jahreswechsel und bei Jahren mit 53 Wochen — beides trifft der Backfill
 * garantiert, und beides faellt ohne Test erst als krumme Historie auf.
 */

import { describe, expect, it } from 'vitest';
import {
  addIsoWeeks,
  isoDate,
  isoWeekEnd,
  isoWeekKey,
  isoWeekOf,
  isoWeekRange,
  isoWeekStart,
  nextIsoWeek,
  parseIsoWeekKey,
  previousIsoWeek,
  sameWeekPreviousYear,
  weeksInIsoYear,
} from '../src/core/isoweek.js';

describe('isoWeekOf', () => {
  it('ordnet den Datenstand der Vorlage der KW 32/2026 zu', () => {
    // Die Vorlage ist mit "KW 32" und "Datenstand 07.08.2026" ueberschrieben.
    expect(isoWeekOf('2026-08-07')).toEqual({ isoYear: 2026, isoWeek: 32 });
  });

  it('haelt die ganze Woche zusammen, Montag bis Sonntag', () => {
    expect(isoWeekOf('2026-08-03')).toEqual({ isoYear: 2026, isoWeek: 32 }); // Mo
    expect(isoWeekOf('2026-08-09')).toEqual({ isoYear: 2026, isoWeek: 32 }); // So
    expect(isoWeekOf('2026-08-10')).toEqual({ isoYear: 2026, isoWeek: 33 }); // Mo
  });

  it('schlaegt Jahreswechsel-Tage der richtigen ISO-Woche zu', () => {
    // 2025-12-29 ist Montag und gehoert bereits zur KW 01/2026.
    expect(isoWeekOf('2025-12-29')).toEqual({ isoYear: 2026, isoWeek: 1 });
    expect(isoWeekOf('2026-01-01')).toEqual({ isoYear: 2026, isoWeek: 1 });
    // 2021-01-01 ist Freitag und gehoert noch zur KW 53/2020.
    expect(isoWeekOf('2021-01-01')).toEqual({ isoYear: 2020, isoWeek: 53 });
  });
});

describe('weeksInIsoYear', () => {
  it('erkennt Jahre mit 53 Wochen', () => {
    expect(weeksInIsoYear(2020)).toBe(53);
    expect(weeksInIsoYear(2026)).toBe(53);
    expect(weeksInIsoYear(2015)).toBe(53);
  });

  it('erkennt Jahre mit 52 Wochen', () => {
    expect(weeksInIsoYear(2021)).toBe(52);
    expect(weeksInIsoYear(2024)).toBe(52);
    expect(weeksInIsoYear(2025)).toBe(52);
  });
});

describe('isoWeekStart / isoWeekEnd', () => {
  it('liefert Montag und Sonntag der KW 32/2026', () => {
    expect(isoDate(isoWeekStart({ isoYear: 2026, isoWeek: 32 }))).toBe('2026-08-03');
    expect(isoDate(isoWeekEnd({ isoYear: 2026, isoWeek: 32 }))).toBe('2026-08-09');
  });

  it('ist die Umkehrung von isoWeekOf', () => {
    for (const year of [2020, 2021, 2024, 2025, 2026]) {
      for (const week of [1, 2, 26, weeksInIsoYear(year)]) {
        const start = isoWeekStart({ isoYear: year, isoWeek: week });
        expect(isoWeekOf(start)).toEqual({ isoYear: year, isoWeek: week });
      }
    }
  });
});

describe('Wochen-Navigation', () => {
  it('springt ueber den Jahreswechsel in ein 53-Wochen-Jahr', () => {
    expect(previousIsoWeek({ isoYear: 2021, isoWeek: 1 })).toEqual({ isoYear: 2020, isoWeek: 53 });
    expect(nextIsoWeek({ isoYear: 2020, isoWeek: 53 })).toEqual({ isoYear: 2021, isoWeek: 1 });
  });

  it('springt ueber den Jahreswechsel in ein 52-Wochen-Jahr', () => {
    expect(previousIsoWeek({ isoYear: 2025, isoWeek: 1 })).toEqual({ isoYear: 2024, isoWeek: 52 });
    expect(nextIsoWeek({ isoYear: 2024, isoWeek: 52 })).toEqual({ isoYear: 2025, isoWeek: 1 });
  });

  it('kappt den Jahresvergleich, wenn das Vorjahr keine KW 53 hat', () => {
    // 2026 hat 53 Wochen, 2025 nur 52 — der Jahresvergleich muss kappen,
    // sonst laeuft der YoY-Vergleich der letzten Woche 2026 ins Leere.
    expect(sameWeekPreviousYear({ isoYear: 2026, isoWeek: 53 })).toEqual({
      isoYear: 2025,
      isoWeek: 52,
    });
    expect(sameWeekPreviousYear({ isoYear: 2026, isoWeek: 32 })).toEqual({
      isoYear: 2025,
      isoWeek: 32,
    });
  });
});

describe('addIsoWeeks', () => {
  /*
   * Der Szenario-Backtest springt 4, 13 und 26 Wochen nach vorn. Wer dafuer
   * n * 7 Tage addiert, landet bei Spruengen ueber ein 53-Wochen-Jahr auf der
   * falschen Kalenderwoche — und der Fehler waere von aussen unsichtbar.
   */
  it('springt vorwaerts ueber einen Jahreswechsel', () => {
    // 2025 hat 52 Wochen: KW 50 + 4 = KW 02/2026.
    expect(addIsoWeeks({ isoYear: 2025, isoWeek: 50 }, 4)).toEqual({ isoYear: 2026, isoWeek: 2 });
  });

  it('zaehlt die 53. Woche mit', () => {
    // 2020 hat 53 Wochen: KW 50/2020 + 4 = KW 01/2021, nicht KW 02.
    expect(addIsoWeeks({ isoYear: 2020, isoWeek: 50 }, 4)).toEqual({ isoYear: 2021, isoWeek: 1 });
    // 2026 ebenfalls: KW 40 + 13 = KW 53/2026.
    expect(addIsoWeeks({ isoYear: 2026, isoWeek: 40 }, 13)).toEqual({ isoYear: 2026, isoWeek: 53 });
  });

  it('trifft ueber 26 Wochen dieselbe Woche wie 26 Einzelschritte', () => {
    for (const start of [
      { isoYear: 2020, isoWeek: 40 },
      { isoYear: 2024, isoWeek: 52 },
      { isoYear: 2026, isoWeek: 45 },
    ]) {
      let step = start;
      for (let i = 0; i < 26; i++) step = nextIsoWeek(step);
      expect(addIsoWeeks(start, 26), isoWeekKey(start)).toEqual(step);
    }
  });

  it('laeuft mit negativem n rueckwaerts und mit 0 gar nicht', () => {
    expect(addIsoWeeks({ isoYear: 2021, isoWeek: 2 }, -4)).toEqual({ isoYear: 2020, isoWeek: 51 });
    expect(addIsoWeeks({ isoYear: 2026, isoWeek: 32 }, 0)).toEqual({ isoYear: 2026, isoWeek: 32 });
  });
});

describe('Schluessel', () => {
  it('formatiert sortierbar mit fuehrender Null', () => {
    expect(isoWeekKey({ isoYear: 2026, isoWeek: 7 })).toBe('2026-W07');
    expect(isoWeekKey({ isoYear: 2026, isoWeek: 32 })).toBe('2026-W32');
  });

  it('liest zurueck und weist unmoegliche Wochen ab', () => {
    expect(parseIsoWeekKey('2026-W32')).toEqual({ isoYear: 2026, isoWeek: 32 });
    expect(parseIsoWeekKey('2026-W53')).toEqual({ isoYear: 2026, isoWeek: 53 });
    // 2025 hat nur 52 Wochen.
    expect(() => parseIsoWeekKey('2025-W53')).toThrow(/52 ISO-Wochen/);
    expect(() => parseIsoWeekKey('Quatsch')).toThrow(/Ungueltiger Wochenschluessel/);
  });
});

describe('isoWeekRange', () => {
  it('zaehlt ueber den Jahreswechsel lueckenlos durch', () => {
    const range = isoWeekRange({ isoYear: 2020, isoWeek: 52 }, { isoYear: 2021, isoWeek: 2 });
    expect(range.map(isoWeekKey)).toEqual(['2020-W52', '2020-W53', '2021-W01', '2021-W02']);
  });

  it('deckt ein 53-Wochen-Jahr vollstaendig ab', () => {
    const range = isoWeekRange({ isoYear: 2026, isoWeek: 1 }, { isoYear: 2026, isoWeek: 53 });
    expect(range).toHaveLength(53);
  });

  it('weist einen rueckwaerts laufenden Bereich ab', () => {
    expect(() =>
      isoWeekRange({ isoYear: 2026, isoWeek: 10 }, { isoYear: 2026, isoWeek: 5 }),
    ).toThrow(/rueckwaerts/);
  });
});
