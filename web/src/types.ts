/** Spiegelt die Typen aus src/core und src/pipeline auf der Frontend-Seite. */

export type Score = -1 | 0 | 1;
export type Quality = 'ok' | 'proxy' | 'manual' | 'stale' | 'missing';
export type Completeness = 'full' | 'partial' | 'sparse';

export interface FlipDistance {
  boundary: number;
  gap: number;
  gapTicks: number;
  gapSigma: number | null;
  direction: 'up' | 'down';
  toScore: Score;
}

export interface ScoredIndicator {
  id: string;
  factor: string;
  label: string;
  measure: string;
  unit: string;
  measureValue: number | null;
  value: number | null;
  obsDate?: string;
  derived?: Record<string, number | null>;
  score: Score;
  scoreNote?: string;
  quality: Quality;
  display?: { primary: string; secondary: string };
  nearestFlip: FlipDistance | null;
  flips: FlipDistance[];
}

export interface ScoredFactor {
  id: string;
  label: string;
  score: Score;
  positives: number;
  negatives: number;
  neutrals: number;
  missing: number;
  determinable: boolean;
  rationale: string;
  indicators: string[];
}

export interface Snapshot {
  schemaVersion: number;
  rulesVersion: string;
  isoYear: number;
  isoWeek: number;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  dataAsOf: string;
  builtAt: string;
  completeness: Completeness;
  meaningful: boolean;
  missing: string[];
  stale: string[];
  undeterminableFactors: string[];
  indicators: Record<string, ScoredIndicator>;
  factors: Record<string, ScoredFactor>;
  total: number;
  regime: { label: string; cashBand: [number, number]; assumed?: boolean };
  notes: string[];
}

export interface IndicatorDelta {
  id: string;
  label: string;
  unit: string;
  currentValue: number | null;
  previousValue: number | null;
  valueDelta: number | null;
  currentScore: Score;
  previousScore: Score | null;
  scoreDelta: number | null;
  scoreChanged: boolean;
}

export interface Comparison {
  reference: { isoYear: number; isoWeek: number };
  resolved: { isoYear: number; isoWeek: number } | null;
  substituted: boolean;
  totalDelta: number | null;
  regimeChanged: boolean;
  previousRegime: string | null;
  factorDeltas: Record<string, number | null>;
  indicators: IndicatorDelta[];
}

export interface Sensitivity {
  indicator: string;
  label: string;
  gap: number;
  gapTicks: number;
  gapSigma: number | null;
  closeness: number;
  closenessBasis: 'sigma' | 'ticks';
  unit: string;
  boundary: number;
  direction: 'up' | 'down';
  fromScore: Score;
  toScore: Score;
  resultingTotal: number;
  resultingRegime: string;
  changesRegime: boolean;
}

export interface WeekResponse {
  snapshot: Snapshot;
  wow: Comparison;
  yoy: Comparison;
  sensitivity: Sensitivity[];
  available: { weekKey: string; total: number; regime: string; meaningful: boolean }[];
}

export interface HistoryPoint {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  total: number;
  regime: string;
  completeness: Completeness;
  factors: Record<string, number>;
  scores: Record<string, Score>;
  values: Record<string, number | null>;
}

export interface HistoryResponse {
  points: HistoryPoint[];
  regimeChanges: { weekKey: string; from: string; to: string; totalFrom: number; totalTo: number }[];
  meaningfulFrom: string | null;
  total: number;
}
