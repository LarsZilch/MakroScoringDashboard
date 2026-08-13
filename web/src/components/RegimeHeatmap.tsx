/**
 * Regime-Timeline als Raster Kalenderwoche x Jahr.
 *
 * Die schnellste Antwort auf "wie lange lief Risk On, wann ist es gekippt" —
 * ein Blick statt einer Tabelle.
 *
 * Farbwahl: divergierende Skala mit neutraler Mitte, nicht die naheliegende
 * Ampel. Rot gegen Gruen ist bei Deuteranopie nicht unterscheidbar, und
 * angrenzende Zellen sind genau der Fall, in dem das auffaellt. Jede Zelle
 * traegt zusaetzlich ihre Zahl — Farbe allein soll nie die Bedeutung tragen.
 */

import { useState } from 'react';
import type { HistoryPoint } from '../types';
import { INK, REGIME_COLOR, REGIME_SCALE } from './viz';
import { scoreText, weekLabel } from '../format';

export function RegimeHeatmap({ points }: { points: HistoryPoint[] }) {
  const [hover, setHover] = useState<HistoryPoint | null>(null);

  const years = [...new Set(points.map((p) => p.isoYear))].sort();
  if (years.length === 0) return <div className="center-note">Keine Wochen im Bestand.</div>;

  const byKey = new Map(points.map((p) => [`${p.isoYear}-${p.isoWeek}`, p]));

  const cell = 15;
  const gap = 2; // 2px Flaechenabstand zwischen Zellen, wie in den Mark-Vorgaben
  const labelW = 46;
  const headH = 18;
  const width = labelW + 53 * (cell + gap);
  const height = headH + years.length * (cell + gap) + 4;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: 720, height: 'auto', display: 'block' }}
          role="img"
          aria-label="Regime je Kalenderwoche und Jahr"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <pattern id="hm-sparse" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#f6f6f4" />
              <path d="M0,5 L5,0" stroke="#dedcd4" strokeWidth="1.2" />
            </pattern>
          </defs>

          {/* Wochenbeschriftung, jede zehnte */}
          {Array.from({ length: 53 }, (_, i) => i + 1)
            .filter((w) => w % 10 === 0 || w === 1)
            .map((w) => (
              <text
                key={`w-${w}`}
                x={labelW + (w - 1) * (cell + gap) + cell / 2}
                y={12}
                textAnchor="middle"
                fontSize="10"
                fill={INK.muted}
              >
                {w}
              </text>
            ))}

          {years.map((year, row) => (
            <g key={year}>
              <text
                x={labelW - 8}
                y={headH + row * (cell + gap) + cell - 3}
                textAnchor="end"
                fontSize="11"
                fill={INK.secondary}
              >
                {year}
              </text>
              {Array.from({ length: 53 }, (_, i) => i + 1).map((week) => {
                const p = byKey.get(`${year}-${week}`);
                if (!p) return null;
                const sparse = p.completeness === 'sparse';
                return (
                  <rect
                    key={week}
                    x={labelW + (week - 1) * (cell + gap)}
                    y={headH + row * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx="2"
                    fill={sparse ? 'url(#hm-sparse)' : (REGIME_COLOR[p.regime] ?? INK.grid)}
                    stroke={hover?.weekKey === p.weekKey ? INK.primary : 'none'}
                    strokeWidth="1.5"
                    onMouseEnter={() => setHover(p)}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap',
          marginTop: 14,
          fontSize: 12.5,
          color: INK.secondary,
        }}
      >
        {REGIME_SCALE.map((label) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 2,
                background: REGIME_COLOR[label],
                border: `1px solid rgba(11,11,11,0.10)`,
              }}
            />
            {label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 2,
              background:
                'repeating-linear-gradient(135deg,#f6f6f4,#f6f6f4 2px,#dedcd4 2px,#dedcd4 3.5px)',
              border: '1px solid rgba(11,11,11,0.10)',
            }}
          />
          unvollstaendig — ohne Aussage
        </span>
      </div>

      {hover && (
        <div style={{ marginTop: 12, fontSize: 13.5 }}>
          <strong>{weekLabel(hover.weekKey)}</strong> · Score {scoreText(hover.total)} ·{' '}
          {hover.completeness === 'sparse' ? (
            <em style={{ color: INK.muted }}>
              unvollstaendig — der Score ergibt sich aus einer Datenluecke
            </em>
          ) : (
            hover.regime
          )}
        </div>
      )}
    </div>
  );
}
