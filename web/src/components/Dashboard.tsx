/**
 * Nachbau der Vorlage: drei Faktorkarten, neun Indikatoren, schwarzer
 * Ergebnisbalken.
 *
 * Eine Ergaenzung gegenueber dem Original ist notwendig, nicht kosmetisch:
 * Datenqualitaet wird ausgewiesen. Die Vorlage konnte davon ausgehen, dass
 * alle neun Werte von Hand geprueft waren. Hier kommen sie aus teils
 * inoffiziellen Quellen, einer ist ein Ersatzwert, und historische Wochen
 * haben Luecken. Ein fehlender Wert darf nie wie eine 0 aussehen.
 */

import type { Comparison, ScoredFactor, ScoredIndicator, Sensitivity, Snapshot } from '../types';
import { num, scoreText, shortDate, signed, weekLabel } from '../format';

const QUALITY_LABEL: Record<string, string> = {
  proxy: 'Ersatzreihe',
  stale: 'veraltet',
  missing: 'kein Wert',
  manual: 'manuell',
};

function QualityTag({ quality }: { quality: string }) {
  if (quality === 'ok') return null;
  return (
    <span className={`quality-tag quality-${quality}`}>{QUALITY_LABEL[quality] ?? quality}</span>
  );
}

function IndicatorRow({ indicator }: { indicator: ScoredIndicator }) {
  const missing = indicator.quality === 'missing';
  const cls = missing ? 'none' : indicator.score > 0 ? 'pos' : indicator.score < 0 ? 'neg' : 'zero';

  return (
    <div className="indicator">
      <div className="ind-text">
        <div className="ind-label">
          {indicator.label}
          <QualityTag quality={indicator.quality} />
        </div>
        <div className="ind-detail">
          {missing ? (
            <em>kein Wert verfuegbar — zaehlt nicht in die Mehrheit</em>
          ) : (
            <>
              {indicator.display?.primary}
              {indicator.display?.secondary ? ` · ${indicator.display.secondary}` : ''}
            </>
          )}
        </div>
      </div>
      <div className={`badge ${cls}`}>{missing ? '—' : scoreText(indicator.score)}</div>
    </div>
  );
}

function FactorCard({
  factor,
  indicators,
}: {
  factor: ScoredFactor;
  indicators: ScoredIndicator[];
}) {
  return (
    <div className={`factor${factor.determinable ? '' : ' undeterminable'}`}>
      <div className="factor-title">
        Faktor {indicators[0]?.factor === 'business_cycle' ? '1' : indicators[0]?.factor === 'liquidity' ? '2' : '3'} ·{' '}
        {factor.label}
      </div>

      {indicators.map((ind) => (
        <IndicatorRow key={ind.id} indicator={ind} />
      ))}

      <div className="factor-result">
        <div>
          <div className="factor-result-label">Ergebnis</div>
          <div className="factor-result-text">{factor.rationale}</div>
        </div>
        {factor.determinable ? (
          <div className="factor-score">{scoreText(factor.score)}</div>
        ) : (
          <div className="factor-score undetermined">unbestimmt</div>
        )}
      </div>
    </div>
  );
}

function ComparisonNote({ wow }: { wow: Comparison }) {
  if (!wow.resolved) return <span>keine Vorwoche im Bestand</span>;
  const ref = `${wow.resolved.isoYear}-W${String(wow.resolved.isoWeek).padStart(2, '0')}`;
  if (wow.regimeChanged) {
    return (
      <span>
        {wow.totalDelta !== null && wow.totalDelta > 0 ? 'hochgestuft' : 'herabgestuft'} von{' '}
        {wow.previousRegime} ({weekLabel(ref)})
      </span>
    );
  }
  return (
    <span>
      unveraendert gegenueber {weekLabel(ref)}
      {wow.totalDelta !== null && wow.totalDelta !== 0
        ? ` (Score ${signed(wow.totalDelta, 0)})`
        : ''}
    </span>
  );
}

/** Die maschinelle Fassung des roten Kastens der Vorlage. */
function SensitivityCallout({
  sensitivity,
  snapshot,
}: {
  sensitivity: Sensitivity[];
  snapshot: Snapshot;
}) {
  const kipper = sensitivity.filter((s) => s.changesRegime);
  if (kipper.length === 0) return null;

  const closest = kipper[0]!;

  /*
   * Die Nachkommastellen richten sich nach der Einheit. Ein auf 2 Stellen
   * gerundeter Abstand von 0,024 neben einer Schwelle von −0,02 laese sich
   * sonst als "0,02 entfernt von −0,02" lesen — beides sichtbar gleich gross,
   * was den Punkt der Aussage zerstoert.
   */
  const decimalsFor = (unit: string) => (unit === 'bp' || unit === 'bps' ? 0 : unit === 'Idx' ? 3 : 2);
  const fmt = (v: number, unit: string) => `${signed(v, decimalsFor(unit))}`;
  const gapText = (v: number, unit: string) =>
    `${num(v, decimalsFor(unit))}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="callout">
      <strong>Die eine Entscheidung, an der das Regime haengt:</strong> {closest.label} steht{' '}
      {gapText(closest.gap, closest.unit)} von der Schwelle {fmt(closest.boundary, closest.unit)}{' '}
      entfernt. Ein Wechsel {closest.direction === 'down' ? 'nach unten' : 'nach oben'} setzt den
      Indikator auf {scoreText(closest.toScore)} und damit den Gesamtscore auf{' '}
      {scoreText(closest.resultingTotal)} — {closest.resultingRegime}.
      {kipper.length > 1 && (
        <>
          {' '}
          Insgesamt wuerden {kipper.length} einzelne Indikatorwechsel das Regime drehen:
          <ul>
            {kipper.map((k) => (
              <li key={k.indicator}>
                {k.label}: {gapText(k.gap, k.unit)} bis Schwelle {fmt(k.boundary, k.unit)} →{' '}
                {k.resultingRegime}
              </li>
            ))}
          </ul>
          Bei einem Gesamtscore von {scoreText(snapshot.total)} reicht jeder Faktor, der seine
          Mehrheit verliert.
        </>
      )}
    </div>
  );
}

export function Dashboard({
  snapshot,
  wow,
  sensitivity,
}: {
  snapshot: Snapshot;
  wow: Comparison;
  sensitivity: Sensitivity[];
}) {
  const factorOrder = ['business_cycle', 'liquidity', 'sentiment'];
  const indicatorsOf = (factorId: string) =>
    Object.values(snapshot.indicators)
      .filter((i) => i.factor === factorId)
      .sort((a, b) => a.id.localeCompare(b.id));

  // Reihenfolge wie in der Vorlage, nicht alphabetisch.
  const ORDER: Record<string, string[]> = {
    business_cycle: ['ism_mfg_pmi', 'nfci', 't10y2y'],
    liquidity: ['gli', 'move', 'sofr_iorb'],
    sentiment: ['vix', 'aaii', 'fear_greed'],
  };
  const ordered = (factorId: string) =>
    (ORDER[factorId] ?? [])
      .map((id) => snapshot.indicators[id])
      .filter((x): x is ScoredIndicator => Boolean(x));

  const headline = wow.regimeChanged
    ? `Scoring: Gesamtscore ${scoreText(snapshot.total)} — ${
        wow.totalDelta !== null && wow.totalDelta > 0 ? 'Hochstufung' : 'Herabstufung'
      } auf ${snapshot.regime.label}`
    : `Scoring: Gesamtscore ${scoreText(snapshot.total)} — ${snapshot.regime.label}`;

  return (
    <>
      <div className="eyebrow">
        Makro-Scoring · Regime-Check · KW {snapshot.isoWeek}
        {snapshot.isoYear !== new Date().getFullYear() ? `/${snapshot.isoYear}` : ''}
      </div>
      <h1>{headline}</h1>
      <p className="subline">
        Neun Whitelist-Indikatoren, drei Faktoren, ein Score. Datenstand{' '}
        {shortDate(snapshot.dataAsOf)}
        {snapshot.completeness !== 'full' && ' · unvollstaendig'}.
      </p>

      {!snapshot.meaningful && (
        <div className="callout warn">
          <strong>Dieser Stand traegt keine Aussage.</strong> Bei{' '}
          {snapshot.undeterminableFactors.length === 1 ? 'einem Faktor' : `${snapshot.undeterminableFactors.length} Faktoren`}{' '}
          fehlen zu viele Werte, um die Mehrheitsregel anzuwenden. Der Gesamtscore{' '}
          {scoreText(snapshot.total)} und das Regime „{snapshot.regime.label}" ergeben sich hier aus
          der Datenluecke, nicht aus dem Marktgeschehen — sie duerfen nicht als Stand gelesen werden.
        </div>
      )}

      <div className="factors">
        {factorOrder.map((fid) => {
          const factor = snapshot.factors[fid];
          if (!factor) return null;
          const inds = ordered(fid).length > 0 ? ordered(fid) : indicatorsOf(fid);
          return <FactorCard key={fid} factor={factor} indicators={inds} />;
        })}
      </div>

      <div className="total-bar">
        <div className="total-cell">
          <div className="total-label">Gesamtscore</div>
          <div className="total-value">{scoreText(snapshot.total)}</div>
          <div className="total-note">
            aus{' '}
            {factorOrder
              .map((f) => (snapshot.factors[f]?.determinable ? scoreText(snapshot.factors[f]!.score) : '?'))
              .join(' / ')}
          </div>
        </div>
        <div className="total-cell">
          <div className="total-label">Regime</div>
          <div className="total-value gold" style={{ fontSize: 38 }}>
            {snapshot.regime.label}
          </div>
          <div className="total-note">
            <ComparisonNote wow={wow} />
          </div>
        </div>
        <div className="total-cell">
          <div className="total-label">Soll-Cash Alpha-Depot</div>
          <div className="total-value">
            {snapshot.regime.cashBand[0]}–{snapshot.regime.cashBand[1]} %
          </div>
          <div className="total-note">
            Bandbreite laut Regel{snapshot.regime.assumed ? ' (gesetzte Annahme)' : ''}
          </div>
        </div>
      </div>

      {snapshot.meaningful && (
        <SensitivityCallout sensitivity={sensitivity} snapshot={snapshot} />
      )}

      {snapshot.notes.length > 0 && (
        <div className="callout warn">
          <strong>Hinweise zu diesem Lauf:</strong>
          <ul>
            {snapshot.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
