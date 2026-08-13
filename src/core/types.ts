/**
 * Gemeinsame Typen fuer Regelwerk, Scoring und Snapshots.
 *
 * Dieses Modul und alles unter src/core/ ist bewusst frei von I/O:
 * derselbe Code laeuft im ETL, im Server und im Browser.
 */

export type Score = -1 | 0 | 1;

export type FactorId = 'business_cycle' | 'liquidity' | 'sentiment';

export const INDICATOR_IDS = [
  'ism_mfg_pmi',
  'nfci',
  't10y2y',
  'gli',
  'move',
  'sofr_iorb',
  'vix',
  'aaii',
  'fear_greed',
] as const;

export type IndicatorId = (typeof INDICATOR_IDS)[number];

/**
 * Wie sehr ist diesem Wert zu trauen?
 * - ok:      regulaer aus der vorgesehenen Quelle geholt
 * - proxy:   Ersatzreihe statt des Originals (Net Liquidity statt Howell GLI)
 * - manual:  von Hand eingetragen
 * - stale:   Quelle nicht erreichbar, letzter bekannter Wert wird weiterverwendet
 * - missing: kein Wert vorhanden, Indikator zaehlt als neutral
 */
export type Quality = 'ok' | 'proxy' | 'manual' | 'stale' | 'missing';

export interface Provenance {
  kind: 'api' | 'csv' | 'scrape' | 'manual' | 'derived';
  provider: string;
  url?: string;
  fetchedAt?: string;
  /** Bei abgeleiteten Werten: aus welchen Rohreihen entstanden. */
  inputs?: string[];
}

// ---------------------------------------------------------------------------
// Regelwerk
// ---------------------------------------------------------------------------

/**
 * Ein Bewertungsband. Die angegebenen Vergleiche muessen alle zutreffen.
 * Ein Band ganz ohne Vergleich ist der Auffangfall und trifft immer zu.
 */
export interface Band {
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  score: Score;
  note?: string;
}

export interface IndicatorRule {
  ordinal: number;
  factor: FactorId;
  label: string;
  /** Abweichende Beschriftung, wenn statt des Originals eine Ersatzreihe genutzt wird. */
  proxyLabel?: string;
  /** Name der Kennzahl, gegen die die Baender geprueft werden (z. B. "change3m"). */
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
  factors: { id: FactorId; label: string; ordinal: number }[];
  indicators: Record<IndicatorId, IndicatorRule>;
  factorAggregation: { rule: 'majority'; minCount: number; note?: string };
  regimeBands: RegimeBand[];
}

// ---------------------------------------------------------------------------
// Scoring-Ein- und Ausgabe
// ---------------------------------------------------------------------------

/** Was der Kern pro Indikator an Eingabe braucht. */
export interface IndicatorInput {
  /** Der Wert, gegen den die Baender geprueft werden. null = kein Wert vorhanden. */
  measureValue: number | null;
  /** Der Schlagzeilenwert fuer die Anzeige (z. B. der PMI-Stand selbst). */
  value?: number | null;
  /** Datum der zugrunde liegenden Beobachtung. */
  obsDate?: string;
  /** Weitere berechnete Groessen, die im Snapshot mitgefuehrt werden. */
  derived?: Record<string, number | null>;
  quality?: Quality;
  provenance?: Provenance;
  display?: { primary: string; secondary: string };
  /**
   * Standardabweichung der Wochenveraenderung dieser Kennzahl, aus der
   * Historie berechnet. Optional: ohne sie faellt die Grenzfall-Analyse auf
   * Anzeigeschritte zurueck.
   */
  volatility?: number | null;
}

/** Wie weit ist der Wert von der naechsten Schwelle entfernt, die den Score kippt. */
export interface FlipDistance {
  /** Schwellenwert, an dem der Score wechselt. */
  boundary: number;
  /** Betragsmaessiger Abstand des aktuellen Werts zur Schwelle, in der Einheit des Indikators. */
  gap: number;
  /**
   * Abstand in Schritten der Anzeigegenauigkeit (10^-decimals).
   *
   * Rohe Abstaende sind zwischen Indikatoren NICHT vergleichbar: 3 bp beim
   * SOFR-IORB-Spread, 0,01 Indexpunkte beim NFCI und 1,9 Punkte beim ISM
   * messen voellig verschiedene Dinge. Erst die Umrechnung in Schritte macht
   * eine Rangfolge ueberhaupt sinnvoll.
   */
  gapTicks: number;
  /**
   * Abstand in Standardabweichungen der eigenen Wochenveraenderung, sofern
   * Historie vorliegt. Das ist das ehrlichste Mass fuer "wie leicht kippt das":
   * es beantwortet, wie ungewoehnlich die noetige Bewegung waere.
   */
  gapSigma: number | null;
  /** Muss der Wert steigen oder fallen, um zu kippen. */
  direction: 'up' | 'down';
  /** Score jenseits der Schwelle. */
  toScore: Score;
}

export interface ScoredIndicator {
  id: IndicatorId;
  factor: FactorId;
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
  provenance?: Provenance;
  display?: { primary: string; secondary: string };
  /** Naechstgelegene Kippschwelle, oder null wenn keine erreichbar ist. */
  nearestFlip: FlipDistance | null;
  /** Alle Kippschwellen, nach Abstand sortiert. Basis der Grenzfall-Analyse. */
  flips: FlipDistance[];
}

export interface ScoredFactor {
  id: FactorId;
  label: string;
  score: Score;
  positives: number;
  negatives: number;
  /** Indikatoren mit echtem Wert, der neutral ausfaellt. */
  neutrals: number;
  /** Indikatoren ohne Wert. NICHT dasselbe wie neutral. */
  missing: number;
  /**
   * Laesst sich der Faktor ueberhaupt bestimmen?
   *
   * Die Mehrheitsregel braucht 2 von 3. Fehlen zwei oder mehr Werte, kann
   * keine Mehrheit mehr zustande kommen — der Faktor ist dann nicht neutral,
   * sondern unbestimmt. Der Unterschied ist wesentlich: "alle drei neutral"
   * ist eine Aussage ueber den Markt, "zwei Werte fehlen" eine ueber die
   * Datenlage. Sie duerfen im Dashboard nicht gleich aussehen.
   */
  determinable: boolean;
  /** Klartext wie in der Vorlage, z. B. "2 von 3 positiv". */
  rationale: string;
  indicators: IndicatorId[];
}

export interface Regime {
  label: string;
  cashBand: [number, number];
  assumed?: boolean;
}

export interface ScoringResult {
  rulesVersion: string;
  indicators: Record<IndicatorId, ScoredIndicator>;
  factors: Record<FactorId, ScoredFactor>;
  total: number;
  regime: Regime;
  /** true, sobald mindestens ein Indikator fehlt oder veraltet ist. */
  degraded: boolean;
  missing: IndicatorId[];
  /** Faktoren, deren Score mangels Daten nicht bestimmbar ist. */
  undeterminableFactors: FactorId[];
  /**
   * Traegt der Gesamtscore ueberhaupt eine Aussage?
   *
   * Sobald ein Faktor unbestimmt ist, geht er als 0 in die Summe ein und
   * zieht den Gesamtscore Richtung Mitte. Das Ergebnis sieht dann nach
   * "Neutral" aus, ist aber nur ein Datenloch. Genau davor warnt dieses Feld.
   */
  meaningful: boolean;
}
