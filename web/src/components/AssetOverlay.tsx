/**
 * Kursverlaeufe der Anlageklassen, unter dem Score-Verlauf und mit derselben
 * Zeitachse — damit man senkrecht ablesen kann, was eine Anlageklasse
 * waehrend einer Regime-Phase getan hat.
 *
 * Zwei Festlegungen:
 *
 * 1. INDEXIERT AUF 100 zu Fensterbeginn. Absolute Kurse waeren zwischen
 *    Bitcoin und dem Dollar-Index nicht in einem Diagramm darstellbar. Die
 *    Indexierung ist zugleich die gewuenschte Abstraktion: Form und relative
 *    Entwicklung statt Kursniveau.
 *
 * 2. KEINE ZWEITE y-ACHSE. Score und Kursindex teilen sich keine Flaeche.
 *    Zwei Skalen auf einem Feld liessen sich so legen, dass dieselbe Datenlage
 *    nach Gleichlauf oder nach Gegenlauf aussieht — der Zusammenhang entstuende
 *    aus der Achsenwahl, nicht aus den Daten.
 */

import { useState } from 'react';
import { INK, linearScale, linePath } from './viz';
import {
  CHART_W,
  MARGIN,
  RegimeBands,
  TimeAxis,
  weekScale,
  stepWidth,
  ChartDefs,
} from './chartGeometry';
import { num, weekLabelWithDate } from '../format';
import type { AssetCurve, RegimeWeekPoint } from '../types';

const HEIGHT = 260;

/**
 * Feste Farbplaetze. Vier Linien gleichzeitig, mehr nicht.
 *
 * Gemessen mit dem Validator der dataviz-Vorgaben: genau diese vier bestehen
 * die Pruefung ueber ALLE Paare (schlechtestes Paar ΔE 9,2 bei Deuteranopie,
 * 16,3 bei normalem Farbsehen). Jeder gepruefte fuenfte Kandidat kollidiert
 * mit Orange — Rot ΔE 7,1, Magenta 12,9, Gelb 13,7, jeweils unter der Grenze
 * von 15 und damit auch ohne Farbsehschwaeche schwer zu unterscheiden.
 *
 * Da die Umschalter jede Kombination erlauben, gilt die strenge Pruefung ueber
 * alle Paare, nicht nur ueber benachbarte.
 */
export const LINE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'];
export const MAX_LINES = LINE_COLORS.length;

export function AssetOverlay({
  curves,
  weeks,
  selected,
}: {
  curves: AssetCurve[];
  weeks: RegimeWeekPoint[];
  selected: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  const shown = selected
    .slice(0, MAX_LINES)
    .map((id, i) => ({ curve: curves.find((c) => c.assetId === id), color: LINE_COLORS[i]! }))
    .filter((s): s is { curve: AssetCurve; color: string } => Boolean(s.curve));

  if (weeks.length < 2) {
    return <div className="center-note">Zu wenige Wochen fuer einen Verlauf.</div>;
  }
  if (shown.length === 0) {
    return (
      <div className="center-note">
        Keine Anlageklasse gewaehlt — oben eine oder mehrere zuschalten.
      </div>
    );
  }

  const x = weekScale(weeks.length);
  const step = stepWidth(weeks.length);
  const indexOfWeek = new Map(weeks.map((w, i) => [w.weekKey, i]));

  // Gemeinsame y-Skala ueber alle sichtbaren Linien, damit sie vergleichbar
  // bleiben. Ein bisschen Luft nach oben und unten.
  const values = shown.flatMap((s) => s.curve.points.map((p) => p.value));
  const lo = Math.min(100, ...values);
  const hi = Math.max(100, ...values);
  const pad = (hi - lo) * 0.08 || 5;
  const y = linearScale([lo - pad, hi + pad], [HEIGHT - MARGIN.bottom, MARGIN.top]);

  // Gitterlinien auf runden Werten, immer inklusive der Basis 100.
  const range = hi + pad - (lo - pad);
  const rawStep = range / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const gridStep = Math.max(5, Math.ceil(rawStep / magnitude) * magnitude);
  const gridValues: number[] = [];
  for (let v = Math.ceil((lo - pad) / gridStep) * gridStep; v <= hi + pad; v += gridStep) {
    gridValues.push(v);
  }
  if (!gridValues.includes(100)) gridValues.push(100);

  const active = hover !== null ? weeks[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${HEIGHT}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Kursverlauf der gewaehlten Anlageklassen, indexiert auf 100"
        onMouseLeave={() => setHover(null)}
      >
        <ChartDefs />
        <RegimeBands weeks={weeks} height={HEIGHT} />

        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + CHART_W - MARGIN.left - MARGIN.right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 100 ? INK.axis : INK.grid}
              strokeWidth={v === 100 ? 1.5 : 1}
            />
            <text x={MARGIN.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={INK.muted}>
              {num(v, 0)}
            </text>
          </g>
        ))}

        <TimeAxis weeks={weeks} height={HEIGHT} />

        {shown.map(({ curve, color }) => {
          const pts = curve.points
            .map((p) => {
              const i = indexOfWeek.get(p.weekKey);
              return i === undefined ? null : { x: x(i), y: y(p.value) };
            })
            .filter((p): p is { x: number; y: number } => p !== null);
          if (pts.length < 2) return null;
          const last = pts[pts.length - 1]!;

          return (
            <g key={curve.assetId}>
              <path
                d={linePath(pts)}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/*
                Endbeschriftung: die Identitaet haengt damit nicht allein an
                der Farbe. Fuer Betrachter mit Farbsehschwaeche ist das der
                eigentliche Traeger der Zuordnung.
              */}
              <text
                x={last.x + 6}
                y={last.y + 4}
                fontSize="11"
                fontWeight="700"
                fill={color}
              >
                {curve.short}
              </text>
            </g>
          );
        })}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke={INK.axis}
            strokeWidth="1"
          />
        )}

        {weeks.map((w, i) => (
          <rect
            key={w.weekKey}
            x={x(i) - step / 2}
            y={MARGIN.top}
            width={Math.max(step, 6)}
            height={HEIGHT - MARGIN.top - MARGIN.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && (
        <div className="overlay-tooltip">
          <strong>{weekLabelWithDate(active.weekKey)}</strong> — {active.regime}
          <br />
          {shown.map(({ curve, color }) => {
            const p = curve.points.find((q) => q.weekKey === active.weekKey);
            if (!p) return null;
            return (
              <span key={curve.assetId} style={{ display: 'block' }}>
                <span className="overlay-dot" style={{ background: color }} />
                {curve.short}: {num(p.value, 1)}
                <span style={{ color: INK.muted }}> ({num(p.value - 100, 1)} %)</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
