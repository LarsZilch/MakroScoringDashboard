/**
 * Die drei Faktorscores als kleine Einzeldiagramme nebeneinander.
 *
 * Bewusst drei getrennte Diagramme statt dreier Linien in einem: bei nur drei
 * moeglichen Werten (-1/0/+1) wuerden sich uebereinanderliegende Linien
 * staendig verdecken. Getrennt braucht jede nur eine Farbe und eine
 * Beschriftung — Farbe muss dann gar keine Identitaet mehr tragen.
 */

import type { HistoryPoint } from '../types';
import { INK, SERIES, linearScale, stepPath } from './viz';

const FACTORS = [
  { id: 'business_cycle', label: 'Business Cycle' },
  { id: 'liquidity', label: 'Globale Liquiditaet' },
  { id: 'sentiment', label: 'Sentiment' },
];

const W = 300;
const H = 110;
const M = { top: 10, right: 8, bottom: 16, left: 22 };

function Mini({ points, factorId, label, color }: { points: HistoryPoint[]; factorId: string; label: string; color: string }) {
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = linearScale([0, Math.max(1, points.length - 1)], [M.left, M.left + innerW]);
  const y = linearScale([-1, 1], [M.top + innerH, M.top]);

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.factors[factorId] ?? 0) }));

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: INK.secondary, marginBottom: 4 }}>
        {label}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Faktorscore ${label}`}>
        {[-1, 0, 1].map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? INK.axis : INK.grid}
              strokeWidth="1"
            />
            <text x={M.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill={INK.muted}>
              {v > 0 ? '+1' : v}
            </text>
          </g>
        ))}
        <path
          d={stepPath(coords)}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function FactorCharts({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22 }}>
      {FACTORS.map((f, i) => (
        <Mini key={f.id} points={points} factorId={f.id} label={f.label} color={SERIES[i]!} />
      ))}
    </div>
  );
}
