/**
 * CNN Fear & Greed Index.
 *
 * Der Endpunkt ist der, den die CNN-Grafik selbst benutzt. Er ist inoffiziell
 * und antwortet auf einen nackten Request mit HTTP 418 ("I'm a teapot") —
 * eine Bot-Sperre. Erst mit Referer und Origin aus der CNN-Domain liefert er
 * Daten. Diese Header sind hier also kein Beiwerk, sondern Voraussetzung.
 *
 * Die Antwort enthaelt rund ein Jahr Tageshistorie. Weiter zurueck reicht sie
 * nicht — fuer aeltere Wochen bleibt der Indikator leer.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetJson } from './http.js';
import type { SourceResult } from './types.js';

const URL_FNG = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

const REQUIRED_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://edition.cnn.com/',
  Origin: 'https://edition.cnn.com',
};

interface FngResponse {
  fear_and_greed?: { score?: number; rating?: string; timestamp?: string };
  fear_and_greed_historical?: { data?: { x?: number; y?: number; rating?: string }[] };
}

export function parseFearGreed(raw: string): { series: Series; currentRating: string | null } {
  let data: FngResponse;
  try {
    data = JSON.parse(raw) as FngResponse;
  } catch {
    throw new Error('CNN Fear & Greed: Antwort ist kein JSON (vermutlich Bot-Sperre)');
  }

  const points = data.fear_and_greed_historical?.data;
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('CNN Fear & Greed: keine Historie in der Antwort — Format geaendert?');
  }

  // x ist Millisekunden seit Epoch, y der Indexstand 0..100.
  const out = points.map((p) => ({
    date: typeof p.x === 'number' ? new Date(p.x).toISOString().slice(0, 10) : '',
    value: typeof p.y === 'number' ? p.y : null,
  }));

  const series = normalizeSeries(out.filter((o) => o.date !== ''));
  if (series.length === 0) throw new Error('CNN Fear & Greed: keine verwertbaren Punkte');

  return { series, currentRating: data.fear_and_greed?.rating ?? null };
}

export async function fetchFearGreed(): Promise<SourceResult> {
  const raw = JSON.stringify(
    await httpGetJson(URL_FNG, { label: 'CNN Fear & Greed', headers: REQUIRED_HEADERS }),
  );
  const { series } = parseFearGreed(raw);

  return {
    seriesId: 'CNN_FEAR_GREED',
    series,
    quality: 'ok',
    provenance: {
      kind: 'api',
      provider: 'CNN Business (inoffizieller dataviz-Endpunkt)',
      url: URL_FNG,
      fetchedAt: new Date().toISOString(),
    },
    warning:
      series.length < 300
        ? `Historie umfasst nur ${series.length} Tage — aeltere Wochen bleiben ohne Fear & Greed`
        : undefined,
  };
}
