/**
 * Golden Test gegen die Vorlage doc/MakroScoringInfoScreen.jpg (KW 32/2026).
 *
 * Dieser Test ist das Rueckgrat des Projekts: er fuettert exakt die neun im
 * Screenshot abgedruckten Werte in den Scoring-Kern und erwartet exakt das
 * dort abgedruckte Ergebnis. Schlaegt er fehl, ist entweder das Regelwerk
 * falsch abgeleitet oder der Kern fehlerhaft - in beiden Faellen ist jede
 * weitere Zahl der App wertlos.
 */

import { describe, expect, it } from 'vitest';
import { analyzeSensitivity, computeScoring } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import type { IndicatorId, IndicatorInput } from '../src/core/types.js';

const rules = loadRules('v1');

/**
 * Die Werte aus der Vorlage, KW 32/2026, Datenstand 07.08.2026.
 *
 * Eine Ausnahme: fuer den GLI nennt die Vorlage nur "5,1 % 3m ann. · fallend"
 * ohne beziffertes Richtungsmass. Hier steht deshalb ein stellvertretender
 * negativer Wert; belegt ist allein das Vorzeichen.
 */
const KW32: Record<IndicatorId, IndicatorInput> = {
  ism_mfg_pmi: {
    measureValue: 2.9,
    value: 55.6,
    obsDate: '2026-07-01',
    display: { primary: '55,6 (Juli)', secondary: '+2,9 Pkt vs. April' },
  },
  nfci: {
    measureValue: -0.03,
    value: -0.529,
    obsDate: '2026-08-01',
    display: { primary: '−0,529', secondary: 'lockerer (−0,030)' },
  },
  t10y2y: {
    measureValue: -3,
    value: 0.45,
    obsDate: '2026-08-07',
    display: { primary: '+0,45 %', secondary: 'leicht flacher (−3 bps)' },
  },
  gli: {
    // Die Vorlage schreibt nur "fallend" und beziffert die Richtung nicht.
    // Hier steht deshalb ein Wert, der unter der kalibrierten Schwelle von
    // -6,0 pp eindeutig fallend ist; belegt ist allein das Vorzeichen.
    measureValue: -8.0,
    value: 5.1,
    obsDate: '2026-08-05',
    display: { primary: '5,1 % 3m ann.', secondary: 'fallend' },
  },
  move: {
    measureValue: 76,
    value: 76,
    obsDate: '2026-08-07',
    display: { primary: '≈ 76', secondary: 'unter 80' },
  },
  sofr_iorb: {
    measureValue: -1,
    value: -1,
    obsDate: '2026-08-07',
    display: { primary: '−1 bp', secondary: '3,64 vs. 3,65' },
  },
  vix: {
    measureValue: 15.15,
    value: 15.15,
    obsDate: '2026-08-07',
    display: { primary: '15,15', secondary: 'Korridor 15–25' },
  },
  aaii: {
    measureValue: -3.2,
    value: -3.2,
    obsDate: '2026-08-06',
    display: { primary: '−3,2 %', secondary: 'Korridor −10 bis +20' },
  },
  fear_greed: {
    measureValue: 60,
    value: 60,
    obsDate: '2026-08-07',
    display: { primary: '60 (Greed)', secondary: 'Korridor 20–70' },
  },
};

describe('Golden Test — KW 32/2026 aus der Vorlage', () => {
  const result = computeScoring(rules, KW32);

  it('bewertet alle neun Einzelindikatoren wie abgedruckt', () => {
    const actual = Object.fromEntries(
      Object.values(result.indicators).map((i) => [i.id, i.score]),
    );
    expect(actual).toEqual({
      // Faktor 1 · Business Cycle
      ism_mfg_pmi: 1,
      nfci: 1,
      t10y2y: 0,
      // Faktor 2 · Globale Liquiditaet
      gli: -1,
      move: 1,
      sofr_iorb: 1,
      // Faktor 3 · Sentiment
      vix: 0,
      aaii: 0,
      fear_greed: 0,
    });
  });

  it('aggregiert die drei Faktoren wie abgedruckt', () => {
    expect(result.factors.business_cycle.score).toBe(1);
    expect(result.factors.liquidity.score).toBe(1);
    expect(result.factors.sentiment.score).toBe(0);
  });

  it('formuliert die Ergebniszeilen wie in der Vorlage', () => {
    expect(result.factors.business_cycle.rationale).toBe('2 von 3 positiv');
    expect(result.factors.liquidity.rationale).toBe('2 von 3 positiv');
    expect(result.factors.sentiment.rationale).toBe('alle 3 neutral');
  });

  it('ergibt Gesamtscore +2, Regime "Risk On" und Soll-Cash 5–15 %', () => {
    expect(result.total).toBe(2);
    expect(result.regime.label).toBe('Risk On');
    expect(result.regime.cashBand).toEqual([5, 15]);
  });

  it('meldet keine fehlenden Indikatoren', () => {
    expect(result.missing).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(result.meaningful).toBe(true);
    expect(result.undeterminableFactors).toEqual([]);
  });

  it('kennzeichnet den GLI als Ersatzreihe', () => {
    expect(result.indicators.gli.quality).toBe('proxy');
    expect(result.indicators.gli.label).toContain('Net Liquidity');
  });
});

describe('Grenzfall-Analyse — reproduziert den roten Kasten der Vorlage', () => {
  const result = computeScoring(rules, KW32);
  const sensitivity = analyzeSensitivity(rules, result);

  it('misst den VIX auf 0,15 Punkte ueber der Complacency-Schwelle', () => {
    // Vorlage: "Der VIX steht 0,15 Punkte ueber der Complacency-Schwelle —
    // ein ruhiger Tag kippt ihn auf −1."
    const vix = result.indicators.vix.nearestFlip;
    expect(vix).not.toBeNull();
    expect(vix!.boundary).toBe(15);
    expect(vix!.gap).toBeCloseTo(0.15, 10);
    expect(vix!.direction).toBe('down');
    expect(vix!.toScore).toBe(-1);
  });

  it('erkennt SOFR–IORB als den wackligsten regime-relevanten Punkt', () => {
    // Vorlage: "Liest man −1 bis +1 bp als stabiles Rauschen (0 statt +1),
    // faellt die Mehrheit weg: Faktor 2 = 0, Gesamtscore +1, Neutral, 20–35 %."
    const sofr = sensitivity.find((s) => s.indicator === 'sofr_iorb')!;
    expect(sofr.changesRegime).toBe(true);
    expect(sofr.toScore).toBe(0);
    expect(sofr.resultingTotal).toBe(1);
    expect(sofr.resultingRegime).toBe('Neutral');

    // Er steht ganz oben in der Rangfolge — genau die Stelle, die die Vorlage
    // als "die eine Entscheidung" ueberschreibt.
    expect(sensitivity[0]!.indicator).toBe('sofr_iorb');
  });

  it('deckt auf, dass bei Gesamtscore +2 vier Indikatoren das Regime kippen koennen', () => {
    // Nicht in der Vorlage benannt, aber mathematisch zwingend: bei einem
    // Gesamtscore von genau +2 reicht jeder Faktor, der von +1 auf 0 faellt.
    // Die Vorlage hebt SOFR-IORB und VIX nur deshalb hervor, weil sie ihren
    // Schwellen am naechsten stehen — nicht, weil sie die einzigen waeren.
    const kipper = sensitivity.filter((s) => s.changesRegime).map((s) => s.indicator);
    expect(new Set(kipper)).toEqual(new Set(['sofr_iorb', 'move', 'nfci', 'ism_mfg_pmi']));
    for (const s of sensitivity.filter((x) => x.changesRegime)) {
      expect(s.resultingRegime).toBe('Neutral');
    }
  });

  it('rangiert nach vergleichbarem Mass, nicht nach rohem Abstand', () => {
    // Roher Abstand waere hier irrefuehrend: NFCI liegt 0,01 Indexpunkte von
    // seiner Schwelle, SOFR-IORB 3 bp. Ohne Umrechnung stuende NFCI vorn.
    const nfci = sensitivity.find((s) => s.indicator === 'nfci')!;
    const sofr = sensitivity.find((s) => s.indicator === 'sofr_iorb')!;
    expect(nfci.gap).toBeLessThan(sofr.gap);
    expect(sofr.closeness).toBeLessThan(nfci.closeness);
    // Ohne Historie wird in Anzeigeschritten gerechnet.
    expect(sofr.closenessBasis).toBe('ticks');
    expect(sofr.gapTicks).toBeCloseTo(3, 10); // 3 bp bei 0 Nachkommastellen
    expect(nfci.gapTicks).toBeCloseTo(10, 10); // 0,010 bei 3 Nachkommastellen
  });

  it('haelt fest, dass der VIX-Kipp das Regime NICHT dreht', () => {
    // Ein einzelner negativer Sentiment-Wert erreicht keine Mehrheit.
    const vix = sensitivity.find((s) => s.indicator === 'vix')!;
    expect(vix.toScore).toBe(-1);
    expect(vix.resultingTotal).toBe(2);
    expect(vix.changesRegime).toBe(false);
  });
});
