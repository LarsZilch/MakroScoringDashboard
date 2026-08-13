/**
 * Alle Quellen abrufen und in den Reihen-Cache schreiben.
 *
 * Grundsatz: ein einzelner Ausfall darf den Lauf nicht abbrechen. Faellt eine
 * Quelle aus, bleibt der zwischengespeicherte Stand stehen und der Bericht
 * sagt es. Nur so bleibt das Dashboard bei einer Bot-Sperre bei CNN oder
 * einem Layoutwechsel bei AAII benutzbar — mit sichtbar gekennzeichneter
 * Luecke statt mit einem Absturz.
 */

import { fetchAaii } from '../sources/aaii.js';
import { fetchFearGreed } from '../sources/cnn.js';
import { fetchFred, fetchIorbChained } from '../sources/fred.js';
import { fetchIsm } from '../sources/ism.js';
import { fetchMove } from '../sources/yahoo.js';
import type { SourceResult } from '../sources/types.js';
import { loadBundle, writeCachedSeries } from './series-cache.js';
import { requiredSeriesIds } from './indicators.js';
import type { Series } from '../core/derive.js';

export interface FetchReport {
  seriesId: string;
  ok: boolean;
  observations?: number;
  added?: number;
  changed?: number;
  latest?: string;
  warning?: string;
  error?: string;
}

interface Job {
  seriesId: string;
  run: () => Promise<SourceResult>;
}

export interface FetchOptions {
  /** Beobachtungsbeginn fuer die FRED-Reihen. */
  from?: string;
  /** Zeitraum fuer Yahoo, z. B. "5y". */
  yahooRange?: string;
  /** Nur diese Reihen abrufen. */
  only?: string[];
}

function buildJobs(opts: FetchOptions): Job[] {
  const fredOpts = opts.from ? { from: opts.from } : {};
  return [
    { seriesId: 'NFCI', run: () => fetchFred('NFCI', fredOpts) },
    { seriesId: 'T10Y2Y', run: () => fetchFred('T10Y2Y', fredOpts) },
    { seriesId: 'SOFR', run: () => fetchFred('SOFR', fredOpts) },
    { seriesId: 'IORB_CHAINED', run: () => fetchIorbChained(fredOpts) },
    { seriesId: 'VIXCLS', run: () => fetchFred('VIXCLS', fredOpts) },
    { seriesId: 'WALCL', run: () => fetchFred('WALCL', fredOpts) },
    { seriesId: 'WTREGEN', run: () => fetchFred('WTREGEN', fredOpts) },
    { seriesId: 'RRPONTSYD', run: () => fetchFred('RRPONTSYD', fredOpts) },
    { seriesId: 'MOVE', run: () => fetchMove({ range: opts.yahooRange ?? '5y' }) },
    { seriesId: 'CNN_FEAR_GREED', run: () => fetchFearGreed() },
    { seriesId: 'AAII_BULL_BEAR', run: () => fetchAaii() },
    { seriesId: 'ISM_MFG_PMI', run: () => fetchIsm() },
  ];
}

export async function fetchAll(
  opts: FetchOptions = {},
): Promise<{ bundle: Record<string, Series>; reports: FetchReport[] }> {
  const jobs = buildJobs(opts).filter((j) => !opts.only || opts.only.includes(j.seriesId));

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));

  const reports: FetchReport[] = settled.map((outcome, i) => {
    const job = jobs[i]!;
    if (outcome.status === 'rejected') {
      const err = outcome.reason;
      return {
        seriesId: job.seriesId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const result = outcome.value;
    const written = writeCachedSeries(job.seriesId, result.series, result.provenance);
    return {
      seriesId: job.seriesId,
      ok: true,
      observations: written.total,
      added: written.added,
      changed: written.changed,
      latest: result.series[result.series.length - 1]?.date,
      warning: result.warning,
    };
  });

  // Der Bundle kommt aus dem Cache, nicht aus den Abrufen: so stehen auch die
  // Reihen zur Verfuegung, deren Quelle gerade ausgefallen ist.
  return { bundle: loadBundle(requiredSeriesIds()), reports };
}
