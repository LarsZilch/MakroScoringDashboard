/**
 * Die Bewertungsbaender eines Indikators als waagerechte Leiste, mit Marke
 * fuer den aktuellen Stand.
 *
 * Sie beantwortet die Frage "was bedeutet eine Aenderung" auf einen Blick:
 * man sieht, in welcher Stufe der Wert steht und wie weit es bis zur naechsten
 * ist. Gerendert wird ausschliesslich aus `bands` — die Leiste kann daher
 * nicht veralten, wenn jemand eine Schwelle in rules/*.json verschiebt.
 *
 * Farben: dieselben Score-Farben wie die Badges des Dashboards, damit ein
 * Score ueberall gleich aussieht. Die drei Fuellungen wurden mit dem
 * dataviz-Validator geprueft — die Trennungspruefungen bestehen deutlich
 * (CVD ΔE 24,7 / normal 25,5). Zwei Fuellungen liegen unter 3:1 Kontrast zur
 * Flaeche; dafuer gilt die Relief-Regel, weshalb jedes Segment SEINEN SCORE
 * ALS TEXT traegt und die Segmente durch 2px Abstand getrennt sind. Farbe
 * traegt die Bedeutung hier nie allein.
 */

import type { Band, Score } from '../types';
import { num } from '../format';

const SCORE_FILL: Record<string, string> = {
  '1': '#d9a520', // Gold, wie das +1-Badge
  '0': '#f2f2f0', // Neutral-Grau
  '-1': '#8b1a1a', // Rot, wie das −1-Badge
};

const SCORE_INK: Record<string, string> = {
  '1': '#ffffff',
  '0': '#5a5a5a',
  '-1': '#ffffff',
};

/** Ein Abschnitt der Leiste: von/bis in Indikator-Einheiten, mit Score. */
interface Segment {
  from: number | null; // null = offen nach unten
  to: number | null; // null = offen nach oben
  score: Score;
  note?: string;
}

/**
 * Baender in zusammenhaengende Abschnitte uebersetzen.
 *
 * Die Baender selbst sind eine Trefferliste ("erstes passendes gewinnt") und
 * nicht notwendig geordnet. Fuer die Darstellung braucht es dagegen eine
 * lueckenlose Folge von links nach rechts. Ermittelt wird sie ueber die
 * Schwellenwerte: zwischen je zwei benachbarten Schwellen wird der Score an
 * einem Probepunkt bestimmt.
 */
export function bandsToSegments(bands: Band[]): Segment[] {
  const boundaries = [
    ...new Set(
      bands.flatMap((b) => [b.lt, b.lte, b.gt, b.gte].filter((v): v is number => v !== undefined)),
    ),
  ].sort((a, b) => a - b);

  if (boundaries.length === 0) {
    return [{ from: null, to: null, score: bands[bands.length - 1]?.score ?? 0 }];
  }

  const matches = (band: Band, value: number): boolean => {
    if (band.lt !== undefined && !(value < band.lt)) return false;
    if (band.lte !== undefined && !(value <= band.lte)) return false;
    if (band.gt !== undefined && !(value > band.gt)) return false;
    if (band.gte !== undefined && !(value >= band.gte)) return false;
    return true;
  };
  const scoreAt = (value: number): { score: Score; note?: string } => {
    for (const b of bands) if (matches(b, value)) return { score: b.score, note: b.note };
    return { score: 0 };
  };

  // Probepunkte: einmal unterhalb der ersten Schwelle, zwischen je zwei
  // Schwellen, und einmal oberhalb der letzten.
  const span = (boundaries[boundaries.length - 1]! - boundaries[0]!) || Math.abs(boundaries[0]!) || 1;
  const probes: { from: number | null; to: number | null; at: number }[] = [
    { from: null, to: boundaries[0]!, at: boundaries[0]! - span },
  ];
  for (let i = 0; i < boundaries.length - 1; i++) {
    probes.push({
      from: boundaries[i]!,
      to: boundaries[i + 1]!,
      at: (boundaries[i]! + boundaries[i + 1]!) / 2,
    });
  }
  probes.push({
    from: boundaries[boundaries.length - 1]!,
    to: null,
    at: boundaries[boundaries.length - 1]! + span,
  });

  // Benachbarte Abschnitte mit gleichem Score zusammenfassen.
  const out: Segment[] = [];
  for (const p of probes) {
    const { score, note } = scoreAt(p.at);
    const last = out[out.length - 1];
    if (last && last.score === score) last.to = p.to;
    else out.push({ from: p.from, to: p.to, score, note });
  }
  return out;
}

function scoreLabel(score: Score): string {
  return score > 0 ? '+1' : score < 0 ? '−1' : '0';
}

export function BandScale({
  bands,
  value,
  unit,
  decimals,
}: {
  bands: Band[];
  value: number | null;
  unit: string;
  decimals: number;
}) {
  const segments = bandsToSegments(bands);

  /*
   * Die aeusseren Abschnitte sind nach aussen offen. Fuer die Darstellung
   * bekommen sie eine endliche Breite — sonst waere die Leiste unendlich
   * breit oder die inneren Abschnitte verschwaenden zu Strichen. Ein halbes
   * Segment ist ein ehrlicher Kompromiss und wird durch die offene
   * Beschriftung ("bis", "ab") als offen kenntlich gemacht.
   */
  const finite = segments.filter((s) => s.from !== null && s.to !== null);
  const innerSpan =
    finite.length > 0
      ? Math.max(...finite.map((s) => s.to! - s.from!))
      : Math.abs(segments.find((s) => s.to !== null)?.to ?? 1) || 1;
  const pad = innerSpan * 0.6;

  const lo = (segments[0]!.to ?? 0) - pad;
  const hi = (segments[segments.length - 1]!.from ?? 0) + pad;
  const total = hi - lo || 1;

  const widthOf = (s: Segment) => {
    const from = s.from ?? lo;
    const to = s.to ?? hi;
    return ((to - from) / total) * 100;
  };

  // Position der Marke, auf die Leiste begrenzt.
  const markerPct =
    value === null ? null : Math.min(100, Math.max(0, ((value - lo) / total) * 100));

  return (
    <div className="bandscale">
      <div className="bandscale-bar">
        {segments.map((s, i) => (
          <div
            key={i}
            className="bandscale-seg"
            style={{
              width: `${widthOf(s)}%`,
              background: SCORE_FILL[String(s.score)],
              color: SCORE_INK[String(s.score)],
            }}
            title={s.note}
          >
            <span className="bandscale-score">{scoreLabel(s.score)}</span>
          </div>
        ))}

        {markerPct !== null && (
          <div className="bandscale-marker" style={{ left: `${markerPct}%` }}>
            <span className="bandscale-marker-value">
              {num(value!, decimals)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Schwellenwerte unter der Leiste, an ihrer Position */}
      <div className="bandscale-ticks">
        {segments.slice(0, -1).map((s, i) => (
          <span
            key={i}
            className="bandscale-tick"
            style={{ left: `${(((s.to ?? lo) - lo) / total) * 100}%` }}
          >
            {num(s.to!, decimals)}
          </span>
        ))}
      </div>

      <div className="bandscale-legend">
        {segments.map((s, i) => (
          <span key={i}>
            {s.from === null
              ? `bis ${num(s.to!, decimals)}`
              : s.to === null
                ? `ab ${num(s.from, decimals)}`
                : `${num(s.from, decimals)} bis ${num(s.to, decimals)}`}
            {s.note ? `: ${s.note}` : ''}
            {i < segments.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
