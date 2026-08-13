/**
 * Rohdaten-Cache unter data/series/.
 *
 * Zwei Aufgaben:
 *
 * 1. Wiederholte Laeufe muessen nicht jedes Mal alle Quellen befragen.
 * 2. Vor allem aber: FORTSCHREIBEN. Die AAII-Umfrage ist frei nur als
 *    aktuelle Woche zu haben — ihre Historie entsteht ueberhaupt erst
 *    dadurch, dass jeder Lauf seinen Wert hier hinzufuegt. Wuerde der Cache
 *    ersetzt statt ergaenzt, gaebe es nie einen 4-Wochen-Schnitt.
 *
 * Der Cache ist bewusst nicht in git: er ist jederzeit neu beschaffbar. Das
 * Gedaechtnis der App sind die Snapshots, nicht diese Dateien.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSeries, type Series } from '../core/derive.js';
import type { Provenance } from '../core/types.js';
import { SERIES_DIR } from './paths.js';

export interface CachedSeries {
  seriesId: string;
  updatedAt: string;
  provenance?: Provenance;
  observations: Series;
}

function fileFor(seriesId: string): string {
  return join(SERIES_DIR, `${seriesId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

export function readCachedSeries(seriesId: string): CachedSeries | null {
  const file = fileFor(seriesId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as CachedSeries;
    if (!Array.isArray(parsed.observations)) return null;
    return { ...parsed, observations: normalizeSeries(parsed.observations) };
  } catch {
    return null; // beschaedigter Cache wird einfach neu aufgebaut
  }
}

/**
 * Neue Beobachtungen in den Bestand einfuegen.
 *
 * Bei gleichem Datum gewinnt der neue Wert — Reihen wie NFCI und ISM werden
 * nachtraeglich revidiert, und die juengere Fassung ist die gueltige.
 */
export function mergeSeries(existing: Series, incoming: Series): Series {
  const byDate = new Map<string, number>();
  for (const o of existing) byDate.set(o.date, o.value);
  for (const o of incoming) byDate.set(o.date, o.value);
  return normalizeSeries([...byDate].map(([date, value]) => ({ date, value })));
}

export interface WriteResult {
  seriesId: string;
  total: number;
  added: number;
  changed: number;
}

export function writeCachedSeries(
  seriesId: string,
  incoming: Series,
  provenance?: Provenance,
): WriteResult {
  mkdirSync(SERIES_DIR, { recursive: true });

  const previous = readCachedSeries(seriesId);
  const before = previous?.observations ?? [];
  const merged = mergeSeries(before, incoming);

  const beforeByDate = new Map(before.map((o) => [o.date, o.value]));
  let added = 0;
  let changed = 0;
  for (const o of merged) {
    if (!beforeByDate.has(o.date)) added++;
    else if (beforeByDate.get(o.date) !== o.value) changed++;
  }

  const payload: CachedSeries = {
    seriesId,
    updatedAt: new Date().toISOString(),
    provenance,
    observations: merged,
  };
  writeFileSync(fileFor(seriesId), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return { seriesId, total: merged.length, added, changed };
}

/** Alle vorhandenen Reihen als Bundle laden. */
export function loadBundle(seriesIds: string[]): Record<string, Series> {
  const bundle: Record<string, Series> = {};
  for (const id of seriesIds) {
    const cached = readCachedSeries(id);
    if (cached) bundle[id] = cached.observations;
  }
  return bundle;
}
