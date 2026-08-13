/**
 * Parser-Tests gegen eingecheckte echte Antworten.
 *
 * Sinn der Sache: die Quellen sind teils inoffiziell (CNN, Yahoo), teils
 * gescrapt (AAII, ISM). Sie werden ihr Format irgendwann aendern. Diese Tests
 * sorgen dafuer, dass das als roter Test auffaellt statt als stiller
 * Falschwert im Dashboard.
 *
 * Kein Netzzugriff — die Fixtures liegen unter test/fixtures/.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFredCsv } from '../src/sources/fred.js';
import { lastBarDate, parseYahooChart } from '../src/sources/yahoo.js';
import { parseFearGreed } from '../src/sources/cnn.js';
import { parseAaii } from '../src/sources/aaii.js';
import { parseIsmHeadlines } from '../src/sources/ism.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('FRED-CSV', () => {
  const series = parseFredCsv(fixture('fred-nfci.csv'), 'NFCI');

  it('liest Beobachtungen in aufsteigender Reihenfolge', () => {
    expect(series.length).toBeGreaterThan(5);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.date > series[i - 1]!.date).toBe(true);
    }
  });

  it('liefert plausible NFCI-Werte', () => {
    for (const o of series) {
      expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Math.abs(o.value)).toBeLessThan(5); // NFCI schwankt um null
    }
  });

  it('verwirft den FRED-Marker "." fuer fehlende Beobachtungen', () => {
    const withGaps = 'observation_date,VIXCLS\n2026-01-01,.\n2026-01-02,17.5\n2026-01-03,.\n';
    const parsed = parseFredCsv(withGaps, 'VIXCLS');
    expect(parsed).toEqual([{ date: '2026-01-02', value: 17.5 }]);
  });

  it('meldet einen veraenderten CSV-Kopf statt still zu scheitern', () => {
    expect(() => parseFredCsv('DATE,NFCI\n2026-01-01,1.0\n', 'NFCI')).toThrow(
      /unerwarteter CSV-Kopf/,
    );
  });
});

describe('Yahoo-Chart (MOVE)', () => {
  const raw = fixture('yahoo-move.json');
  const series = parseYahooChart(raw, '^MOVE');

  it('liefert plausible MOVE-Staende', () => {
    expect(series.length).toBeGreaterThan(0);
    for (const o of series) {
      expect(o.value).toBeGreaterThan(20);
      expect(o.value).toBeLessThan(300);
    }
  });

  it('verwirft Luecken (null-Schlusskurse) statt sie als 0 zu werten', () => {
    const parsed = JSON.parse(raw);
    const closes = parsed.chart.result[0].indicators.quote[0].close as (number | null)[];
    const withValue = closes.filter((c) => c !== null).length;
    // Balken mit Wert, plus der angehaengte Live-Kurs an einem neuen Datum.
    expect(series.length).toBe(withValue + 1);
  });

  it('haengt den Live-Kurs an, weil Yahoo fuer ^MOVE keine Tagesbalken mehr liefert', () => {
    /*
     * Befund beim Erstellen der Fixture: Yahoo liefert fuer ^MOVE seit dem
     * 17.07.2026 nur noch null-Schlusskurse, waehrend der Live-Kurs im
     * meta-Block weiterlaeuft. Ohne das Anhaengen fehlte dem Dashboard genau
     * der aktuelle Wert — der Indikator wuerde still auf einem vier Wochen
     * alten Stand einfrieren.
     */
    expect(lastBarDate(raw)).toBe('2026-07-17');
    const meta = JSON.parse(raw).chart.result[0].meta;
    const last = series[series.length - 1]!;
    expect(last.value).toBeCloseTo(meta.regularMarketPrice, 4);
    expect(last.date > '2026-07-17').toBe(true);
  });

  it('meldet ein veraendertes Antwortformat', () => {
    expect(() => parseYahooChart('{"chart":{"result":[{"meta":{}}]}}', '^MOVE')).toThrow(
      /keine Kursreihe/,
    );
  });
});

describe('CNN Fear & Greed', () => {
  const { series } = parseFearGreed(fixture('cnn-feargreed.json'));

  it('liest rund ein Jahr Tageshistorie', () => {
    expect(series.length).toBeGreaterThan(200);
    expect(series.length).toBeLessThan(400);
  });

  it('haelt sich an den Wertebereich 0..100', () => {
    for (const o of series) {
      expect(o.value).toBeGreaterThanOrEqual(0);
      expect(o.value).toBeLessThanOrEqual(100);
    }
  });

  it('meldet die Bot-Sperre verstaendlich', () => {
    expect(() => parseFearGreed('<html>418</html>')).toThrow(/kein JSON/);
  });
});

describe('AAII Sentiment Survey', () => {
  const reading = parseAaii(fixture('aaii-sentiment.html'));

  it('liest die Wochenwerte, nicht die historischen Durchschnitte', () => {
    // Die Seite zeigt daneben "Avg 37.5%", "Avg 31.0%", "Avg 31.5%".
    expect(reading.bullish).toBe(34.7);
    expect(reading.neutral).toBe(27.4);
    expect(reading.bearish).toBe(37.9);
  });

  it('rechnet den Bull-Bear-Spread aus', () => {
    expect(reading.spread).toBe(-3.2);
  });

  it('liest das Datum der Umfragewoche', () => {
    expect(reading.date).toBe('2026-08-12');
  });

  it('faengt ab, wenn versehentlich die Durchschnitte gelesen wuerden', () => {
    // 37.5 + 31.0 + 31.5 = 100.0 waere plausibel — deshalb hier ein Fall,
    // der die Summenpruefung wirklich reisst.
    const broken = fixture('aaii-sentiment.html').replace('34.7%', '84.7%');
    expect(() => parseAaii(broken)).toThrow(/statt 100 %/);
  });

  it('meldet ein geaendertes Layout', () => {
    expect(() => parseAaii('<div>nichts hier</div>')).toThrow(/Seitenlayout/);
  });
});

describe('ISM Manufacturing PMI', () => {
  const series = parseIsmHeadlines(fixture('ism-prnewswire.html'));

  it('rekonstruiert die Monatsreihe aus den Ueberschriften', () => {
    expect(series.length).toBeGreaterThanOrEqual(8);
    const byDate = Object.fromEntries(series.map((o) => [o.date, o.value]));
    expect(byDate['2026-07-01']).toBe(55.6);
    expect(byDate['2026-04-01']).toBe(52.7);
  });

  it('reproduziert die 3m-Change der Vorlage: Juli gegen April = +2,9', () => {
    // Genau die Rechnung hinter "55,6 (Juli) · +2,9 Pkt vs. April".
    const byDate = Object.fromEntries(series.map((o) => [o.date, o.value]));
    expect(byDate['2026-07-01']! - byDate['2026-04-01']!).toBeCloseTo(2.9, 10);
  });

  it('versteht glatte Werte ohne Nachkommastelle', () => {
    const parsed = parseIsmHeadlines('Manufacturing PMI® at 54%; May 2026 ISM® Report');
    expect(parsed).toEqual([{ date: '2026-05-01', value: 54 }]);
  });

  it('verwirft unmoegliche PMI-Staende', () => {
    expect(() => parseIsmHeadlines('Manufacturing PMI® at 9%; May 2026 ISM® Report')).toThrow(
      /keine PMI-Ueberschrift/,
    );
  });
});
