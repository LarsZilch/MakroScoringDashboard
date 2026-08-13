/**
 * Regelwerk-Parser.
 *
 * Das Regelwerk ist die einzige Wahrheit ueber Schwellen, Korridore und
 * Regime-Baender — Code und Hilfetexte lesen daraus, statt Zahlen zu
 * wiederholen. Diese Tests halten fest, dass nichts auf dem Weg verloren geht
 * und dass ein fehlerhaftes Regelwerk laut scheitert statt still zu wirken.
 */

import { describe, expect, it } from 'vitest';
import { listAssumptions, parseRuleBook } from '../src/core/rulebook.js';
import { loadRules } from '../src/pipeline/load-rules.js';
import { INDICATOR_IDS } from '../src/core/types.js';
import { INDICATOR_SPECS } from '../src/pipeline/indicators.js';
import { num } from '../src/pipeline/format.js';

const rules = loadRules('v1');

describe('Vollstaendigkeit des geladenen Regelwerks', () => {
  it('kennt genau die neun Whitelist-Indikatoren', () => {
    expect(Object.keys(rules.indicators).sort()).toEqual([...INDICATOR_IDS].sort());
  });

  it('reicht den Kalibrierungs-Beleg des GLI-Ersatzes durch', () => {
    /*
     * Dieses Feld ist beim Bau des Hilfe-Tabs aufgefallen: es stand in
     * rules/v1.json, wurde vom Parser aber nicht mitkopiert und fehlte
     * deshalb in der API. Ausgerechnet die wichtigste Einschraenkung des
     * unruhigsten Indikators waere so unsichtbar geblieben.
     */
    const cal = rules.indicators.gli.calibration;
    expect(cal).toBeDefined();
    expect(cal!.chosenThreshold).toBe(6.0);
    expect(cal!.observed.standardDeviation).toBeGreaterThan(40);
    expect(cal!.warning).toMatch(/0,5 pp/);
    expect(cal!.basis).toMatch(/Net Liquidity/);
  });

  it('haelt Ersatzreihen-Hinweis und Bewertungsgrundlage des GLI fest', () => {
    expect(rules.indicators.gli.quality).toBe('proxy');
    expect(rules.indicators.gli.proxyLabel).toContain('Net Liquidity');
    expect(rules.indicators.gli.proxyNote).toMatch(/CrossBorder Capital/);
  });

  it('traegt fuer jede Bewertungsstufe eine Erlaeuterung', () => {
    // Die Hilfe rendert diese Notizen; eine leere Stufe waere dort eine Luecke.
    for (const id of INDICATOR_IDS) {
      for (const band of rules.indicators[id].bands) {
        expect(band.note, `${id}: Band ohne Notiz`).toBeTruthy();
      }
    }
  });

  it('kennzeichnet die kontrarisch gelesenen Indikatoren', () => {
    const contrarian = INDICATOR_IDS.filter((id) => rules.indicators[id].contrarian);
    expect(new Set(contrarian)).toEqual(new Set(['vix', 'aaii', 'fear_greed']));
  });

  it('kennzeichnet den NFCI als invertierte Skala', () => {
    // Fallende Werte bedeuten lockerere Finanzbedingungen — ohne diese
    // Markierung liest die Hilfe die Richtung genau falsch herum.
    expect(rules.indicators.nfci.invertedScale).toBe(true);
  });
});

describe('listAssumptions', () => {
  const assumptions = listAssumptions(rules);

  it('fuehrt jede gesetzte Annahme mit Begruendung', () => {
    expect(assumptions.length).toBeGreaterThanOrEqual(9);
    for (const a of assumptions) {
      expect(a.scope).toBeTruthy();
      expect(a.note.length).toBeGreaterThan(20);
      expect(a.note).not.toBe('ohne Begruendung markiert');
    }
  });

  it('umfasst die gesetzten Regime-Baender', () => {
    const scopes = assumptions.map((a) => a.scope);
    expect(scopes.some((s) => s.includes('Risk Off'))).toBe(true);
    expect(scopes.some((s) => s.includes('Defensiv'))).toBe(true);
  });

  it('fuehrt die belegten Regime-Baender NICHT als Annahme', () => {
    // Risk On bei +2 und Neutral bei +1 sind aus der Vorlage belegt.
    const scopes = assumptions.map((a) => a.scope).join(' ');
    expect(scopes).not.toContain('Risk On');
    expect(scopes).not.toContain('Neutral');
  });
});

describe('Der Parser weist fehlerhafte Regelwerke ab', () => {
  const valid = JSON.parse(JSON.stringify(loadRules('v1'))) as Record<string, unknown>;
  const clone = () => JSON.parse(JSON.stringify(valid)) as any;

  it('akzeptiert das gueltige Regelwerk unveraendert', () => {
    expect(() => parseRuleBook(clone())).not.toThrow();
  });

  it('meldet einen unvollstaendigen Kalibrierungs-Beleg', () => {
    // Halb ausgefuellt waere schlimmer als gar nicht: es erweckte den
    // Anschein einer Messung, die nicht stattfand.
    const broken = clone();
    delete broken.indicators.gli.calibration.warning;
    expect(() => parseRuleBook(broken)).toThrow(/calibration\.warning/);
  });

  it('meldet eine Luecke in den Regime-Baendern', () => {
    const broken = clone();
    broken.regimeBands = broken.regimeBands.filter((b: { label: string }) => b.label !== 'Neutral');
    expect(() => parseRuleBook(broken)).toThrow(/von keinem Band abgedeckt/);
  });

  it('meldet einen Faktor mit falscher Indikatorzahl', () => {
    const broken = clone();
    broken.indicators.vix.factor = 'liquidity';
    expect(() => parseRuleBook(broken)).toThrow(/Indikatoren zugeordnet/);
  });

  it('meldet ein Band ohne Auffangfall', () => {
    const broken = clone();
    broken.indicators.vix.bands[broken.indicators.vix.bands.length - 1].gt = 99;
    expect(() => parseRuleBook(broken)).toThrow(/Auffangfall/);
  });
});

describe('Keine zweite Wahrheit in den Anzeigezeilen', () => {
  /*
   * Die Korridore standen frueher als Text in src/pipeline/indicators.ts
   * ("Korridor 15-25") und zusaetzlich als Zahlen im Regelwerk. Beim
   * Verschieben einer Schwelle wanderte nur die eine Fassung mit — die
   * Anzeige behauptete dann einen Korridor, nach dem gar nicht mehr bewertet
   * wurde. Dieser Test haelt fest, dass der Text aus dem Regelwerk kommt.
   */
  const withCorridor = INDICATOR_IDS.filter((id) => rules.indicators[id].corridor);

  it('betrifft genau die drei Sentiment-Indikatoren', () => {
    expect(new Set(withCorridor)).toEqual(new Set(['vix', 'aaii', 'fear_greed']));
  });

  it('leitet den Korridortext aus dem Regelwerk ab', () => {
    const bundle = {
      VIXCLS: [{ date: '2026-08-12', value: 15.28 }],
      AAII_BULL_BEAR: [{ date: '2026-08-12', value: -3.2 }],
      CNN_FEAR_GREED: [{ date: '2026-08-12', value: 62 }],
    };

    for (const id of withCorridor) {
      const [lo, hi] = rules.indicators[id].corridor!;
      const input = INDICATOR_SPECS[id].compute(bundle, '2026-08-13', rules.indicators[id]);
      // Mit derselben Formatierung vergleichen: die Anzeige benutzt das
      // typografische Minuszeichen, String(-10) den ASCII-Bindestrich.
      expect(input.display?.secondary, id).toContain(num(lo, 0));
      expect(input.display?.secondary, id).toContain(num(hi, 0));
    }
  });

  it('folgt einer verschobenen Schwelle, statt den alten Wert zu behaupten', () => {
    const moved = JSON.parse(JSON.stringify(rules.indicators.vix));
    moved.corridor = [12, 30];
    const bundle = { VIXCLS: [{ date: '2026-08-12', value: 15.28 }] };
    const input = INDICATOR_SPECS.vix.compute(bundle, '2026-08-13', moved);
    expect(input.display?.secondary).toContain('12');
    expect(input.display?.secondary).toContain('30');
    expect(input.display?.secondary).not.toContain('25');
  });
});
