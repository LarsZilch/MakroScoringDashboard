/**
 * ISM Manufacturing PMI.
 *
 * Der Index selbst ist lizenziert und hat keine offene Schnittstelle; FRED
 * fuehrt ihn seit dem Auslaufen der Reihe NAPM nicht mehr. Frei zugaenglich
 * ist aber die monatliche Pressemitteilung, deren Ueberschrift dem festen
 * Muster folgt:
 *
 *   "Manufacturing PMI® at 55.6%; July 2026 ISM® Manufacturing PMI® Report"
 *
 * Die Trefferliste von PRNewswire zeigt rund ein Jahr solcher Ueberschriften
 * auf zwei Seiten — daraus laesst sich die Monatsreihe rekonstruieren, ohne
 * jede einzelne Mitteilung zu oeffnen.
 *
 * Reichweite: etwa 12 Monate. Fuer aeltere Wochen bleibt der ISM leer; der
 * 3-Monats-Vergleich ist damit rund 9 Monate zurueck rechenbar.
 */

import { normalizeSeries, type Series } from '../core/derive.js';
import { httpGetText } from './http.js';
import type { SourceResult } from './types.js';

const SEARCH_URL = 'https://www.prnewswire.com/search/news/?keyword=ISM%20Manufacturing%20PMI';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * PMI-Staende aus Pressemitteilungs-Ueberschriften ziehen.
 *
 * Das Muster laesst die Nachkommastelle bewusst optional: glatte Werte werden
 * als "at 54%" veroeffentlicht, nicht als "54.0%".
 */
export function parseIsmHeadlines(raw: string): Series {
  const pattern =
    /Manufacturing\s+PMI[^<]{0,12}?\bat\s*([0-9]{1,3}(?:\.[0-9])?)\s*%?\s*;?\s*([A-Za-z]+)\s+(\d{4})/gi;

  const byMonth = new Map<string, number>();
  for (const m of raw.matchAll(pattern)) {
    const value = Number(m[1]);
    const month = MONTHS[m[2]!.toLowerCase()];
    const year = Number(m[3]);
    if (!month || !Number.isFinite(value) || !Number.isFinite(year)) continue;
    // Ein PMI ausserhalb 25..75 waere ein Jahrhundertwert — eher ein Fehlgriff
    // des Musters als eine echte Meldung.
    if (value < 25 || value > 75) continue;

    // Der ISM bezieht sich auf den Berichtsmonat; als Datum dient dessen Erster.
    const date = `${year}-${String(month).padStart(2, '0')}-01`;
    if (!byMonth.has(date)) byMonth.set(date, value);
  }

  if (byMonth.size === 0) {
    throw new Error(
      'ISM: keine PMI-Ueberschrift im erwarteten Muster gefunden — Quelle oder Titelformat geaendert',
    );
  }

  return normalizeSeries([...byMonth].map(([date, value]) => ({ date, value })));
}

export interface IsmOptions {
  /** Wie viele Seiten der Trefferliste abgefragt werden. */
  pages?: number;
}

export async function fetchIsm(opts: IsmOptions = {}): Promise<SourceResult> {
  const pages = Math.max(1, opts.pages ?? 2);
  const collected: Series = [];
  const errors: string[] = [];

  for (let page = 1; page <= pages; page++) {
    const url = page === 1 ? SEARCH_URL : `${SEARCH_URL}&page=${page}`;
    try {
      const raw = await httpGetText(url, { label: `ISM via PRNewswire (Seite ${page})` });
      collected.push(...parseIsmHeadlines(raw));
    } catch (err) {
      // Eine leere Folgeseite ist normal — nur ein Totalausfall zaehlt.
      errors.push(`Seite ${page}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (collected.length === 0) {
    throw new Error(`ISM: kein Wert abrufbar. ${errors.join('; ')}`);
  }

  // Doppelte Monate aus mehreren Seiten zusammenfuehren.
  const byDate = new Map<string, number>();
  for (const o of collected) if (!byDate.has(o.date)) byDate.set(o.date, o.value);
  const series = normalizeSeries([...byDate].map(([date, value]) => ({ date, value })));

  return {
    seriesId: 'ISM_MFG_PMI',
    series,
    quality: 'ok',
    provenance: {
      kind: 'scrape',
      provider: 'ISM via PRNewswire-Pressemitteilungen',
      url: SEARCH_URL,
      fetchedAt: new Date().toISOString(),
    },
    warning: `${series.length} Monate gefunden (${series[0]?.date} bis ${series[series.length - 1]?.date}); aeltere Werte sind frei nicht verfuegbar`,
  };
}
