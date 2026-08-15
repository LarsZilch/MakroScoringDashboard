/**
 * Uebersichtsleiste unter den Diagrammen: der gesamte Bestand als Miniatur,
 * darin das sichtbare Fenster als verschiebbarer Rahmen mit zwei Griffen.
 *
 * Sie leistet zweierlei, was Radzoom allein nicht kann: sie zeigt, WO im
 * Bestand man gerade steht, und sie erlaubt einen Sprung an eine beliebige
 * Stelle, ohne sich durchzuscrollen.
 *
 * Die Miniatur zeigt Regime-Faerbung und die Score-Linie — beides ohne Achsen
 * und Beschriftung, denn hier geht es um Orientierung, nicht um Ablesen.
 */

import { useEffect, useRef, useState } from 'react';
import { INK, REGIME_COLOR, linearScale, stepPath } from './viz';
import { CHART_W, MARGIN } from './chartGeometry';
import { clampWindow, windowWidth, type WeekWindow } from './windowMath';
import { weekLabel } from '../format';

const H = 54;
/** Griffbreite in SVG-Einheiten; grosszuegig, damit sie greifbar bleiben. */
const HANDLE = 7;

type DragMode = 'move' | 'left' | 'right' | null;

export interface BrushPoint {
  weekKey: string;
  total: number;
  regime: string;
  completeness?: string;
}

export function WeekBrush({
  points,
  window: win,
  onChange,
  onReset,
}: {
  /** Der GESAMTE Bestand, nicht der sichtbare Ausschnitt. */
  points: BrushPoint[];
  window: WeekWindow;
  onChange: (w: WeekWindow) => void;
  onReset: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [mode, setMode] = useState<DragMode>(null);
  const dragRef = useRef<{ startX: number; startWin: WeekWindow } | null>(null);

  const total = points.length;
  if (total < 2) return null;

  const left = MARGIN.left;
  const plotW = CHART_W - MARGIN.left - MARGIN.right;
  const x = linearScale([0, total], [left, left + plotW]);
  const y = linearScale([-3, 3], [H - 6, 6]);

  const winX = x(win.start);
  const winW = Math.max(2, x(win.end) - x(win.start));

  // Regime-Baender: zusammenhaengende Laeufe verschmelzen, sonst entstehen bei
  // ueber 800 Wochen Rundungsfugen zwischen den Rechtecken.
  const spans: { from: number; to: number; regime: string; sparse: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const p = points[i]!;
    const sparse = p.completeness === 'sparse';
    const last = spans[spans.length - 1];
    if (last && last.regime === p.regime && last.sparse === sparse) last.to = i;
    else spans.push({ from: i, to: i, regime: p.regime, sparse });
  }

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.total) }));

  /** Klientenkoordinate in einen Wochenindex umrechnen. */
  const indexAt = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const rel = (clientX - rect.left) / rect.width; // 0..1 ueber das ganze SVG
    const plotRel = (rel * CHART_W - left) / plotW;
    return Math.max(0, Math.min(total, plotRel * total));
  };

  const startDrag = (e: React.PointerEvent, m: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startWin: win };
    setMode(m);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    if (!mode) return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const weeksPerPx = total / (rect.width * (plotW / CHART_W));
      const deltaWeeks = (e.clientX - d.startX) * weeksPerPx;

      if (mode === 'move') {
        const start = d.startWin.start + deltaWeeks;
        onChange(clampWindow({ start, end: start + windowWidth(d.startWin) }, total));
      } else if (mode === 'left') {
        onChange(clampWindow({ start: d.startWin.start + deltaWeeks, end: d.startWin.end }, total));
      } else {
        onChange(clampWindow({ start: d.startWin.start, end: d.startWin.end + deltaWeeks }, total));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      setMode(null);
    };

    // Auf dem Fenster lauschen, damit der Zug auch ausserhalb des SVG haelt.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [mode, total, plotW, onChange]);

  /** Klick neben das Fenster zentriert es dort. */
  const onTrackClick = (e: React.PointerEvent) => {
    if (mode) return;
    const idx = indexAt(e.clientX);
    const width = windowWidth(win);
    onChange(clampWindow({ start: idx - width / 2, end: idx + width / 2 }, total));
  };

  const fromLabel = points[Math.min(total - 1, Math.floor(win.start))]?.weekKey;
  const toLabel = points[Math.max(0, Math.ceil(win.end) - 1)]?.weekKey;

  return (
    <div className="brush">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${H}`}
        className="brush-svg"
        role="group"
        aria-label="Zeitraum waehlen"
        onPointerDown={onTrackClick}
      >
        <defs>
          <pattern id="brush-hatch" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="#f6f6f4" />
            <path d="M0,5 L5,0" stroke="#e2e2dc" strokeWidth="1.2" />
          </pattern>
        </defs>

        <rect x={left} y={4} width={plotW} height={H - 8} fill="#fbfaf7" stroke={INK.grid} />

        {spans.map((s, i) => (
          <rect
            key={i}
            x={x(s.from)}
            y={5}
            width={Math.max(0.5, x(s.to + 1) - x(s.from))}
            height={H - 10}
            fill={s.sparse ? 'url(#brush-hatch)' : (REGIME_COLOR[s.regime] ?? 'transparent')}
            opacity={s.sparse ? 1 : 0.3}
          />
        ))}

        <path
          d={stepPath(coords)}
          fill="none"
          stroke={INK.secondary}
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* Abgedunkelte Bereiche ausserhalb des Fensters */}
        <rect x={left} y={4} width={Math.max(0, winX - left)} height={H - 8} fill="#fff" opacity="0.62" />
        <rect
          x={winX + winW}
          y={4}
          width={Math.max(0, left + plotW - winX - winW)}
          height={H - 8}
          fill="#fff"
          opacity="0.62"
        />

        {/* Das Fenster selbst */}
        <rect
          x={winX}
          y={4}
          width={winW}
          height={H - 8}
          fill="transparent"
          stroke={INK.primary}
          strokeWidth="1.5"
          className="brush-window"
          onPointerDown={(e) => startDrag(e, 'move')}
        />

        {/* Griffe links und rechts */}
        {(['left', 'right'] as const).map((side) => (
          <rect
            key={side}
            x={(side === 'left' ? winX : winX + winW) - HANDLE / 2}
            y={4}
            width={HANDLE}
            height={H - 8}
            fill={INK.primary}
            className="brush-handle"
            onPointerDown={(e) => startDrag(e, side)}
          />
        ))}
      </svg>

      <div className="brush-legend">
        <span>
          {fromLabel && toLabel ? (
            <>
              Ausschnitt: <strong>{weekLabel(fromLabel)}</strong> bis{' '}
              <strong>{weekLabel(toLabel)}</strong> ({Math.round(windowWidth(win))} von {total}{' '}
              Wochen)
            </>
          ) : (
            <>{total} Wochen</>
          )}
        </span>
        <span className="brush-hint">
          Mausrad zoomt · Ziehen verschiebt · Umschalt+Rad blaettert
          {windowWidth(win) < total && (
            <>
              {' · '}
              <button className="brush-reset" onClick={onReset}>
                alles zeigen
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
