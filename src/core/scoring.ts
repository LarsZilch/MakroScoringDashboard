/**
 * Der Scoring-Kern: Band-Auswertung, Kippschwellen, Faktor-Mehrheit, Regime.
 *
 * Alles hier ist rein rechnend und kennt weder Dateien noch Netz. Damit laeuft
 * dieselbe Logik im ETL, im Server und im Browser - und der Golden Test gegen
 * die Vorlage braucht keinerlei Vorbereitung.
 */

import type {
  Band,
  FactorId,
  IndicatorId,
  IndicatorInput,
  IndicatorRule,
  FlipDistance,
  Quality,
  Regime,
  RuleBook,
  Score,
  ScoredFactor,
  ScoredIndicator,
  ScoringResult,
} from './types.js';
import { INDICATOR_IDS } from './types.js';

/** Trifft das Band auf den Wert zu? Ein Band ohne Vergleich ist der Auffangfall. */
function bandMatches(band: Band, value: number): boolean {
  if (band.lt !== undefined && !(value < band.lt)) return false;
  if (band.lte !== undefined && !(value <= band.lte)) return false;
  if (band.gt !== undefined && !(value > band.gt)) return false;
  if (band.gte !== undefined && !(value >= band.gte)) return false;
  return true;
}

export interface BandHit {
  score: Score;
  note?: string;
}

/** Erstes zutreffendes Band gewinnt. Trifft keines zu, gilt neutral. */
export function evaluateBands(bands: Band[], value: number): BandHit {
  for (const band of bands) {
    if (bandMatches(band, value)) return { score: band.score, note: band.note };
  }
  return { score: 0, note: 'kein Band getroffen, neutral gewertet' };
}

/**
 * Alle Schwellenwerte, die in den Baendern vorkommen.
 * Basis der Kippschwellen-Berechnung.
 */
function boundariesOf(bands: Band[]): number[] {
  const set = new Set<number>();
  for (const b of bands) {
    for (const v of [b.lt, b.lte, b.gt, b.gte]) {
      if (v !== undefined) set.add(v);
    }
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * Wie weit ist der Wert von jeder Schwelle entfernt, an der der Score kippt.
 *
 * Das ist die maschinelle Fassung des roten Kastens der Vorlage
 * ("VIX steht 0,15 Punkte ueber der Complacency-Schwelle"). Die Schwellen
 * werden nicht hartcodiert, sondern aus den Baendern selbst abgeleitet -
 * eine Regelaenderung wirkt damit automatisch mit.
 */
export function flipDistances(
  bands: Band[],
  value: number,
  decimals = 2,
  volatility: number | null = null,
): FlipDistance[] {
  const current = evaluateBands(bands, value).score;
  const eps = 1e-9;
  const tick = Math.pow(10, -decimals);
  const usableVol = volatility !== null && Number.isFinite(volatility) && volatility > 0 ? volatility : null;

  const raw: { boundary: number; gap: number; direction: 'up' | 'down'; toScore: Score }[] = [];

  for (const boundary of boundariesOf(bands)) {
    if (boundary > value) {
      const beyond = evaluateBands(bands, boundary + eps).score;
      const at = evaluateBands(bands, boundary).score;
      // Der Score kann schon exakt auf der Schwelle kippen (gte/lte) oder erst
      // dahinter (gt/lt). Beide Faelle liefern denselben praktischen Abstand.
      const toScore = at !== current ? at : beyond;
      if (toScore !== current) {
        raw.push({ boundary, gap: boundary - value, direction: 'up', toScore });
      }
    } else if (boundary < value) {
      const beyond = evaluateBands(bands, boundary - eps).score;
      const at = evaluateBands(bands, boundary).score;
      const toScore = at !== current ? at : beyond;
      if (toScore !== current) {
        raw.push({ boundary, gap: value - boundary, direction: 'down', toScore });
      }
    } else {
      // Wert liegt exakt auf der Schwelle: beide Richtungen pruefen.
      const up = evaluateBands(bands, boundary + eps).score;
      const down = evaluateBands(bands, boundary - eps).score;
      if (up !== current) raw.push({ boundary, gap: 0, direction: 'up', toScore: up });
      if (down !== current) raw.push({ boundary, gap: 0, direction: 'down', toScore: down });
    }
  }

  return raw
    .map((r) => ({
      ...r,
      gapTicks: r.gap / tick,
      gapSigma: usableVol === null ? null : r.gap / usableVol,
    }))
    .sort((a, b) => a.gap - b.gap);
}

/**
 * Vergleichbares Mass fuer "wie leicht kippt dieser Indikator".
 * Sigma, wo Historie vorliegt; sonst Anzeigeschritte.
 */
export function flipCloseness(f: FlipDistance): number {
  return f.gapSigma ?? f.gapTicks;
}

/** Einen einzelnen Indikator bewerten. */
export function scoreIndicator(
  id: IndicatorId,
  rule: IndicatorRule,
  input: IndicatorInput,
): ScoredIndicator {
  const useProxy = rule.quality === 'proxy';
  const base: Omit<ScoredIndicator, 'score' | 'scoreNote' | 'quality' | 'nearestFlip' | 'flips'> = {
    id,
    factor: rule.factor,
    label: useProxy && rule.proxyLabel ? rule.proxyLabel : rule.label,
    measure: rule.measure,
    unit: rule.unit,
    measureValue: input.measureValue,
    value: input.value ?? input.measureValue ?? null,
    obsDate: input.obsDate,
    derived: input.derived,
    provenance: input.provenance,
    display: input.display,
  };

  if (input.measureValue === null || !Number.isFinite(input.measureValue)) {
    return {
      ...base,
      score: 0,
      scoreNote: 'kein Wert verfuegbar, neutral gewertet',
      quality: 'missing',
      nearestFlip: null,
      flips: [],
    };
  }

  const hit = evaluateBands(rule.bands, input.measureValue);
  const flips = flipDistances(
    rule.bands,
    input.measureValue,
    rule.decimals,
    input.volatility ?? null,
  );

  // Die Regelwerk-Qualitaet (z. B. "proxy") gilt, solange der Abruf nicht
  // selbst schon einen schlechteren Zustand gemeldet hat.
  const quality: Quality =
    input.quality && input.quality !== 'ok' ? input.quality : (rule.quality ?? 'ok');

  return {
    ...base,
    score: hit.score,
    scoreNote: hit.note,
    quality,
    nearestFlip: flips[0] ?? null,
    flips,
  };
}

/**
 * Faktor aus seinen drei Indikatoren: Mehrheit entscheidet.
 * Aus der Vorlage belegt: "2 von 3 positiv" -> +1, "alle drei neutral" -> 0.
 */
/**
 * Wie streng wird die Mehrheit verlangt?
 *
 * - `strict`: mindestens `minCount` von drei Werten muessen vorliegen, sonst
 *   gilt der Faktor als unbestimmt. Das ist die Regel des echten Modells.
 *
 * - `available`: Mehrheit der VORHANDENEN Werte, also `positives > vorhandene/2`.
 *   Bei drei vorhandenen Werten ist das rechnerisch dasselbe wie `strict`
 *   (beides verlangt zwei); bei zwei vorhandenen verlangt es Einstimmigkeit,
 *   bei einem entscheidet dieser eine.
 *
 * `available` existiert allein fuer das Vergleichsmodell 2018, das mit sechs
 * statt neun Indikatoren rechnet, weil ISM, AAII und Fear & Greed historisch
 * nicht zu bekommen sind. Es ist damit eine ANDERE Methodik und nicht die
 * Verlaengerung des echten Modells — deshalb ist `strict` der Standard und
 * muss es bleiben.
 */
export type AggregationMode = 'strict' | 'available';

export function aggregateFactor(
  factorId: FactorId,
  label: string,
  members: ScoredIndicator[],
  minCount: number,
  mode: AggregationMode = 'strict',
): ScoredFactor {
  const missing = members.filter((m) => m.quality === 'missing').length;
  const present = members.filter((m) => m.quality !== 'missing');
  const positives = present.filter((m) => m.score === 1).length;
  const negatives = present.filter((m) => m.score === -1).length;
  const neutrals = present.length - positives - negatives;

  // Schwelle fuer eine Mehrheit. Bei drei vorhandenen Werten ergibt die
  // verallgemeinerte Regel dieselben zwei, die das echte Modell verlangt.
  const needed = mode === 'strict' ? minCount : Math.floor(present.length / 2) + 1;

  let score: Score = 0;
  if (present.length > 0 && positives >= needed && positives > negatives) score = 1;
  else if (present.length > 0 && negatives >= needed && negatives > positives) score = -1;

  /*
   * Ohne genug vorhandene Werte kann die Mehrheitsregel gar nicht greifen.
   * Der Faktor faellt dann zwar rechnerisch auf 0, ist aber nicht "neutral"
   * im Sinne einer Marktaussage, sondern schlicht unbestimmt. Diese
   * Unterscheidung muss bis in die Anzeige durchschlagen — sonst liest sich
   * eine Datenluecke wie ein Befund.
   */
  const determinable = mode === 'strict' ? present.length >= minCount : present.length > 0;

  // Im reduzierten Modus bezieht sich die Mehrheit auf die vorhandenen
  // Werte, nicht auf alle drei — der Klartext muss das widerspiegeln.
  const basis = mode === 'strict' ? members.length : present.length;

  let rationale: string;
  if (!determinable) {
    rationale =
      missing === members.length
        ? `kein Wert verfuegbar — nicht bestimmbar`
        : `${missing} von ${members.length} ohne Wert — nicht bestimmbar`;
  } else if (score === 1) {
    rationale = `${positives} von ${basis} positiv`;
  } else if (score === -1) {
    rationale = `${negatives} von ${basis} negativ`;
  } else if (neutrals === basis) {
    rationale = `alle ${basis} neutral`;
  } else if (missing > 0 && mode === 'strict') {
    rationale = `${positives} positiv, ${negatives} negativ, ${missing} ohne Wert — keine Mehrheit`;
  } else {
    rationale = `${positives} positiv, ${negatives} negativ — keine Mehrheit`;
  }

  return {
    id: factorId,
    label,
    score,
    positives,
    negatives,
    neutrals,
    missing,
    determinable,
    rationale,
    indicators: members.map((m) => m.id),
  };
}

/** Gesamtscore -> Regime und Soll-Cash-Band. */
export function resolveRegime(rules: RuleBook, total: number): Regime {
  const band = rules.regimeBands.find((b) => total >= b.min && total <= b.max);
  if (!band) {
    throw new Error(
      `Regelwerk ${rules.version} deckt Gesamtscore ${total} nicht ab. ` +
        `Vorhandene Baender: ${rules.regimeBands.map((b) => `${b.min}..${b.max}`).join(', ')}`,
    );
  }
  return { label: band.label, cashBand: band.cashBand, assumed: band.assumed };
}

/** Das komplette Scoring einer Woche. */
export function computeScoring(
  rules: RuleBook,
  inputs: Record<IndicatorId, IndicatorInput>,
  mode: AggregationMode = 'strict',
): ScoringResult {
  const indicators = {} as Record<IndicatorId, ScoredIndicator>;
  for (const id of INDICATOR_IDS) {
    const rule = rules.indicators[id];
    if (!rule) throw new Error(`Regelwerk ${rules.version} kennt den Indikator ${id} nicht`);
    const input = inputs[id] ?? { measureValue: null };
    indicators[id] = scoreIndicator(id, rule, input);
  }

  const factors = {} as Record<FactorId, ScoredFactor>;
  for (const f of [...rules.factors].sort((a, b) => a.ordinal - b.ordinal)) {
    const members = INDICATOR_IDS.filter((id) => rules.indicators[id].factor === f.id)
      .map((id) => indicators[id])
      .sort((a, b) => rules.indicators[a.id].ordinal - rules.indicators[b.id].ordinal);
    factors[f.id] = aggregateFactor(f.id, f.label, members, rules.factorAggregation.minCount, mode);
  }

  const total = Object.values(factors).reduce((sum, f) => sum + f.score, 0);
  const missing = INDICATOR_IDS.filter((id) => indicators[id].quality === 'missing');
  const degraded = INDICATOR_IDS.some((id) =>
    ['missing', 'stale'].includes(indicators[id].quality),
  );
  const undeterminableFactors = (Object.keys(factors) as FactorId[]).filter(
    (id) => !factors[id].determinable,
  );

  return {
    rulesVersion: rules.version,
    indicators,
    factors,
    total,
    regime: resolveRegime(rules, total),
    degraded,
    missing,
    undeterminableFactors,
    meaningful: undeterminableFactors.length === 0,
  };
}

/**
 * Grenzfall-Analyse: welcher einzelne Indikator-Wechsel kippt das Regime?
 *
 * Wird fuer jeden Indikator durchgespielt, indem sein Score auf den Wert
 * jenseits der naechsten Schwelle gesetzt und das Scoring neu aggregiert wird.
 */
export interface RegimeSensitivity {
  indicator: IndicatorId;
  label: string;
  /** Abstand zur Kippschwelle in der Einheit des Indikators. */
  gap: number;
  /** Abstand in Anzeigeschritten — zwischen Indikatoren vergleichbar. */
  gapTicks: number;
  /** Abstand in Standardabweichungen der Wochenveraenderung, falls Historie vorliegt. */
  gapSigma: number | null;
  /** Das tatsaechlich zur Rangfolge benutzte Mass: Sigma wenn vorhanden, sonst Ticks. */
  closeness: number;
  closenessBasis: 'sigma' | 'ticks';
  unit: string;
  boundary: number;
  direction: 'up' | 'down';
  fromScore: Score;
  toScore: Score;
  /** Gesamtscore, wenn dieser eine Indikator kippt. */
  resultingTotal: number;
  resultingRegime: string;
  /** Aendert sich dadurch das Regime? */
  changesRegime: boolean;
}

export function analyzeSensitivity(
  rules: RuleBook,
  result: ScoringResult,
): RegimeSensitivity[] {
  const out: RegimeSensitivity[] = [];

  for (const id of INDICATOR_IDS) {
    const ind = result.indicators[id];
    const flip = ind.nearestFlip;
    if (!flip) continue;

    // Faktoren mit dem hypothetisch gekippten Score neu aggregieren.
    const factorId = ind.factor;
    const members = result.factors[factorId].indicators.map((mid) =>
      mid === id ? { ...result.indicators[mid], score: flip.toScore } : result.indicators[mid],
    );
    const hypothetical = aggregateFactor(
      factorId,
      result.factors[factorId].label,
      members,
      rules.factorAggregation.minCount,
    );

    const total = Object.values(result.factors).reduce(
      (sum, f) => sum + (f.id === factorId ? hypothetical.score : f.score),
      0,
    );
    const regime = resolveRegime(rules, total);

    out.push({
      indicator: id,
      label: ind.label,
      gap: flip.gap,
      gapTicks: flip.gapTicks,
      gapSigma: flip.gapSigma,
      closeness: flipCloseness(flip),
      closenessBasis: flip.gapSigma === null ? 'ticks' : 'sigma',
      unit: ind.unit,
      boundary: flip.boundary,
      direction: flip.direction,
      fromScore: ind.score,
      toScore: flip.toScore,
      resultingTotal: total,
      resultingRegime: regime.label,
      changesRegime: regime.label !== result.regime.label,
    });
  }

  // Die wackligsten Punkte zuerst: erst was das Regime kippt, dann nach
  // vergleichbarem Abstand. Roher Abstand taugt hier nicht als Kriterium,
  // weil er in neun verschiedenen Einheiten gemessen wird.
  return out.sort((a, b) => {
    if (a.changesRegime !== b.changesRegime) return a.changesRegime ? -1 : 1;
    return a.closeness - b.closeness;
  });
}
