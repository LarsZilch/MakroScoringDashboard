/** Anzeigeformate, deutsch. Spiegelt src/pipeline/format.ts. */

import { isoDate, isoWeekEnd, isoWeekStart, parseIsoWeekKey } from '../../src/core/isoweek.js';

export function num(value: number, decimals = 1): string {
  return value
    .toLocaleString('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    // toLocaleString liefert einen Bindestrich; im Satz gehoert das echte
    // Minuszeichen hin - sonst mischen sich in einer Spalte zwei Zeichen.
    .replace('-', '−');
}

export function signed(value: number, decimals = 1): string {
  const s = num(Math.abs(value), decimals);
  if (value > 0) return `+${s}`;
  if (value < 0) return `−${s}`;
  return `±${s}`;
}

/** Score als Badge-Text: +1 / 0 / −1 */
export function scoreText(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `−${Math.abs(score)}`;
  return '0';
}

export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export function weekLabel(weekKey: string): string {
  const [year, week] = weekKey.split('-W');
  return `KW ${Number(week)}/${year}`;
}

/** Montag–Sonntag der Kalenderwoche als Datum, z. B. "02.02.–08.02.2026". */
export function weekDateRange(weekKey: string): string {
  const w = parseIsoWeekKey(weekKey);
  const start = isoDate(isoWeekStart(w));
  const end = isoDate(isoWeekEnd(w));
  const startText = shortDate(start).slice(0, 6); // "TT.MM."
  return `${startText}–${shortDate(end)}`;
}

/** Wochenlabel mit Datum, fuer Tooltips beim Vergleichen ueber Charts hinweg. */
export function weekLabelWithDate(weekKey: string): string {
  return `${weekLabel(weekKey)} · ${weekDateRange(weekKey)}`;
}

export const REGIME_ORDER = ['Risk On', 'Neutral', 'Risk Off', 'Defensiv'];

export function regimeClass(label: string): string {
  switch (label) {
    case 'Risk On':
      return 'regime-on';
    case 'Neutral':
      return 'regime-neutral';
    case 'Risk Off':
      return 'regime-off';
    default:
      return 'regime-def';
  }
}
