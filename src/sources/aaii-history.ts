/**
 * Vollstaendige AAII-Historie aus der offiziellen Arbeitsmappe.
 *
 *   https://www.aaii.com/files/surveys/sentiment.xlsx
 *
 * Diese Datei ist der wichtige Unterschied zur Fear-&-Greed-Historie
 * (src/sources/cnn-historical.ts): dort steht eine Community-Rekonstruktion,
 * hier AAII SELBST. Die Mappe liegt frei auf dem Webserver, ohne Login, und
 * traegt die Umfrage von der ersten Woche 1987 an. Nur die HTML-Seite mit der
 * Wochentabelle ist beschraenkt, nicht dieser Download.
 *
 * Zwei Einschraenkungen, die den Umgang praegen:
 *
 * 1. Die Mappe hinkt der Website nach — sie wird nicht jede Woche fortgeschrieben.
 *    Die Luecke zwischen ihrem Ende und heute schliesst der regulaere Abruf
 *    (src/sources/aaii.ts), der die letzten Wochen von der Ergebnisseite liest.
 * 2. Deshalb ist das hier ein EINMALIGER Import (src/cli/import-aaii-history.ts)
 *    und nicht Teil von `npm run update`: 440 kB Arbeitsmappe fuer einen
 *    Zeitraum, der sich nicht mehr aendert, waere jede Woche vergeudet.
 *
 * Geschrieben wird in dieselbe Reihe AAII_BULL_BEAR wie der Wochenabruf — es
 * ist dieselbe Groesse aus derselben Hand, nur weiter zurueck. Folge: das Feld
 * `provenance` im Cache nennt immer den zuletzt schreibenden Weg. Nach dem
 * naechsten `npm run update` steht dort also die Ergebnisseite, was fuer die
 * jungen, score-tragenden Wochen auch die richtige Angabe ist.
 *
 * Gelesen wird die Mappe mit Bordmitteln (node:zlib), ohne Fremdbibliothek:
 * eine xlsx ist ein ZIP mit XML darin, und gebraucht werden genau zwei
 * Eintraege.
 */

import { inflateRawSync } from 'node:zlib';
import { normalizeSeries, type Series } from '../core/derive.js';
import { isoDate, isoWeekOf, isoWeekStart } from '../core/isoweek.js';
import { httpGetBuffer } from './http.js';
import type { SourceResult } from './types.js';

const URL_XLSX = 'https://www.aaii.com/files/surveys/sentiment.xlsx';

/**
 * Die Umfrage laeuft seit Juli 1987 woechentlich. Kaeme die Mappe mit deutlich
 * weniger Zeilen zurueck, waere sie leergeraeumt oder umgebaut — dann ist ein
 * Abbruch richtiger, als eine Rumpfreihe ueber den Bestand zu legen.
 */
export const MIN_OBSERVATIONS = 1500;

/** Ab diesem Anteil unplausibler Zeilen ist nicht die Zeile schuld, sondern das Blatt. */
const MAX_IMPLAUSIBLE_SHARE = 0.01;

// ---------------------------------------------------------------------------
// ZIP: nur so viel, wie zum Herausloesen zweier Eintraege noetig ist
// ---------------------------------------------------------------------------

/**
 * Einen Eintrag aus dem ZIP-Container holen.
 *
 * Gelesen wird ueber das zentrale Verzeichnis am Dateiende, nicht ueber die
 * lokalen Kopfsaetze. Grund: bei stroemend geschriebenen Eintraegen steht die
 * Groesse im lokalen Kopf auf 0 und erst hinterher im Data Descriptor — in
 * genau dieser Mappe kommt das vor. Im zentralen Verzeichnis stimmt sie immer.
 */
function readZipEntry(zip: Buffer, name: string): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('AAII-Arbeitsmappe: kein ZIP-Container (Endverzeichnis fehlt)');

  const entries = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('AAII-Arbeitsmappe: Zentralverzeichnis beschaedigt');
    }
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const entryName = zip.toString('utf8', pos + 46, pos + 46 + nameLen);

    if (entryName === name) {
      // Der lokale Kopf wiederholt Name und Extra-Feld mit teils ANDEREN
      // Laengen als das Verzeichnis — der Datenanfang muss von dort kommen.
      const localNameLen = zip.readUInt16LE(localOffset + 26);
      const localExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = zip.subarray(start, start + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(`AAII-Arbeitsmappe: unbekanntes Kompressionsverfahren ${method}`);
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`AAII-Arbeitsmappe: Eintrag "${name}" fehlt — Dateiformat geaendert?`);
}

// ---------------------------------------------------------------------------
// XLSX: Zellen als Text oder Zahl
// ---------------------------------------------------------------------------

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Die Zeichenketten-Tabelle. Zellen mit t="s" verweisen per Index hierher. */
function readSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    // Rich Text zerfaellt in mehrere <t>-Stuecke; sie gehoeren wieder zusammen.
    decodeXml([...si!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]!).join('')),
  );
}

interface Cell {
  /** Roher Zellinhalt: bei Zahlen der Wert, bei t="s" der Index in die Tabelle. */
  raw: string;
  type: string;
}

type Row = Record<string, Cell>;

function readRows(sheetXml: string): Row[] {
  const rows: Row[] = [];

  for (const [, body] of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Row = {};
    // Leere Zellen kommen als <c r="A9" s="5"/> und tragen kein <v>.
    for (const [, attrs, inner] of body!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs!);
      if (!ref || inner === undefined) continue;
      // <f> steht vor <v>, wenn die Zelle eine Formel traegt — beides zulassen.
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!value) continue;
      row[ref[1]!] = { raw: value[1]!, type: /\bt="([^"]+)"/.exec(attrs!)?.[1] ?? 'n' };
    }
    rows.push(row);
  }

  return rows;
}

function cellText(row: Row, col: string, strings: string[]): string | null {
  const cell = row[col];
  if (!cell) return null;
  if (cell.type !== 's') return cell.raw.trim();
  return strings[Number(cell.raw)]?.trim() ?? null;
}

function cellNumber(row: Row, col: string): number | null {
  const cell = row[col];
  if (!cell || cell.type === 's') return null;
  const n = Number(cell.raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excel-Datumszahl in ein ISO-Datum.
 *
 * Bezugspunkt ist der 30.12.1899, nicht der 01.01.1900: Excel fuehrt 1900
 * faelschlich als Schaltjahr, und der um einen Tag zurueckgesetzte Nullpunkt
 * gleicht das fuer alle Daten ab Maerz 1900 aus. Die Umfrage beginnt 1987 —
 * die Reihe liegt vollstaendig im korrekten Bereich.
 */
export function excelSerialToIso(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Beide AAII-Wege auf denselben Wochentag bringen.
 *
 * Die Arbeitsmappe datiert eine Umfrage auf den Tag der Veroeffentlichung
 * (ueberwiegend Donnerstag, in den Anfangsjahren Freitag), die Website auf den
 * Mittwoch, an dem die Umfrage schliesst. Nachgemessen an der einen Woche, in
 * der sich beide ueberschneiden: Mappe 2026-03-19, Seite "Mar 18" — identische
 * Anteile, ein Tag Unterschied.
 *
 * Ohne Angleichung stuenden fuer dieselbe Umfrage zwei Punkte im Cache, und der
 * 4-Wochen-Schnitt zoege an der Nahtstelle drei statt vier echte Umfragen
 * heran. Die ISO-Woche aendert sich durch die Verschiebung nicht: Mittwoch,
 * Donnerstag und Freitag liegen in derselben Kalenderwoche.
 */
export function toSurveyWednesday(date: string): string {
  return isoDate(new Date(isoWeekStart(isoWeekOf(date)).getTime() + 2 * 86_400_000));
}

// ---------------------------------------------------------------------------

export interface WorkbookParseResult {
  series: Series;
  /** Zeilen, deren Anteile sich nicht auf 100 % summieren — uebergangen, aber gezaehlt. */
  implausible: number;
  /** Zeilen, die nach der Angleichung auf dieselbe Woche fielen. */
  collapsed: number;
}

/**
 * Die Arbeitsmappe in eine Bull-Bear-Reihe umsetzen.
 *
 * Die Kopfzeile wird ausdruecklich geprueft, und das ist kein Zierrat: die
 * 100-%-Probe allein faengt einen Spaltentausch NICHT. Waeren Bullish und
 * Bearish vertauscht, summierten sich die drei Anteile weiterhin sauber auf
 * 100, und der Spread kaeme mit falschem Vorzeichen heraus — ein kontrarischer
 * Indikator mit gedrehtem Vorzeichen ist schlimmer als gar keiner.
 */
export function parseAaiiWorkbook(zip: Buffer): WorkbookParseResult {
  const strings = readSharedStrings(readZipEntry(zip, 'xl/sharedStrings.xml').toString('utf8'));
  const rows = readRows(readZipEntry(zip, 'xl/worksheets/sheet1.xml').toString('utf8'));

  const headerIndex = rows.findIndex(
    (row) =>
      cellText(row, 'A', strings) === 'Date' &&
      cellText(row, 'B', strings) === 'Bullish' &&
      cellText(row, 'C', strings) === 'Neutral' &&
      cellText(row, 'D', strings) === 'Bearish',
  );
  if (headerIndex < 0) {
    throw new Error(
      'AAII-Arbeitsmappe: Kopfzeile "Date | Bullish | Neutral | Bearish" nicht gefunden — ' +
        'die Spalten haben sich geaendert',
    );
  }

  // normalizeSeries entdoppelt nicht — nach der Angleichung auf den Mittwoch
  // koennen zwei Zeilen auf derselben Woche landen, also entdoppelt die Map.
  const byDate = new Map<string, number>();
  let implausible = 0;
  let collapsed = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const serial = cellNumber(row, 'A');
    const bullish = cellNumber(row, 'B');
    const neutral = cellNumber(row, 'C');
    const bearish = cellNumber(row, 'D');
    // Vor der ersten Umfrage stehen Zeilen mit Datum, aber ohne Werte; danach
    // folgen leere, nur formatierte Zeilen. Beide fallen hier heraus.
    if (serial === null || bullish === null || neutral === null || bearish === null) continue;

    // Die Anteile stehen als Bruch in der Mappe (0.347 statt 34.7).
    const bull = bullish * 100;
    const neut = neutral * 100;
    const bear = bearish * 100;
    if (Math.abs(bull + neut + bear - 100) > 1.5) {
      implausible++;
      continue;
    }

    const date = toSurveyWednesday(excelSerialToIso(serial));
    if (byDate.has(date)) collapsed++;
    byDate.set(date, Number((bull - bear).toFixed(1)));
  }

  if (byDate.size < MIN_OBSERVATIONS) {
    throw new Error(
      `AAII-Arbeitsmappe: nur ${byDate.size} verwertbare Wochen gefunden (erwartet mindestens ` +
        `${MIN_OBSERVATIONS}) — die Datei ist unvollstaendig oder umgebaut`,
    );
  }
  if (implausible > (byDate.size + implausible) * MAX_IMPLAUSIBLE_SHARE) {
    throw new Error(
      `AAII-Arbeitsmappe: ${implausible} Zeilen summieren sich nicht auf 100 % — ` +
        'das ist kein Ausreisser mehr, sondern ein verrutschtes Blatt',
    );
  }

  const series = normalizeSeries([...byDate].map(([date, value]) => ({ date, value })));
  return { series, implausible, collapsed };
}

export async function fetchAaiiHistory(): Promise<SourceResult> {
  const zip = await httpGetBuffer(URL_XLSX, { label: 'AAII Sentiment Survey (Historie)' });
  const { series, implausible, collapsed } = parseAaiiWorkbook(zip);

  const first = series[0]!.date;
  const last = series[series.length - 1]!.date;

  return {
    seriesId: 'AAII_BULL_BEAR',
    series,
    quality: 'ok',
    provenance: {
      kind: 'csv',
      provider: 'AAII, offizielle Arbeitsmappe der Sentiment Survey (aaii.com/files/surveys)',
      url: URL_XLSX,
      fetchedAt: new Date().toISOString(),
    },
    warning:
      `${series.length} Wochen von ${first} bis ${last}, auf den Umfrageschluss (Mittwoch) ` +
      'datiert wie der Wochenabruf. Die Mappe endet vor der laufenden Woche — den Rest traegt ' +
      'der regulaere Abruf nach.' +
      (implausible > 0 ? ` ${implausible} unplausible Zeilen wurden uebergangen.` : '') +
      (collapsed > 0 ? ` ${collapsed} Zeilen fielen auf eine bereits belegte Woche.` : ''),
  };
}
