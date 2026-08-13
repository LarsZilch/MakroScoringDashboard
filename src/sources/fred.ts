/**
 * FRED (Federal Reserve Bank of St. Louis).
 *
 * Genutzt wird der CSV-Graphdienst, der OHNE API-Schluessel auskommt:
 *   https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>
 * Das erspart Einrichtung und Geheimnisverwaltung. Die offizielle JSON-API
 * mit Schluessel liesse sich spaeter dahinter haengen, ohne dass die Aufrufer
 * etwas merken.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetText } from './http.js';
import type { SourceResult } from './types.js';

const BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

/** Reihen, die dieses Projekt von FRED bezieht. */
export const FRED_SERIES = {
  NFCI: 'Chicago Fed National Financial Conditions Index',
  T10Y2Y: '10-Year minus 2-Year Treasury Constant Maturity',
  SOFR: 'Secured Overnight Financing Rate',
  IORB: 'Interest Rate on Reserve Balances',
  IOER: 'Interest Rate on Excess Reserves (Vorgaenger von IORB, endet 2021-07-28)',
  VIXCLS: 'CBOE Volatility Index',
  WALCL: 'Fed-Bilanzsumme (Mio. USD)',
  WTREGEN: 'Treasury General Account (Mio. USD)',
  RRPONTSYD: 'Overnight Reverse Repo (Mrd. USD)',
} as const;

export type FredSeriesId = keyof typeof FRED_SERIES;

/**
 * FRED-CSV parsen.
 *
 * Format:
 *   observation_date,NFCI
 *   2026-06-05,-0.507
 *
 * Fehlende Beobachtungen stehen als "." — FRED benutzt diesen Punkt fuer
 * Feiertage und Datenluecken. Sie werden verworfen, nicht auf 0 gesetzt.
 */
export function parseFredCsv(raw: string, seriesId: string): Series {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error(`FRED ${seriesId}: CSV enthaelt keine Beobachtungen`);
  }

  const header = lines[0]!.split(',').map((h) => h.trim());
  if (header[0]?.toLowerCase() !== 'observation_date') {
    throw new Error(
      `FRED ${seriesId}: unerwarteter CSV-Kopf "${lines[0]}" — das Format hat sich geaendert`,
    );
  }

  const out: { date: string; value: number | null }[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [date, rawValue] = line.split(',');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) continue;
    const v = rawValue?.trim();
    if (!v || v === '.') continue; // FRED-Marker fuer "keine Beobachtung"
    const num = Number(v);
    out.push({ date: date.trim(), value: Number.isFinite(num) ? num : null });
  }

  if (out.length === 0) {
    throw new Error(`FRED ${seriesId}: alle ${lines.length - 1} Zeilen unbrauchbar`);
  }
  return normalizeSeries(out);
}

export interface FredOptions {
  /** Beobachtungsbeginn (YYYY-MM-DD). */
  from?: string;
  /** Beobachtungsende (YYYY-MM-DD). */
  to?: string;
}

export async function fetchFred(id: FredSeriesId, opts: FredOptions = {}): Promise<SourceResult> {
  const url = new URL(BASE);
  url.searchParams.set('id', id);
  if (opts.from) url.searchParams.set('cosd', opts.from);
  if (opts.to) url.searchParams.set('coed', opts.to);

  const raw = await httpGetText(url.toString(), { label: `FRED ${id}` });
  const series = parseFredCsv(raw, id);

  return {
    seriesId: id,
    series,
    quality: 'ok',
    provenance: {
      kind: 'csv',
      provider: 'FRED (Federal Reserve Bank of St. Louis)',
      url: url.toString(),
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * IORB mit seinem Vorgaenger IOER zu einer durchgehenden Reihe verketten.
 *
 * IORB beginnt am 2021-07-29, IOER endet am 2021-07-28 — die beiden Reihen
 * schliessen bruchlos aneinander an und messen dasselbe: den Zins, den die
 * Fed auf Reserveguthaben zahlt. Ohne die Verkettung waere der SOFR-IORB-
 * Spread vor Mitte 2021 nicht berechenbar und der Backfill endete dort.
 */
export async function fetchIorbChained(opts: FredOptions = {}): Promise<SourceResult> {
  const [iorb, ioer] = await Promise.all([
    fetchFred('IORB', opts),
    fetchFred('IOER', opts).catch(() => null),
  ]);

  if (!ioer || ioer.series.length === 0) {
    return {
      ...iorb,
      seriesId: 'IORB_CHAINED',
      warning: 'IOER nicht verfuegbar — Reihe beginnt erst mit IORB (2021-07-29)',
    };
  }

  const iorbStart = iorb.series[0]?.date ?? '9999-12-31';
  const merged = normalizeSeries([
    ...ioer.series.filter((o) => o.date < iorbStart),
    ...iorb.series,
  ]);

  return {
    seriesId: 'IORB_CHAINED',
    series: merged,
    quality: 'ok',
    provenance: {
      kind: 'derived',
      provider: 'FRED (Federal Reserve Bank of St. Louis)',
      inputs: ['IORB', 'IOER'],
      url: iorb.provenance.url,
      fetchedAt: new Date().toISOString(),
    },
  };
}
