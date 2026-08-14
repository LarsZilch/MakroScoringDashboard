/**
 * Zoom-Fenster ueber eine Wochenreihe.
 *
 * Der Kniff: die Diagramme skalieren ohnehin auf das, was sie bekommen. Ein
 * Zoom ist deshalb kein Eingriff in die Zeichenlogik, sondern ein slice() auf
 * die Datenreihe DAVOR. Das haelt ScoreChart, FactorCharts und AssetOverlay
 * unveraendert und macht das Verhalten hier vollstaendig testbar, ohne DOM.
 *
 * Alle Funktionen sind rein: Fenster rein, Fenster raus. Keine Seiteneffekte.
 */

export interface WeekWindow {
  /** Erster sichtbarer Index, einschliesslich. */
  start: number;
  /** Erster nicht mehr sichtbarer Index (wie bei slice). */
  end: number;
}

/**
 * Weniger als acht Wochen ergeben keine lesbare Stufenlinie mehr — dann ist
 * die Tabelle das bessere Werkzeug. Die Grenze verhindert ausserdem, dass ein
 * beherztes Mausrad das Fenster auf null zieht.
 */
export const MIN_WEEKS = 8;

/** Fenster in gueltige Grenzen zwingen, ohne seine Breite unnoetig zu aendern. */
export function clampWindow(w: WeekWindow, total: number): WeekWindow {
  if (total <= MIN_WEEKS) return { start: 0, end: total };

  let width = Math.round(w.end - w.start);
  width = Math.max(MIN_WEEKS, Math.min(total, width));

  let start = Math.round(w.start);
  // Zuerst nach rechts begrenzen, dann nach links — sonst kann ein Fenster,
  // das ueber das Ende hinausragt, mit negativem Start herauskommen.
  start = Math.min(start, total - width);
  start = Math.max(0, start);

  return { start, end: start + width };
}

export function windowWidth(w: WeekWindow): number {
  return w.end - w.start;
}

export function isFullRange(w: WeekWindow, total: number): boolean {
  return w.start <= 0 && w.end >= total;
}

export function fullWindow(total: number): WeekWindow {
  return { start: 0, end: total };
}

/**
 * Zoomen mit festem Ankerpunkt.
 *
 * `anchor` ist die relative Position im SICHTBAREN Fenster (0 = linke Kante,
 * 1 = rechte Kante). Die Woche unter dem Mauszeiger bleibt damit unter dem
 * Mauszeiger — ohne das fuehlt sich Radzoom an, als rutschte einem der Chart
 * unter den Fingern weg.
 *
 * `factor` < 1 zoomt hinein, > 1 heraus.
 */
export function zoomWindow(
  w: WeekWindow,
  total: number,
  factor: number,
  anchor: number,
): WeekWindow {
  const width = windowWidth(w);
  const anchorClamped = Math.max(0, Math.min(1, anchor));
  // Absolute Position des Ankers in Indexeinheiten.
  const anchorIndex = w.start + width * anchorClamped;

  const newWidth = Math.max(MIN_WEEKS, Math.min(total, width * factor));
  const newStart = anchorIndex - newWidth * anchorClamped;

  return clampWindow({ start: newStart, end: newStart + newWidth }, total);
}

/** Fenster um `deltaWeeks` verschieben; Breite bleibt erhalten. */
export function panWindow(w: WeekWindow, total: number, deltaWeeks: number): WeekWindow {
  const width = windowWidth(w);
  const start = w.start + deltaWeeks;
  return clampWindow({ start, end: start + width }, total);
}

/** Fenster so verschieben, dass `index` in der Mitte liegt. */
export function centerWindow(w: WeekWindow, total: number, index: number): WeekWindow {
  const width = windowWidth(w);
  const start = index - width / 2;
  return clampWindow({ start, end: start + width }, total);
}

/**
 * Kurskurven auf den sichtbaren Fensterbeginn neu indexieren.
 *
 * Ohne das behielte die y-Achse ihre 100er-Linie an einem Punkt, der nach dem
 * Zoomen gar nicht mehr im Bild ist — die Prozentangaben im Tooltip waeren
 * dann auf einen unsichtbaren Bezugspunkt bezogen und damit irrefuehrend.
 */
export function reindexPoints(
  points: { weekKey: string; value: number }[],
  visibleWeekKeys: Set<string>,
): { weekKey: string; value: number }[] {
  const visible = points.filter((p) => visibleWeekKeys.has(p.weekKey));
  const base = visible[0]?.value;
  if (!base || base <= 0) return visible;
  return visible.map((p) => ({ weekKey: p.weekKey, value: (p.value / base) * 100 }));
}
