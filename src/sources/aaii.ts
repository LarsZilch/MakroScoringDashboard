/**
 * AAII Investor Sentiment Survey.
 *
 * Zwei frei zugaengliche Seiten, die sich ergaenzen:
 *
 * 1. /sentimentsurvey — der Anzeigeblock mit der aktuellen Woche, samt Jahr.
 * 2. /sentimentsurvey/sent_results — eine Tabelle der letzten rund 22 Wochen.
 *    Sie ist serverseitig gerendert und braucht keine Mitgliedschaft; ihre
 *    Datumsangaben tragen allerdings kein Jahr ("Aug 12"), was unten
 *    abgeleitet wird.
 *
 * Die lange Historie kommt nicht von hier, sondern aus der offiziellen
 * Arbeitsmappe (src/sources/aaii-history.ts, einmaliger Import). Diese Datei
 * haelt den jungen Rand aktuell und schliesst die Luecke, die die Mappe laesst,
 * weil sie nicht jede Woche fortgeschrieben wird.
 *
 * Beide Wege datieren eine Umfrage auf den MITTWOCH ihres Schlusses — die
 * Arbeitsmappe rechnet dafuer um. Diese Uebereinstimmung ist Voraussetzung
 * dafuer, dass der Cache beide Quellen ueberlappungsfrei zusammenfuehrt.
 *
 * Das Regelwerk bewertet den 4-Wochen-Schnitt; solange weniger als vier Wochen
 * vorliegen, weist die Anzeige das aus.
 *
 * Gescrapt wird HTML. Ein Layoutwechsel bricht den Parser — genau dafuer gibt
 * es die Fixture-Tests, damit das als roter Test auffaellt und nicht als
 * stiller Falschwert im Dashboard landet.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetText } from './http.js';
import type { SourceResult } from './types.js';

const URL_AAII = 'https://www.aaii.com/sentimentsurvey';
const URL_RESULTS = 'https://www.aaii.com/sentimentsurvey/sent_results';

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

/**
 * Die beiden Seiten schreiben den Monat unterschiedlich: der Anzeigeblock
 * ausgeschrieben ("August 12, 2026"), die Wochentabelle abgekuerzt ("Aug 12").
 * Bei drei Buchstaben sind die zwoelf englischen Monatsnamen eindeutig — nur
 * "May" ist in beiden Formen gleich, was den Fehler lange verstecken kann.
 */
function monthNumber(name: string): number | undefined {
  const key = name.toLowerCase();
  if (MONTHS[key]) return MONTHS[key];
  if (key.length < 3) return undefined;
  const full = Object.keys(MONTHS).find((m) => m.startsWith(key));
  return full ? MONTHS[full] : undefined;
}

function parseUsDate(text: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (!m) return null;
  const month = monthNumber(m[1]!);
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/**
 * Die drei Anteile muessen sich zu rund 100 % addieren.
 *
 * Ohne diese Pruefung wuerde ein Parser, der versehentlich die historischen
 * Durchschnitte neben der Tabelle greift, unbemerkt falsche Werte liefern.
 * Was sie NICHT faengt, ist ein Tausch von Bullish und Bearish — dagegen
 * stehen die gepruefte Spaltenreihenfolge und die Fixture-Tests.
 */
function isPlausible(bullish: number, neutral: number, bearish: number): boolean {
  return Math.abs(bullish + neutral + bearish - 100) <= 1.5;
}

function toReading(date: string, bullish: number, neutral: number, bearish: number): AaiiReading {
  return { date, bullish, neutral, bearish, spread: Number((bullish - bearish).toFixed(1)) };
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

  if (!isPlausible(bullish, neutral, bearish)) {
    throw new Error(
      `AAII: Anteile summieren sich auf ${(bullish + neutral + bearish).toFixed(1)} % statt 100 % ` +
        `(bullish ${bullish}, neutral ${neutral}, bearish ${bearish}) — vermutlich falsche Felder gelesen`,
    );
  }

  return toReading(date, bullish, neutral, bearish);
}

/**
 * Die Tabelle der letzten Wochen von /sentimentsurvey/sent_results.
 *
 * Die Kopfzeile der Tabelle nennt "Reported Date | Bullish | Neutral |
 * Bearish", die Datenzellen tragen durchgehend class="tableTxt" — vier je
 * Zeile, in genau dieser Reihenfolge.
 *
 * Das Jahr fehlt in den Datumsangaben ("Aug 12", "Mar 18"). Abgeleitet wird es
 * vom Stichtag aus rueckwaerts: die Tabelle laeuft von neu nach alt, also ist
 * jeder Monatssprung nach OBEN ein Jahreswechsel nach hinten. Der Stichtag ist
 * ein Parameter und nicht `new Date()`, damit sich der Jahreswechsel testen
 * laesst.
 */
export function parseAaiiResults(raw: string, asOf: Date): AaiiReading[] {
  const cell = '<td[^>]*class="tableTxt"[^>]*>\\s*([^<]*?)\\s*</td>';
  const rowPattern = new RegExp(`${cell}\\s*${cell}\\s*${cell}\\s*${cell}`, 'g');

  let year = asOf.getUTCFullYear();
  let previousMonth = asOf.getUTCMonth() + 1;
  const out: AaiiReading[] = [];

  for (const [, rawDate, rawBull, rawNeutral, rawBear] of raw.matchAll(rowPattern)) {
    const dateMatch = /^([A-Za-z]+)\s+(\d{1,2})$/.exec(rawDate!);
    if (!dateMatch) continue;
    const month = monthNumber(dateMatch[1]!);
    if (!month) continue;

    if (month > previousMonth) year--;
    previousMonth = month;

    const [bullish, neutral, bearish] = [rawBull, rawNeutral, rawBear].map((v) =>
      Number(v!.replace('%', '').trim()),
    ) as [number, number, number];
    // Eine einzelne unplausible Zeile ist kein Grund, den ganzen Abruf
    // hinzuwerfen — sie faellt heraus, der Rest bleibt nutzbar.
    if (![bullish, neutral, bearish].every(Number.isFinite)) continue;
    if (!isPlausible(bullish, neutral, bearish)) continue;

    const day = String(Number(dateMatch[2])).padStart(2, '0');
    out.push(toReading(`${year}-${String(month).padStart(2, '0')}-${day}`, bullish, neutral, bearish));
  }

  return out;
}

function toSeries(readings: AaiiReading[]): Series {
  // normalizeSeries entdoppelt nicht; die aktuelle Woche steht in beiden Quellen.
  const byDate = new Map(readings.map((r) => [r.date, r.spread]));
  return normalizeSeries([...byDate].map(([date, value]) => ({ date, value })));
}

/**
 * Beide Seiten abrufen und zusammenfuehren.
 *
 * Die Tabelle ist der Hauptweg, der Anzeigeblock der Rueckfall: aendert sich
 * das Tabellenlayout, liefert der Konnektor weiterhin die aktuelle Woche statt
 * gar nichts. Umgekehrt genauso. Erst wenn beide Wege ausfallen, ist der Abruf
 * gescheitert — dann wird der Fehler der Tabelle gemeldet, weil sie mehr
 * traegt.
 */
export async function fetchAaii(): Promise<SourceResult> {
  const [table, current] = await Promise.allSettled([
    httpGetText(URL_RESULTS, { label: 'AAII Sentiment Survey (Wochentabelle)' }).then((raw) =>
      parseAaiiResults(raw, new Date()),
    ),
    httpGetText(URL_AAII, { label: 'AAII Sentiment Survey' }).then(parseAaii),
  ]);

  const rows = table.status === 'fulfilled' ? table.value : [];
  const latest = current.status === 'fulfilled' ? [current.value] : [];

  if (rows.length === 0 && latest.length === 0) {
    throw table.status === 'rejected'
      ? table.reason
      : new Error('AAII: die Wochentabelle enthielt keine lesbare Zeile — Layout geaendert?');
  }

  const usable = rows.length > 0;
  return {
    seriesId: 'AAII_BULL_BEAR',
    series: toSeries([...rows, ...latest]),
    quality: 'ok',
    provenance: {
      kind: 'scrape',
      provider: usable
        ? 'AAII (aaii.com/sentimentsurvey/sent_results)'
        : 'AAII (aaii.com/sentimentsurvey)',
      url: usable ? URL_RESULTS : URL_AAII,
      fetchedAt: new Date().toISOString(),
    },
    warning: usable
      ? `${rows.length} Wochen aus der Ergebnistabelle; die lange Historie kommt aus der ` +
        'Arbeitsmappe (npm run import:aaii)'
      : 'Die Wochentabelle war nicht lesbar — nur die aktuelle Woche konnte uebernommen werden',
  };
}
