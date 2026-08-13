/**
 * Regelwerk einlesen und pruefen.
 *
 * Bewusst streng: ein Tippfehler in rules/*.json soll sofort und laut
 * scheitern. Die stille Alternative waere, dass ein Indikator dauerhaft
 * neutral bewertet wird und niemand es merkt.
 */

import type { Band, Calibration, FactorId, IndicatorRule, RuleBook, Score } from './types.js';
import { INDICATOR_IDS } from './types.js';

function fail(path: string, msg: string): never {
  throw new Error(`Regelwerk ungueltig bei ${path}: ${msg}`);
}

function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'Objekt erwartet');
  return v as Record<string, unknown>;
}

function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, `endliche Zahl erwartet, war ${JSON.stringify(v)}`);
  return v;
}

function asString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, 'nicht-leere Zeichenkette erwartet');
  return v;
}

function asScore(v: unknown, path: string): Score {
  if (v !== -1 && v !== 0 && v !== 1) fail(path, `score muss -1, 0 oder 1 sein, war ${JSON.stringify(v)}`);
  return v;
}

function parseBands(v: unknown, path: string): Band[] {
  if (!Array.isArray(v) || v.length === 0) fail(path, 'nicht-leeres Array erwartet');
  const bands = v.map((raw, i) => {
    const o = asRecord(raw, `${path}[${i}]`);
    const band: Band = { score: asScore(o.score, `${path}[${i}].score`) };
    for (const op of ['lt', 'lte', 'gt', 'gte'] as const) {
      if (o[op] !== undefined) band[op] = asNumber(o[op], `${path}[${i}].${op}`);
    }
    if (typeof o.note === 'string') band.note = o.note;
    return band;
  });

  // Das letzte Band muss der Auffangfall sein, sonst gibt es Werte ohne Bewertung.
  const last = bands[bands.length - 1]!;
  if (last.lt !== undefined || last.lte !== undefined || last.gt !== undefined || last.gte !== undefined) {
    fail(path, 'das letzte Band muss der Auffangfall ohne Vergleichsoperator sein');
  }
  return bands;
}

/**
 * Kalibrierungs-Beleg pruefen.
 *
 * Bewusst streng: dieser Block ist der Nachweis, dass eine Schwelle gemessen
 * und nicht gegriffen wurde. Ein halb ausgefuellter Beleg waere schlimmer als
 * gar keiner — er erweckte den Anschein einer Pruefung, die nicht stattfand.
 */
function parseCalibration(v: unknown, path: string): Calibration {
  const o = asRecord(v, path);
  const observedRaw = asRecord(o.observed, `${path}.observed`);
  const observed: Record<string, number> = {};
  for (const [key, value] of Object.entries(observedRaw)) {
    observed[key] = asNumber(value, `${path}.observed.${key}`);
  }
  if (Object.keys(observed).length === 0) {
    fail(`${path}.observed`, 'mindestens eine gemessene Groesse erwartet');
  }
  return {
    basis: asString(o.basis, `${path}.basis`),
    measuredOn: asString(o.measuredOn, `${path}.measuredOn`),
    observed,
    chosenThreshold: asNumber(o.chosenThreshold, `${path}.chosenThreshold`),
    resultingSplit: asString(o.resultingSplit, `${path}.resultingSplit`),
    warning: asString(o.warning, `${path}.warning`),
  };
}

export function parseRuleBook(raw: unknown): RuleBook {
  const r = asRecord(raw, 'root');
  const version = asString(r.version, 'version');
  const title = asString(r.title, 'title');

  // Faktoren
  const KNOWN_FACTORS: readonly FactorId[] = ['business_cycle', 'liquidity', 'sentiment'];
  const asFactorId = (v: unknown, path: string): FactorId => {
    const s = asString(v, path);
    const hit = KNOWN_FACTORS.find((f) => f === s);
    if (!hit) fail(path, `unbekannter Faktor "${s}", erlaubt sind ${KNOWN_FACTORS.join(', ')}`);
    return hit;
  };

  if (!Array.isArray(r.factors) || r.factors.length === 0) fail('factors', 'nicht-leeres Array erwartet');
  const factors = r.factors.map((f, i) => {
    const o = asRecord(f, `factors[${i}]`);
    return {
      id: asFactorId(o.id, `factors[${i}].id`),
      label: asString(o.label, `factors[${i}].label`),
      ordinal: asNumber(o.ordinal, `factors[${i}].ordinal`),
    };
  });
  const factorIds = new Set(factors.map((f) => f.id));

  // Indikatoren: genau die neun der Whitelist, keiner mehr, keiner weniger.
  const indRaw = asRecord(r.indicators, 'indicators');
  const extra = Object.keys(indRaw).filter((k) => !INDICATOR_IDS.includes(k as never));
  if (extra.length > 0) fail('indicators', `unbekannte Indikatoren: ${extra.join(', ')}`);

  const indicators = {} as RuleBook['indicators'];
  for (const id of INDICATOR_IDS) {
    const path = `indicators.${id}`;
    if (indRaw[id] === undefined) fail(path, 'fehlt');
    const o = asRecord(indRaw[id], path);
    const factor = asFactorId(o.factor, `${path}.factor`);
    if (!factorIds.has(factor)) fail(`${path}.factor`, `Faktor ${factor} ist oben nicht deklariert`);

    const rule: IndicatorRule = {
      ordinal: asNumber(o.ordinal, `${path}.ordinal`),
      factor,
      label: asString(o.label, `${path}.label`),
      measure: asString(o.measure, `${path}.measure`),
      unit: typeof o.unit === 'string' ? o.unit : '',
      decimals: asNumber(o.decimals, `${path}.decimals`),
      bands: parseBands(o.bands, `${path}.bands`),
    };
    if (typeof o.proxyLabel === 'string') rule.proxyLabel = o.proxyLabel;
    if (typeof o.proxyNote === 'string') rule.proxyNote = o.proxyNote;
    if (typeof o.assumptionNote === 'string') rule.assumptionNote = o.assumptionNote;
    if (typeof o.assumed === 'boolean') rule.assumed = o.assumed;
    if (typeof o.contrarian === 'boolean') rule.contrarian = o.contrarian;
    if (typeof o.invertedScale === 'boolean') rule.invertedScale = o.invertedScale;
    if (typeof o.quality === 'string') rule.quality = o.quality as IndicatorRule['quality'];
    if (Array.isArray(o.corridor) && o.corridor.length === 2) {
      rule.corridor = [asNumber(o.corridor[0], `${path}.corridor[0]`), asNumber(o.corridor[1], `${path}.corridor[1]`)];
    }
    if (o.calibration !== undefined) {
      rule.calibration = parseCalibration(o.calibration, `${path}.calibration`);
    }
    indicators[id] = rule;
  }

  // Jeder Faktor braucht genau drei Indikatoren - darauf beruht die Mehrheitsregel.
  for (const f of factors) {
    const n = INDICATOR_IDS.filter((id) => indicators[id].factor === f.id).length;
    if (n !== 3) fail(`factors.${f.id}`, `${n} Indikatoren zugeordnet, erwartet werden 3`);
  }

  // Aggregation
  const agg = asRecord(r.factorAggregation, 'factorAggregation');
  if (agg.rule !== 'majority') fail('factorAggregation.rule', 'derzeit nur "majority" unterstuetzt');
  const minCount = asNumber(agg.minCount, 'factorAggregation.minCount');
  if (minCount < 2 || minCount > 3) fail('factorAggregation.minCount', 'muss 2 oder 3 sein');

  // Regime-Baender: muessen -3..+3 lueckenlos und ueberschneidungsfrei abdecken.
  if (!Array.isArray(r.regimeBands) || r.regimeBands.length === 0) {
    fail('regimeBands', 'nicht-leeres Array erwartet');
  }
  const regimeBands = r.regimeBands.map((b, i) => {
    const o = asRecord(b, `regimeBands[${i}]`);
    const min = asNumber(o.min, `regimeBands[${i}].min`);
    const max = asNumber(o.max, `regimeBands[${i}].max`);
    if (min > max) fail(`regimeBands[${i}]`, `min ${min} groesser als max ${max}`);
    const cash = o.cashBand;
    if (!Array.isArray(cash) || cash.length !== 2) fail(`regimeBands[${i}].cashBand`, 'Paar [von, bis] erwartet');
    return {
      min,
      max,
      label: asString(o.label, `regimeBands[${i}].label`),
      cashBand: [asNumber(cash[0], `regimeBands[${i}].cashBand[0]`), asNumber(cash[1], `regimeBands[${i}].cashBand[1]`)] as [number, number],
      assumed: typeof o.assumed === 'boolean' ? o.assumed : undefined,
      note: typeof o.note === 'string' ? o.note : undefined,
    };
  });

  for (let total = -3; total <= 3; total++) {
    const hits = regimeBands.filter((b) => total >= b.min && total <= b.max);
    if (hits.length === 0) fail('regimeBands', `Gesamtscore ${total} ist von keinem Band abgedeckt`);
    if (hits.length > 1) {
      fail('regimeBands', `Gesamtscore ${total} ist mehrfach abgedeckt: ${hits.map((h) => h.label).join(', ')}`);
    }
  }

  return {
    version,
    title,
    derivedFrom: typeof r.derivedFrom === 'string' ? r.derivedFrom : undefined,
    note: typeof r.note === 'string' ? r.note : undefined,
    factors,
    indicators,
    factorAggregation: { rule: 'majority', minCount, note: typeof agg.note === 'string' ? agg.note : undefined },
    regimeBands,
  };
}

/** Alle Stellen, an denen das Regelwerk auf einer gesetzten Annahme beruht. */
export function listAssumptions(rules: RuleBook): { scope: string; note: string }[] {
  const out: { scope: string; note: string }[] = [];
  for (const id of INDICATOR_IDS) {
    const r = rules.indicators[id];
    if (r.assumed) out.push({ scope: r.label, note: r.assumptionNote ?? 'ohne Begruendung markiert' });
  }
  for (const b of rules.regimeBands) {
    if (b.assumed) out.push({ scope: `Regime ${b.label} (${b.min}..${b.max})`, note: b.note ?? 'ohne Begruendung markiert' });
  }
  return out;
}
