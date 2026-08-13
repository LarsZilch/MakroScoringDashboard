/**
 * Der Unterschied zwischen "neutral" und "unbekannt".
 *
 * Das ist die gefaehrlichste Verwechslung in diesem Projekt. Fehlt ein Wert
 * und wird er als 0 gezaehlt, ergibt sich rechnerisch ein Score, der wie eine
 * Marktaussage aussieht, aber nur eine Datenluecke abbildet. Beim Backfill
 * betrifft das die grosse Mehrheit aller Wochen: AAII, ISM und Fear & Greed
 * sind historisch frei nicht zu bekommen.
 *
 * Diese Tests halten fest, dass die Luecke als Luecke erkennbar bleibt.
 */

import { describe, expect, it } from 'vitest';
import { computeScoring } from '../src/core/scoring.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { INDICATOR_IDS, type IndicatorId, type IndicatorInput } from '../src/core/types.js';

const rules = loadRules('v1');

/** Alle neun Indikatoren mit einem Wert belegen, der neutral bewertet wird. */
function allNeutral(): Record<IndicatorId, IndicatorInput> {
  return {
    ism_mfg_pmi: { measureValue: 0 },
    nfci: { measureValue: 0 },
    t10y2y: { measureValue: 0 },
    gli: { measureValue: 0 },
    move: { measureValue: 90 },
    sofr_iorb: { measureValue: 5 },
    vix: { measureValue: 20 },
    aaii: { measureValue: 0 },
    fear_greed: { measureValue: 50 },
  };
}

function without(ids: IndicatorId[]): Record<IndicatorId, IndicatorInput> {
  const inputs = allNeutral();
  for (const id of ids) inputs[id] = { measureValue: null };
  return inputs;
}

describe('Neutral ist nicht dasselbe wie unbekannt', () => {
  it('nennt einen echt neutralen Faktor "alle 3 neutral"', () => {
    const r = computeScoring(rules, allNeutral());
    expect(r.factors.sentiment.rationale).toBe('alle 3 neutral');
    expect(r.factors.sentiment.determinable).toBe(true);
    expect(r.factors.sentiment.missing).toBe(0);
    expect(r.meaningful).toBe(true);
  });

  it('erklaert einen Faktor mit zwei fehlenden Werten fuer unbestimmbar', () => {
    // Genau die Lage im Backfill: VIX vorhanden, AAII und Fear & Greed nicht.
    const r = computeScoring(rules, without(['aaii', 'fear_greed']));
    const s = r.factors.sentiment;
    expect(s.missing).toBe(2);
    expect(s.determinable).toBe(false);
    expect(s.rationale).toBe('2 von 3 ohne Wert — nicht bestimmbar');
    // Und vor allem: NICHT als "alle drei neutral" ausgeben.
    expect(s.rationale).not.toContain('neutral');
  });

  it('markiert den Gesamtscore als nicht aussagekraeftig', () => {
    const r = computeScoring(rules, without(['aaii', 'fear_greed']));
    expect(r.meaningful).toBe(false);
    expect(r.undeterminableFactors).toEqual(['sentiment']);
    // Die Zahl existiert weiterhin — aber sie ist gekennzeichnet.
    expect(typeof r.total).toBe('number');
  });

  it('bleibt bei einem einzelnen fehlenden Wert bestimmbar', () => {
    const r = computeScoring(rules, without(['aaii']));
    expect(r.factors.sentiment.determinable).toBe(true);
    expect(r.factors.sentiment.missing).toBe(1);
    expect(r.meaningful).toBe(true);
  });

  it('zaehlt fehlende Werte nicht in die Mehrheit', () => {
    // Zwei positive von drei — aber der dritte fehlt. Die Mehrheit steht
    // trotzdem, weil sie sich auf die vorhandenen Werte stuetzt.
    const inputs = allNeutral();
    inputs.ism_mfg_pmi = { measureValue: 3 }; // +1
    inputs.nfci = { measureValue: -0.1 }; // +1
    inputs.t10y2y = { measureValue: null }; // fehlt
    const r = computeScoring(rules, inputs);
    expect(r.factors.business_cycle.score).toBe(1);
    expect(r.factors.business_cycle.positives).toBe(2);
    expect(r.factors.business_cycle.missing).toBe(1);
    expect(r.factors.business_cycle.determinable).toBe(true);
  });

  it('erklaert einen voellig leeren Faktor als "kein Wert verfuegbar"', () => {
    const r = computeScoring(rules, without(['vix', 'aaii', 'fear_greed']));
    expect(r.factors.sentiment.rationale).toBe('kein Wert verfuegbar — nicht bestimmbar');
  });

  it('meldet alle fehlenden Indikatoren namentlich', () => {
    const r = computeScoring(rules, without(['aaii', 'ism_mfg_pmi', 'fear_greed']));
    expect(new Set(r.missing)).toEqual(new Set(['aaii', 'ism_mfg_pmi', 'fear_greed']));
    for (const id of r.missing) {
      expect(r.indicators[id].quality).toBe('missing');
      expect(r.indicators[id].scoreNote).toMatch(/kein Wert/);
    }
  });

  it('behandelt einen voellig leeren Datensatz als nicht aussagekraeftig', () => {
    const r = computeScoring(rules, without([...INDICATOR_IDS]));
    expect(r.meaningful).toBe(false);
    expect(r.undeterminableFactors).toHaveLength(3);
    expect(r.total).toBe(0);
    // Ein Score von 0 bei voelliger Datenlosigkeit darf niemals als
    // "Neutral" durchgehen, ohne dass die Kennzeichnung daran haengt.
    expect(r.regime.label).toBe('Neutral');
    expect(r.meaningful).toBe(false);
  });
});
