/**
 * Veraenderung je Indikator gegenueber Vorwoche UND Vorjahres-Kalenderwoche,
 * in einer Ansicht.
 *
 * Beides nebeneinander zu zeigen ist der Sinn der Sache: die Vorwoche sagt,
 * was sich gerade bewegt, die Vorjahreswoche, wo man im groesseren Bild steht.
 * Getrennte Tabellen wuerden den Vergleich dem Gedaechtnis ueberlassen.
 */

import type { Comparison, IndicatorDelta } from '../types';
import { num, scoreText, signed, weekLabel } from '../format';

function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return <span className="score-chip none">—</span>;
  const cls = score > 0 ? 'pos' : score < 0 ? 'neg' : 'zero';
  return <span className={`score-chip ${cls}`}>{scoreText(score)}</span>;
}

function ValueDelta({ delta, unit, decimals }: { delta: number | null; unit: string; decimals: number }) {
  if (delta === null) return <span className="delta-flat">—</span>;
  if (Math.abs(delta) < Math.pow(10, -decimals) / 2) {
    return <span className="delta-flat">±0</span>;
  }
  const cls = delta > 0 ? 'delta-up' : 'delta-down';
  return (
    <span className={cls}>
      {signed(delta, decimals)}
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

/** Nachkommastellen je Einheit — bp und Indexpunkte brauchen keine. */
function decimalsFor(unit: string): number {
  if (unit === 'bp' || unit === 'bps') return 0;
  if (unit === 'Idx') return 2;
  return 2;
}

function refLabel(c: Comparison): string {
  if (!c.resolved) return 'kein Vergleichswert';
  const key = `${c.resolved.isoYear}-W${String(c.resolved.isoWeek).padStart(2, '0')}`;
  return weekLabel(key) + (c.substituted ? ' (ersatzweise)' : '');
}

export function DeltaTable({ wow, yoy }: { wow: Comparison; yoy: Comparison }) {
  const yoyById = new Map(yoy.indicators.map((i) => [i.id, i]));

  return (
    <>
      <table>
        <thead>
          <tr>
            <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>
              Indikator
            </th>
            <th rowSpan={2} className="num" style={{ verticalAlign: 'bottom' }}>
              aktuell
            </th>
            <th colSpan={3} style={{ textAlign: 'center', borderBottom: 'none' }}>
              gegen Vorwoche
            </th>
            <th colSpan={3} style={{ textAlign: 'center', borderBottom: 'none' }}>
              gegen Vorjahres-KW
            </th>
          </tr>
          <tr>
            <th className="num">Wert</th>
            <th className="num">Δ</th>
            <th className="num">Score</th>
            <th className="num">Wert</th>
            <th className="num">Δ</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {wow.indicators.map((w: IndicatorDelta) => {
            const y = yoyById.get(w.id);
            const dec = decimalsFor(w.unit);
            return (
              <tr key={w.id}>
                <td>
                  {w.label}
                  {w.unit && (
                    <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}> · {w.unit}</span>
                  )}
                </td>
                <td className="num">
                  {w.currentValue === null ? '—' : num(w.currentValue, dec)}
                </td>

                <td className="num">
                  {w.previousValue === null ? '—' : num(w.previousValue, dec)}
                </td>
                <td className="num">
                  <ValueDelta delta={w.valueDelta} unit="" decimals={dec} />
                </td>
                <td className="num">
                  <ScoreChip score={w.previousScore} />
                  {w.scoreChanged && (
                    <span style={{ color: 'var(--ink-faint)' }}> → </span>
                  )}
                  {w.scoreChanged && <ScoreChip score={w.currentScore} />}
                </td>

                <td className="num">
                  {y?.previousValue == null ? '—' : num(y.previousValue, dec)}
                </td>
                <td className="num">
                  <ValueDelta delta={y?.valueDelta ?? null} unit="" decimals={dec} />
                </td>
                <td className="num">
                  <ScoreChip score={y?.previousScore ?? null} />
                  {y?.scoreChanged && <span style={{ color: 'var(--ink-faint)' }}> → </span>}
                  {y?.scoreChanged && <ScoreChip score={y.currentScore} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--ink-faint)' }}>
        Vorwoche: {refLabel(wow)} · Vorjahr: {refLabel(yoy)}
        {(wow.substituted || yoy.substituted) && (
          <>
            {' '}
            — „ersatzweise" heisst, die exakte Vergleichswoche fehlt im Bestand und es wurde die
            naechstgelegene davor genommen.
          </>
        )}
      </div>
    </>
  );
}
