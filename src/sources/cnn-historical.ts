/**
 * Historische CNN-Fear-&-Greed-Daten aus einer Community-Rekonstruktion.
 *
 * CNN selbst verkauft keine Historie seines Fear-&-Greed-Index, und kein
 * institutioneller Datenanbieter fuehrt die Reihe (Recherche vom 14.08.2026,
 * siehe Plan). Der eigene Live-Endpunkt (src/sources/cnn.ts) reicht nur rund
 * ein Jahr zurueck.
 *
 * Diese Datei laedt stattdessen eine MIT-lizenzierte Nachbildung:
 *   https://github.com/whit3rabbit/fear-greed-data
 * Taeglich, 2011-01-03 bis heute, werktaeglich aktualisiert. Der Autor selbst
 * weist darauf hin, dass Werte vor dem 01.02.2021 aus Archiven rekonstruiert
 * und WENIGER GENAU sind als danach ("precise" ab 2021-02-01). Diese Grenze
 * wird hier als Konstante gefuehrt und muss in jeder Anzeige sichtbar bleiben
 * — sie zu verschweigen waere schlimmer, als die Reihe gar nicht zu nutzen.
 *
 * Bewusst ein einmaliger Import (siehe src/cli/import-feargreed-history.ts),
 * nicht Teil des woechentlichen Abrufs: die CSV ist ein vergangener,
 * unveraenderlicher Zeitraum, und der reguläre Betrieb soll nicht an der
 * Erreichbarkeit eines fremden GitHub-Repos haengen.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetText } from './http.js';
import type { SourceResult } from './types.js';

const URL_CSV = 'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv';

/** Ab hier bezeichnet der Autor der Quelle die Werte selbst als "precise". */
export const ACCURATE_FROM = '2021-02-01';

export const HISTORICAL_SERIES_ID = 'CNN_FEAR_GREED_HISTORICAL';

/**
 * CSV mit Kopf "Date,Fear Greed,Rating" parsen.
 *
 * Nur die ersten beiden Spalten werden gebraucht; die Rating-Spalte
 * (z. B. "greed") ist eine Ableitung des Zahlenwerts und wird hier verworfen
 * — die App bildet ihre eigene Einstufung aus dem Rohwert
 * (src/pipeline/indicators.ts, fear_greed.compute).
 */
export function parseFearGreedHistoryCsv(raw: string): Series {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error('CNN-Fear-&-Greed-Historie: CSV enthaelt keine Beobachtungen');
  }

  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  if (header[0] !== 'date' || header[1] !== 'fear greed') {
    throw new Error(
      `CNN-Fear-&-Greed-Historie: unerwarteter CSV-Kopf "${lines[0]}" — das Format hat sich geaendert`,
    );
  }

  const out: { date: string; value: number | null }[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [date, rawValue] = line.split(',');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) continue;
    const num = Number(rawValue?.trim());
    if (!Number.isFinite(num)) continue;
    // Der Index ist per Definition auf 0..100 begrenzt; alles ausserhalb
    // waere ein Parsing- oder Formatfehler, kein echter Indexstand.
    if (num < 0 || num > 100) continue;
    out.push({ date: date.trim(), value: num });
  }

  if (out.length === 0) {
    throw new Error('CNN-Fear-&-Greed-Historie: keine verwertbaren Zeilen in der CSV');
  }
  return normalizeSeries(out);
}

export async function fetchFearGreedHistorical(): Promise<SourceResult> {
  const raw = await httpGetText(URL_CSV, { label: 'CNN Fear & Greed (Historie, Community)' });
  const series = parseFearGreedHistoryCsv(raw);

  const before = series.filter((o) => o.date < ACCURATE_FROM).length;
  const after = series.length - before;

  return {
    seriesId: HISTORICAL_SERIES_ID,
    series,
    quality: 'ok', // der Abruf selbst ist erfolgreich; die Vertrauensfrage sitzt in provenance/warning und wird pro Woche in indicators.ts als "proxy" gefuehrt
    provenance: {
      kind: 'csv',
      provider:
        'Community-Rekonstruktion des CNN Fear & Greed Index (github.com/whit3rabbit/fear-greed-data, MIT-Lizenz) — nicht CNN selbst',
      url: URL_CSV,
      fetchedAt: new Date().toISOString(),
    },
    warning:
      `${before} Beobachtungen vor dem ${ACCURATE_FROM} sind laut Autor der Quelle aus Archiven ` +
      `rekonstruiert und weniger genau; ${after} Beobachtungen danach bezeichnet er selbst als praezise. ` +
      'Keine dieser Zahlen stammt von CNN selbst.',
  };
}
