/**
 * AAII Investor Sentiment Survey.
 *
 * Zwei harte Einschraenkungen, die den Umgang mit diesem Indikator praegen:
 *
 * 1. Die Tabelle mit der Wochenhistorie liegt hinter der Mitgliedschaft. Frei
 *    zugaenglich ist nur die JEWEILS AKTUELLE Woche. Die Historie muss die App
 *    sich also selbst aufbauen, Woche fuer Woche — deshalb schreibt der
 *    Reihen-Cache jeden Abruf fort, statt ihn zu ersetzen.
 * 2. Das Regelwerk bewertet den 4-Wochen-Schnitt. Der ist erst nach vier
 *    gesammelten Wochen belastbar; vorher meldet der Aufrufer das offen.
 *
 * Gescrapt wird HTML. Ein Layoutwechsel bricht den Parser — genau dafuer gibt
 * es den Fixture-Test, damit das als roter Test auffaellt und nicht als
 * stiller Falschwert im Dashboard landet.
 */

import { normalizeSeries } from '../core/derive.js';
import { httpGetText } from './http.js';
import type { SourceResult } from './types.js';

const URL_AAII = 'https://www.aaii.com/sentimentsurvey';

export interface AaiiReading {
  /** Datum des Umfrage-Endes (Mittwoch). */
  date: string;
  bullish: number;
  neutral: number;
  bearish: number;
  /** Bull-Bear-Spread in Prozentpunkten — die im Regelwerk bewertete Groesse. */
  spread: number;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseUsDate(text: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/**
 * Aktuelle Wochenwerte aus der Seite ziehen.
 *
 * Angesteuert werden die Klassen des Anzeigeblocks (ssv2-snum bull/neut/bear).
 * Wichtig: die Seite zeigt daneben auch historische Durchschnitte ("Avg 37.5%")
 * — die duerfen nicht mit den Wochenwerten verwechselt werden.
 */
export function parseAaii(raw: string): AaiiReading {
  const pick = (cls: string): number => {
    const re = new RegExp(`ssv2-snum[^"]*\\b${cls}\\b[^"]*"[^>]*>\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s*%`, 'i');
    const m = re.exec(raw);
    if (!m) {
      throw new Error(
        `AAII: Wert fuer "${cls}" nicht gefunden — das Seitenlayout hat sich vermutlich geaendert`,
      );
    }
    return Number(m[1]);
  };

  const bullish = pick('bull');
  const neutral = pick('neut');
  const bearish = pick('bear');

  const weekMatch = /ssv2-gauge-week[^>]*>\s*Week ending\s*([^<]+)</i.exec(raw);
  const date = weekMatch ? parseUsDate(weekMatch[1]!) : null;
  if (!date) {
    throw new Error('AAII: Datum der Umfragewoche nicht gefunden — Seitenlayout geaendert?');
  }

  // Plausibilitaet: die drei Anteile muessen sich zu rund 100 % addieren.
  // Ohne diese Pruefung wuerde ein Parser, der versehentlich die Durchschnitte
  // greift, unbemerkt falsche Werte liefern.
  const sum = bullish + neutral + bearish;
  if (Math.abs(sum - 100) > 1.5) {
    throw new Error(
      `AAII: Anteile summieren sich auf ${sum.toFixed(1)} % statt 100 % ` +
        `(bullish ${bullish}, neutral ${neutral}, bearish ${bearish}) — vermutlich falsche Felder gelesen`,
    );
  }

  return {
    date,
    bullish,
    neutral,
    bearish,
    spread: Number((bullish - bearish).toFixed(1)),
  };
}

export async function fetchAaii(): Promise<SourceResult> {
  const raw = await httpGetText(URL_AAII, { label: 'AAII Sentiment Survey' });
  const reading = parseAaii(raw);

  return {
    seriesId: 'AAII_BULL_BEAR',
    series: normalizeSeries([{ date: reading.date, value: reading.spread }]),
    quality: 'ok',
    provenance: {
      kind: 'scrape',
      provider: 'AAII (aaii.com/sentimentsurvey)',
      url: URL_AAII,
      fetchedAt: new Date().toISOString(),
    },
    warning:
      'Frei zugaenglich ist nur die aktuelle Woche; die Historie waechst mit jedem Lauf',
  };
}
