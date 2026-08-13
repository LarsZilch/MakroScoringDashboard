/**
 * Snapshot-Bestand: lesen, schreiben, vergleichen.
 *
 * Der Bestand ist das Gedaechtnis der App. Er liegt als eine JSON-Datei je
 * ISO-Woche unter data/snapshots/<jahr>/ und ist bewusst git-versioniert:
 * jeder Wochenlauf erzeugt einen lesbaren Commit-Diff, in dem genau die
 * geaenderten Indikatorwerte stehen.
 *
 * Damit dieser Diff brauchbar bleibt, wird beim Schreiben mit stabiler
 * Schluesselreihenfolge serialisiert. Ohne das wuerde jede Umsortierung durch
 * die Laufzeit als Aenderung erscheinen und den Verlauf unlesbar machen.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isoWeekKey,
  parseIsoWeekKey,
  previousIsoWeek,
  sameWeekPreviousYear,
  type IsoWeek,
} from '../core/isoweek.js';
import { INDICATOR_IDS, type IndicatorId, type Score } from '../core/types.js';
import { SNAPSHOT_DIR } from './paths.js';
import type { Snapshot } from './snapshot.js';

// ---------------------------------------------------------------------------
// Lesen und Schreiben
// ---------------------------------------------------------------------------

function fileFor(week: IsoWeek): string {
  return join(SNAPSHOT_DIR, String(week.isoYear), `${isoWeekKey(week)}.json`);
}

/**
 * Stabil serialisieren: Objektschluessel alphabetisch, damit git-Diffs nur
 * echte Wertaenderungen zeigen.
 */
function stableStringify(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function writeSnapshot(snapshot: Snapshot): string {
  const week = { isoYear: snapshot.isoYear, isoWeek: snapshot.isoWeek };
  const file = fileFor(week);
  mkdirSync(join(SNAPSHOT_DIR, String(week.isoYear)), { recursive: true });
  writeFileSync(file, stableStringify(snapshot), 'utf8');
  return file;
}

export function readSnapshot(week: IsoWeek): Snapshot | null {
  const file = fileFor(week);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  } catch (err) {
    throw new Error(`Snapshot ${isoWeekKey(week)} ist beschaedigt: ${String(err)}`);
  }
}

/** Alle vorhandenen Snapshots, aufsteigend nach Woche. */
export function loadAllSnapshots(): Snapshot[] {
  if (!existsSync(SNAPSHOT_DIR)) return [];
  const out: Snapshot[] = [];

  for (const year of readdirSync(SNAPSHOT_DIR)) {
    const dir = join(SNAPSHOT_DIR, year);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Snapshot);
      } catch {
        // Eine kaputte Datei darf den Bestand nicht unlesbar machen.
      }
    }
  }

  return out.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}

export function listSnapshotWeeks(): IsoWeek[] {
  return loadAllSnapshots().map((s) => ({ isoYear: s.isoYear, isoWeek: s.isoWeek }));
}

export function latestSnapshot(): Snapshot | null {
  const all = loadAllSnapshots();
  return all[all.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Vergleiche: Woche zu Woche und Jahr zu Jahr
// ---------------------------------------------------------------------------

export interface IndicatorDelta {
  id: IndicatorId;
  label: string;
  unit: string;
  currentValue: number | null;
  previousValue: number | null;
  /** Differenz der bewerteten Kennzahl. */
  valueDelta: number | null;
  currentScore: Score;
  previousScore: Score | null;
  scoreDelta: number | null;
  /** true, wenn der Indikator die Bewertungsstufe gewechselt hat. */
  scoreChanged: boolean;
}

export interface Comparison {
  /** Woche, gegen die verglichen wird. */
  reference: IsoWeek;
  /** Die tatsaechlich gefundene Woche — kann von reference abweichen. */
  resolved: IsoWeek | null;
  /**
   * Wurde ersatzweise eine andere Woche genommen, weil die gesuchte fehlt?
   * Wichtig fuer die Anzeige: ein Jahresvergleich gegen die uebernaechste
   * verfuegbare Woche ist etwas anderes als einer gegen die exakte Vorjahres-KW.
   */
  substituted: boolean;
  totalDelta: number | null;
  regimeChanged: boolean;
  previousRegime: string | null;
  factorDeltas: Record<string, number | null>;
  indicators: IndicatorDelta[];
}

/**
 * Snapshot zu einer Woche holen; fehlt sie, die naechstgelegene davor nehmen.
 *
 * Das ist fuer den Jahresvergleich wesentlich: fiel die Vorjahres-KW aus
 * (Quelle nicht erreichbar, Backfill-Luecke), soll der Vergleich nicht
 * einfach verschwinden — aber der Ersatz muss gekennzeichnet sein.
 */
export function resolveWeek(
  snapshots: Snapshot[],
  target: IsoWeek,
  toleranceWeeks = 4,
): { snapshot: Snapshot; substituted: boolean } | null {
  const key = isoWeekKey(target);
  const exact = snapshots.find((s) => s.weekKey === key);
  if (exact) return { snapshot: exact, substituted: false };

  const earlier = snapshots.filter((s) => s.weekKey < key);
  const candidate = earlier[earlier.length - 1];
  if (!candidate) return null;

  // Nur akzeptieren, wenn der Ersatz nicht zu weit weg liegt.
  const diffWeeks = weeksApart(parseIsoWeekKey(candidate.weekKey), target);
  if (diffWeeks > toleranceWeeks) return null;
  return { snapshot: candidate, substituted: true };
}

/** Ungefaehrer Wochenabstand zweier ISO-Wochen. */
function weeksApart(a: IsoWeek, b: IsoWeek): number {
  const toDays = (w: IsoWeek) => w.isoYear * 53 + w.isoWeek;
  return Math.abs(toDays(a) - toDays(b));
}

function compare(current: Snapshot, previous: Snapshot | null, substituted: boolean, reference: IsoWeek): Comparison {
  const indicators: IndicatorDelta[] = INDICATOR_IDS.map((id) => {
    const cur = current.indicators[id];
    const prev = previous?.indicators[id] ?? null;
    const curValue = cur?.measureValue ?? null;
    const prevValue = prev?.measureValue ?? null;

    /*
     * Ein fehlender Indikator traegt rechnerisch den Score 0. Als
     * VERGLEICHSWERT darf diese 0 aber nicht auftreten: sonst behauptet die
     * Delta-Tabelle einen Wechsel "0 -> +1", wo in Wahrheit "unbekannt -> +1"
     * steht. Genau dieser Fall tritt beim ISM und bei AAII regelmaessig auf,
     * weil ihre Historie nur wenige Monate zurueckreicht.
     */
    const prevKnown = prev !== null && prev.quality !== 'missing';
    const curKnown = cur !== undefined && cur.quality !== 'missing';
    const previousScore = prevKnown ? prev.score : null;
    const comparable = prevKnown && curKnown;

    return {
      id,
      label: cur?.label ?? id,
      unit: cur?.unit ?? '',
      currentValue: curValue,
      previousValue: prevValue,
      valueDelta: curValue !== null && prevValue !== null ? curValue - prevValue : null,
      currentScore: cur?.score ?? 0,
      previousScore,
      scoreDelta: comparable ? cur.score - prev.score : null,
      scoreChanged: comparable ? cur.score !== prev.score : false,
    };
  });

  const factorDeltas: Record<string, number | null> = {};
  for (const key of Object.keys(current.factors)) {
    const prevFactor = previous?.factors[key];
    factorDeltas[key] = prevFactor ? current.factors[key]!.score - prevFactor.score : null;
  }

  return {
    reference,
    resolved: previous ? { isoYear: previous.isoYear, isoWeek: previous.isoWeek } : null,
    substituted,
    totalDelta: previous ? current.total - previous.total : null,
    regimeChanged: previous ? current.regime.label !== previous.regime.label : false,
    previousRegime: previous?.regime.label ?? null,
    factorDeltas,
    indicators,
  };
}

/** Vergleich gegen die Vorwoche. */
export function compareWeekOverWeek(current: Snapshot, snapshots: Snapshot[]): Comparison {
  const target = previousIsoWeek({ isoYear: current.isoYear, isoWeek: current.isoWeek });
  const found = resolveWeek(snapshots, target, 3);
  return compare(current, found?.snapshot ?? null, found?.substituted ?? false, target);
}

/** Vergleich gegen dieselbe Kalenderwoche des Vorjahres. */
export function compareYearOverYear(current: Snapshot, snapshots: Snapshot[]): Comparison {
  const target = sameWeekPreviousYear({ isoYear: current.isoYear, isoWeek: current.isoWeek });
  const found = resolveWeek(snapshots, target, 4);
  return compare(current, found?.snapshot ?? null, found?.substituted ?? false, target);
}

// ---------------------------------------------------------------------------
// Verlauf
// ---------------------------------------------------------------------------

export interface HistoryPoint {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  total: number;
  regime: string;
  completeness: string;
  factors: Record<string, number>;
  scores: Record<string, Score>;
  values: Record<string, number | null>;
}

export function buildHistory(snapshots: Snapshot[]): HistoryPoint[] {
  return snapshots.map((s) => ({
    weekKey: s.weekKey,
    isoYear: s.isoYear,
    isoWeek: s.isoWeek,
    total: s.total,
    regime: s.regime.label,
    completeness: s.completeness,
    factors: Object.fromEntries(Object.entries(s.factors).map(([k, f]) => [k, f.score])),
    scores: Object.fromEntries(INDICATOR_IDS.map((id) => [id, s.indicators[id]?.score ?? 0])),
    values: Object.fromEntries(INDICATOR_IDS.map((id) => [id, s.indicators[id]?.measureValue ?? null])),
  }));
}

/** Wechsel des Regimes im Zeitverlauf. */
export interface RegimeChange {
  weekKey: string;
  from: string;
  to: string;
  totalFrom: number;
  totalTo: number;
}

export function findRegimeChanges(snapshots: Snapshot[]): RegimeChange[] {
  const out: RegimeChange[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!;
    const cur = snapshots[i]!;
    if (prev.regime.label !== cur.regime.label) {
      out.push({
        weekKey: cur.weekKey,
        from: prev.regime.label,
        to: cur.regime.label,
        totalFrom: prev.total,
        totalTo: cur.total,
      });
    }
  }
  return out;
}
