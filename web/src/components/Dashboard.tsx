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

import { useState } from 'react';
import type {
  Comparison,
  RulesResponse,
  ScenarioBacktestReport,
  ScoredFactor,
  ScoredIndicator,
  Sensitivity,
  Snapshot,
} from '../types';
import { num, scoreText, shortDate, signed, weekLabel } from '../format';
import { useScenarios } from './useScenarios';
import { DeltaTable } from './DeltaTable';
import { HelpModal } from './HelpModal';
import { IndicatorCard } from './IndicatorCard';
import { ScoreChip } from './ScoreChip';
import { WeekPicker } from './WeekPicker';
import { FACTOR_HELP } from '../content/help';

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

/**
 * Das Fragezeichen neben einem Faktor- oder Indikatornamen.
 *
 * Bewusst klein und blass: es soll auffindbar sein, ohne mit dem Wert zu
 * konkurrieren, um den es hier eigentlich geht.
 */
function HelpDot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="help-dot"
      onClick={onClick}
      aria-label={`Erklaerung zu ${label}`}
      title={`Erklaerung zu ${label}`}
    >
      ?
    </button>
  );
}

function IndicatorRow({
  indicator,
  onShowHelp,
}: {
  indicator: ScoredIndicator;
  /** Fehlt, solange das Regelwerk nicht geladen ist — dann gaebe es nichts zu zeigen. */
  onShowHelp?: () => void;
}) {
  const missing = indicator.quality === 'missing';
  const cls = missing ? 'none' : indicator.score > 0 ? 'pos' : indicator.score < 0 ? 'neg' : 'zero';

  return (
    <div className="indicator">
      <div className="ind-text">
        <div className="ind-label">
          {indicator.label}
          <QualityTag quality={indicator.quality} />
          {onShowHelp && <HelpDot label={indicator.label} onClick={onShowHelp} />}
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
  position,
  indicators,
  onShowFactorHelp,
  onShowIndicatorHelp,
}: {
  factor: ScoredFactor;
  /** 1, 2 oder 3 — die Nummer aus der Vorlage, nicht aus dem Alphabet. */
  position: number;
  indicators: ScoredIndicator[];
  onShowFactorHelp: () => void;
  onShowIndicatorHelp?: (id: string) => void;
}) {
  return (
    <div className={`factor${factor.determinable ? '' : ' undeterminable'}`}>
      <div className="factor-title">
        Faktor {position} · {factor.label}
        <HelpDot label={factor.label} onClick={onShowFactorHelp} />
      </div>

      {indicators.map((ind) => (
        <IndicatorRow
          key={ind.id}
          indicator={ind}
          onShowHelp={onShowIndicatorHelp && (() => onShowIndicatorHelp(ind.id))}
        />
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

/**
 * Die Faktor-Erklaerung im Hilfe-Fenster.
 *
 * Anders als beim Indikator gibt es hier keinen gemeinsamen Baustein mit dem
 * Hilfe-Tab — dort verteilt sich die Erklaerung auf Panelkopf und Fliesstext,
 * weil sie drei Indikatorkarten anfuehrt. Der TEXT ist trotzdem derselbe: er
 * kommt aus FACTOR_HELP, nicht aus dieser Datei.
 */
function FactorHelpCard({ factor, position }: { factor: ScoredFactor; position: number }) {
  const help = FACTOR_HELP[factor.id];

  return (
    <div className="help-card">
      <div className="help-card-head">
        <div>
          <div className="help-card-title">
            Faktor {position} · {factor.label}
          </div>
          {help && <div className="help-card-short">{help.short}</div>}
        </div>
        {factor.determinable && <ScoreChip score={factor.score} />}
      </div>
      <div className="help-card-body">
        {help && <p>{help.detail}</p>}
        <div className="help-why">
          <span className="help-why-label">Ergebnis dieser Woche</span>
          {factor.determinable ? factor.rationale : <em>unbestimmt · {factor.rationale}</em>}
        </div>
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

/**
 * Die vier Szenarien in Kurzform — das Zwei-Indikatoren-Pendant zum
 * Grenzfall-Kasten darueber.
 *
 * Bewusst nur Ergebnis, kein Ausloeser und keine Einordnung: die gehoeren in
 * die Hilfe, wo Platz zum Erklaeren ist. Hier steht, was sich bewegt und was
 * dabei herauskommt.
 */
function ScenarioStrip({
  snapshot,
  rules,
  scenarios,
  onShowHelp,
}: {
  snapshot: Snapshot;
  rules: RulesResponse | null;
  scenarios: ScenarioBacktestReport | null;
  onShowHelp: () => void;
}) {
  const results = useScenarios(snapshot, rules, scenarios);
  if (results.length === 0) return null;

  return (
    <div className="scenario-strip">
      <div className="scenario-strip-head">
        <span>
          Vier Durchspielungen · gerechnet von <strong>{weekLabel(snapshot.weekKey)}</strong> aus —
          die Wochenauswahl oben zieht sie mit
        </span>
        <button className="scenario-strip-link" onClick={onShowHelp}>
          Ausloeser und Einordnung in der Hilfe →
        </button>
      </div>

      {results.map((r) => (
        <div key={r.scenarioId} className={`scenario-strip-row${r.changed ? ' flips' : ''}`}>
          <div className="scenario-strip-title">{r.title}</div>

          <div className="scenario-strip-moves">
            {r.alreadyTrue ? (
              <em>bereits eingetreten</em>
            ) : (
              r.moves.map((m) => (
                <span key={m.id}>
                  {m.label} {scoreText(m.before)} → {scoreText(m.after)}
                </span>
              ))
            )}
            {r.assumedWithoutValue.map((id) => (
              <span key={id} className="scenario-strip-assumed">
                {snapshot.indicators[id]?.label ?? id} ohne Wert — angesetzt
              </span>
            ))}
          </div>

          <div className="scenario-strip-score">
            {scoreText(r.totalBefore)} → <strong>{scoreText(r.totalAfter)}</strong>
          </div>

          <div className="scenario-strip-regime">
            {r.changed ? (
              <strong>{r.regimeAfter.label}</strong>
            ) : (
              <>bleibt {r.regimeAfter.label}</>
            )}
          </div>

          {/*
            Nur "so lag es zuletzt", nie eine Quote: die Zahl steht direkt
            neben einer kontrafaktischen Rechnung und wuerde sonst als
            Eintrittswahrscheinlichkeit gelesen. Fehlt der Backtest, entfaellt
            die Zelle wortlos — ein "—" saehe aus wie ein Wert.
          */}
          {r.backtest && (
            <div className="scenario-strip-history">
              {r.backtest.occurrences === 0 ? (
                <>im Bestand nie vorgekommen</>
              ) : (
                <>
                  {r.backtest.occurrences} Wochen
                  {r.backtest.lastWeek && <> · zuletzt {weekLabel(r.backtest.lastWeek)}</>}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Dashboard({
  snapshot,
  wow,
  yoy,
  sensitivity,
  rules,
  scenarios,
  onShowScenarioHelp,
  weekOptions,
  selectedWeek,
  hiddenWeekCount,
  onSelectWeek,
}: {
  snapshot: Snapshot;
  wow: Comparison;
  /** Fuer die Delta-Tabelle — sie zog vom Verlauf hierher, weil sie an der gewaehlten Woche haengt. */
  yoy: Comparison;
  sensitivity: Sensitivity[];
  rules: RulesResponse | null;
  scenarios: ScenarioBacktestReport | null;
  onShowScenarioHelp: () => void;
  weekOptions: { weekKey: string; total: number; regime: string }[];
  selectedWeek: string;
  /** Anzahl der aus der Auswahl ausgeblendeten Backfill-Wochen — nur fuer den Tooltip. */
  hiddenWeekCount: number;
  onSelectWeek: (weekKey: string) => void;
}) {
  /*
   * Wofuer das Hilfe-Fenster offen ist — nur die Kennung, nicht der Text.
   * Gezeigt wird derselbe Baustein wie im Hilfe-Tab, damit es jede Erklaerung
   * genau einmal gibt.
   */
  const [helpFor, setHelpFor] = useState<{ kind: 'factor' | 'indicator'; id: string } | null>(null);

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
      <div className="header-bar">
        <div>
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
        </div>
        <WeekPicker
          options={weekOptions}
          selected={selectedWeek}
          hiddenCount={hiddenWeekCount}
          onSelect={onSelectWeek}
        />
      </div>

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
        {factorOrder.map((fid, i) => {
          const factor = snapshot.factors[fid];
          if (!factor) return null;
          const inds = ordered(fid).length > 0 ? ordered(fid) : indicatorsOf(fid);
          return (
            <FactorCard
              key={fid}
              factor={factor}
              position={i + 1}
              indicators={inds}
              onShowFactorHelp={() => setHelpFor({ kind: 'factor', id: fid })}
              /*
               * Ohne Regelwerk kann die Indikatorkarte weder Stufen noch
               * Schwellen zeigen — dann bleibt das Fragezeichen weg, statt
               * ein leeres Fenster zu oeffnen.
               */
              onShowIndicatorHelp={
                rules ? (id) => setHelpFor({ kind: 'indicator', id }) : undefined
              }
            />
          );
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

      {/*
        Haengt an der gewaehlten Woche wie alles bisher oben — deshalb hier
        und nicht im wochenunabhaengigen Verlauf. Ungefiltert sichtbar, auch
        bei unvollstaendiger Lage: sie ist eine Tatsache (was sich bewegt
        hat), keine Durchspielung.
      */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Veraenderung je Indikator</div>
            <div className="panel-sub">Vorwoche und Vorjahres-Kalenderwoche nebeneinander</div>
          </div>
        </div>
        <div className="panel-body flush">
          <DeltaTable wow={wow} yoy={yoy} />
        </div>
      </div>

      {/*
        Beides nur bei belastbarer Lage. Eine Durchspielung aus einem Stand
        ohne Aussage hat selbst keine — derselbe Massstab wie beim
        Grenzfall-Kasten. Der Hilfe-Tab zeigt die Szenarien weiterhin, dort
        aber mit dem ausdruecklichen Warnhinweis davor.
      */}
      {snapshot.meaningful && (
        <>
          <SensitivityCallout sensitivity={sensitivity} snapshot={snapshot} />
          <ScenarioStrip
            snapshot={snapshot}
            rules={rules}
            scenarios={scenarios}
            onShowHelp={onShowScenarioHelp}
          />
        </>
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

      {helpFor && (
        <HelpModal
          title={
            (helpFor.kind === 'factor'
              ? snapshot.factors[helpFor.id]?.label
              : snapshot.indicators[helpFor.id]?.label) ?? helpFor.id
          }
          onClose={() => setHelpFor(null)}
        >
          {helpFor.kind === 'factor'
            ? snapshot.factors[helpFor.id] && (
                <FactorHelpCard
                  factor={snapshot.factors[helpFor.id]!}
                  position={factorOrder.indexOf(helpFor.id) + 1}
                />
              )
            : rules && (
                <IndicatorCard
                  id={helpFor.id}
                  rules={rules}
                  indicator={snapshot.indicators[helpFor.id]}
                  sensitivity={sensitivity.find((s) => s.indicator === helpFor.id)}
                />
              )}
        </HelpModal>
      )}
    </>
  );
}
