/**
 * Kursreihen der Anlageklassen, fuer die Frage "wie haben sie sich in den
 * jeweiligen Regimen geschlagen".
 *
 * Zwei Festlegungen mit Folgen:
 *
 * 1. GESAMTERTRAG, nicht Kurs. Genutzt wird `adjclose`, also die um
 *    Ausschuettungen und Splits bereinigte Reihe. Bei TLT, HYG und LQD macht
 *    der Kupon den Grossteil der Rendite aus — mit reinen Kursen waeren
 *    ausgerechnet die Anleihe-Klassen systematisch schlechtgerechnet und
 *    jeder Vergleich mit Aktien schief.
 *
 * 2. Wochenintervall. Das Scoring arbeitet in ISO-Wochen; Tagesdaten muessten
 *    ohnehin verdichtet werden. Yahoo liefert Wochenkerzen direkt.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetJson } from './http.js';
import type { SourceResult } from './types.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export interface AssetDef {
  /** Kennung im Reihen-Cache, ohne den Praefix ASSET_. */
  id: string;
  /** Yahoo-Symbol. */
  symbol: string;
  label: string;
  /** Kurzform fuer Umschalter und Linienbeschriftung. */
  short: string;
  /** Gruppierung fuer die Auswahl. */
  group: 'Aktien' | 'Anleihen & Kredit' | 'Sachwerte & Waehrung';
}

/**
 * Die elf Anlageklassen. Die Reihenfolge ist stabil und bestimmt zugleich die
 * Reihenfolge in der Auswahl — sie darf nicht umsortiert werden, ohne die
 * Farbzuordnung mitzudenken.
 */
export const ASSETS: AssetDef[] = [
  { id: 'SPX', symbol: '^GSPC', label: 'S&P 500', short: 'S&P 500', group: 'Aktien' },
  { id: 'IWM', symbol: 'IWM', label: 'US Small Caps', short: 'Small Caps', group: 'Aktien' },
  { id: 'EFA', symbol: 'EFA', label: 'Aktien Welt ex-US', short: 'Welt ex-US', group: 'Aktien' },
  { id: 'EEM', symbol: 'EEM', label: 'Schwellenlaender', short: 'Schwellenl.', group: 'Aktien' },
  { id: 'TLT', symbol: 'TLT', label: 'US-Staatsanleihen 20y+', short: 'Staatsanl.', group: 'Anleihen & Kredit' },
  { id: 'LQD', symbol: 'LQD', label: 'Investment Grade Credit', short: 'IG Credit', group: 'Anleihen & Kredit' },
  { id: 'HYG', symbol: 'HYG', label: 'High Yield Credit', short: 'High Yield', group: 'Anleihen & Kredit' },
  { id: 'GLD', symbol: 'GLD', label: 'Gold', short: 'Gold', group: 'Sachwerte & Waehrung' },
  { id: 'DBC', symbol: 'DBC', label: 'Rohstoffe breit', short: 'Rohstoffe', group: 'Sachwerte & Waehrung' },
  { id: 'UUP', symbol: 'UUP', label: 'US-Dollar', short: 'US-Dollar', group: 'Sachwerte & Waehrung' },
  { id: 'BTC', symbol: 'BTC-USD', label: 'Bitcoin', short: 'Bitcoin', group: 'Sachwerte & Waehrung' },
];

export const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

/** Cache-Kennung einer Anlageklasse. */
export function assetSeriesId(id: string): string {
  return `ASSET_${id}`;
}

export function assetSeriesIds(): string[] {
  return ASSETS.map((a) => assetSeriesId(a.id));
}

interface YahooWeeklyResponse {
  chart?: {
    result?: {
      meta?: { symbol?: string; gmtoffset?: number };
      timestamp?: number[];
      indicators?: {
        quote?: { close?: (number | null)[] }[];
        adjclose?: { adjclose?: (number | null)[] }[];
      };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

export interface ParsedAssetSeries {
  series: Series;
  /** true, wenn ausschuettungsbereinigt gerechnet wurde. */
  totalReturn: boolean;
  gaps: number;
}

/**
 * Wochenreihe aus der Antwort ziehen.
 *
 * Bevorzugt wird `adjclose`. Fehlt es, faellt die Reihe auf Schlusskurse
 * zurueck — das wird gemeldet, statt still zu passieren, denn es aendert die
 * Bedeutung der Zahlen.
 */
export function parseAssetChart(raw: string, symbol: string): ParsedAssetSeries {
  let data: YahooWeeklyResponse;
  try {
    data = JSON.parse(raw) as YahooWeeklyResponse;
  } catch {
    throw new Error(`Yahoo ${symbol}: Antwort ist kein JSON`);
  }

  if (data.chart?.error) {
    throw new Error(
      `Yahoo ${symbol}: ${data.chart.error.code ?? 'Fehler'} — ${data.chart.error.description ?? ''}`,
    );
  }

  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: kein Ergebnisblock in der Antwort`);

  const timestamps = result.timestamp;
  if (!timestamps) throw new Error(`Yahoo ${symbol}: keine Zeitstempel — Format geaendert?`);

  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const close = result.indicators?.quote?.[0]?.close;
  const values = adj ?? close;
  if (!values) {
    throw new Error(`Yahoo ${symbol}: weder adjclose noch close in der Antwort`);
  }
  if (values.length !== timestamps.length) {
    throw new Error(
      `Yahoo ${symbol}: ${timestamps.length} Zeitstempel zu ${values.length} Kursen — Antwort inkonsistent`,
    );
  }

  const offsetMs = (result.meta?.gmtoffset ?? 0) * 1000;
  const points = timestamps.map((ts, i) => ({
    date: new Date(ts * 1000 + offsetMs).toISOString().slice(0, 10),
    value: values[i] ?? null,
  }));

  const series = normalizeSeries(points);
  if (series.length === 0) throw new Error(`Yahoo ${symbol}: keine verwertbaren Kurse`);

  // Kurse muessen positiv sein — eine 0 oder ein negativer Wert waere ein
  // Datenfehler, der als Rendite von -100 % durchschlagen wuerde.
  const bad = series.find((o) => o.value <= 0);
  if (bad) {
    throw new Error(`Yahoo ${symbol}: unmoeglicher Kurs ${bad.value} am ${bad.date}`);
  }

  return {
    series,
    totalReturn: Boolean(adj),
    gaps: timestamps.length - series.length,
  };
}

export interface AssetFetchOptions {
  /** Zeitraum, z. B. "10y" oder "max". */
  range?: string;
}

export async function fetchAsset(
  asset: AssetDef,
  opts: AssetFetchOptions = {},
): Promise<SourceResult> {
  const url =
    `${BASE}/${encodeURIComponent(asset.symbol)}` +
    `?range=${opts.range ?? '10y'}&interval=1wk&events=div,split`;

  const raw = JSON.stringify(await httpGetJson(url, { label: `Yahoo ${asset.symbol}` }));
  const parsed = parseAssetChart(raw, asset.symbol);

  const warnings: string[] = [];
  if (!parsed.totalReturn) {
    warnings.push(
      'ohne Ausschuettungsbereinigung gerechnet — Ertraege sind dadurch zu niedrig ausgewiesen',
    );
  }
  if (parsed.gaps > 0) {
    warnings.push(`${parsed.gaps} Wochen ohne Kurs`);
  }

  return {
    seriesId: assetSeriesId(asset.id),
    series: parsed.series,
    quality: parsed.totalReturn ? 'ok' : 'stale',
    provenance: {
      kind: 'api',
      provider: `Yahoo Finance (${asset.symbol}, ${parsed.totalReturn ? 'Gesamtertrag' : 'Kurs'})`,
      url,
      fetchedAt: new Date().toISOString(),
    },
    warning: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}
