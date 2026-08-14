/**
 * Mausrad-Zoom und Ziehen zum Verschieben fuer die Wochendiagramme.
 *
 * Zwei Dinge, die man leicht falsch macht und die hier bewusst geloest sind:
 *
 * 1. React haengt wheel-Ereignisse passiv ein — ein onWheel-Handler kann also
 *    preventDefault() nicht wirksam aufrufen, und die Seite scrollt beim
 *    Zoomen mit weg. Deshalb wird der Listener nativ und ausdruecklich mit
 *    { passive: false } registriert.
 *
 * 2. Der Anker beim Zoomen ist die Mausposition INNERHALB der Zeichenflaeche,
 *    nicht innerhalb des DOM-Elements: das SVG hat seitliche Raender fuer die
 *    Achsenbeschriftung. Ohne diese Umrechnung wandert der Chart beim Zoomen
 *    langsam zur Seite.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampWindow,
  fullWindow,
  isFullRange,
  panWindow,
  windowWidth,
  zoomWindow,
  type WeekWindow,
} from './windowMath';
import { CHART_W, MARGIN } from './chartGeometry';

/** Anteil der SVG-Breite, den die Zeichenflaeche einnimmt (ohne Raender). */
const PLOT_LEFT = MARGIN.left / CHART_W;
const PLOT_RIGHT = (CHART_W - MARGIN.right) / CHART_W;

export interface ZoomPan {
  window: WeekWindow;
  /** Auf das jeweilige Diagramm-Behaeltnis setzen. */
  ref: (node: HTMLDivElement | null) => void;
  isFull: boolean;
  reset: () => void;
  zoomBy: (factor: number) => void;
  panBy: (weeks: number) => void;
  setWindow: (w: WeekWindow) => void;
  /** true, solange gezogen wird — fuer den Mauszeiger. */
  dragging: boolean;
}

export function useZoomPan(total: number): ZoomPan {
  /*
   * Das Element wird als ZUSTAND gehalten, nicht als useRef.
   *
   * Grund: die Diagramme werden teils bedingt gerendert (im
   * Anlageklassen-Abschnitt erst, wenn die Daten da sind). Mit einem
   * gewoehnlichen Ref liefe der Effekt einmal mit null, und wenn das Element
   * spaeter erscheint, geschieht nichts mehr — die Rad-Ereignisse blieben
   * stumm. Ueber den Zustand laeuft der Effekt erneut, sobald der Knoten
   * tatsaechlich im Baum haengt.
   */
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [win, setWin] = useState<WeekWindow>(() => fullWindow(total));
  const [dragging, setDragging] = useState(false);

  // Der native Listener liest den Zustand ueber Refs, damit er nicht bei jeder
  // Fensteraenderung neu registriert werden muss.
  const winRef = useRef(win);
  winRef.current = win;
  const totalRef = useRef(total);
  totalRef.current = total;

  /*
   * Aendert sich der Bestand (anderer Zeitraum gewaehlt, anderes Modell), ist
   * das alte Fenster bedeutungslos — die Indizes zeigen auf andere Wochen.
   * Dann auf die Gesamtsicht zurueck, statt einen zufaelligen Ausschnitt zu
   * behalten.
   */
  useEffect(() => {
    setWin(fullWindow(total));
  }, [total]);

  /** Mausposition in einen Anteil 0..1 der Zeichenflaeche umrechnen. */
  const anchorFrom = useCallback(
    (clientX: number): number => {
      if (!el) return 0.5;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return 0.5;
      const rel = (clientX - rect.left) / rect.width;
      const inPlot = (rel - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT);
      return Math.max(0, Math.min(1, inPlot));
    },
    [el],
  );

  // --- Mausrad -------------------------------------------------------------

  useEffect(() => {
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const t = totalRef.current;
      if (t <= 0) return;

      /*
       * Waagerechtes Wischen (Trackpad, Shift+Rad) schwenkt, statt zu zoomen —
       * das entspricht der Erwartung und erlaubt schnelles Durchblaettern.
       */
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      e.preventDefault();

      if (horizontal) {
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        const weeks = (delta / 100) * Math.max(1, windowWidth(winRef.current) * 0.15);
        setWin(panWindow(winRef.current, t, weeks));
        return;
      }

      // deltaY < 0 heisst "vom Nutzer weg" = hineinzoomen.
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      setWin(zoomWindow(winRef.current, t, factor, anchorFrom(e.clientX)));
    };

    // Ausdruecklich nicht passiv: sonst greift preventDefault() nicht und die
    // Seite scrollt beim Zoomen unter dem Chart weg.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [el, anchorFrom]);

  // --- Ziehen --------------------------------------------------------------

  useEffect(() => {
    if (!el) return;

    let startX = 0;
    let startWin: WeekWindow | null = null;

    const onDown = (e: PointerEvent) => {
      // Nur die primaere Taste, und nicht auf Bedienelementen im Chart.
      if (e.button !== 0) return;
      startX = e.clientX;
      startWin = winRef.current;
      setDragging(true);
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!startWin) return;
      const rect = el.getBoundingClientRect();
      const plotPx = rect.width * (PLOT_RIGHT - PLOT_LEFT);
      if (plotPx <= 0) return;
      // Wie viele Wochen entspricht die zurueckgelegte Strecke?
      const weeksPerPx = windowWidth(startWin) / plotPx;
      const delta = -(e.clientX - startX) * weeksPerPx;
      setWin(panWindow(startWin, totalRef.current, delta));
    };

    const onUp = (e: PointerEvent) => {
      startWin = null;
      setDragging(false);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [el]);

  return {
    window: win,
    ref: setEl,
    isFull: isFullRange(win, total),
    dragging,
    reset: useCallback(() => setWin(fullWindow(totalRef.current)), []),
    zoomBy: useCallback(
      (factor: number) => setWin(zoomWindow(winRef.current, totalRef.current, factor, 0.5)),
      [],
    ),
    panBy: useCallback(
      (weeks: number) => setWin(panWindow(winRef.current, totalRef.current, weeks)),
      [],
    ),
    setWindow: useCallback((w: WeekWindow) => setWin(clampWindow(w, totalRef.current)), []),
  };
}
