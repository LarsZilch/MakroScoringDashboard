/**
 * Wochenrenditen der Anlageklassen und ihre Zuordnung zu den Regimen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER FALLSTRICK, AN DEM SOLCHE AUSWERTUNGEN SCHEITERN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Snapshot fuer KW W nutzt Daten bis zum Ende von KW W. Das Regime steht
 * also erst fest, WENN DIE WOCHE VORBEI IST. Rechnet man die Rendite derselben
 * Woche zu, benutzt man Wissen aus der Zukunft: man haette in der Woche
 * investiert sein muessen, bevor man wusste, welches Regime herrscht.
 *
 * Deshalb wird konsequent die Rendite der FOLGEWOCHE zugeordnet. Das ist der
 * Ertrag, den man tatsaechlich haette erzielen koennen — und regelmaessig ein
 * deutlich unscheinbarerer als der naive.
 */

import { isoWeekKey, isoWeekOf, nextIsoWeek, parseIsoWeekKey } from '../core/isoweek.js';
import type { Series } from '../core/derive.js';

/** Eine Wochenrendite, geschluesselt nach der ISO-Woche ihres Zeitraums. */
export interface WeeklyReturn {
  weekKey: string;
  /** Einfache Rendite des Zeitraums, z. B. 0.012 fuer +1,2 %. */
  ret: number;
  from: string;
  to: string;
}

/**
 * Kursreihe in Wochenrenditen umrechnen.
 *
 * Die Reihe kommt bereits in Wochenkerzen; jede Rendite gilt fuer die
 * ISO-Woche ihres Endpunkts.
 */
export function weeklyReturns(series: Series): WeeklyReturn[] {
  const out: WeeklyReturn[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    if (prev.value <= 0) continue;
    out.push({
      weekKey: isoWeekKey(isoWeekOf(cur.date)),
      ret: cur.value / prev.value - 1,
      from: prev.date,
      to: cur.date,
    });
  }
  // Bei doppelten Wochenschluesseln gewinnt der spaetere Eintrag.
  const byWeek = new Map<string, WeeklyReturn>();
  for (const r of out) byWeek.set(r.weekKey, r);
  return [...byWeek.values()].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}

/**
 * Regime der Woche W mit der Rendite der Woche W+1 verbinden.
 *
 * Genau hier wird der Look-ahead vermieden. Die Zuordnung ist bewusst
 * explizit und nicht in eine Schleife irgendwo versteckt.
 */
export interface RegimeReturn {
  /** Woche, in der das Regime festgestellt wurde. */
  signalWeek: string;
  /** Woche, deren Rendite gemessen wird — immer die darauf folgende. */
  returnWeek: string;
  regime: string;
  ret: number;
}

export function joinForwardReturns(
  regimeByWeek: Map<string, string>,
  returns: WeeklyReturn[],
): RegimeReturn[] {
  const retByWeek = new Map(returns.map((r) => [r.weekKey, r.ret]));
  const out: RegimeReturn[] = [];

  for (const [weekKey, regime] of regimeByWeek) {
    const next = isoWeekKey(nextIsoWeek(parseIsoWeekKey(weekKey)));
    const ret = retByWeek.get(next);
    // Fehlt die Folgewoche (Reihenende, Datenluecke), wird der Punkt
    // ausgelassen statt geschaetzt.
    if (ret === undefined) continue;
    out.push({ signalWeek: weekKey, returnWeek: next, regime, ret });
  }

  return out.sort((a, b) => a.signalWeek.localeCompare(b.signalWeek));
}

// ---------------------------------------------------------------------------
// Kennzahlen
// ---------------------------------------------------------------------------

/**
 * Ab wie vielen Wochen eine Kennzahl ueberhaupt gezeigt wird.
 *
 * Unterhalb von MIN_WEEKS steht keine Zahl, sondern der Hinweis auf die
 * Stichprobe. Der Grund ist konkret: im echten Modell gibt es derzeit genau
 * zwei Risk-Off-Wochen, und "+3,2 % in Risk Off" aus zwei Einzelwochen liest
 * sich wie ein Befund, ist aber keiner.
 */
export const MIN_WEEKS = 8;
/** Ab hier gilt die Stichprobe als tragfaehig; dazwischen: schwach belegt. */
export const SOLID_WEEKS = 26;

export type Confidence = 'insufficient' | 'weak' | 'solid';

export interface PerformanceStats {
  regime: string;
  weeks: number;
  confidence: Confidence;
  /** Geometrisch annualisierte Rendite, null wenn die Stichprobe zu klein ist. */
  annualized: number | null;
  /** Durchschnittliche Wochenrendite, null wenn zu klein. */
  meanWeekly: number | null;
  /** Anteil positiver Wochen, null wenn zu klein. */
  hitRate: number | null;
  /** Gesamtertrag ueber alle Wochen dieses Regimes, null wenn zu klein. */
  cumulative: number | null;

  /**
   * Zahl der zusammenhaengenden Episoden.
   *
   * Das ist das ehrlichere Mass fuer die Stichprobe als die Wochenzahl. Beim
   * Vergleichsmodell 2018 stammen 58 der 73 Risk-On-Wochen aus zwei Episoden
   * in 2020/21 — "n = 73" sieht robust aus, sind aber faktisch zwei
   * unabhaengige Beobachtungen desselben Ereignisses.
   */
  episodes: number;
  /** Anteil der Wochen, die in der laengsten Episode liegen. */
  largestEpisodeShare: number;
  /** true, wenn eine einzelne Episode das Ergebnis traegt. */
  concentrated: boolean;
}

/** Ab diesem Anteil gilt ein Ergebnis als von einer Episode getragen. */
export const CONCENTRATION_LIMIT = 0.4;

export function confidenceOf(weeks: number): Confidence {
  if (weeks < MIN_WEEKS) return 'insufficient';
  if (weeks < SOLID_WEEKS) return 'weak';
  return 'solid';
}

/**
 * Kennzahlen fuer ein Regime.
 *
 * Bei zu kleiner Stichprobe bleiben die Zahlen bewusst null — die Zahl der
 * Wochen wird aber immer ausgewiesen, damit die Luecke sichtbar ist statt
 * unsichtbar.
 */
/**
 * Zusammenhaengende Episoden zaehlen.
 *
 * Zwei Eintraege gehoeren zur selben Episode, wenn ihre Signalwochen direkt
 * aufeinander folgen. Ueber Jahreswechsel hinweg gilt dasselbe — deshalb wird
 * mit der ISO-Wochenrechnung verglichen und nicht mit Zeichenketten.
 */
export function countEpisodes(signalWeeks: string[]): number[] {
  if (signalWeeks.length === 0) return [];
  const sorted = [...signalWeeks].sort();
  const lengths: number[] = [];
  let len = 1;

  for (let i = 1; i < sorted.length; i++) {
    const expected = isoWeekKey(nextIsoWeek(parseIsoWeekKey(sorted[i - 1]!)));
    if (sorted[i] === expected) len++;
    else {
      lengths.push(len);
      len = 1;
    }
  }
  lengths.push(len);
  return lengths;
}

export interface StatsEntry {
  signalWeek: string;
  ret: number;
}

export function statsFor(regime: string, entries: StatsEntry[]): PerformanceStats {
  const rets = entries.map((e) => e.ret);
  const weeks = rets.length;
  const confidence = confidenceOf(weeks);

  const episodeLengths = countEpisodes(entries.map((e) => e.signalWeek));
  const episodes = episodeLengths.length;
  const largest = episodeLengths.length > 0 ? Math.max(...episodeLengths) : 0;
  const largestEpisodeShare = weeks > 0 ? largest / weeks : 0;
  const concentrated = episodes > 0 && largestEpisodeShare >= CONCENTRATION_LIMIT;

  const shape = { regime, weeks, confidence, episodes, largestEpisodeShare, concentrated };

  if (confidence === 'insufficient') {
    return { ...shape, annualized: null, meanWeekly: null, hitRate: null, cumulative: null };
  }

  const growth = rets.reduce((acc, r) => acc * (1 + r), 1);
  return {
    ...shape,
    // Geometrisch: so, als waere man nur in diesen Wochen investiert gewesen.
    annualized: Math.pow(growth, 52 / weeks) - 1,
    meanWeekly: rets.reduce((a, r) => a + r, 0) / weeks,
    hitRate: rets.filter((r) => r > 0).length / weeks,
    cumulative: growth - 1,
  };
}

export interface AssetPerformance {
  assetId: string;
  label: string;
  byRegime: PerformanceStats[];
  /** Alle Wochen zusammen, als Vergleichsmassstab. */
  overall: PerformanceStats;
}

export function performanceByRegime(
  assetId: string,
  label: string,
  joined: RegimeReturn[],
  regimeOrder: string[],
): AssetPerformance {
  const byRegime = regimeOrder.map((regime) =>
    statsFor(
      regime,
      joined.filter((j) => j.regime === regime),
    ),
  );
  /*
   * Der Gesamtwert ist keine bedingte Stichprobe, sondern der Zeitraum am
   * Stueck. Die Episoden-Kennzeichnung waere dort immer erfuellt (eine
   * durchgehende Phase) und damit sinnlos — sie wuerde nur suggerieren, auch
   * dieser Wert haenge an einem einzelnen Ereignis.
   */
  const overall = statsFor('Alle', joined);

  return {
    assetId,
    label,
    byRegime,
    overall: { ...overall, concentrated: false },
  };
}

// ---------------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------------

/**
 * Kursreihe auf 100 zum ersten Punkt des Fensters indexieren.
 *
 * Das ist die "abstrahierte" Darstellung: nicht der absolute Kurs, sondern die
 * relative Entwicklung ab Fensterbeginn — erst dadurch werden Anlageklassen
 * mit voellig verschiedenen Kursniveaus in einem Diagramm vergleichbar.
 */
export function indexTo100(series: Series, fromDate?: string): Series {
  const window = fromDate ? series.filter((o) => o.date >= fromDate) : series;
  const base = window[0]?.value;
  if (!base || base <= 0) return [];
  return window.map((o) => ({ date: o.date, value: (o.value / base) * 100 }));
}
