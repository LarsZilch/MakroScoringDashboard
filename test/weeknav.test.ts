/**
 * Indexrechnung fuer das Blaettern durch die Wochenauswahl (web/src/weeknav.ts).
 *
 * `options` ist wie in App.tsx neueste zuerst; Index 0 == juengste Woche ==
 * 'latest'.
 */

import { describe, expect, it } from 'vitest';
import { resolveIndex, stepWeek } from '../web/src/weeknav.js';

const OPTIONS = [
  { weekKey: '2026-W33' },
  { weekKey: '2026-W32' },
  { weekKey: '2026-W31' },
  { weekKey: '2026-W30' },
];

describe('resolveIndex', () => {
  it("'latest' zeigt auf die juengste Woche", () => {
    expect(resolveIndex(OPTIONS, 'latest')).toBe(0);
  });

  it('findet einen bekannten Wochenschluessel', () => {
    expect(resolveIndex(OPTIONS, '2026-W31')).toBe(2);
  });

  it('faellt bei einem unbekannten Schluessel auf die juengste Woche zurueck', () => {
    expect(resolveIndex(OPTIONS, '1999-W01')).toBe(0);
  });
});

describe('stepWeek', () => {
  it("geht von 'latest' aus eine Woche zurueck", () => {
    expect(stepWeek(OPTIONS, 'latest', 'older')).toBe('2026-W32');
  });

  it('bleibt am juengeren Rand stehen', () => {
    expect(stepWeek(OPTIONS, 'latest', 'newer')).toBeNull();
    expect(stepWeek(OPTIONS, '2026-W33', 'newer')).toBeNull();
  });

  it('bleibt am aeltesten Rand stehen', () => {
    expect(stepWeek(OPTIONS, '2026-W30', 'older')).toBeNull();
  });

  it('vor und zurueck heben sich auf', () => {
    const back = stepWeek(OPTIONS, '2026-W32', 'older')!;
    expect(back).toBe('2026-W31');
    expect(stepWeek(OPTIONS, back, 'newer')).toBe('2026-W32');
  });

  it('faellt bei unbekanntem Schluessel auf die juengste Woche zurueck und schreitet von dort', () => {
    expect(stepWeek(OPTIONS, '1999-W01', 'older')).toBe('2026-W32');
  });

  it('liefert null bei leerer Auswahl', () => {
    expect(stepWeek([], 'latest', 'older')).toBeNull();
  });
});
