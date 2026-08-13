/**
 * Ableitungen auf Zeitreihen: 3m-Change, 3m-annualisierte Rate, 4-Wochen-Mittel.
 *
 * Alle Funktionen arbeiten auf aufsteigend sortierten Reihen und geben null
 * zurueck, wenn die Datenlage nicht reicht. Ein fehlender Wert ist ein normaler
 * Betriebszustand (Quelle nicht erreichbar, Reihe beginnt spaeter) und darf
 * nicht als Ausnahme durchschlagen.
 */

export interface Obs {
  date: string; // YYYY-MM-DD
  value: number;
}

export type Series = Obs[];

/** Reihe aufsteigend sortieren und nicht-numerische Punkte entfernen. */
export function normalizeSeries(raw: { date: string; value: number | null }[]): Series {
  return raw
    .filter((o): o is Obs => o.value !== null && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Letzte Beobachtung am Stichtag oder davor.
 *
 * Das ist die zentrale Verknuepfungsregel der Pipeline: die neun Indikatoren
 * haben unterschiedliche Frequenzen (taeglich, woechentlich, monatlich) und
 * unterschiedliche Veroeffentlichungsverzoegerungen. Ein naiver Join auf
 * gleiches Datum wuerde die meisten Wochen leer lassen.
 */
export function lastOnOrBefore(series: Series, asOf: string): Obs | null {
  let found: Obs | null = null;
  for (const o of series) {
    if (o.date <= asOf) found = o;
    else break;
  }
  return found;
}

/** Datum um `months` Kalendermonate zurueckschieben (UTC, mit Monatsende-Kappung). */
export function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const targetMonth = d.getUTCMonth() - months;
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  // Tag kappen, damit z. B. 31.03. minus 1 Monat nicht auf den 03.03. springt.
  const daysInTarget = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(d.getUTCDate(), daysInTarget));
  return shifted.toISOString().slice(0, 10);
}

/** Datum um `days` Tage zurueckschieben. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface ChangeResult {
  current: number;
  previous: number;
  change: number;
  currentDate: string;
  previousDate: string;
}

/**
 * Veraenderung gegenueber dem Stand vor `months` Kalendermonaten.
 * Fuer den ISM heisst das: Juli gegen April - genau wie in der Vorlage.
 */
export function changeOverMonths(
  series: Series,
  asOf: string,
  months = 3,
): ChangeResult | null {
  const cur = lastOnOrBefore(series, asOf);
  if (!cur) return null;
  const prev = lastOnOrBefore(series, monthsBefore(cur.date, months));
  if (!prev || prev.date === cur.date) return null;
  return {
    current: cur.value,
    previous: prev.value,
    change: cur.value - prev.value,
    currentDate: cur.date,
    previousDate: prev.date,
  };
}

/**
 * Auf ein Jahr hochgerechnete Wachstumsrate ueber `months` Monate, in Prozent.
 * Nur fuer Reihen sinnvoll, die ein Niveau in einer positiven Einheit messen
 * (Bilanzsummen, Liquiditaetsaggregate) - nicht fuer Indizes um null.
 */
export function annualizedRateOverMonths(
  series: Series,
  asOf: string,
  months = 3,
): number | null {
  const c = changeOverMonths(series, asOf, months);
  if (!c) return null;
  if (c.previous <= 0 || c.current <= 0) return null;
  const periodsPerYear = 12 / months;
  return (Math.pow(c.current / c.previous, periodsPerYear) - 1) * 100;
}

/**
 * Richtungsmass fuer eine Rate: wie hat sich die 3m-annualisierte Rate
 * gegenueber ihrem Stand vor `lookbackMonths` Monaten veraendert (in
 * Prozentpunkten). Positiv = Impuls nimmt zu.
 *
 * Genau diese Groesse steht in der Vorlage hinter "5,1 % 3m ann. · fallend":
 * bewertet wird nicht das Niveau, sondern seine Richtung.
 */
export function rateDirection(
  series: Series,
  asOf: string,
  months = 3,
  lookbackMonths = 1,
): { rateNow: number; ratePrev: number; delta: number } | null {
  const rateNow = annualizedRateOverMonths(series, asOf, months);
  const ratePrev = annualizedRateOverMonths(series, monthsBefore(asOf, lookbackMonths), months);
  if (rateNow === null || ratePrev === null) return null;
  return { rateNow, ratePrev, delta: rateNow - ratePrev };
}

/** Mittelwert der Beobachtungen im Fenster von `weeks` Wochen bis zum Stichtag. */
export function trailingAverage(
  series: Series,
  asOf: string,
  weeks = 4,
): { avg: number; count: number } | null {
  const cur = lastOnOrBefore(series, asOf);
  if (!cur) return null;
  const from = daysBefore(cur.date, weeks * 7 - 1);
  const window = series.filter((o) => o.date >= from && o.date <= cur.date);
  if (window.length === 0) return null;
  const sum = window.reduce((acc, o) => acc + o.value, 0);
  return { avg: sum / window.length, count: window.length };
}

/**
 * Differenz zweier Reihen an einem Stichtag, jeweils mit dem letzten
 * verfuegbaren Wert. Verwendet fuer SOFR - IORB.
 */
export function spreadAt(
  a: Series,
  b: Series,
  asOf: string,
): { value: number; aDate: string; bDate: string; aValue: number; bValue: number } | null {
  const oa = lastOnOrBefore(a, asOf);
  const ob = lastOnOrBefore(b, asOf);
  if (!oa || !ob) return null;
  return {
    value: oa.value - ob.value,
    aDate: oa.date,
    bDate: ob.date,
    aValue: oa.value,
    bValue: ob.value,
  };
}

/**
 * Punktweise Kombination mehrerer Reihen mit unterschiedlicher Frequenz.
 * Fuer jedes Datum der Leitreihe wird aus jeder weiteren Reihe der letzte
 * Wert am Tag oder davor genommen.
 *
 * Gebraucht fuer Fed Net Liquidity: WALCL und WTREGEN sind woechentlich,
 * RRPONTSYD ist taeglich.
 */
export function combineSeries(
  leader: Series,
  others: Series[],
  fn: (leaderValue: number, otherValues: number[]) => number,
): Series {
  const out: Series = [];
  for (const o of leader) {
    const vals: number[] = [];
    let complete = true;
    for (const s of others) {
      const m = lastOnOrBefore(s, o.date);
      if (!m) {
        complete = false;
        break;
      }
      vals.push(m.value);
    }
    if (complete) out.push({ date: o.date, value: fn(o.value, vals) });
  }
  return out;
}
