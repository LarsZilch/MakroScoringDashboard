/**
 * Zoom-Fenster ueber die Wochenreihe.
 *
 * Zwei Eigenschaften tragen das Gefuehl der Bedienung und sind deshalb hier
 * festgenagelt: das Fenster verlaesst nie die Datenreihe, und beim Radzoom
 * bleibt die Woche unter dem Mauszeiger unter dem Mauszeiger.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_WEEKS,
  centerWindow,
  clampWindow,
  fullWindow,
  isFullRange,
  panWindow,
  reindexPoints,
  windowWidth,
  zoomWindow,
} from '../web/src/components/windowMath.js';

const TOTAL = 815; // der reale Bestand nach dem Fear-&-Greed-Import

describe('clampWindow', () => {
  it('laesst ein gueltiges Fenster unveraendert', () => {
    expect(clampWindow({ start: 100, end: 200 }, TOTAL)).toEqual({ start: 100, end: 200 });
  });

  it('schiebt ein ueber das Ende hinausragendes Fenster zurueck, ohne es zu stauchen', () => {
    const w = clampWindow({ start: 800, end: 900 }, TOTAL);
    expect(windowWidth(w)).toBe(100);
    expect(w.end).toBe(TOTAL);
    expect(w.start).toBe(TOTAL - 100);
  });

  it('schiebt ein negativ beginnendes Fenster nach rechts', () => {
    const w = clampWindow({ start: -50, end: 50 }, TOTAL);
    expect(w).toEqual({ start: 0, end: 100 });
  });

  it('erzwingt die Mindestbreite', () => {
    const w = clampWindow({ start: 400, end: 401 }, TOTAL);
    expect(windowWidth(w)).toBe(MIN_WEEKS);
  });

  it('begrenzt die Breite auf den Bestand', () => {
    const w = clampWindow({ start: 0, end: 5000 }, TOTAL);
    expect(w).toEqual({ start: 0, end: TOTAL });
  });

  it('zeigt bei sehr kurzem Bestand einfach alles', () => {
    expect(clampWindow({ start: 2, end: 4 }, 5)).toEqual({ start: 0, end: 5 });
  });
});

describe('zoomWindow — der Anker bleibt stehen', () => {
  it('haelt die Woche unter dem Mauszeiger fest, wenn er in der Mitte steht', () => {
    const w = { start: 0, end: 800 };
    const mitte = w.start + windowWidth(w) * 0.5; // 400
    const z = zoomWindow(w, TOTAL, 0.5, 0.5);
    const neueMitte = z.start + windowWidth(z) * 0.5;
    expect(neueMitte).toBeCloseTo(mitte, 6);
    expect(windowWidth(z)).toBe(400);
  });

  it('haelt den Anker auch am linken Rand fest', () => {
    const w = { start: 200, end: 600 };
    const z = zoomWindow(w, TOTAL, 0.5, 0); // Zeiger auf der linken Kante
    expect(z.start).toBe(200);
    expect(windowWidth(z)).toBe(200);
  });

  it('haelt den Anker auch am rechten Rand fest', () => {
    const w = { start: 200, end: 600 };
    const z = zoomWindow(w, TOTAL, 0.5, 1); // Zeiger auf der rechten Kante
    expect(z.end).toBe(600);
    expect(windowWidth(z)).toBe(200);
  });

  it('zoomt heraus und bleibt im Bestand', () => {
    const w = { start: 700, end: 780 };
    const z = zoomWindow(w, TOTAL, 4, 0.5);
    expect(windowWidth(z)).toBe(320);
    expect(z.start).toBeGreaterThanOrEqual(0);
    expect(z.end).toBeLessThanOrEqual(TOTAL);
  });

  it('geht beim Herauszoomen nie ueber den Gesamtbestand hinaus', () => {
    const z = zoomWindow({ start: 0, end: TOTAL }, TOTAL, 10, 0.5);
    expect(z).toEqual({ start: 0, end: TOTAL });
  });

  it('unterschreitet die Mindestbreite auch bei wildem Hineinzoomen nicht', () => {
    let w = fullWindow(TOTAL);
    for (let i = 0; i < 50; i++) w = zoomWindow(w, TOTAL, 0.5, 0.5);
    expect(windowWidth(w)).toBe(MIN_WEEKS);
  });
});

describe('panWindow', () => {
  it('verschiebt und behaelt die Breite', () => {
    const w = panWindow({ start: 100, end: 200 }, TOTAL, 50);
    expect(w).toEqual({ start: 150, end: 250 });
  });

  it('bleibt am linken Anschlag stehen', () => {
    const w = panWindow({ start: 10, end: 110 }, TOTAL, -999);
    expect(w).toEqual({ start: 0, end: 100 });
  });

  it('bleibt am rechten Anschlag stehen', () => {
    const w = panWindow({ start: 700, end: 800 }, TOTAL, 999);
    expect(w.end).toBe(TOTAL);
    expect(windowWidth(w)).toBe(100);
  });
});

describe('centerWindow', () => {
  it('legt den gewuenschten Index in die Mitte', () => {
    const w = centerWindow({ start: 0, end: 100 }, TOTAL, 400);
    expect(w.start + windowWidth(w) / 2).toBeCloseTo(400, 6);
  });

  it('kappt sauber, wenn die Mitte am Rand nicht erreichbar ist', () => {
    const w = centerWindow({ start: 300, end: 400 }, TOTAL, 5);
    expect(w).toEqual({ start: 0, end: 100 });
  });
});

describe('isFullRange', () => {
  it('erkennt die Gesamtsicht', () => {
    expect(isFullRange(fullWindow(TOTAL), TOTAL)).toBe(true);
    expect(isFullRange({ start: 1, end: TOTAL }, TOTAL)).toBe(false);
  });
});

describe('reindexPoints', () => {
  it('setzt den ersten sichtbaren Punkt auf 100', () => {
    const points = [
      { weekKey: '2020-W01', value: 100 },
      { weekKey: '2020-W02', value: 150 },
      { weekKey: '2020-W03', value: 300 },
    ];
    const sichtbar = new Set(['2020-W02', '2020-W03']);
    const r = reindexPoints(points, sichtbar);

    // Ohne Neuindexierung stuende hier 150 und 300 — bezogen auf eine
    // 100er-Linie, die nach dem Zoomen gar nicht mehr im Bild ist.
    expect(r).toEqual([
      { weekKey: '2020-W02', value: 100 },
      { weekKey: '2020-W03', value: 200 },
    ]);
  });

  it('verwirft Punkte ausserhalb des Fensters', () => {
    const points = [
      { weekKey: 'a', value: 10 },
      { weekKey: 'b', value: 20 },
    ];
    expect(reindexPoints(points, new Set(['b']))).toEqual([{ weekKey: 'b', value: 100 }]);
  });

  it('bleibt bei leerem Fenster leer, statt durch null zu teilen', () => {
    expect(reindexPoints([{ weekKey: 'a', value: 10 }], new Set())).toEqual([]);
  });
});
