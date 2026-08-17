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

// ---------------------------------------------------------------------------
// Regelwerk
//
// Der Hilfe-Tab rendert saemtliche Schwellen, Korridore und Cash-Baender aus
// diesen Daten, statt sie im Text zu wiederholen. Sonst haette die App zwei
// Wahrheiten und die Hilfe wuerde still falsch, sobald jemand rules/v1.json
// anfasst.
// ---------------------------------------------------------------------------

/** Ein Bewertungsband. Die angegebenen Vergleiche muessen alle zutreffen. */
export interface Band {
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  score: Score;
  note?: string;
}

/** Beleg, dass eine Schwelle an den Daten gemessen und nicht geraten wurde. */
export interface Calibration {
  basis: string;
  measuredOn: string;
  observed: Record<string, number>;
  chosenThreshold: number;
  resultingSplit: string;
  warning: string;
}

export interface IndicatorRule {
  ordinal: number;
  factor: string;
  label: string;
  proxyLabel?: string;
  measure: string;
  unit: string;
  decimals: number;
  bands: Band[];
  quality?: Quality;
  proxyNote?: string;
  contrarian?: boolean;
  invertedScale?: boolean;
  corridor?: [number, number];
  assumed?: boolean;
  assumptionNote?: string;
  calibration?: Calibration;
}

export interface RegimeBand {
  min: number;
  max: number;
  label: string;
  cashBand: [number, number];
  assumed?: boolean;
  note?: string;
}

export interface RuleBook {
  version: string;
  title: string;
  derivedFrom?: string;
  note?: string;
  factors: { id: string; label: string; ordinal: number }[];
  indicators: Record<string, IndicatorRule>;
  factorAggregation: { rule: string; minCount: number; note?: string };
  regimeBands: RegimeBand[];
}

export interface RulesResponse {
  rules: RuleBook;
  assumptions: { scope: string; note: string }[];
}

// ---------------------------------------------------------------------------
// Szenarien
//
// Der Backtest zaehlt, wann die angenommene Lage historisch tatsaechlich galt.
// Das ist eine andere Frage als die Durchspielung im Hilfe-Tab — siehe
// src/pipeline/scenario-backtest.ts.
// ---------------------------------------------------------------------------

export interface HorizonOutcome {
  weeks: number;
  evaluated: number;
  /** Zielwoche liegt jenseits des Bestandsendes — kein Blick in die Zukunft. */
  truncated: number;
  changed: number;
  byRegime: Record<string, number>;
}

/** Warum die Trefferzahl klein ist: wie oft der Indikator ueberhaupt einen Wert trug. */
export interface OverrideCoverage {
  id: string;
  label: string;
  assumed: Score;
  weeksWithValue: number;
  weeksMatching: number;
  firstWeekWithValue: string | null;
}

export interface ScenarioBacktest {
  scenarioId: string;
  occurrences: number;
  episodes: number;
  largestEpisodeShare: number;
  concentrated: boolean;
  confidence: 'insufficient' | 'weak' | 'solid';
  byRegime: Record<string, number>;
  firstWeek: string | null;
  lastWeek: string | null;
  horizons: HorizonOutcome[];
  coverage: OverrideCoverage[];
  limitedBy: string | null;
  weeks: string[];
}

export interface ScenarioBacktestReport {
  basisWeeks: number;
  from: string | null;
  to: string | null;
  rulesVersions: string[];
  scenarios: ScenarioBacktest[];
}

// ---------------------------------------------------------------------------
// Anlageklassen
// ---------------------------------------------------------------------------

/** `live` = echtes Modell, `reduced` = Vergleichsmodell 2018. */
export type RegimeMode = 'live' | 'reduced';

export interface AssetDef {
  id: string;
  symbol: string;
  label: string;
  short: string;
  group: string;
}

export interface AssetCurve {
  assetId: string;
  label: string;
  short: string;
  group: string;
  /** Auf 100 zum Fensterbeginn indexiert. */
  points: { weekKey: string; value: number }[];
}

export interface RegimeWeekPoint {
  weekKey: string;
  isoYear: number;
  isoWeek: number;
  total: number;
  regime: string;
  factors: Record<string, number>;
  completeness?: string;
}

export interface AssetsResponse {
  mode: RegimeMode;
  regimes: {
    label: string;
    caveat: string;
    omitted: string[];
    from: string | null;
    to: string | null;
    weeks: RegimeWeekPoint[];
  };
  curves: AssetCurve[];
  catalogue: AssetDef[];
}

export interface PerformanceStatsView {
  regime: string;
  weeks: number;
  confidence: 'insufficient' | 'weak' | 'solid';
  annualized: number | null;
  meanWeekly: number | null;
  hitRate: number | null;
  cumulative: number | null;
  episodes: number;
  largestEpisodeShare: number;
  concentrated: boolean;
}

export interface AssetPerformanceView {
  assetId: string;
  label: string;
  byRegime: PerformanceStatsView[];
  overall: PerformanceStatsView;
}

export interface RegimeSampleView {
  regime: string;
  weeks: number;
  episodes: number;
  largestEpisodeShare: number;
  concentrated: boolean;
}

export interface PerformanceResponse {
  mode: RegimeMode;
  label: string;
  caveat: string;
  from: string | null;
  to: string | null;
  totalWeeks: number;
  regimeOrder: string[];
  sample: RegimeSampleView[];
  assets: AssetPerformanceView[];
}
