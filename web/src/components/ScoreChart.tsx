/**
 * Gesamtscore im Zeitverlauf, als Stufenlinie.
 *
 * Stufen statt einer verbundenen Linie, weil ein Wochenscore bis zur naechsten
 * Woche gilt und nicht dazwischen interpoliert. Eine schraege Verbindung
 * behauptete Zwischenwerte, die es nicht gibt.
 *
 * Wochen ohne belastbare Datenlage sind schraffiert unterlegt — sie tragen
 * zwar eine Zahl, aber keine Aussage.
 */

import { useState } from 'react';
import type { HistoryPoint } from '../types';
import { INK, linearScale, stepPath } from './viz';
import { scoreText, weekLabel } from '../format';

const W = 900;
const H = 240;
const M = { top: 16, right: 16, bottom: 30, left: 34 };

export function ScoreChart({ points }: { points: HistoryPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <div className="center-note">Zu wenige Wochen im Bestand fuer einen Verlauf.</div>;
  }

  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = linearScale([0, points.length - 1], [M.left, M.left + innerW]);
  const y = linearScale([-3, 3], [M.top + innerH, M.top]);

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.total) }));
  const step = innerW / Math.max(1, points.length - 1);

  const active = hover !== null ? points[hover] : null;

  // Nur wenige Beschriftungen auf der Zeitachse, sonst ueberlagern sie sich.
  const tickEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Gesamtscore im Wochenverlauf"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="sparse-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#f6f6f4" />
            <path d="M0,6 L6,0" stroke="#e2e2dc" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Wochen ohne belastbare Datenlage kenntlich machen */}
        {points.map((p, i) =>
          p.completeness === 'sparse' ? (
            <rect
              key={`sp-${p.weekKey}`}
              x={x(i) - step / 2}
              y={M.top}
              width={step}
              height={innerH}
              fill="url(#sparse-hatch)"
            />
          ) : null,
        )}

        {/* Gitter */}
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? INK.axis : INK.grid}
              strokeWidth={v === 0 ? 1.5 : 1}
            />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={INK.muted}>
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        ))}

        {/* Zeitachse */}
        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text
              key={`t-${p.weekKey}`}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize="10.5"
              fill={INK.muted}
            >
              {p.weekKey.replace('-W', '/')}
            </text>
          ) : null,
        )}

        {/* Die Linie: 2px, wie in den Mark-Vorgaben */}
        <path
          d={stepPath(coords)}
          fill="none"
          stroke={INK.primary}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Aktueller Punkt hervorgehoben, mit 2px Flaechenring */}
        {hover !== null && coords[hover] && (
          <>
            <line
              x1={coords[hover]!.x}
              x2={coords[hover]!.x}
              y1={M.top}
              y2={M.top + innerH}
              stroke={INK.axis}
              strokeWidth="1"
            />
            <circle
              cx={coords[hover]!.x}
              cy={coords[hover]!.y}
              r="5"
              fill={INK.primary}
              stroke={INK.surface}
              strokeWidth="2"
            />
          </>
        )}

        {/* Unsichtbare, grosszuegige Trefferflaechen */}
        {points.map((p, i) => (
          <rect
            key={`h-${p.weekKey}`}
            x={x(i) - step / 2}
            y={M.top}
            width={Math.max(step, 6)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            background: '#fff',
            border: `1px solid ${INK.grid}`,
            padding: '8px 12px',
            fontSize: 13,
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
            pointerEvents: 'none',
          }}
        >
          <strong>{weekLabel(active.weekKey)}</strong>
          <br />
          Score {scoreText(active.total)} · {active.regime}
          {active.completeness === 'sparse' && (
            <>
              <br />
              <em style={{ color: INK.muted }}>unvollstaendig — ohne Aussage</em>
            </>
          )}
        </div>
      )}
    </div>
  );
}
