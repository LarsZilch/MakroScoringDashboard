/**
 * ISO-8601-Wochenrechnung, durchgehend in UTC.
 *
 * Die gesamte App ist auf Kalenderwochen aufgebaut: ein Snapshot je ISO-Woche.
 * ISO-Wochen sind der einzige Wochenbegriff, bei dem der Jahreswechsel
 * eindeutig ist - und es gibt Jahre mit 53 Wochen (z. B. 2020, 2026).
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface IsoWeek {
  isoYear: number;
  isoWeek: number;
}

/** Datum -> UTC-Millisekunden auf Tagesgenauigkeit. */
function toUtcDay(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`Ungueltiges Datum: ${String(date)}`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Montag = 0 ... Sonntag = 6 */
function isoDayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** Der Donnerstag der Woche bestimmt, zu welchem ISO-Jahr die Woche gehoert. */
function thursdayOfWeek(ms: number): number {
  return ms + (3 - isoDayIndex(ms)) * DAY;
}

export function isoWeekOf(date: Date | string): IsoWeek {
  const thu = thursdayOfWeek(toUtcDay(date));
  const isoYear = new Date(thu).getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const week1Thursday = thursdayOfWeek(jan4);
  const isoWeek = 1 + Math.round((thu - week1Thursday) / WEEK);
  return { isoYear, isoWeek };
}

/** Anzahl der ISO-Wochen eines Jahres: 52 oder 53. */
export function weeksInIsoYear(isoYear: number): number {
  // Der 28. Dezember liegt per Definition immer in der letzten ISO-Woche.
  return isoWeekOf(new Date(Date.UTC(isoYear, 11, 28))).isoWeek;
}

/** Montag der angegebenen ISO-Woche, als UTC-Datum. */
export function isoWeekStart({ isoYear, isoWeek }: IsoWeek): Date {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const week1Monday = jan4 - isoDayIndex(jan4) * DAY;
  return new Date(week1Monday + (isoWeek - 1) * WEEK);
}

/** Sonntag der angegebenen ISO-Woche. */
export function isoWeekEnd(w: IsoWeek): Date {
  return new Date(isoWeekStart(w).getTime() + 6 * DAY);
}

/** Sortier- und dateisichere Kennung, z. B. "2026-W32". */
export function isoWeekKey({ isoYear, isoWeek }: IsoWeek): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

export function parseIsoWeekKey(key: string): IsoWeek {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(key.trim());
  if (!m) throw new Error(`Ungueltiger Wochenschluessel: ${key} (erwartet z. B. 2026-W32)`);
  const isoYear = Number(m[1]);
  const isoWeek = Number(m[2]);
  const max = weeksInIsoYear(isoYear);
  if (isoWeek < 1 || isoWeek > max) {
    throw new Error(`${key}: ${isoYear} hat ${max} ISO-Wochen`);
  }
  return { isoYear, isoWeek };
}

export function previousIsoWeek(w: IsoWeek): IsoWeek {
  if (w.isoWeek > 1) return { isoYear: w.isoYear, isoWeek: w.isoWeek - 1 };
  const prevYear = w.isoYear - 1;
  return { isoYear: prevYear, isoWeek: weeksInIsoYear(prevYear) };
}

export function nextIsoWeek(w: IsoWeek): IsoWeek {
  if (w.isoWeek < weeksInIsoYear(w.isoYear)) {
    return { isoYear: w.isoYear, isoWeek: w.isoWeek + 1 };
  }
  return { isoYear: w.isoYear + 1, isoWeek: 1 };
}

/**
 * Dieselbe Kalenderwoche im Vorjahr.
 * KW 53 gibt es nicht in jedem Jahr - dann wird auf die letzte Woche gekappt.
 */
export function sameWeekPreviousYear(w: IsoWeek): IsoWeek {
  const prevYear = w.isoYear - 1;
  return { isoYear: prevYear, isoWeek: Math.min(w.isoWeek, weeksInIsoYear(prevYear)) };
}

/** Fortlaufende Wochenliste von `from` bis einschliesslich `to`. */
export function isoWeekRange(from: IsoWeek, to: IsoWeek): IsoWeek[] {
  const out: IsoWeek[] = [];
  let cur = from;
  // Obergrenze als Schutz gegen vertauschte Argumente.
  for (let guard = 0; guard < 10_000; guard++) {
    out.push(cur);
    if (cur.isoYear === to.isoYear && cur.isoWeek === to.isoWeek) return out;
    if (cur.isoYear > to.isoYear || (cur.isoYear === to.isoYear && cur.isoWeek > to.isoWeek)) {
      throw new Error(`Wochenbereich laeuft rueckwaerts: ${isoWeekKey(from)} .. ${isoWeekKey(to)}`);
    }
    cur = nextIsoWeek(cur);
  }
  throw new Error('Wochenbereich unplausibel lang');
}

/** ISO-Datum (YYYY-MM-DD) in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
