/**
 * AAII: die lange Historie aus der Arbeitsmappe und der junge Rand aus der
 * Wochentabelle.
 *
 * Vier Dinge muessen stimmen, sonst ist der Import schlimmer als gar keiner:
 *
 * 1. Die Excel-Datumszahl wird richtig umgerechnet.
 * 2. Beide Quellen datieren dieselbe Umfrage auf denselben Tag — sonst stehen
 *    fuer eine Woche zwei Punkte im Cache.
 * 3. Ein Spaltentausch faellt auf. Die 100-%-Probe reicht dafuer NICHT: jede
 *    Vertauschung von Bullish/Neutral/Bearish summiert sich weiterhin auf 100,
 *    liefert aber ein gedrehtes Vorzeichen — bei einem kontrarischen Indikator
 *    der denkbar schlimmste stille Fehler.
 * 4. Das fehlende Jahr in der Wochentabelle wird korrekt ergaenzt, auch ueber
 *    den Jahreswechsel.
 */

import { deflateRawSync, crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MIN_OBSERVATIONS,
  excelSerialToIso,
  parseAaiiWorkbook,
  toSurveyWednesday,
} from '../src/sources/aaii-history.js';
import { parseAaii, parseAaiiResults } from '../src/sources/aaii.js';

// ---------------------------------------------------------------------------
// Eine Arbeitsmappe bauen
//
// Bewusst erzeugt statt eingecheckt: die echte Datei waegt 440 kB, und der
// Mindestumfang von 1500 Wochen liesse sich ohnehin nicht beschneiden. Der
// Aufbau bildet die echte Mappe nach — Kopfzeilen ueber die Zeichenketten-
// Tabelle, Anteile als Bruch, Formelzellen mit <f> vor <v>, leere Zellen
// selbstschliessend.
// ---------------------------------------------------------------------------

function zip(entries: { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const data = Buffer.from(content, 'utf8');
    const deflated = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // benoetigte Version
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const dir = Buffer.alloc(46 + nameBuf.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    nameBuf.copy(dir, 46);

    locals.push(local, deflated);
    central.push(dir);
    offset += local.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

const SHARED = ['Date', 'Bullish', 'Neutral', 'Bearish'];

/** 1987-07-23 (Donnerstag) als Excel-Datumszahl — der echte Reihenanfang. */
const FIRST_SERIAL = 31981;

interface Week {
  serial: number;
  bullish: number;
  neutral: number;
  bearish: number;
}

function defaultWeeks(count: number): Week[] {
  return Array.from({ length: count }, (_, i) => ({
    serial: FIRST_SERIAL + i * 7,
    bullish: 0.4,
    neutral: 0.25,
    bearish: 0.35,
  }));
}

function workbook(weeks: Week[], header = SHARED): Buffer {
  const sharedStrings =
    `<sst count="${header.length}">` +
    header.map((s) => `<si><t>${s}</t></si>`).join('') +
    '</sst>';

  const headerRow =
    '<row r="4">' +
    header.map((_, i) => `<c r="${'ABCD'[i]}4" t="s"><v>${i}</v></c>`).join('') +
    '</row>';

  const dataRows = weeks
    .map(
      (w, i) =>
        `<row r="${5 + i}">` +
        `<c r="A${5 + i}" s="100"><v>${w.serial}</v></c>` +
        `<c r="B${5 + i}" s="126"><v>${w.bullish}</v></c>` +
        `<c r="C${5 + i}" s="126"><v>${w.neutral}</v></c>` +
        `<c r="D${5 + i}" s="126"><v>${w.bearish}</v></c>` +
        // Formelzelle: <f> steht vor <v> und darf den Parser nicht stoeren.
        `<c r="G${5 + i}" s="109"><f>B${5 + i}-D${5 + i}</f><v>${w.bullish - w.bearish}</v></c>` +
        '</row>',
    )
    .join('');

  const sheet =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="D1" t="s"><v>0</v></c></row>' +
    '<row r="2"/>' +
    headerRow +
    dataRows +
    // Nachlaufende, nur formatierte Leerzeilen wie in der echten Mappe.
    '<row r="9000"><c r="A9000" s="5"/><c r="B9000" s="35"/></row>' +
    '</sheetData></worksheet>';

  return zip([
    { name: 'xl/sharedStrings.xml', content: sharedStrings },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ]);
}

// ---------------------------------------------------------------------------

describe('excelSerialToIso', () => {
  it('rechnet mit dem um einen Tag zurueckgesetzten Nullpunkt', () => {
    // 25569 ist per Definition der 01.01.1970 — der Pruefstein fuer den
    // Schaltjahrfehler von 1900.
    expect(excelSerialToIso(25569)).toBe('1970-01-01');
    expect(excelSerialToIso(31981)).toBe('1987-07-23');
    expect(excelSerialToIso(46100)).toBe('2026-03-19');
  });
});

describe('toSurveyWednesday', () => {
  it('zieht Donnerstag und Freitag auf den Mittwoch derselben Woche', () => {
    expect(toSurveyWednesday('2026-03-19')).toBe('2026-03-18'); // Do
    expect(toSurveyWednesday('1987-07-24')).toBe('1987-07-22'); // Fr
  });

  it('laesst den Mittwoch stehen', () => {
    expect(toSurveyWednesday('2026-08-12')).toBe('2026-08-12');
  });

  it('bleibt am Jahreswechsel in der richtigen ISO-Woche', () => {
    // Donnerstag, 01.01.2026 — der Mittwoch derselben ISO-Woche liegt noch 2025.
    expect(toSurveyWednesday('2026-01-01')).toBe('2025-12-31');
  });
});

describe('parseAaiiWorkbook', () => {
  it('liest Datum und Bull-Bear-Spread, Anteile als Bruch', () => {
    const { series, implausible, collapsed } = parseAaiiWorkbook(
      workbook(defaultWeeks(MIN_OBSERVATIONS)),
    );

    expect(series).toHaveLength(MIN_OBSERVATIONS);
    expect(implausible).toBe(0);
    expect(collapsed).toBe(0);
    // 40 % bullish minus 35 % bearish, auf den Mittwoch datiert.
    expect(series[0]).toEqual({ date: '1987-07-22', value: 5 });
  });

  it('erkennt eine vertauschte Spaltenreihenfolge an der Kopfzeile', () => {
    // Der gefaehrliche Fall: vertauscht summiert sich alles weiter auf 100 %,
    // nur das Vorzeichen des Spreads dreht sich.
    expect(() => parseAaiiWorkbook(workbook(defaultWeeks(MIN_OBSERVATIONS), ['Date', 'Bearish', 'Neutral', 'Bullish'])))
      .toThrow(/Kopfzeile/);
  });

  it('bricht ab, wenn die Mappe zu wenige Wochen traegt', () => {
    expect(() => parseAaiiWorkbook(workbook(defaultWeeks(20)))).toThrow(/mindestens/);
  });

  it('uebergeht einzelne unplausible Zeilen, bricht aber bei vielen ab', () => {
    const weeks = defaultWeeks(MIN_OBSERVATIONS + 1);
    weeks[10] = { ...weeks[10]!, bullish: 0.9 }; // summiert auf 150 %
    const { series, implausible } = parseAaiiWorkbook(workbook(weeks));
    expect(implausible).toBe(1);
    expect(series).toHaveLength(MIN_OBSERVATIONS);

    const broken = defaultWeeks(MIN_OBSERVATIONS + 100).map((w) => ({ ...w, bullish: 0.9 }));
    expect(() => parseAaiiWorkbook(workbook(broken))).toThrow(/mindestens|100 %/);
  });

  it('meldet einen fehlenden Eintrag statt still leer zu bleiben', () => {
    const incomplete = zip([{ name: 'xl/sharedStrings.xml', content: '<sst/>' }]);
    expect(() => parseAaiiWorkbook(incomplete)).toThrow(/sheet1\.xml/);
  });
});

// ---------------------------------------------------------------------------

const pastResults = readFileSync(
  join(import.meta.dirname, 'fixtures', 'aaii-past-results.html'),
  'utf8',
);

describe('parseAaiiResults', () => {
  const rows = parseAaiiResults(pastResults, new Date('2026-08-15T00:00:00Z'));

  it('liest alle Zeilen der Ergebnistabelle', () => {
    expect(rows).toHaveLength(22);
  });

  it('setzt das fehlende Jahr aus dem Stichtag', () => {
    expect(rows[0]).toEqual({
      date: '2026-08-12',
      bullish: 34.7,
      neutral: 27.4,
      bearish: 37.9,
      spread: -3.2,
    });
    expect(rows.at(-1)!.date).toBe('2026-03-18');
  });

  it('deckt sich an der Nahtstelle mit der Arbeitsmappe', () => {
    // Dieselbe Umfrage, beide Quellen: die Mappe datiert sie auf Donnerstag,
    // die Seite auf Mittwoch. Nach der Angleichung muss BEIDES zusammenfallen.
    expect(toSurveyWednesday(excelSerialToIso(46100))).toBe('2026-03-18');
    expect(rows.at(-1)).toMatchObject({ date: '2026-03-18', spread: -21.6 });
  });

  it('zaehlt beim Monatssprung nach oben ein Jahr zurueck', () => {
    const cell = (v: string) => `<td align="right" class="tableTxt">${v}</td>`;
    const row = (d: string) =>
      `<tr>${cell(d)}${cell('40.0%')}${cell('25.0%')}${cell('35.0%')}</tr>`;
    const table = [row('Jan 7'), row('Dec 31'), row('Dec 24')].join('\n');

    const parsed = parseAaiiResults(table, new Date('2027-01-09T00:00:00Z'));
    expect(parsed.map((r) => r.date)).toEqual(['2027-01-07', '2026-12-31', '2026-12-24']);
  });

  it('uebergeht eine Zeile, deren Anteile sich nicht auf 100 % summieren', () => {
    const cell = (v: string) => `<td align="right" class="tableTxt">${v}</td>`;
    const table =
      `<tr>${cell('Aug 12')}${cell('34.7%')}${cell('27.4%')}${cell('37.9%')}</tr>` +
      `<tr>${cell('Aug 5')}${cell('90.0%')}${cell('25.0%')}${cell('35.0%')}</tr>`;

    const parsed = parseAaiiResults(table, new Date('2026-08-15T00:00:00Z'));
    expect(parsed.map((r) => r.date)).toEqual(['2026-08-12']);
  });
});

describe('Monatsnamen', () => {
  it('versteht die Abkuerzung der Tabelle und den ausgeschriebenen Namen des Anzeigeblocks', () => {
    // "May" ist der einzige Monat, dessen Abkuerzung dem vollen Namen gleicht —
    // ein Parser, der nur volle Namen kennt, laesst genau diese eine Zeile
    // durch und wirkt dadurch laenger heil, als er ist.
    const cell = (v: string) => `<td align="right" class="tableTxt">${v}</td>`;
    const table = ['Aug 12', 'Jul 8', 'Jun 3', 'May 27', 'Mar 18']
      .map((d) => `<tr>${cell(d)}${cell('40.0%')}${cell('25.0%')}${cell('35.0%')}</tr>`)
      .join('');

    expect(parseAaiiResults(table, new Date('2026-08-15T00:00:00Z')).map((r) => r.date)).toEqual([
      '2026-08-12',
      '2026-07-08',
      '2026-06-03',
      '2026-05-27',
      '2026-03-18',
    ]);
  });

  it('liest den Anzeigeblock unveraendert weiter', () => {
    const gauge = readFileSync(
      join(import.meta.dirname, 'fixtures', 'aaii-sentiment.html'),
      'utf8',
    );
    expect(parseAaii(gauge).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
