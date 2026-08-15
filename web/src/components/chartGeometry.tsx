/**
 * Gemeinsame Geometrie und Regime-Schattierung fuer Score-Verlauf und
 * Kurs-Overlay.
 *
 * Beide Diagramme muessen SENKRECHT DECKUNGSGLEICH sein — nur dann kann man
 * ablesen, wie sich eine Anlageklasse waehrend einer Regime-Phase verhalten
 * hat. Deshalb stehen Breite und seitliche Raender hier an einer Stelle und
 * nicht zweimal als Zahl im jeweiligen Bauteil.
 */

import type { ReactNode } from 'react';
import { INK, REGIME_COLOR, linearScale, type Scale } from './viz';

/** Zeichenflaeche. Die Hoehe darf je Diagramm abweichen, die Breite nicht. */
export const CHART_W = 900;
export const MARGIN = { top: 16, right: 60, bottom: 30, left: 34 };

export const innerWidth = () => CHART_W - MARGIN.left - MARGIN.right;

/** x-Skala ueber die Position in der Wochenliste. */
export function weekScale(count: number) {
  return linearScale([0, Math.max(1, count - 1)], [MARGIN.left, MARGIN.left + innerWidth()]);
}

/** Breite eines Wochenschritts, fuer Trefferflaechen und Schattierung. */
export function stepWidth(count: number) {
  return innerWidth() / Math.max(1, count - 1);
}

/**
 * Rechteck-Anfang und -Breite fuer eine Woche oder einen Wochen-Bereich,
 * unter derselben Konvention wie die Stufenlinie: ein Wert gilt vom eigenen
 * Tick bis zum naechsten, nicht symmetrisch um den Tick.
 */
export function weekSpanX(x: Scale, step: number, from: number, to: number = from, minWidth = 0) {
  return { x: x(from), width: Math.max((to - from + 1) * step, minWidth) };
}

export interface RegimeWeek {
  weekKey: string;
  regime: string;
  completeness?: string;
}

/**
 * Regime als Hintergrundbaender.
 *
 * Bewusst stark abgeschwaecht (Deckkraft 0,16): die Baender sollen die Phase
 * erkennbar machen, ohne die Kurslinien zu ueberdecken. Zusammenhaengende
 * Wochen desselben Regimes werden zu einem Band verschmolzen — einzelne
 * Rechtecke je Woche ergaeben sonst ein Streifenmuster aus Rundungsfugen.
 */
export function RegimeBands({
  weeks,
  height,
  opacity = 0.16,
}: {
  weeks: RegimeWeek[];
  height: number;
  opacity?: number;
}) {
  if (weeks.length === 0) return null;
  const x = weekScale(weeks.length);
  const step = stepWidth(weeks.length);

  const spans: { from: number; to: number; regime: string; sparse: boolean }[] = [];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i]!;
    const sparse = w.completeness === 'sparse';
    const last = spans[spans.length - 1];
    if (last && last.regime === w.regime && last.sparse === sparse) last.to = i;
    else spans.push({ from: i, to: i, regime: w.regime, sparse });
  }

  return (
    <g>
      {spans.map((s, i) => {
        const span = weekSpanX(x, step, s.from, s.to);
        return (
          <rect
            key={i}
            x={span.x}
            y={MARGIN.top}
            width={span.width}
            height={height - MARGIN.top - MARGIN.bottom}
            fill={s.sparse ? 'url(#sparse-hatch)' : (REGIME_COLOR[s.regime] ?? 'transparent')}
            opacity={s.sparse ? 1 : opacity}
          />
        );
      })}
    </g>
  );
}

/** Schraffur fuer Wochen ohne belastbare Datenlage. In jedem SVG einmal noetig. */
export function ChartDefs() {
  return (
    <defs>
      <pattern id="sparse-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#f6f6f4" />
        <path d="M0,6 L6,0" stroke="#e2e2dc" strokeWidth="1.5" />
      </pattern>
    </defs>
  );
}

/** Beschriftung der Zeitachse, in beiden Diagrammen identisch positioniert. */
export function TimeAxis({
  weeks,
  height,
  every,
}: {
  weeks: { weekKey: string }[];
  height: number;
  every?: number;
}) {
  const x = weekScale(weeks.length);
  const tick = every ?? Math.max(1, Math.ceil(weeks.length / 8));
  return (
    <g>
      {weeks.map((w, i) =>
        i % tick === 0 ? (
          <text
            key={w.weekKey}
            x={x(i)}
            y={height - 10}
            textAnchor="middle"
            fontSize="10.5"
            fill={INK.muted}
          >
            {w.weekKey.replace('-W', '/')}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Rahmen mit einheitlicher Breite; die Hoehe gibt das Diagramm vor. */
export function ChartFrame({
  height,
  label,
  children,
}: {
  height: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={label}
    >
      <ChartDefs />
      {children}
    </svg>
  );
}
