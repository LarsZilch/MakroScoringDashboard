/** Deutsche Zahlenformate fuer die Anzeigezeilen der Snapshots. */

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

/** Mit ausdruecklichem Vorzeichen, inklusive echtem Minuszeichen. */
export function signed(value: number, decimals = 1): string {
  const s = num(Math.abs(value), decimals);
  if (value > 0) return `+${s}`;
  if (value < 0) return `−${s}`; // U+2212 MINUS SIGN, nicht Bindestrich
  return `±${s}`;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function monthName(isoDate: string): string {
  const m = Number(isoDate.slice(5, 7));
  return MONTH_NAMES[m - 1] ?? isoDate;
}

export function shortDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
}

/** Richtungswort fuer Veraenderungen, mit Rauschband. */
export function trendWord(
  delta: number,
  noise: number,
  words: { up: string; down: string; flat: string },
): string {
  if (delta > noise) return words.up;
  if (delta < -noise) return words.down;
  return words.flat;
}
