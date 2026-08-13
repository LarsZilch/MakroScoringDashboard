/**
 * Yahoo Finance Chart-Endpunkt — hier fuer den MOVE-Index (^MOVE).
 *
 * Der ICE BofA MOVE ist lizenziert und hat keine offene Schnittstelle;
 * Yahoo liefert ihn als Kursreihe mit. Der Endpunkt ist inoffiziell und kann
 * jederzeit verschwinden, deshalb ist der Ausfall sauber behandelt.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetJson } from './http.js';
import type { SourceResult } from './types.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        gmtoffset?: number;
        exchangeTimezoneName?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

/**
 * Antwort in eine Tagesreihe umsetzen.
 *
 * Die Zeitstempel sind Sekunden seit Epoch zum Handelsbeginn an der Boerse.
 * Umgerechnet wird mit dem mitgelieferten gmtoffset auf das Boersendatum —
 * eine reine UTC-Umrechnung waere fuer Boersen oestlich von Greenwich falsch.
 */
export function parseYahooChart(raw: string, symbol: string): Series {
  let data: YahooChartResponse;
  try {
    data = JSON.parse(raw) as YahooChartResponse;
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
  const closes = result.indicators?.quote?.[0]?.close;
  if (!timestamps || !closes) {
    throw new Error(`Yahoo ${symbol}: Antwort enthaelt keine Kursreihe — Format geaendert?`);
  }
  if (timestamps.length !== closes.length) {
    throw new Error(
      `Yahoo ${symbol}: ${timestamps.length} Zeitstempel zu ${closes.length} Kursen — Antwort inkonsistent`,
    );
  }

  const offsetMs = (result.meta?.gmtoffset ?? 0) * 1000;
  const toExchangeDate = (epochSeconds: number) =>
    new Date(epochSeconds * 1000 + offsetMs).toISOString().slice(0, 10);

  const out = timestamps.map((ts, i) => ({
    date: toExchangeDate(ts),
    value: closes[i] ?? null,
  }));

  /*
   * Beim MOVE hat Yahoo Mitte Juli 2026 aufgehoert, Tagesbalken zu liefern:
   * die Historie ist dicht (ueber 1200 Werte seit 2021), aber die letzten
   * Wochen kommen ausschliesslich als null. Der Live-Kurs im meta-Block
   * laeuft dagegen weiter. Er wird deshalb als juengste Beobachtung
   * angehaengt — sonst fehlt dem Dashboard genau der aktuelle Wert.
   */
  const price = result.meta?.regularMarketPrice;
  const priceTime = result.meta?.regularMarketTime;
  if (typeof price === 'number' && Number.isFinite(price) && typeof priceTime === 'number') {
    out.push({ date: toExchangeDate(priceTime), value: price });
  }

  const series = normalizeSeries(out);
  if (series.length === 0) throw new Error(`Yahoo ${symbol}: keine verwertbaren Kurse`);

  // Doppelte Daten (Balken und Live-Kurs am selben Tag) auf den letzten Eintrag reduzieren.
  const byDate = new Map<string, number>();
  for (const o of series) byDate.set(o.date, o.value);
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Letzter Tag, fuer den echte Tagesbalken vorliegen (ohne den Live-Kurs). */
export function lastBarDate(raw: string): string | null {
  const data = JSON.parse(raw) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  const ts = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!ts || !closes) return null;
  const offsetMs = (result?.meta?.gmtoffset ?? 0) * 1000;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] !== null && closes[i] !== undefined) {
      return new Date(ts[i]! * 1000 + offsetMs).toISOString().slice(0, 10);
    }
  }
  return null;
}

export interface YahooOptions {
  /** Zeitraum, z. B. "1mo", "1y", "5y", "max". */
  range?: string;
}

export async function fetchYahooDaily(
  symbol: string,
  opts: YahooOptions = {},
): Promise<SourceResult> {
  const url = `${BASE}/${encodeURIComponent(symbol)}?range=${opts.range ?? '2y'}&interval=1d`;
  const raw = JSON.stringify(await httpGetJson(url, { label: `Yahoo ${symbol}` }));
  const series = parseYahooChart(raw, symbol);

  // Wie gross ist die Luecke zwischen dem letzten echten Tagesbalken und heute?
  // Beim MOVE sind das derzeit rund vier Wochen; in dieser Spanne stuetzt sich
  // die Reihe allein auf den angehaengten Live-Kurs.
  const bar = lastBarDate(raw);
  const last = series[series.length - 1]?.date;
  let warning: string | undefined;
  if (bar && last && bar < last) {
    const gapDays = Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${bar}T00:00:00Z`)) / 86_400_000,
    );
    if (gapDays > 7) {
      warning =
        `Yahoo liefert fuer ${symbol} seit ${bar} keine Tagesbalken mehr (${gapDays} Tage). ` +
        `Der aktuelle Stand stammt aus dem Live-Kurs; fuer die Wochen dazwischen fehlen echte Schlusskurse.`;
    }
  }

  return {
    seriesId: symbol.replace(/^\^/, ''),
    series,
    quality: 'ok',
    provenance: {
      kind: 'api',
      provider: 'Yahoo Finance (inoffizieller Chart-Endpunkt)',
      url,
      fetchedAt: new Date().toISOString(),
    },
    warning,
  };
}

/** ICE BofA MOVE Index. */
export function fetchMove(opts: YahooOptions = {}): Promise<SourceResult> {
  return fetchYahooDaily('^MOVE', opts);
}
