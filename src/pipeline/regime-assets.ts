/**
 * Bindeglied zwischen Regime-Reihe und Kursreihen: liefert das, was die
 * Oberflaeche fuer Overlay und Kennzahlen braucht.
 */

import { ASSETS, ASSET_BY_ID, assetSeriesId } from '../sources/assets.js';
import type { Series } from '../core/derive.js';
import {
  CONCENTRATION_LIMIT,
  countEpisodes,
  indexTo100,
  joinForwardReturns,
  performanceByRegime,
  weeklyReturns,
  type AssetPerformance,
} from './asset-returns.js';
import { loadBundle } from './series-cache.js';
import { regimeMap, type RegimeSeries } from './regime-history.js';
import { isoWeekEnd, isoWeekKey, isoWeekOf, isoDate, parseIsoWeekKey } from '../core/isoweek.js';

/** Regime von guenstig nach unguenstig — die Achse der Auswertung. */
export const REGIME_ORDER = ['Risk On', 'Neutral', 'Risk Off', 'Defensiv'];

export interface AssetCurve {
  assetId: string;
  label: string;
  short: string;
  group: string;
  /** Auf 100 zum Fensterbeginn indexierte Wochenreihe. */
  points: { weekKey: string; value: number }[];
}

/** Alle Kursreihen aus dem Cache laden. */
export function loadAssetBundle(): Record<string, Series> {
  return loadBundle(ASSETS.map((a) => assetSeriesId(a.id)));
}

/**
 * Kursreihen auf das Fenster der Regime-Reihe zuschneiden und indexieren.
 *
 * Der Zuschnitt erfolgt ueber die ISO-Woche, nicht ueber das Kalenderdatum —
 * sonst laegen Kurs- und Regimeachse um bis zu sechs Tage versetzt und die
 * beiden Diagramme waeren nicht mehr deckungsgleich.
 */
export function buildCurves(
  regimes: RegimeSeries,
  bundle: Record<string, Series>,
  fromWeek?: string,
): AssetCurve[] {
  const weeks = fromWeek ? regimes.weeks.filter((w) => w.weekKey >= fromWeek) : regimes.weeks;
  const firstWeek = weeks[0]?.weekKey;
  const lastWeek = weeks[weeks.length - 1]?.weekKey;
  if (!firstWeek || !lastWeek) return [];

  const from = isoDate(isoWeekEnd(parseIsoWeekKey(firstWeek)));
  const to = isoDate(isoWeekEnd(parseIsoWeekKey(lastWeek)));

  return ASSETS.map((a) => {
    const series = bundle[assetSeriesId(a.id)] ?? [];
    const window = series.filter((o) => o.date >= from && o.date <= to);
    const indexed = indexTo100(window);
    return {
      assetId: a.id,
      label: a.label,
      short: a.short,
      group: a.group,
      points: indexed.map((o) => ({ weekKey: isoWeekKey(isoWeekOf(o.date)), value: o.value })),
    };
  }).filter((c) => c.points.length > 1);
}

/** Kennzahlen je Anlageklasse und Regime. */
export function buildPerformance(
  regimes: RegimeSeries,
  bundle: Record<string, Series>,
): AssetPerformance[] {
  const map = regimeMap(regimes);
  return ASSETS.map((a) => {
    const series = bundle[assetSeriesId(a.id)] ?? [];
    const joined = joinForwardReturns(map, weeklyReturns(series));
    return performanceByRegime(a.id, ASSET_BY_ID.get(a.id)?.label ?? a.id, joined, REGIME_ORDER);
  }).filter((p) => p.overall.weeks > 0);
}

/**
 * Wie stark haengt eine Regime-Auswertung an einzelnen Episoden?
 *
 * Wird ueber alle Anlageklassen hinweg einmal ausgewiesen, damit die
 * Einschraenkung nicht in elf Tabellenzellen versteckt bleibt.
 */
export interface RegimeSampleInfo {
  regime: string;
  weeks: number;
  episodes: number;
  largestEpisodeShare: number;
  concentrated: boolean;
}

export function sampleInfo(regimes: RegimeSeries): RegimeSampleInfo[] {
  return REGIME_ORDER.map((regime) => {
    const weeks = regimes.weeks.filter((w) => w.regime === regime).map((w) => w.weekKey);
    // Episoden ueber die Regime-Reihe selbst, nicht ueber eine Anlageklasse —
    // die Stichprobe haengt am Modell, nicht am Kurs.
    const lengths = countEpisodes(weeks);
    const largest = lengths.length ? Math.max(...lengths) : 0;
    const share = weeks.length ? largest / weeks.length : 0;

    return {
      regime,
      weeks: weeks.length,
      episodes: lengths.length,
      largestEpisodeShare: share,
      concentrated: weeks.length > 0 && share >= CONCENTRATION_LIMIT,
    };
  });
}
