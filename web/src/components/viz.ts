/**
 * Diagramm-Parameter.
 *
 * Die Farben sind nicht nach Gefuehl gewaehlt, sondern mit dem Validator der
 * dataviz-Vorgaben geprueft (OKLab-Abstaende unter simulierter Farbenblindheit).
 *
 * Insbesondere die naheliegende Ampel Gruen/Gelb/Rot fuer die Regime ist
 * durchgefallen: Rot gegen Gruen liegt bei Deuteranopie bei einem Abstand von
 * 4,1 — in einer Heatmap mit angrenzenden Zellen nicht unterscheidbar. Die
 * Regime sind ohnehin GEORDNET (Risk On … Defensiv), gehoeren also auf eine
 * divergierende Skala mit neutraler Mitte. Die farbigen Arme dieser Skala
 * bestehen alle Pruefungen (schlechtestes Paar: 21,5 deutan / 22,6 normal).
 *
 * Zwei Farben liegen unter 3:1 Kontrast zur weissen Flaeche. Dafuer gilt die
 * Relief-Regel: jede Heatmap-Zelle traegt ihre Zahl, jedes Faktor-Diagramm
 * seine Beschriftung. Farbe traegt die Bedeutung nie allein.
 */

export const REGIME_COLOR: Record<string, string> = {
  'Risk On': '#2a78d6',
  Neutral: '#cfcec7',
  'Risk Off': '#e8845f',
  Defensiv: '#b02525',
};

/** Reihenfolge von guenstig nach unguenstig — die Achse der Skala. */
export const REGIME_SCALE = ['Risk On', 'Neutral', 'Risk Off', 'Defensiv'];

/** Kategoriale Steckplaetze in fester Reihenfolge, nie zyklisch vergeben. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];

export const INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#ffffff',
};

/** Wochen ohne belastbare Datenlage werden schraffiert statt eingefaerbt. */
export const SPARSE_FILL = 'url(#sparse-hatch)';

export interface Scale {
  (value: number): number;
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Pfad fuer eine Stufenlinie — richtig fuer Wochenwerte, die bis zur naechsten Woche gelten. */
export function stepPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i]!.x} ${points[i - 1]!.y}`);
    parts.push(`L ${points[i]!.x} ${points[i]!.y}`);
  }
  return parts.join(' ');
}

export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}
